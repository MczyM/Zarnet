const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const config = require('../config');
const { requireAuth, requireSiteAccess } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await pool.query(
    `SELECT a.*, s.slug AS site_slug FROM admin_users a LEFT JOIN sites s ON s.id = a.site_id WHERE a.email = $1`,
    [email]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Incorrect email or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, siteSlug: user.site_slug || null },
    config.jwtSecret,
    { expiresIn: '12h' }
  );

  res.json({ token, role: user.role, siteSlug: user.site_slug || null });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.admin);
});

// Dashboard summary for a single site — revenue, active sessions, redemptions,
// and ZRT settlement health, all scoped to that site's own data only.
router.get('/:slug/dashboard', requireAuth, requireSiteAccess, async (req, res) => {
  const { rows: siteRows } = await pool.query(`SELECT id FROM sites WHERE slug = $1`, [req.params.slug]);
  const site = siteRows[0];
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  const [revenueToday, activeSessions, redeemedToday, ledgerStatus] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(p.price_zar_cents), 0)::bigint AS cents
       FROM vouchers v JOIN packages p ON p.id = v.package_id
       WHERE v.site_id = $1 AND v.redeemed_at >= date_trunc('day', now())`,
      [site.id]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM sessions WHERE site_id = $1 AND revoked_at IS NULL`,
      [site.id]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM vouchers WHERE site_id = $1 AND redeemed_at >= date_trunc('day', now())`,
      [site.id]
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS n FROM ledger_entries WHERE site_id = $1 GROUP BY status`,
      [site.id]
    ),
  ]);

  res.json({
    revenueTodayZarCents: Number(revenueToday.rows[0].cents),
    activeSessions: activeSessions.rows[0].n,
    redeemedToday: redeemedToday.rows[0].n,
    ledgerStatus: Object.fromEntries(ledgerStatus.rows.map((r) => [r.status, r.n])),
  });
});

module.exports = router;
