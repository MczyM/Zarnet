// Create an admin login. Usage:
//   npm run create-admin -- --email=you@zarnet.online --password=... [--site=sunset-backpackers]
// Omit --site to create a super admin who can manage every site.
const bcrypt = require('bcryptjs');
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
  const { email, password, site } = parseArgs();
  if (!email || !password) {
    console.error('Usage: npm run create-admin -- --email=you@zarnet.online --password=yourpassword [--site=site-slug]');
    process.exit(1);
  }

  let siteId = null;
  let role = 'super_admin';
  if (site) {
    const { rows } = await pool.query('SELECT id FROM sites WHERE slug = $1', [site]);
    if (!rows[0]) throw new Error(`No site with slug "${site}" — create it first with npm run create-site`);
    siteId = rows[0].id;
    role = 'operator';
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO admin_users (site_id, email, password_hash, role) VALUES ($1, $2, $3, $4)
     RETURNING id, email, role`,
    [siteId, email, passwordHash, role]
  );

  console.log('Admin created:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
