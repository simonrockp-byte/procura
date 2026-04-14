'use strict';
const bcrypt = require('bcryptjs');
const db = require('./index');
const { v4: uuidv4 } = require('uuid');

async function seed() {
  const email = 'simonrockp@gmail.com';
  const orgName = 'CODX Systems Tech';
  const orgSlug = 'codx-systems';
  const password = 'ChangeMe123!';

  console.log(`[seed] Starting seed for ${email}...`);

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    // Use a raw pool client to bypass RLS for initial setup
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Create Organisation
      const orgRes = await client.query(
        `INSERT INTO organisations (name, slug, default_currency, sla_hours)
         VALUES ($1, $2, 'ZMW', 72)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgName, orgSlug]
      );
      const orgId = orgRes.rows[0].id;
      console.log(`[seed] Organisation created/found: ${orgId}`);

      // 2. Create Executive Officer
      const offRes = await client.query(
        `INSERT INTO officers (org_id, email, full_name, password_hash, role, is_active)
         VALUES ($1, $2, 'Simon Rock', $3, 'Executive', TRUE)
         ON CONFLICT (org_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [orgId, email, passwordHash]
      );
      const officerId = offRes.rows[0].id;
      console.log(`[seed] Executive account created/updated: ${officerId}`);

      // 3. Seed Reference Counter
      await client.query(
        `INSERT INTO org_ref_counters (org_id, prefix, last_value)
         VALUES ($1, 'REQ', 0)
         ON CONFLICT DO NOTHING`,
        [orgId]
      );

      // 4. Set org context for audit log trigger
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
      
      // 5. Initial Audit Entry
      await client.query(
        `INSERT INTO audit_log (org_id, actor_id, table_name, record_id, action, payload, hash)
         VALUES ($1, $2, 'system', $1, 'SYSTEM', '{"event": "initial_seed"}', encode(digest('seed' || now()::text, 'sha256'), 'hex'))`,
        [orgId, officerId]
      );

      await client.query('COMMIT');
      
      console.log('\n' + '='.repeat(40));
      console.log('SEED SUCCESSFUL');
      console.log('='.repeat(40));
      console.log(`Org Slug: ${orgSlug}`);
      console.log(`Email:    ${email}`);
      console.log(`Password: ${password}`);
      console.log('='.repeat(40));
      console.log('Please log in and change your password immediately.');

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[seed] Failed:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

seed();
