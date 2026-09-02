require('dotenv').config();

function required(name) {
  // Only enforced at the point of use (e.g. Solana calls), not at boot —
  // so the API can still come up for local frontend/dashboard work before
  // every secret is filled in.
  if (!process.env[name]) return null;
  return process.env[name];
}

module.exports = {
  port: process.env.PORT || 4000,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',

  solanaClusterUrl: process.env.SOLANA_CLUSTER_URL || 'https://api.devnet.solana.com',
  zrtMintAddress: process.env.ZRT_MINT_ADDRESS || null,
  zrtTreasurySecretKey: process.env.ZRT_TREASURY_SECRET_KEY || null,
  zrtSettlementMaxAttempts: parseInt(process.env.ZRT_SETTLEMENT_MAX_ATTEMPTS || '8', 10),
  zrtSettlementIntervalMs: parseInt(process.env.ZRT_SETTLEMENT_INTERVAL_MS || '15000', 10),
  expirySweepIntervalMs: parseInt(process.env.EXPIRY_SWEEP_INTERVAL_MS || '60000', 10),

  solanaMerchantWallet: process.env.SOLANA_MERCHANT_WALLET || null,
  zarPerSol: parseFloat(process.env.ZAR_PER_SOL || '2800'),

  required,
};
