import { DEFAULT_LEAGUES, CATEGORIES } from './leagues.js';

const SESSION_DAYS = 180;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();

// ---------- helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const err = (msg, status = 400) => json({ error: msg }, status);

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashSecret(secret, salt = randomBytes(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function verifySecret(secret, stored) {
  if (!stored) return false;
  const [, iter, salt, hash] = stored.split('$');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: +iter }, key, 256);
  const a = b64(bits);
  if (a.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// Код восстановления: 12 символов без похожих букв, вида XXXX-XXXX-XXXX
function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = randomBytes(12);
  const s = [...r].map((b) => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function makeTempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...randomBytes(10)].map((b) => abc[b % abc.length]).join('');
}

const LOGIN_RE = /^[a-zA-Z0-9а-яА-ЯёЁ_.\-]{3,32}$/;
const cleanLogin = (l) => String(l || '').trim().toLowerCase();
const cleanStr = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

// ---------- sessions ----------
function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function createSession(env, userId) {
  const token = hex(randomBytes(32));
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires).run();
  return `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}
const clearCookie = 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

async function currentUser(req, env) {
  const token = getCookie(req, 'sid');
  if (!token) return null;
  const th = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.login, u.name, u.category, u.is_admin, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(th).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    return null;
  }
  return { id: row.id, login: row.login, name: row.name, category: row.category, isAdmin: !!row.is_admin, tokenHash: th };
}

// ---------- leagues config ----------
async function getLeagues(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'leagues'").first();
  if (row) { try { return JSON.parse(row.value); } catch { /* fall through */ } }
  return DEFAULT_LEAGUES;
}

function sanitizeLeagues(list) {
  if (!Array.isArray(list) || !list.length || list.length > 60) throw new Error('Неверный список лиг');
  const ids = new Set();
  return list.map((l) => {
    const id = cleanStr(l.id, 40).replace(/[^a-z0-9_-]/gi, '') || 'l' + hex(randomBytes(4));
    if (ids.has(id)) throw new Error('Повторяется id лиги: ' + id);
    ids.add(id);
    const name = cleanStr(l.name, 80);
    if (!name) throw new Error('У лиги нет названия');
    const rules = (Array.isArray(l.rules) ? l.rules : []).slice(0, 80).map((r) => ({
      role: cleanStr(r.role, 40),
      cats: cleanStr(r.cats, 40),
      ages: cleanStr(r.ages, 20).replace(/\s/g, ''),
      price: Math.max(0, Math.round(Number(r.price) || 0)),
    }));
    return { id, name, year: !!l.year, yearNoPrice: !!l.yearNoPrice, free: !!l.free, active: l.active !== false, rules };
  });
}

// ---------- games ----------
function sanitizeGame(g, leagues, fallbackCategory) {
  const date = cleanStr(g.date, 10);
  if (!isDate(date)) throw new Error('Неверная дата');
  const league = leagues.find((l) => l.id === g.leagueId);
  if (!league) throw new Error('Неизвестная лига');
  const leagueName = league.free ? cleanStr(g.leagueName, 80) || league.name : league.name;
  const role = cleanStr(g.role, 40);
  if (!role) throw new Error('Не указано амплуа');
  const price = Math.round(Number(g.price));
  if (!Number.isFinite(price) || price < 0 || price > 10_000_000) throw new Error('Неверная сумма');
  let by = g.birthYear ? parseInt(g.birthYear, 10) : null;
  if (by && (by < 1950 || by > 2100)) by = null;
  const cat = CATEGORIES.includes(g.category) ? g.category : fallbackCategory;
  return {
    date, leagueId: league.id, leagueName, role, category: cat,
    birthYear: league.year ? by : null, price, paid: g.paid ? 1 : 0, note: cleanStr(g.note, 300) || null,
  };
}

const gameRow = (r) => ({
  id: r.id, date: r.date, leagueId: r.league_id, leagueName: r.league_name, role: r.role,
  category: r.category, birthYear: r.birth_year, price: r.price, paid: !!r.paid, note: r.note,
});

// ---------- router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e) {
      console.error(e);
      return err('Ошибка сервера', 500);
    }
  },
};

async function api(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  // Простая защита от запросов с чужих сайтов
  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return err('Запрещено', 403);
  }

  // --- публичные ---
  if (path === '/api/config' && method === 'GET') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    return json({
      leagues: await getLeagues(env), categories: CATEGORIES,
      inviteRequired: !!env.INVITE_CODE, firstUser: count.n === 0,
    });
  }

  if (path === '/api/register' && method === 'POST') {
    const b = await readJson(req);
    const login = cleanLogin(b.login);
    const name = cleanStr(b.name, 60);
    const password = String(b.password || '');
    if (!LOGIN_RE.test(login)) return err('Логин: 3–32 символа, буквы, цифры, точка, дефис или _');
    if (!name) return err('Укажите имя');
    if (password.length < 6) return err('Пароль — минимум 6 символов');
    if (!CATEGORIES.includes(b.category)) return err('Выберите категорию');
    if (env.INVITE_CODE && String(b.invite || '').trim() !== env.INVITE_CODE) return err('Неверный код приглашения');
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE login = ?').bind(login).first();
    if (exists) return err('Такой логин уже занят');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    const code = makeCode();
    const res = await env.DB.prepare(
      'INSERT INTO users (login, name, category, pass_hash, recovery_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(login, name, b.category, await hashSecret(password), await hashSecret(normCode(code)), count.n === 0 ? 1 : 0).run();
    const cookie = await createSession(env, res.meta.last_row_id);
    return json({ ok: true, recoveryCode: code }, 200, { 'set-cookie': cookie });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readJson(req);
    const login = cleanLogin(b.login);
    const fail = await env.DB.prepare('SELECT count, until FROM login_fails WHERE login = ?').bind(login).first();
    if (fail && fail.count >= 8 && fail.until > Date.now()) return err('Слишком много попыток. Подождите 15 минут.', 429);
    const u = await env.DB.prepare('SELECT id, pass_hash FROM users WHERE login = ?').bind(login).first();
    if (!u || !(await verifySecret(String(b.password || ''), u.pass_hash))) {
      const cnt = fail && fail.until > Date.now() ? fail.count + 1 : 1;
      await env.DB.prepare('INSERT OR REPLACE INTO login_fails (login, count, until) VALUES (?, ?, ?)')
        .bind(login, cnt, Date.now() + 15 * 60e3).run();
      return err('Неверный логин или пароль', 401);
    }
    await env.DB.prepare('DELETE FROM login_fails WHERE login = ?').bind(login).run();
    return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id) });
  }

  if (path === '/api/recover' && method === 'POST') {
    const b = await readJson(req);
    const login = cleanLogin(b.login);
    const pw = String(b.password || '');
    if (pw.length < 6) return err('Пароль — минимум 6 символов');
    const fail = await env.DB.prepare('SELECT count, until FROM login_fails WHERE login = ?').bind('#' + login).first();
    if (fail && fail.count >= 5 && fail.until > Date.now()) return err('Слишком много попыток. Подождите 15 минут.', 429);
    const u = await env.DB.prepare('SELECT id, recovery_hash FROM users WHERE login = ?').bind(login).first();
    if (!u || !(await verifySecret(normCode(b.code), u.recovery_hash))) {
      const cnt = fail && fail.until > Date.now() ? fail.count + 1 : 1;
      await env.DB.prepare('INSERT OR REPLACE INTO login_fails (login, count, until) VALUES (?, ?, ?)')
        .bind('#' + login, cnt, Date.now() + 15 * 60e3).run();
      return err('Неверный логин или код восстановления', 401);
    }
    const code = makeCode();
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, recovery_hash = ? WHERE id = ?')
        .bind(await hashSecret(pw), await hashSecret(normCode(code)), u.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    ]);
    return json({ ok: true, recoveryCode: code }, 200, { 'set-cookie': await createSession(env, u.id) });
  }

  // --- дальше только для вошедших ---
  const me = await currentUser(req, env);
  if (!me) return err('Нужно войти', 401);

  if (path === '/api/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.tokenHash).run();
    return json({ ok: true }, 200, { 'set-cookie': clearCookie });
  }

  if (path === '/api/me') {
    if (method === 'GET') {
      const { tokenHash, ...pub } = me;
      return json(pub);
    }
    if (method === 'PATCH') {
      const b = await readJson(req);
      const name = cleanStr(b.name ?? me.name, 60);
      const cat = CATEGORIES.includes(b.category) ? b.category : me.category;
      if (!name) return err('Укажите имя');
      await env.DB.prepare('UPDATE users SET name = ?, category = ? WHERE id = ?').bind(name, cat, me.id).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/me/password' && method === 'POST') {
    const b = await readJson(req);
    const u = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(me.id).first();
    if (!(await verifySecret(String(b.old || ''), u.pass_hash))) return err('Старый пароль неверный');
    if (String(b.password || '').length < 6) return err('Пароль — минимум 6 символов');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashSecret(String(b.password)), me.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(me.id, me.tokenHash),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/me/recovery' && method === 'POST') {
    const b = await readJson(req);
    const u = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(me.id).first();
    if (!(await verifySecret(String(b.password || ''), u.pass_hash))) return err('Пароль неверный');
    const code = makeCode();
    await env.DB.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').bind(await hashSecret(normCode(code)), me.id).run();
    return json({ ok: true, recoveryCode: code });
  }

  // --- игры ---
  if (path === '/api/games' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM games WHERE user_id = ? ORDER BY date DESC, id DESC').bind(me.id).all();
    return json(results.map(gameRow));
  }

  if (path === '/api/games' && method === 'POST') {
    const b = await readJson(req);
    const list = Array.isArray(b.games) ? b.games : [];
    if (!list.length) return err('Нет игр для сохранения');
    if (list.length > 30) return err('Не больше 30 игр за раз');
    const leagues = await getLeagues(env);
    let games;
    try { games = list.map((g) => sanitizeGame(g, leagues, me.category)); } catch (e) { return err(e.message); }
    await env.DB.batch(games.map((g) => env.DB.prepare(
      `INSERT INTO games (user_id, date, league_id, league_name, role, category, birth_year, price, paid, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(me.id, g.date, g.leagueId, g.leagueName, g.role, g.category, g.birthYear, g.price, g.paid, g.note)));
    return json({ ok: true, added: games.length });
  }

  if (path === '/api/games/paid' && method === 'POST') {
    const b = await readJson(req);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 2000);
    if (!ids.length) return json({ ok: true, updated: 0 });
    const paid = b.paid ? 1 : 0;
    const stmts = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      stmts.push(env.DB.prepare(`UPDATE games SET paid = ? WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
        .bind(paid, me.id, ...chunk));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  const gm = path.match(/^\/api\/games\/(\d+)$/);
  if (gm) {
    const id = +gm[1];
    const own = await env.DB.prepare('SELECT id FROM games WHERE id = ? AND user_id = ?').bind(id, me.id).first();
    if (!own) return err('Игра не найдена', 404);
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const b = await readJson(req);
      let g;
      try { g = sanitizeGame(b, await getLeagues(env), me.category); } catch (e) { return err(e.message); }
      await env.DB.prepare(
        `UPDATE games SET date=?, league_id=?, league_name=?, role=?, category=?, birth_year=?, price=?, paid=?, note=? WHERE id=?`
      ).bind(g.date, g.leagueId, g.leagueName, g.role, g.category, g.birthYear, g.price, g.paid, g.note, id).run();
      return json({ ok: true });
    }
  }

  // --- админ ---
  if (path.startsWith('/api/admin/')) {
    if (!me.isAdmin) return err('Только для админа', 403);

    if (path === '/api/admin/users' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.login, u.name, u.category, u.is_admin, u.created_at,
                COUNT(g.id) AS games, MAX(g.date) AS last_game
         FROM users u LEFT JOIN games g ON g.user_id = u.id
         GROUP BY u.id ORDER BY u.name COLLATE NOCASE`
      ).all();
      return json(results.map((r) => ({ ...r, is_admin: !!r.is_admin })));
    }

    const um = path.match(/^\/api\/admin\/users\/(\d+)(\/reset)?$/);
    if (um) {
      const id = +um[1];
      const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
      if (!u) return err('Пользователь не найден', 404);
      if (um[2] && method === 'POST') {
        const temp = makeTempPassword();
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashSecret(temp), id),
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        ]);
        return json({ ok: true, tempPassword: temp });
      }
      if (!um[2] && method === 'PATCH') {
        const b = await readJson(req);
        if (id === me.id && b.isAdmin === false) return err('Нельзя снять админа с себя');
        const sets = [], vals = [];
        if (typeof b.isAdmin === 'boolean') { sets.push('is_admin = ?'); vals.push(b.isAdmin ? 1 : 0); }
        if (CATEGORIES.includes(b.category)) { sets.push('category = ?'); vals.push(b.category); }
        if (sets.length) await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
        return json({ ok: true });
      }
      if (!um[2] && method === 'DELETE') {
        if (id === me.id) return err('Нельзя удалить себя');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM games WHERE user_id = ?').bind(id),
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
          env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }

    if (path === '/api/admin/leagues' && method === 'PUT') {
      const b = await readJson(req);
      let leagues;
      try { leagues = sanitizeLeagues(b.leagues); } catch (e) { return err(e.message); }
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('leagues', ?)").bind(JSON.stringify(leagues)).run();
      return json({ ok: true, leagues });
    }

    if (path === '/api/admin/leagues/reset' && method === 'POST') {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'leagues'").run();
      return json({ ok: true, leagues: DEFAULT_LEAGUES });
    }
  }

  return err('Не найдено', 404);
}
