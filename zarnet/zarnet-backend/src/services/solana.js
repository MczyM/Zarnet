const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const config = require('../config');

const connection = new Connection(config.solanaClusterUrl, 'confirmed');

/**
 * Creates a one-time "reference" keypair for a purchase intent.
 * The customer's wallet app includes this reference pubkey in the payment
 * transaction (Solana Pay convention), so we can find and verify it later
 * without needing a webhook. Used only for the "pay live with your own
 * wallet" path — cash/reseller vouchers never touch this.
 */
function createPaymentReference() {
  const kp = Keypair.generate();
  return kp.publicKey.toBase58();
}

function buildPaymentUrl({ amountSol, reference, label, message }) {
  const params = new URLSearchParams({
    amount: amountSol,
    reference,
    label: label || 'Zarnet',
    message: message || 'Zarnet voucher purchase',
  });
  return `solana:${config.solanaMerchantWallet}?${params.toString()}`;
}

async function verifyPayment({ reference, expectedLamports }) {
  const refPubkey = new PublicKey(reference);
  const signatures = await connection.getSignaturesForAddress(refPubkey, { limit: 5 });

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;
    const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;

    const paidToMerchant = tx.transaction.message.instructions.some((ix) => {
      return (
        ix.parsed &&
        ix.parsed.type === 'transfer' &&
        ix.parsed.info.destination === config.solanaMerchantWallet &&
        Number(ix.parsed.info.lamports) >= expectedLamports
      );
    });

    if (paidToMerchant) {
      return { verified: true, signature: sigInfo.signature };
    }
  }

  return { verified: false, signature: null };
}

module.exports = { connection, createPaymentReference, buildPaymentUrl, verifyPayment };
