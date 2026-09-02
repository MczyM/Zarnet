require('express-async-errors'); // must be required before any router that uses async handlers
const express = require('express');
const cors = require('cors');
const config = require('./config');

const siteRoutes = require('./routes/sites');
const packageRoutes = require('./routes/packages');
const voucherRoutes = require('./routes/vouchers');
const adminRoutes = require('./routes/admin');
const { voucherLimiter, adminLimiter } = require('./middleware/rateLimiter');
const { startSettlementWorker } = require('./workers/settlementWorker');
const { startExpiryWorker } = require('./workers/expiryWorker');

const app = express();

app.use(cors({
  origin: config.corsOrigins.length ? config.corsOrigins : true,
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

// Rate limiters run BEFORE the router they protect. voucherRoutes holds the
// unauthenticated, anonymously-callable endpoints (purchase-intent,
// check-payment, redeem) so it gets the tighter limit; everything else is
// already behind requireAuth and gets the looser one.
app.use('/sites', voucherLimiter, voucherRoutes); // /sites/:slug/(purchase-intent|:code/...|batch)
app.use('/sites', adminLimiter, packageRoutes);   // /sites/:slug/packages
app.use('/sites', adminLimiter, siteRoutes);      // /sites, /sites/:slug/public, PATCH /sites/:slug
app.use('/admin', adminLimiter, adminRoutes);     // /admin/login, /admin/me, /sites/:slug/dashboard

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Zarnet backend listening on :${config.port}`);
  startSettlementWorker();
  startExpiryWorker();
});
