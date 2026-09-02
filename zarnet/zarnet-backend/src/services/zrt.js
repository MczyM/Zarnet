const {
  Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount, createMintToInstruction, TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const config = require('../config');

const connection = new Connection(config.solanaClusterUrl, 'confirmed');

// ZRT never reaches an end customer's wallet — customers just use a voucher
// code, no wallet required. Every redemption mints ZRT directly into the
// CLIENT SITE's own wallet (the hostel/school/business), so each site ends
// up with a real, independently-verifiable on-chain ledger of the access
// it has sold — this is what "converted to Solana in the backend" means.
// The treasury keypair is the ZRT mint authority and pays network fees.
function loadTreasuryKeypair() {
  if (!config.zrtTreasurySecretKey) {
    throw new Error('ZRT_TREASURY_SECRET_KEY is not set — run `npm run setup-zrt-mint` first');
  }
  const secret = Uint8Array.from(JSON.parse(config.zrtTreasurySecretKey));
  return Keypair.fromSecretKey(secret);
}

/**
 * Mints `amount` ZRT (as a whole-token float, e.g. 15.0) to a site's wallet.
 * Returns the transaction signature. Throws on any failure — the caller
 * (the settlement worker) is responsible for retry/backoff bookkeeping.
 */
async function mintZrtToWallet({ destinationWalletAddress, amount }) {
  if (!config.zrtMintAddress) {
    throw new Error('ZRT_MINT_ADDRESS is not set — run `npm run setup-zrt-mint` first');
  }
  const treasury = loadTreasuryKeypair();
  const mint = new PublicKey(config.zrtMintAddress);
  const destinationOwner = new PublicKey(destinationWalletAddress);

  const destinationAta = await getOrCreateAssociatedTokenAccount(
    connection, treasury, mint, destinationOwner
  );

  // ZRT is configured with 6 decimals at mint-creation time (see setupZrtMint.js).
  const rawAmount = BigInt(Math.round(amount * 1_000_000));

  const tx = new Transaction().add(
    createMintToInstruction(mint, destinationAta.address, treasury.publicKey, rawAmount, [], TOKEN_PROGRAM_ID)
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: 'confirmed' });
  return signature;
}

module.exports = { mintZrtToWallet, connection };
