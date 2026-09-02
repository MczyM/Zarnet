const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireSiteAccess } = require('../middleware/auth');

const router = express.Router();

router.get('/:slug/packages', requireAuth, requireSiteAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.* FROM packages p JOIN sites s ON s.id = p.site_id WHERE s.slug = $1 ORDER BY p.price_zar_cents`,
    [req.params.slug]
  );
  res.json(rows);
});

router.post('/:slug/packages', requireAuth, requireSiteAccess, async (req, res) => {
  const { slug, name, deviceLimit, durationHours, speedMbps, priceZarCents, zrtAmount } = req.body;
  if (!slug || !name || !deviceLimit || !durationHours || !priceZarCents || zrtAmount === undefined) {
    return res.status(400).json({ error: 'slug, name, deviceLimit, durationHours, priceZarCents, zrtAmount are required' });
  }
  const { rows: siteRows } = await pool.query(`SELECT id FROM sites WHERE slug = $1`, [req.params.slug]);
  const site = siteRows[0];
  if (!site) return res.status(404).json({ error: 'Unknown site' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO packages (site_id, slug, name, device_limit, duration_hours, speed_mbps, price_zar_cents, zrt_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [site.id, slug, name, deviceLimit, durationHours, speedMbps || 100, priceZarCents, zrtAmount]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A package with that slug already exists on this site' });
    throw err;
  }
});

router.patch('/:slug/packages/:packageSlug', requireAuth, requireSiteAccess, async (req, res) => {
  const keyMap = {
    name: 'name', deviceLimit: 'device_limit', durationHours: 'duration_hours',
    speedMbps: 'speed_mbps', priceZarCents: 'price_zar_cents', zrtAmount: 'zrt_amount', active: 'active',
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

  values.push(req.params.slug, req.params.packageSlug);
  const { rows } = await pool.query(
    `UPDATE packages SET ${sets.join(', ')}
     WHERE site_id = (SELECT id FROM sites WHERE slug = $${values.length - 1}) AND slug = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'Unknown package' });
  res.json(rows[0]);
});

module.exports = router;
