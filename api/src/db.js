import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Return DATE columns as 'YYYY-MM-DD' strings, not JS Dates shifted by timezone
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
// "today", day boundaries etc. follow the clinic's time zone, not the container's UTC
const TZ = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(process.env.TZ || '') ? process.env.TZ : 'Africa/Algiers';
pool.on('connect', (client) => client.query(`SET TIME ZONE '${TZ}'`).catch(() => {}));

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(path.join(dir, '..', 'sql', 'schema.sql'), 'utf8');
  // Serialize concurrent starts. Advisory locks belong to a session: lock and unlock on one connection.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    try {
      await client.query(sql);
    } finally {
      await client.query('SELECT pg_advisory_unlock(424242)');
    }
  } finally {
    client.release();
  }
}
