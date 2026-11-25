// Запуск того же приложения на обычном сервере (VPS) без Cloudflare.
// Нужен Node.js 22.5+ (встроенный SQLite). Данные хранятся в файле data.db.
//   node server-node.js            → http://localhost:3000
//   PORT=8080 DB_FILE=/var/lib/kosh/data.db INVITE_CODE=hockey node server-node.js
// Для работы с телефона нужен HTTPS (например, через Caddy — см. README).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from './src/worker.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const db = new DatabaseSync(process.env.DB_FILE || join(ROOT, 'data.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));

// Обёртка, повторяющая API Cloudflare D1
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a); }
  p() { return db.prepare(this.sql); }
  async first() { return this.p().get(...this.args) ?? null; }
  async all() { return { results: this.p().all(...this.args) }; }
  async run() { const r = this.p().run(...this.args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(list) {
    db.exec('BEGIN');
    try { const out = list.map((s) => s.p().run(...s.args)); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const ASSETS = {
  async fetch(req) {
    let p = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(PUBLIC, p);
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
    catch { file = join(PUBLIC, 'index.html'); }
    if (!file.startsWith(PUBLIC)) file = join(PUBLIC, 'index.html');
    const body = await readFile(file);
    return new Response(body, { headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' } });
  },
};
const env = { DB, ASSETS, INVITE_CODE: process.env.INVITE_CODE || '' };

http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, {
      method: req.method, headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = await worker.fetch(request, env);
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('Ошибка сервера');
  }
}).listen(process.env.PORT || 3000, () => console.log('Кошелёк судьи: http://localhost:' + (process.env.PORT || 3000)));
