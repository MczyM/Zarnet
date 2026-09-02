// One-time setup: creates the ZRT token mint and a fresh treasury keypair
// (the mint authority + fee payer for every settlement transaction), then
// prints exactly what to paste into .env. Safe to re-run on devnet if you
// want a fresh mint — it never touches an existing mint address.
//
// Usage: node scripts/setupZrtMint.js
require('dotenv').config();
const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createMint } = require('@solana/spl-token');

async function main() {
  const clusterUrl = process.env.SOLANA_CLUSTER_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(clusterUrl, 'confirmed');
  const isDevnet = clusterUrl.includes('devnet');

  const treasury = Keypair.generate();
  console.log(`Generated treasury keypair: ${treasury.publicKey.toBase58()}`);

  if (isDevnet) {
    console.log('Requesting a devnet SOL airdrop to fund the mint-creation transaction...');
    const sig = await connection.requestAirdrop(treasury.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('Airdrop confirmed.');
  } else {
    console.log('Not on devnet — make sure this wallet already holds enough SOL to pay network fees before continuing, or this will fail.');
  }

  // 6 decimals — matches the raw-amount math in src/services/zrt.js.
  const mint = await createMint(connection, treasury, treasury.publicKey, null, 6);

  console.log('\nZRT mint created:', mint.toBase58());
  console.log('\nAdd these to your .env:\n');
  console.log(`ZRT_MINT_ADDRESS=${mint.toBase58()}`);
  console.log(`ZRT_TREASURY_SECRET_KEY=${JSON.stringify(Array.from(treasury.secretKey))}`);
  console.log('\nKeep ZRT_TREASURY_SECRET_KEY private — it is the mint authority for ZRT and can mint unlimited tokens. Never commit it or expose it to the frontend.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
