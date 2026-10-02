'use strict';
const { Pool } = require('pg');
let pool;
exports.connect = async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!pool) {
    const connection = new URL(process.env.DATABASE_URL);
    const local = !process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname);
    if (!local) connection.searchParams.set('sslmode', 'verify-full');
    pool = new Pool({ connectionString: connection.toString(), max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, statement_timeout: 10000, allowExitOnIdle: true });
    pool.on('error', () => console.error('Database pool connection closed'));
  }
  return pool.connect();
};
exports.close = async () => { if (pool) { await pool.end(); pool = null; } };
