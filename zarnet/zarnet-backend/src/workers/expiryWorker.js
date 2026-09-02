const { pool } = require('../db');
const config = require('../config');

// Flips vouchers past their expiry to 'expired' so the admin dashboard and
// API report accurate status. NOTE: this does not itself cut off a device's
// internet access — that's enforced by Omada using the `time` duration
// already passed to it at authorization (see services/omada.js). Forcibly
// kicking a client early is a real Omada API call, but it varies by
// controller firmware and hasn't been verified against real hardware yet —
// don't wire it up blind. Confirm the exact endpoint once your OC200 is
// online (Settings > Platform Integration), then extend this worker.
async function sweepOnce() {
  const { rowCount } = await pool.query(
    `UPDATE vouchers SET status = 'expired' WHERE status = 'active' AND expires_at < now()`
  );
  if (rowCount > 0) console.log(`[expiry] marked ${rowCount} voucher(s) expired`);
}

function startExpiryWorker() {
  setInterval(() => {
    sweepOnce().catch((err) => console.error('[expiry] worker tick failed:', err));
  }, config.expirySweepIntervalMs);
  console.log(`[expiry] worker started, sweeping every ${config.expirySweepIntervalMs}ms`);
}

module.exports = { startExpiryWorker, sweepOnce };
