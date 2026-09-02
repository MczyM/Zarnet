const rateLimit = require('express-rate-limit');

// Closes the "no rate-limiting on the API" gap from the original pilot build.
// Public voucher endpoints (purchase-intent, check-payment, redeem) are the
// ones anyone who finds the URL could hammer, so they get the tightest limit.
const voucherLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down and try again shortly.' },
});

// Looser limit for admin-authenticated / read-mostly routes.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { voucherLimiter, adminLimiter };
