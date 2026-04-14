'use strict';
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(
  config.db.connectionString
    ? { connectionString: config.db.connectionString, max: config.db.max }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        max: config.db.max,
        idleTimeoutMillis: config.db.idleTimeoutMillis,
        connectionTimeoutMillis: config.db.connectionTimeoutMillis,
      }
);

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

/**
 * Execute a callback within a transaction scoped to a specific organisation.
 * Sets `app.current_org_id` as a LOCAL (transaction-scoped) setting so RLS
 * policies are applied and automatically cleared after the transaction.
 *
 * @param {string} orgId
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withOrg(orgId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_org_id', $1, true)`,
      [orgId]
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a query outside org context (e.g. during auth, migrations).
 * No RLS org filter is applied — use with care.
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Acquire a raw client with org context set.
 * Caller is responsible for releasing the client.
 * Use withOrg() instead wherever possible.
 */
async function getOrgClient(orgId) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
  return client;
}

module.exports = { pool, withOrg, query, getOrgClient };
