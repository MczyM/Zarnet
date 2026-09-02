const express = require('express');
const { customAlphabet } = require('nanoid');
const { pool, withTransaction } = require('../db');
const { createPaymentReference, buildPaymentUrl, verifyPayment } = require('../services/solana');
const { authorizeClient } = require('../services/omada');
const { requireAuth, requireSiteAccess } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4); // no confusing chars

function generateCode() {
  return `ZN-${nanoid()}-${nanoid()}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function zarCentsToLamports(zarCents) {
  const zar = zarCents / 100;
  const sol = zar / config.zarPerSol;
  return Math.round(sol * LAMPORTS_PER_SOL);
}

async function getSiteBySlug(slug) {
  const { rows } = await pool.query(`SELECT * FROM sites WHERE slug = $1`, [slug]);
  return rows[0] || null;
}

// POST /sites/:slug/vouchers/purchase-intent { packageSlug }
// Creates an unpaid voucher and returns a Solana Pay URL, for a customer who
// wants to pay live with their own wallet at the portal.
router.post('/:slug/vouchers/purchase-intent', async (req, res) => {
  const site = await getSiteBySlug(req.params.slug);
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const { packageSlug } = req.body;
  const { rows: pkgRows } = await pool.query(
    `SELECT * FROM packages WHERE site_id = $1 AND slug = $2 AND active = true`,
    [site.id, packageSlug]
  );
  const pkg = pkgRows[0];
  if (!pkg) return res.status(404).json({ error: 'Unknown package' });

  const code = generateCode();
  const reference = createPaymentReference();
  const lamports = zarCentsToLamports(pkg.price_zar_cents);

  await pool.query(
    `INSERT INTO vouchers (site_id, code, package_id, status, payment_method, payment_reference)
     VALUES ($1, $2, $3, 'unused', 'solana', $4)`,
    [site.id, code, pkg.id, reference]
  );

  const paymentUrl = buildPaymentUrl({
    amountSol: (lamports / LAMPORTS_PER_SOL).toFixed(9),
    reference,
    label: site.name,
    message: `${pkg.name} voucher`,
  });

  res.json({ code, reference, paymentUrl, expectedLamports: lamports, package: pkg.slug });
});

// POST /sites/:slug/vouchers/:code/check-payment
router.post('/:slug/vouchers/:code/check-payment', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT v.*, p.price_zar_cents FROM vouchers v
     JOIN packages p ON p.id = v.package_id JOIN sites s ON s.id = v.site_id
     WHERE s.slug = $1 AND v.code = $2`,
    [req.params.slug, req.params.code]
  );
  const voucher = rows[0];
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.solana_tx_sig) return res.json({ paid: true, alreadyConfirmed: true });

  const expectedLamports = zarCentsToLamports(voucher.price_zar_cents);
  const result = await verifyPayment({ reference: voucher.payment_reference, expectedLamports });

  if (result.verified) {
    await pool.query('UPDATE vouchers SET solana_tx_sig = $1 WHERE id = $2', [result.signature, voucher.id]);
    return res.json({ paid: true, signature: result.signature });
  }
  res.json({ paid: false });
});

