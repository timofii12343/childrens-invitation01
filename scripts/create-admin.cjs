'use strict';
const { randomUUID } = require('node:crypto');
const db = require('../lib/db.cjs');
const security = require('../lib/security.cjs');
function passwordPrompt(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('Нужен интерактивный терминал. Пароль нельзя передавать в аргументах.'));
    process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    let value = '';
    const finish = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    function onData(data) {
      for (const char of data.toString('utf8')) {
        if (char === '\u0003') { finish(); reject(new Error('Отменено.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    process.stdin.on('data', onData);
  });
}
(async () => {
  const args = process.argv.slice(2), get = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const slot = Number(get('--slot')), email = String(get('--email') || '').trim().toLowerCase();
  const name = slot === 1 ? 'Тимофей' : 'Сергей Власенко';
  if (![1, 2].includes(slot) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Использование: npm run admin:create -- --slot 1 --email ваш-email (слоты 1 и 2).');
  const password = await passwordPrompt('Новый пароль (не отображается): ');
  const confirm = await passwordPrompt('Повторите пароль: ');
  if (password !== confirm || password.length < 12 || password.length > 256) throw new Error('Пароли должны совпадать и содержать от 12 до 256 символов.');
  const hash = await security.hashPassword(password), client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(728191)');
    await client.query('INSERT INTO invitation_admins(id,slot,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slot) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash', [randomUUID(), slot, email, name, hash]);
    await client.query('DELETE FROM invitation_sessions WHERE admin_id=(SELECT id FROM invitation_admins WHERE slot=$1)', [slot]);
    await client.query('COMMIT'); console.log(`Администратор ${name} настроен. Старые сессии этого аккаунта завершены.`);
  } catch (e) { await client.query('ROLLBACK'); throw new Error(e.code === '23505' ? 'У двух администраторов должны быть разные email.' : 'Не удалось создать администратора. Проверьте миграцию и подключение.'); }
  finally { client.release(); await db.close(); }
})().catch(e => { console.error(e.message === 'DATABASE_NOT_CONFIGURED' ? 'Добавьте DATABASE_URL в .env.' : e.message); process.exitCode = 1; });
