const axios = require('axios');
const https = require('https');

/**
 * Omada's "External Portal Server" flow (controller v5.0.15+):
 *  1. POST /{controllerId}/api/v2/hotspot/login with an operator username/password
 *     -> returns a CSRF token and sets a TPOMADA_SESSIONID cookie
 *  2. POST /{controllerId}/api/v2/hotspot/extPortal/auth with the client's info
 *     and the CSRF token in the header -> authorizes that device on the network
 *  3. POST /{controllerId}/logout when done
 *
 * Every client site runs its own OC200, so every call here is parametrized
 * by that site's row (base URL, controller ID, operator credentials) instead
 * of a single global env var. Confirm on each real controller (Settings >
 * Platform Integration) whether the newer OAuth2 "Open API" is available —
 * if so it's simpler and worth migrating to; this external-portal flow is
 * the one guaranteed to exist on older OC200 firmware.
 */
function clientFor(site) {
  if (!site.omada_base_url) {
    throw new Error(`Site "${site.slug}" has no Omada controller configured yet`);
  }
  const httpsAgent = new https.Agent({
    rejectUnauthorized: !site.omada_allow_self_signed,
  });
  return axios.create({ baseURL: site.omada_base_url, httpsAgent, timeout: 10000 });
}

async function omadaLogin(site) {
  const client = clientFor(site);
  const { data } = await client.post(`/${site.omada_controller_id}/api/v2/hotspot/login`, {
    name: site.omada_operator_username,
    password: site.omada_operator_password,
  });

  if (!data || data.errorCode !== 0) {
    throw new Error(`Omada login failed for site "${site.slug}": ${data ? data.msg : 'no response'}`);
  }

  return { client, csrfToken: data.result.token };
}

/**
 * Authorizes a device's MAC address on `site`'s WiFi for `durationSeconds`.
 * Call this right after a voucher is successfully redeemed.
 */
async function authorizeClient(site, { clientMac, apMac, ssidName, radioId, durationSeconds }) {
  const { client, csrfToken } = await omadaLogin(site);

  const { data } = await client.post(
    `/${site.omada_controller_id}/api/v2/hotspot/extPortal/auth`,
    {
      clientMac,
      apMac,
      ssidName,
      radioId,
      site: site.omada_site_id,
      time: durationSeconds,
      authType: '4',
    },
    { headers: { 'Csrf-Token': csrfToken } }
  );

  await client.post(`/${site.omada_controller_id}/logout`, {}, { headers: { 'Csrf-Token': csrfToken } });

  if (!data || data.success !== true) {
    throw new Error(`Omada authorization failed for site "${site.slug}": ${data ? data.message : 'no response'}`);
  }

  return { authorized: true };
}

module.exports = { omadaLogin, authorizeClient };
