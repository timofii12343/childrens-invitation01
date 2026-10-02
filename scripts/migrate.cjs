'use strict';
const { readFileSync } = require('node:fs');
const db = require('../lib/db.cjs');
(async () => {
  const client = await db.connect();
  try { await client.query(readFileSync(require('node:path').join(__dirname, '../database/001_postgres.sql'), 'utf8')); console.log('Таблицы PostgreSQL подготовлены.'); }
  finally { client.release(); await db.close(); }
})().catch(() => { console.error('Не удалось выполнить миграцию. Проверьте DATABASE_URL и доступ к PostgreSQL.'); process.exitCode = 1; });
