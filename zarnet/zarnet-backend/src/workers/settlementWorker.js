const { pool } = require('../db');
const { mintZrtToWallet } = require('../services/zrt');
const config = require('../config');

// Drains pending ledger_entries and settles each one on-chain. A voucher is
// activated for the customer immediately at redeem time (see routes/vouchers.js)
// — this worker runs independently in the background so the customer never
// waits on a blockchain confirmation to get online. Failures are retried
// with a short backoff, up to ZRT_SETTLEMENT_MAX_ATTEMPTS, then parked as
// 'failed' for manual review in the admin dashboard rather than retried forever.
async function settleOnce() {
  const { rows: pending } = await pool.query(
    `SELECT * FROM ledger_entries WHERE status = 'pending' AND attempts < $1 ORDER BY id LIMIT 20`,
    [config.zrtSettlementMaxAttempts]
  );

  for (const entry of pending) {
    try {
      if (!entry.destination_wallet) {
        throw new Error('Site has no Solana wallet on file — set one before this can settle');
      }
      const signature = await mintZrtToWallet({
        destinationWalletAddress: entry.destination_wallet,
        amount: Number(entry.zrt_amount),
      });
      await pool.query(
        `UPDATE ledger_entries SET status = 'confirmed', tx_signature = $1, confirmed_at = now(), attempts = attempts + 1 WHERE id = $2`,
        [signature, entry.id]
      );
    } catch (err) {
      const attempts = entry.attempts + 1;
      const nextStatus = attempts >= config.zrtSettlementMaxAttempts ? 'failed' : 'pending';
      await pool.query(
        `UPDATE ledger_entries SET attempts = $1, last_error = $2, status = $3 WHERE id = $4`,
        [attempts, String(err.message || err).slice(0, 500), nextStatus, entry.id]
      );
      console.error(`[settlement] ledger_entry ${entry.id} failed (attempt ${attempts}):`, err.message);
    }
  }
}

function startSettlementWorker() {
  if (!config.zrtMintAddress || !config.zrtTreasurySecretKey) {
    console.warn('[settlement] ZRT_MINT_ADDRESS / ZRT_TREASURY_SECRET_KEY not set — settlement worker is paused. Redemptions still work; ledger entries will queue up as pending until you run `npm run setup-zrt-mint`.');
    return;
  }
  setInterval(() => {
    settleOnce().catch((err) => console.error('[settlement] worker tick failed:', err));
  }, config.zrtSettlementIntervalMs);
  console.log(`[settlement] worker started, polling every ${config.zrtSettlementIntervalMs}ms`);
}

module.exports = { startSettlementWorker, settleOnce };
