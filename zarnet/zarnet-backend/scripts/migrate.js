const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

// Optional one-time bootstrap: if ADMIN_EMAIL and ADMIN_PASSWORD are set and
// no admin with that email exists yet, create a super_admin login. Safe to
// leave these env vars set permanently — this only ever creates the account
// once; every later boot just skips it silently since the email already exists.
async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows } = await pool.query('SELECT id FROM admin_users WHERE email = $1', [email]);
  if (rows.length > 0) {
    console.log(`Admin bootstrap: "${email}" already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO admin_users (site_id, email, password_hash, role) VALUES (NULL, $1, $2, 'super_admin')`,
    [email, passwordHash]
  );
  console.log(`Admin bootstrap: created super_admin "${email}".`);
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema applied — tables created and demo site/packages seeded.');
  await bootstrapAdmin();
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
