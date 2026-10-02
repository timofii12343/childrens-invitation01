'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const routes = Object.fromEntries(['register','participation','login','logout','session','registrations'].map(r => [r, require('../api/' + r + '.js')]));
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const handler = routes[url.pathname.slice(5)];
    if (!handler) { res.writeHead(404); return res.end(); }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 24000) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
    req.body = Buffer.concat(chunks).toString('utf8');
    return handler(req, res);
  }
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { res.writeHead(400); return res.end(); }
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
}).listen(3000, '127.0.0.1', () => console.log('Откройте http://localhost:3000. PostgreSQL берётся из .env.'));