// POST /sites/:slug/vouchers/:code/redeem { clientMac, apMac, ssidName, radioId }
// Called from the captive portal page once the customer enters their code.
// Authorizes the device on THIS site's Omada network, then atomically both
// activates the voucher and queues its ZRT settlement — so a redemption can
// never be recorded without also being queued for the on-chain ledger.
router.post('/:slug/vouchers/:code/redeem', async (req, res) => {
  const site = await getSiteBySlug(req.params.slug);
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const { clientMac, apMac, ssidName, radioId } = req.body;
  if (!clientMac) return res.status(400).json({ error: 'clientMac is required' });

  const { rows } = await pool.query(
    `SELECT v.*, p.device_limit, p.duration_hours, p.zrt_amount, p.name AS package_name
     FROM vouchers v JOIN packages p ON p.id = v.package_id
     WHERE v.site_id = $1 AND v.code = $2`,
    [site.id, req.params.code]
  );
  const voucher = rows[0];
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.status === 'expired' || voucher.status === 'revoked') {
    return res.status(410).json({ error: `Voucher is ${voucher.status}` });
  }
  const isPaid = Boolean(voucher.solana_tx_sig) || voucher.payment_method === 'cash_reseller';
  if (!isPaid) return res.status(402).json({ error: 'Voucher not yet paid' });

  const { rows: existingSessionRows } = await pool.query(
    `SELECT s.id FROM sessions s JOIN devices d ON d.id = s.device_id
     WHERE s.voucher_id = $1 AND d.mac_address = $2 AND s.revoked_at IS NULL`,
    [voucher.id, clientMac]
  );
  const alreadyConnected = existingSessionRows.length > 0;

  if (!alreadyConnected) {
    const { rows: sessionRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sessions WHERE voucher_id = $1 AND revoked_at IS NULL`,
      [voucher.id]
    );
    const activeDevices = sessionRows[0].n;
    if (voucher.status === 'active' && activeDevices >= voucher.device_limit) {
      return res.status(409).json({ error: 'Device limit reached for this voucher' });
    }
  }

  const durationSeconds = voucher.duration_hours * 3600;
  const isFirstRedemption = voucher.status === 'unused';

  // Talk to the physical network first — if the AP rejects it, nothing
  // in the database changes and the customer can simply retry.
  try {
    await authorizeClient(site, { clientMac, apMac, ssidName, radioId, durationSeconds });
  } catch (err) {
    console.error(`[redeem] Omada authorization failed for site "${site.slug}":`, err.message);
    return res.status(502).json({ error: 'Could not reach this site\'s network controller. Try again in a moment.' });
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO devices (site_id, mac_address) VALUES ($1, $2)
       ON CONFLICT (site_id, mac_address) DO NOTHING`,
      [site.id, clientMac]
    );
    const { rows: deviceRows } = await client.query(
      `SELECT id FROM devices WHERE site_id = $1 AND mac_address = $2`,
      [site.id, clientMac]
    );
    const deviceId = deviceRows[0].id;

    await client.query(
      `INSERT INTO sessions (site_id, voucher_id, device_id)
       VALUES ($1, $2, $3) ON CONFLICT (voucher_id, device_id) DO NOTHING`,
      [site.id, voucher.id, deviceId]
    );

    if (isFirstRedemption) {
      const expiresAt = new Date(Date.now() + durationSeconds * 1000);
      await client.query(
        `UPDATE vouchers SET status = 'active', redeemed_at = now(), expires_at = $1 WHERE id = $2`,
        [expiresAt, voucher.id]
      );

      // Queue the on-chain settlement in the SAME transaction as activation,
      // so this redemption can never be lost even if the process crashes
      // right after this point. The settlement worker drains it async.
      if (site.solana_wallet_address) {
        await client.query(
          `INSERT INTO ledger_entries (site_id, voucher_id, zrt_amount, destination_wallet)
           VALUES ($1, $2, $3, $4)`,
          [site.id, voucher.id, voucher.zrt_amount, site.solana_wallet_address]
        );
      } else {
        console.warn(`[redeem] site "${site.slug}" has no solana_wallet_address set — skipping ZRT settlement for voucher ${voucher.code}`);
      }
    }
  });

  res.json({ authorized: true, package: voucher.package_name, durationSeconds });
});

// POST /sites/:slug/vouchers/batch { packageSlug, count, batchId }
// Admin/reseller endpoint: pre-generate voucher codes to sell for cash.
router.post('/:slug/vouchers/batch', requireAuth, requireSiteAccess, async (req, res) => {
  const site = await getSiteBySlug(req.params.slug);
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const { packageSlug, count, batchId } = req.body;
  if (!count || count < 1 || count > 500) return res.status(400).json({ error: 'count must be between 1 and 500' });

  const { rows: pkgRows } = await pool.query(
    `SELECT * FROM packages WHERE site_id = $1 AND slug = $2`,
    [site.id, packageSlug]
  );
  const pkg = pkgRows[0];
  if (!pkg) return res.status(404).json({ error: 'Unknown package' });

  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    await pool.query(
      `INSERT INTO vouchers (site_id, code, package_id, status, payment_method, reseller_batch)
       VALUES ($1, $2, $3, 'unused', 'cash_reseller', $4)`,
      [site.id, code, pkg.id, batchId || null]
    );
    codes.push(code);
  }
  res.json({ batchId: batchId || null, package: pkg.slug, codes });
});

// GET /sites/:slug/vouchers — admin listing for the dashboard table.
router.get('/:slug/vouchers', requireAuth, requireSiteAccess, async (req, res) => {
  const site = await getSiteBySlug(req.params.slug);
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const { rows } = await pool.query(
    `SELECT v.code, v.status, v.payment_method, v.created_at, v.redeemed_at, v.expires_at,
            p.name AS package_name, le.status AS ledger_status, le.tx_signature
     FROM vouchers v JOIN packages p ON p.id = v.package_id
     LEFT JOIN ledger_entries le ON le.voucher_id = v.id
     WHERE v.site_id = $1 ORDER BY v.created_at DESC LIMIT $2`,
    [site.id, limit]
  );
  res.json(rows);
});

module.exports = router;
