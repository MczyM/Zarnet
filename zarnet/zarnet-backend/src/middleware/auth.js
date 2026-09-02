const jwt = require('jsonwebtoken');
const config = require('../config');

// Verifies a Bearer JWT and attaches { id, email, role, siteId } to req.admin.
// role 'super_admin' has siteId = null and can act on any site.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Use after requireAuth on any route with a :slug param. Confirms the
// logged-in admin is allowed to act on that specific site.
function requireSiteAccess(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: 'Not authenticated' });
  if (req.admin.role === 'super_admin') return next();
  if (req.admin.siteSlug === req.params.slug) return next();
  return res.status(403).json({ error: 'Not authorized for this site' });
}

module.exports = { requireAuth, requireSiteAccess };
