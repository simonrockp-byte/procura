'use strict';
/**
 * Runs schema.sql against the configured database.
 * Safe to run multiple times (all DDL is idempotent via IF NOT EXISTS / DO $$ blocks).
 *
 * Usage: node src/db/migrate.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { pool } = require('./index');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] running schema.sql …');
  try {
    await pool.query(sql);
    console.log('[migrate] done.');
  } catch (err) {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
