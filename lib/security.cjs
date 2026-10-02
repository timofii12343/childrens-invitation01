'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
exports.hash = value => crypto.createHash('sha256').update(value).digest('hex');
exports.randomToken = () => crypto.randomBytes(32).toString('base64url');
exports.hashPassword = async password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
};
exports.verifyPassword = async (password, encoded) => {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  const key = await scrypt(password, parts[4], 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
};
exports.receipt = (id, requestId) => {
  const secret = process.env.REGISTRATION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SERVER_NOT_CONFIGURED');
  return crypto.createHmac('sha256', secret).update(id + ':' + requestId).digest('base64url');
};
exports.ipHash = req => {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error('SERVER_NOT_CONFIGURED');
  // Vercel overwrites these headers. Local development uses the socket address.
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || (!process.env.VERCEL && req.socket?.remoteAddress) || '').split(',')[0].trim();
  if (!ip) throw new Error('SERVER_NOT_CONFIGURED');
  return crypto.createHmac('sha256', secret).update(ip).digest('hex');
};
exports.cookieName = () => process.env.VERCEL || process.env.NODE_ENV === 'production' ? '__Host-lemgo_session' : 'lemgo_session';
exports.cookie = (token, clear = false) => `${exports.cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${exports.cookieName().startsWith('__Host-') ? '; Secure' : ''}`;
exports.cookieToken = req => {
  const prefix = exports.cookieName() + '=';
  const raw = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix));
  const token = raw?.slice(prefix.length);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};
