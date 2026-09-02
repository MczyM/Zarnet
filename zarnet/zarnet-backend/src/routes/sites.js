const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireSiteAccess } = require('../middleware/auth');

const router = express.Router();

// PUBLIC — used by the captive portal / pricing frontend to render a given
// site's branding and active packages. No auth: this is what a customer's
// browser calls before they've paid for anything.
router.get('/:slug/public', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT slug, name, brand_accent_color, brand_logo_text, status FROM sites WHERE slug = $1`,
    [req.params.slug]
  );
  const site = rows[0];
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const { rows: packages } = await pool.query(
    `SELECT slug, name, device_limit, duration_hours, speed_mbps, price_zar_cents
     FROM packages WHERE site_id = (SELECT id FROM sites WHERE slug = $1) AND active = true ORDER BY price_zar_cents`,
    [req.params.slug]
  );

  res.json({ site, packages });
});

// Super-admin only — list every site.
router.get('/', requireAuth, async (req, res) => {
  if (req.admin.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
  const { rows } = await pool.query(`SELECT id, slug, name, status, created_at FROM sites ORDER BY created_at DESC`);
  res.json(rows);
});

// Super-admin only — onboard a new client site. (Also available as the
// `npm run create-site` CLI script for a quicker terminal workflow.)
router.post('/', requireAuth, async (req, res) => {
  if (req.admin.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' });
  const { slug, name, contactEmail, brandAccentColor, brandLogoText, solanaWalletAddress } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO sites (slug, name, contact_email, brand_accent_color, brand_logo_text, solana_wallet_address)
       VALUES ($1, $2, $3, COALESCE($4, '#B6FF3C'), $5, $6) RETURNING id, slug, name`,
      [slug, name, contactEmail || null, brandAccentColor || null, brandLogoText || name, solanaWalletAddress || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That slug is already taken' });
    throw err;
  }
});

// Update a site's own settings — operator of that site, or super admin.
router.patch('/:slug', requireAuth, requireSiteAccess, async (req, res) => {
  const keyMap = {
    name: 'name', contactEmail: 'contact_email', brandAccentColor: 'brand_accent_color',
    brandLogoText: 'brand_logo_text', omadaBaseUrl: 'omada_base_url', omadaControllerId: 'omada_controller_id',
    omadaSiteId: 'omada_site_id', omadaOperatorUsername: 'omada_operator_username',
    omadaOperatorPassword: 'omada_operator_password', omadaAllowSelfSigned: 'omada_allow_self_signed',
    solanaWalletAddress: 'solana_wallet_address', status: 'status',
  };

  const sets = [];
  const values = [];
  for (const [bodyKey, column] of Object.entries(keyMap)) {
    if (req.body[bodyKey] !== undefined) {
      values.push(req.body[bodyKey]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No recognized fields to update' });

  values.push(req.params.slug);
  const { rows } = await pool.query(
    `UPDATE sites SET ${sets.join(', ')} WHERE slug = $${values.length} RETURNING id, slug, name`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'Unknown site' });
  res.json(rows[0]);
});

module.exports = router;
