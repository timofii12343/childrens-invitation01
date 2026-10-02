'use strict';
const crypto = require('node:crypto');
const security = require('./security.cjs');
const database = require('./db.cjs');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const churchText = value => {
  if (typeof value !== 'string') fail(400, 'Укажите церковь.');
  const s = value.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 100 || /[\p{C}<>]/u.test(s)) fail(400, 'Название церкви должно содержать от 1 до 100 символов.');
  return s;
};
const childrenNumber = n => { if (!Number.isInteger(n) || n < 1 || n > 1000) fail(400, 'Количество детей — целое число от 1 до 1000.'); return n; };
const participationText = value => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, 'Текст участия должен быть не длиннее 5000 символов.');
  return value.trim() || null;
};
function body(req) {
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Нужен JSON-запрос.');
  let data;
  try { const raw = req.body; if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw) || '') > 24000) fail(413, 'Слишком большой запрос.'); data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Некорректный запрос.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Некорректный запрос.');
  return data;
}
function sameOrigin(req) {
  const allowed = process.env.APP_ORIGIN || `${process.env.VERCEL ? 'https' : 'http'}://${req.headers.host}`;
  if (!req.headers.origin || req.headers.origin !== allowed || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Запрос должен быть отправлен с этого сайта.');
}
async function transaction(client, fn) {
  await client.query('BEGIN');
  try { const result = await fn(); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
}
async function rate(client, scope, key, limit, minutes) {
  return transaction(client, async () => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scope + key]);
    await client.query("DELETE FROM invitation_rate_events WHERE created_at < now() - interval '1 day'");
    const r = await client.query("SELECT count(*)::int AS n FROM invitation_rate_events WHERE scope=$1 AND key_hash=$2 AND created_at > now() - ($3 * interval '1 minute')", [scope, key, minutes]);
    if (r.rows[0].n >= limit) return false;
    await client.query('INSERT INTO invitation_rate_events(scope,key_hash) VALUES ($1,$2)', [scope, key]);
    return true;
  });
}
async function requireAdmin(client, req) {
  const token = security.cookieToken(req);
  if (!token) fail(401, 'Войдите в кабинет администратора.');
  const r = await client.query('SELECT a.id,a.display_name FROM invitation_sessions s JOIN invitation_admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at > now()', [security.hash(token)]);
  if (!r.rows.length) fail(401, 'Сессия завершена. Войдите снова.');
  return r.rows[0];
}
function createHandler(route, { connect = database.connect } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let client;
    try {
      const methods = { register: ['POST'], participation: ['POST'], login: ['POST'], logout: ['POST'], session: ['GET'], registrations: ['GET', 'DELETE', 'PATCH'] }[route];
      if (!methods?.includes(req.method)) { res.setHeader('Allow', methods?.join(', ') || ''); fail(405, 'Метод не поддерживается.'); }
      if (req.method !== 'GET') sameOrigin(req);
      const data = req.method !== 'GET' ? body(req) : null;
      // Validate simple input before opening a DB connection.
      if (route === 'register') { churchText(data.church); childrenNumber(data.children_count); if (!uuid(data.request_id) || data.website) fail(400, 'Проверьте данные заявки.'); }
      if (route === 'participation') { if (!uuid(data.id) || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) fail(400, 'Некорректное подтверждение заявки.'); participationText(data.participation); }
      if (route === 'login' && (typeof data.email !== 'string' || data.email.length > 254 || typeof data.password !== 'string' || data.password.length > 256)) fail(400, 'Проверьте email и пароль.');
      client = await connect();
      let result;
      if (route === 'register') {
        const church = churchText(data.church), count = childrenNumber(data.children_count);
        // Lock request ID first; safe replay never consumes another rate-limit slot.
        result = await transaction(client, async () => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [data.request_id]);
          const prior = await client.query('SELECT * FROM invitation_registrations WHERE request_id=$1', [data.request_id]);
          if (prior.rows.length) {
            const row = prior.rows[0];
            if (row.deleted_at) fail(410, 'Заявка удалена организатором.');
            if (row.original_church !== church || row.original_children_count !== count) fail(409, 'Этот запрос уже использован. Обновите страницу.');
            return { id: row.id, token: security.receipt(row.id, data.request_id) };
          }
          const key = security.ipHash(req);
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['register' + key]);
          await client.query("DELETE FROM invitation_rate_events WHERE created_at < now() - interval '1 day'");
          const limit = await client.query("SELECT count(*)::int AS n FROM invitation_rate_events WHERE scope='register' AND key_hash=$1 AND created_at > now() - interval '10 minutes'", [key]);
          if (limit.rows[0].n >= 10) fail(429, 'Слишком много заявок. Попробуйте через 10 минут.');
          const id = crypto.randomUUID(), token = security.receipt(id, data.request_id);
          await client.query('INSERT INTO invitation_registrations(id,request_id,church,children_count,participation_token_hash,original_church,original_children_count) VALUES ($1,$2,$3,$4,$5,$3,$4)', [id, data.request_id, church, count, security.hash(token)]);
          await client.query("INSERT INTO invitation_rate_events(scope,key_hash) VALUES ('register',$1)", [key]);
          return { id, token };
        });
      } else if (route === 'participation') {
        if (!await rate(client, 'participation', security.ipHash(req), 60, 10)) fail(429, 'Подождите немного и повторите попытку.');
        const changed = await client.query("UPDATE invitation_registrations SET participation=$1 WHERE id=$2 AND participation_token_hash=$3 AND deleted_at IS NULL AND created_at > now() - interval '24 hours' RETURNING id", [participationText(data.participation), data.id, security.hash(data.token)]);
        if (!changed.rows.length) fail(403, 'Не удалось подтвердить право на эту заявку. Основная регистрация уже сохранена.');
        result = { ok: true };
      } else if (route === 'login') {
        const email = data.email.trim().toLowerCase();
        const ipAllowed = await rate(client, 'login-ip', security.ipHash(req), 30, 15);
        const emailAllowed = await rate(client, 'login-email', security.hash(email), 10, 15);
        if (!ipAllowed || !emailAllowed) fail(429, 'Слишком много попыток входа. Повторите через 15 минут.');
        const found = await client.query('SELECT * FROM invitation_admins WHERE email=$1', [email]);
        // Compute scrypt also for unknown emails to avoid a fast account-existence oracle.
        const fallback = 'scrypt$32768$8$1$00000000000000000000000000000000$' + '00'.repeat(32);
        const valid = await security.verifyPassword(data.password, found.rows[0]?.password_hash || fallback);
        if (!found.rows.length || !valid) fail(401, 'Неверный email или пароль.');
        const token = security.randomToken();
        await transaction(client, async () => {
          await client.query('DELETE FROM invitation_sessions WHERE expires_at <= now()');
          const old = security.cookieToken(req);
          if (old) await client.query('DELETE FROM invitation_sessions WHERE token_hash=$1', [security.hash(old)]);
          await client.query("INSERT INTO invitation_sessions(token_hash,admin_id,expires_at) VALUES ($1,$2,now() + interval '12 hours')", [security.hash(token), found.rows[0].id]);
        });
        res.setHeader('Set-Cookie', security.cookie(token));
        result = { admin: { display_name: found.rows[0].display_name } };
      } else if (route === 'logout') {
        const token = security.cookieToken(req);
        if (token) await client.query('DELETE FROM invitation_sessions WHERE token_hash=$1', [security.hash(token)]);
        res.setHeader('Set-Cookie', security.cookie('', true)); result = { ok: true };
      } else {
        const admin = await requireAdmin(client, req);
        if (route === 'session') result = { admin };
        else if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost');
          const offset = Number(url.searchParams.get('offset') || 0);
          if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Некорректная страница.');
          result = await transaction(client, async () => {
            // One snapshot for totals and the page.
            await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
            const stats = await client.query("SELECT count(*)::int AS requests, COALESCE(sum(children_count),0)::int AS children, count(*) FILTER (WHERE participation IS NOT NULL AND trim(participation) <> '')::int AS participation FROM invitation_registrations WHERE deleted_at IS NULL");
            const rows = await client.query('SELECT id,church,children_count,participation,created_at FROM invitation_registrations WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $1', [offset]);
            return { rows: rows.rows, totals: stats.rows[0] };
          });
        } else {
          if (!uuid(data.id)) fail(400, 'Некорректная заявка.');
          const changed = req.method === 'DELETE'
            ? await client.query('UPDATE invitation_registrations SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [data.id])
            : await client.query('UPDATE invitation_registrations SET church=$1,children_count=$2,participation=$3 WHERE id=$4 AND deleted_at IS NULL RETURNING id', [churchText(data.church), childrenNumber(data.children_count), participationText(data.participation), data.id]);
          if (!changed.rows.length) fail(404, 'Заявка уже удалена.');
          result = { ok: true };
        }
      }
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = e instanceof HttpError ? e.status : 503;
      if (res.statusCode === 429) res.setHeader('Retry-After', '900');
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Сервис временно недоступен. Повторите попытку позже.' }));
      // Do not log request bodies, credentials, connection strings, or raw DB errors.
      if (!(e instanceof HttpError)) console.error('API unavailable:', route, /^[A-Z0-9_]+$/.test(e.code || '') ? e.code : 'SERVER_ERROR');
    } finally { client?.release(); }
  };
}
exports.createHandler = createHandler;
