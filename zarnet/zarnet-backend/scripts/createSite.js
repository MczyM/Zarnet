// Onboard a new client site from the terminal.
// Usage: npm run create-site -- --slug=sunset-backpackers --name="Sunset Backpackers" --wallet=<solana-pubkey>
const { pool } = require('../src/db');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const { slug, name, wallet, email } = parseArgs();
  if (!slug || !name) {
    console.error('Usage: npm run create-site -- --slug=my-site --name="My Site" [--wallet=<pubkey>] [--email=ops@client.com]');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `INSERT INTO sites (slug, name, contact_email, brand_logo_text, solana_wallet_address)
     VALUES ($1, $2, $3, $2, $4) RETURNING id, slug, name`,
    [slug, name, email || null, wallet || null]
  );

  console.log('Site created:', rows[0]);
  console.log(`Next: seed at least one package for it (POST /sites/${slug}/packages once you're logged in as an admin), and set its Omada details with PATCH /sites/${slug}.`);
  if (!wallet) console.log('No --wallet given — ZRT settlement will queue as pending until you set solana_wallet_address for this site.');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create site:', err.message);
  process.exit(1);
});
