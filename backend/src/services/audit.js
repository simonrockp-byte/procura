'use strict';
/**
 * Audit Service — append-only, SHA-256 hash-chained log.
 *
 * Every write operation in Procura calls audit.log() inside the same
 * transaction. The hash chain works as follows:
 *
 *   hash_n = SHA256( prev_hash_n-1 || org_id || actor_id || table || record_id
 *                    || action || JSON(payload) || created_at )
 *
 * The DB trigger prevents any UPDATE or DELETE on audit_log, making the
 * chain tamper-evident: any gap or mutation breaks the hash linkage.
 */
const crypto = require('crypto');

/**
 * Append a log entry inside an existing transaction.
 *
 * @param {import('pg').PoolClient} client  - DB client with org context set
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string|null} opts.actorId       - officer UUID, or null for system
 * @param {string}  opts.tableName
 * @param {string|null} opts.recordId
 * @param {'INSERT'|'UPDATE'|'DELETE'|'SYSTEM'} opts.action
 * @param {object}  opts.payload
 */
async function log(client, { orgId, actorId, tableName, recordId, action, payload }) {
  // Fetch the last hash for this org with a row-level lock to serialise
  // concurrent inserts and preserve chain integrity.
  const lastRow = await client.query(
    `SELECT hash FROM audit_log
     WHERE org_id = $1
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [orgId]
  );

  const prevHash = lastRow.rows[0]?.hash ?? '';
  const now = new Date().toISOString();

  const raw = JSON.stringify({
    orgId,
    actorId: actorId ?? null,
    tableName,
    recordId: recordId ?? null,
    action,
    payload,
    prevHash,
    createdAt: now,
  });

  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  await client.query(
    `INSERT INTO audit_log
       (org_id, actor_id, table_name, record_id, action, payload, prev_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      orgId,
      actorId ?? null,
      tableName,
      recordId ?? null,
      action,
      JSON.stringify(payload),
      prevHash,
      hash,
      now,
    ]
  );
}

/**
 * Verify the hash chain for an organisation.
 * Returns { valid: true } or { valid: false, brokenAt: <audit_log id> }.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} orgId
 */
async function verify(client, orgId) {
  const rows = await client.query(
    `SELECT id, org_id, actor_id, table_name, record_id, action,
            payload, prev_hash, hash, created_at
     FROM audit_log
     WHERE org_id = $1
     ORDER BY id ASC`,
    [orgId]
  );

  let expectedPrevHash = '';

  for (const row of rows.rows) {
    const raw = JSON.stringify({
      orgId: row.org_id,
      actorId: row.actor_id,
      tableName: row.table_name,
      recordId: row.record_id,
      action: row.action,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      prevHash: row.prev_hash,
      createdAt: new Date(row.created_at).toISOString(),
    });

    const computed = crypto.createHash('sha256').update(raw).digest('hex');

    if (row.prev_hash !== expectedPrevHash || row.hash !== computed) {
      return { valid: false, brokenAt: row.id };
    }

    expectedPrevHash = row.hash;
  }

  return { valid: true };
}

module.exports = { log, verify };
