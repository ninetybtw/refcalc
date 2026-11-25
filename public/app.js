// Кошелёк судьи — клиентская часть (без фреймворков)
{
const app = document.getElementById('app');
const S = { me: null, cfg: null, games: [], month: null, statYear: 'all', forms: {}, authTab: 'login', adminTab: 'users', adminUsers: null, leaguesDraft: null, installEvt: null };

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => (Math.round(n) || 0).toLocaleString('ru-RU') + ' ₽';
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); };
const fmtDate = (d) => { const [y, m, dd] = d.split('-').map(Number); const w = new Date(y, m - 1, dd).getDay(); return `${WD[w]}, ${dd} ${MONTHS_GEN[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
const monthLabel = (k) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const gamesWord = (n) => `${n} ${plural(n, 'игра', 'игры', 'игр')}`;

function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* пусто */ }
  if (res.status === 401 && !opts.auth) { S.me = null; route(); throw new Error(data.error || 'Нужно войти'); }
  if (!res.ok) throw new Error(data.error || 'Ошибка связи');
  return data;
}

// ---------- лиги и ставки ----------
const leagueById = (id) => S.cfg.leagues.find((l) => l.id === id);
const activeLeagues = () => S.cfg.leagues.filter((l) => l.active !== false);
const seasonEnd = (date) => { const [y, m] = date.split('-').map(Number); return m >= 7 ? y + 1 : y; };
const ageOf = (date, by) => (by ? seasonEnd(date) - Number(by) : null);
const matchAges = (spec, age) => { if (!spec) return true; if (age == null) return false; const [a, b] = spec.split('-').map(Number); return b ? age >= a && age <= b : age === a; };
const matchCats = (spec, cat) => !spec || spec.split(',').map((s) => s.trim().toUpperCase()).includes(String(cat).toUpperCase());

function autoPrice(league, role, cat, date, by) {
  if (!league || league.free) return null;
  const age = league.year && !league.yearNoPrice ? ageOf(date, by) : null;
  for (const r of league.rules || []) {
    if ((r.role && r.role !== role) || !matchCats(r.cats, cat)) continue;
    if (!league.yearNoPrice && !matchAges(r.ages, age)) continue;
    return r.price;
  }
  return null;
}
function priceHint(league, row, ctx) {
  if (!league || league.free || row.price !== '') return '';
  const needsAge = !league.yearNoPrice && (league.rules || []).some((r) => r.ages);
  if (league.year && needsAge && !row.birthYear) return 'Выберите год рождения — от него зависит ставка';
  if (!(league.rules || []).length) return 'Введите сумму вручную';
  return `Ставки для категории «${ctx.category}»${league.year && !league.yearNoPrice ? ', этого возраста' : ''} и амплуа «${row.role}» нет — введите сумму`;
}
function yearOptions(date, selected) {
  const se = seasonEnd(date);
  let o = '<option value="">— не указан —</option>';
  for (let y = se - 6; y >= se - 21; y--) o += `<option value="${y}" ${String(selected) === String(y) ? 'selected' : ''}>${y} · до ${se - y} лет</option>`;
  return o;
}
const sums = (list) => list.reduce((a, g) => { a.count++; a.earned += g.price; if (g.paid) a.got += g.price; else a.due += g.price; return a; }, { count: 0, earned: 0, got: 0, due: 0 });

// ---------- оболочка ----------
const ICONS = {
  games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke-linecap="round"/></svg>',
};
function nav(r) {
  const a = (id, label, icon, cls = '') => `<a href="#${id}" class="${cls} ${r === id || (id === 'profile' && r === 'admin') ? 'on' : ''}">${icon}<span>${label}</span></a>`;
  return `<nav class="tabs"><div class="in">${a('games', 'Игры', ICONS.games)}${a('add', 'Добавить', `<span class="plus">${ICONS.plus}</span>`, 'add')}${a('stats', 'Итоги', ICONS.stats)}${a('profile', 'Профиль', ICONS.profile)}</div></nav>`;
}
function shell(html) { app.innerHTML = `<div class="wrap">${html}</div>${nav(S.route)}`; }

const ROUTES = { games: renderGames, add: renderAdd, stats: renderStats, profile: renderProfile, admin: renderAdmin };
function route() {
  closeSheet();
  if (!S.me) return renderAuth();
  let r = location.hash.slice(1) || 'games';
  if (!ROUTES[r] || (r === 'admin' && !S.me.isAdmin)) r = 'games';
  S.route = r; S.onField = null;
  ROUTES[r]();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- модальные окна ----------
function openSheet(html) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  return bg.firstChild;
}
function closeSheet() { document.getElementById('sheet')?.remove(); document.body.style.overflow = ''; }
function confirmSheet(text, okLabel = 'Да', danger = false) {
  return new Promise((resolve) => {
    const sh = openSheet(`<h2>${esc(text)}</h2><div class="btn-row"><button class="btn ghost" data-c="0">Отмена</button><button class="btn ${danger ? 'danger' : ''}" data-c="1">${esc(okLabel)}</button></div>`);
    sh.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { closeSheet(); resolve(b.dataset.c === '1'); } });
  });
}
function showCode(code, title) {
  const sh = openSheet(`<h2>${esc(title)}</h2>
    <p>Это <b>код восстановления</b>. Если забудете пароль, сможете сбросить его этим кодом. Код показывается <b>один раз</b> — сделайте скриншот или запишите.</p>
    <div class="code-box">${esc(code)}</div>
    <div class="btn-row"><button class="btn ghost" data-copy>Скопировать</button><button class="btn" data-ok>Я сохранил</button></div>`);
  sh.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Скопировано'); } catch { toast('Не удалось скопировать — запишите вручную', true); } };
  sh.querySelector('[data-ok]').onclick = () => { closeSheet(); route(); };
}

// ---------- вход / регистрация ----------
function renderAuth() {
  const t = S.authTab;
  const cats = S.cfg.categories.map((c) => `<option value="${esc(c)}">${c === 'ВК' ? 'ВК — всероссийская' : c === 'ЮС' ? 'ЮС — юный судья' : c + ' категория'}</option>`).join('');
  const tab = (id, label) => `<button type="button" class="chip ${t === id ? 'on' : ''}" data-act="auth-tab" data-v="${id}">${label}</button>`;
  let form = '';
  if (t === 'login') form = `<form data-submit="login" class="card">
      <label class="f"><span>Логин</span><input name="login" autocomplete="username" autocapitalize="none" required></label>
      <label class="f"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn full">Войти</button></form>`;
  if (t === 'register') form = `<form data-submit="register" class="card">
      ${S.cfg.firstUser ? '<p class="small muted" style="margin-top:0">Вы первый пользователь — станете администратором.</p>' : ''}
      <label class="f"><span>Логин (латиница или кириллица, без пробелов)</span><input name="login" autocomplete="username" autocapitalize="none" required minlength="3" maxlength="32"></label>
      <label class="f"><span>Имя и фамилия</span><input name="name" autocomplete="name" required maxlength="60"></label>
      <label class="f"><span>Судейская категория</span><select name="category" required>${cats}</select></label>
      <label class="f"><span>Пароль (минимум 6 символов)</span><input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
      ${S.cfg.inviteRequired ? '<label class="f"><span>Код приглашения (спросите у админа)</span><input name="invite" required autocapitalize="none"></label>' : ''}
      <button class="btn full">Зарегистрироваться</button></form>`;
  if (t === 'recover') form = `<form data-submit="recover" class="card">
      <p class="small muted" style="margin-top:0">Введите код восстановления, который показали при регистрации. Если кода нет — попросите админа сбросить пароль.</p>
      <label class="f"><span>Логин</span><input name="login" autocapitalize="none" required></label>
      <label class="f"><span>Код восстановления</span><input name="code" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX" required></label>
      <label class="f"><span>Новый пароль</span><input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
      <button class="btn full">Сменить пароль</button></form>`;
  app.innerHTML = `<div class="auth">
    <div class="auth-hero"><div class="board"><div class="board-title">Кошелёк судьи</div><div class="board-main">Игры и деньги</div><div class="board-sub" style="margin:4px 0 0">Сколько заработано, сколько получено и сколько ещё должны — по всем лигам.</div></div></div>
    <div class="tabs-top">${tab('login', 'Вход')}${tab('register', 'Регистрация')}${tab('recover', 'Забыл пароль')}</div>${form}</div>`;
}
const SUBMITS = {
  async login(f) {
    await api('/login', { method: 'POST', body: { login: f.login.value, password: f.password.value }, auth: true });
    await boot();
  },
  async register(f) {
    const r = await api('/register', { method: 'POST', body: { login: f.login.value, name: f.name.value, category: f.category.value, password: f.password.value, invite: f.invite?.value }, auth: true });
    await boot(); showCode(r.recoveryCode, 'Готово! Сохраните код');
  },
  async recover(f) {
    const r = await api('/recover', { method: 'POST', body: { login: f.login.value, code: f.code.value, password: f.password.value }, auth: true });
    await boot(); showCode(r.recoveryCode, 'Пароль изменён. Новый код');
  },
  async profile(f) {
    await api('/me', { method: 'PATCH', body: { name: f.name.value, category: f.category.value } });
    S.me.name = f.name.value.trim(); S.me.category = f.category.value; toast('Сохранено');
  },
  async password(f) {
    await api('/me/password', { method: 'POST', body: { old: f.old.value, password: f.password.value } });
    f.reset(); toast('Пароль изменён');
  },
  async recovery(f) {
    const r = await api('/me/recovery', { method: 'POST', body: { password: f.password.value } });
    showCode(r.recoveryCode, 'Новый код восстановления');
  },
};

// ---------- форма игр (добавление и правка) ----------
let rowKey = 0;
function newRow(prev) {
  const lg = prev ? leagueById(prev.leagueId) : activeLeagues()[0];
  return { key: ++rowKey, leagueId: lg.id, role: prev?.role || 'Главный', birthYear: prev?.birthYear || '', leagueName: prev?.leagueName || '', price: '', touched: false, note: '', paid: false };
}
function recalc(ctx) {
  for (const r of ctx.rows) {
    if (r.touched) continue;
    const p = autoPrice(leagueById(r.leagueId), r.role, ctx.category, ctx.date, r.birthYear);
    r.price = p == null ? '' : String(p);
  }
}
function rowHTML(ctx, r, i) {
  const lg = leagueById(r.leagueId);
  const opts = [...activeLeagues(), ...(lg && lg.active === false ? [lg] : [])].map((l) => `<option value="${esc(l.id)}" ${l.id === r.leagueId ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const auto = autoPrice(lg, r.role, ctx.category, ctx.date, r.birthYear);
  const tag = priceTag(auto, r, i);
  const roleField = lg?.free
    ? `<label class="f"><span>Лига / турнир</span><input data-f="leagueName" value="${esc(r.leagueName)}" maxlength="80" placeholder="Например: Кубок Урала"></label>
       <label class="f"><span>Амплуа</span><input data-f="role" value="${esc(r.role)}" maxlength="40" list="roles" placeholder="Главный, линейный, секретарь…"></label>`
    : `<div class="f" style="margin-bottom:10px"><span class="small muted" style="display:block;margin-bottom:4px">Амплуа</span><div class="seg">${['Главный', 'Линейный'].map((x) => `<button type="button" class="${r.role === x ? 'on' : ''}" data-act="role" data-i="${i}" data-v="${x}">${x}</button>`).join('')}</div></div>`;
  const year = lg?.year ? `<label class="f"><span>Год рождения игроков${lg.yearNoPrice ? '' : ' — влияет на ставку'}</span><select data-f="birthYear">${yearOptions(ctx.date, r.birthYear)}</select></label>` : '';
  const hint = priceHint(lg, r, ctx);
  const many = ctx.rows.length > 1;
  return `<div class="card row-card" data-row="${i}">
    ${ctx.single ? '' : `<div class="row-head"><b>Игра ${i + 1}</b><div class="icon-btns"><button type="button" class="btn sm ghost" data-act="row-copy" data-i="${i}">Копия</button>${many ? `<button type="button" class="btn sm danger" data-act="row-del" data-i="${i}">Убрать</button>` : ''}</div></div>`}
    <label class="f"><span>Лига</span><select data-f="leagueId">${opts}</select></label>
    ${roleField}${year}
    <label class="f"><span>Сумма за игру, ₽</span><div class="price-wrap"><input data-f="price" inputmode="numeric" pattern="[0-9]*" value="${esc(r.price)}" placeholder="0"><span data-tag>${tag}</span></div></label>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
    <label class="f"><span>Команды / заметка (необязательно)</span><input data-f="note" value="${esc(r.note)}" maxlength="300" placeholder="Трактор-2010 — Металлург-2010"></label>
    <label class="check"><input type="checkbox" data-f="paid" ${r.paid ? 'checked' : ''}> Деньги за эту игру уже получены</label>
  </div>`;
}
// «авто» — сумма совпадает со ставкой; «↺ ставка» — сумма изменена вручную, можно вернуть
function priceTag(auto, r, i) {
  if (auto == null) return '';
  if (!r.touched || String(auto) === r.price) return '<span class="price-tag auto">авто</span>';
  return `<button type="button" class="price-tag auto" data-act="price-auto" data-i="${i}">↺ ${rub(auto)}</button>`;
}
function formHTML(name) {
  const ctx = S.forms[name];
  const catOpts = S.cfg.categories.map((c) => `<option ${c === ctx.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const total = ctx.rows.reduce((a, r) => a + (Number(r.price) || 0), 0);
  return `<div data-form="${name}">
    <div class="grid2">
      <label class="f"><span>Дата</span><input type="date" data-f="date" data-day value="${esc(ctx.date)}"></label>
      <label class="f"><span>Ваша категория</span><select data-f="category" data-day>${catOpts}</select></label>
    </div>
    <datalist id="roles"><option>Главный</option><option>Линейный</option><option>Секретарь</option><option>Судья видеоповтора</option><option>Инспектор</option></datalist>
    <div class="stack-y">${ctx.rows.map((r, i) => rowHTML(ctx, r, i)).join('')}</div>
    ${ctx.single ? `<div class="btn-row" style="margin-top:14px"><button type="button" class="btn danger" data-act="edit-del">Удалить</button><button type="button" class="btn" data-act="edit-save">Сохранить</button></div>`
      : `<button type="button" class="btn soft full" style="margin-top:12px" data-act="row-add">+ Ещё игра в этот день</button>
         <div class="save-bar"><button type="button" class="btn full" data-act="add-save" data-total>${saveLabel(ctx, total)}</button></div>`}
  </div>`;
}
const saveLabel = (ctx, total) => `Сохранить ${gamesWord(ctx.rows.length)} · ${rub(total)}`;
function rerenderForm(name) {
  const box = document.querySelector(`[data-form="${name}"]`);
  if (box) box.outerHTML = formHTML(name);
}
function onFormField(el, type) {
  const box = el.closest('[data-form]'); if (!box) return;
  const name = box.dataset.form, ctx = S.forms[name], f = el.dataset.f;
  if (el.hasAttribute('data-day')) {
    if (type !== 'change') return;
    if (f === 'date' && el.value) ctx.date = el.value;
    if (f === 'category') ctx.category = el.value;
    recalc(ctx); return rerenderForm(name);
  }
  const i = +el.closest('[data-row]').dataset.row, r = ctx.rows[i];
  if (f === 'leagueId' && type === 'change') {
    const was = leagueById(r.leagueId), now = leagueById(el.value);
    r.leagueId = el.value; r.touched = false;
    if (now.free && !was?.free) r.role = '';
    if (!now.free && was?.free) r.role = 'Главный';
    recalc(ctx); return rerenderForm(name);
  }
  if (f === 'birthYear' && type === 'change') { r.birthYear = el.value; recalc(ctx); return rerenderForm(name); }
  if (f === 'paid') { r.paid = el.checked; return; }
  if (f === 'price') {
    const v = el.value.replace(/\D/g, ''); if (v !== el.value) el.value = v;
    r.price = v; r.touched = true;
    // без перерисовки формы — иначе следующий тап (например, «+ Ещё игра») потеряется
    const rowEl = el.closest('[data-row]'), auto = autoPrice(leagueById(r.leagueId), r.role, ctx.category, ctx.date, r.birthYear);
    rowEl.querySelector('[data-tag]').innerHTML = priceTag(auto, r, i);
    if (v) rowEl.querySelector('.hint')?.remove();
  }
  if (f === 'note' || f === 'leagueName') r[f] = el.value;
  if (f === 'role') { r.role = el.value; }
  const btn = box.querySelector('[data-total]');
  if (btn) btn.textContent = saveLabel(ctx, ctx.rows.reduce((a, x) => a + (Number(x.price) || 0), 0));
}
function validRows(ctx) {
  for (const [i, r] of ctx.rows.entries()) {
    const n = ctx.single ? '' : ` (игра ${i + 1})`;
    if (r.price === '') { toast('Укажите сумму' + n, true); return false; }
    if (!r.role.trim()) { toast('Укажите амплуа' + n, true); return false; }
  }
  return true;
}
const rowToGame = (ctx, r) => ({ date: ctx.date, category: ctx.category, leagueId: r.leagueId, leagueName: r.leagueName, role: r.role.trim(), birthYear: r.birthYear || null, price: Number(r.price), note: r.note, paid: r.paid });

function renderAdd() {
  if (!S.forms.add) { S.forms.add = { date: today(), category: S.me.category, rows: [newRow()] }; recalc(S.forms.add); }
  shell(`<h1>Добавить игры</h1>${formHTML('add')}`);
  S.onField = onFormField;
}
function openEdit(g) {
  const lg = leagueById(g.leagueId) || activeLeagues()[0];
  S.forms.edit = { id: g.id, single: true, date: g.date, category: g.category || S.me.category,
    rows: [{ key: ++rowKey, leagueId: lg.id, role: g.role, birthYear: g.birthYear || '', leagueName: lg.free ? g.leagueName : '', price: String(g.price), touched: true, note: g.note || '', paid: g.paid }] };
  openSheet(`<h2>Игра</h2>${formHTML('edit')}`);
  S.onField = onFormField;
}

// ---------- экран «Игры» ----------
function monthsList() {
  const set = new Set(S.games.map((g) => g.date.slice(0, 7))); set.add(today().slice(0, 7));
  return [...set].sort().reverse();
}
function gameItem(g) {
  const lg = leagueById(g.leagueId);
  const bits = [g.role];
  if (g.birthYear) bits.push(`${g.birthYear} г.р. (до ${ageOf(g.date, g.birthYear)})`);
  if (g.note) bits.push(g.note);
  return `<div class="game" data-act="edit" data-id="${g.id}">
    <div class="game-main"><div class="game-t">${esc(lg?.free || !lg ? g.leagueName : lg.name)}</div><div class="game-s">${esc(bits.join(' · '))}</div></div>
    <div><div class="game-p num">${rub(g.price)}</div><button type="button" class="paid-btn ${g.paid ? 'on' : 'off'}" data-act="toggle-paid" data-id="${g.id}">${g.paid ? '✓ получено' : 'не получено'}</button></div>
  </div>`;
}
function renderGames() {
  const months = monthsList();
  if (!S.month || !months.includes(S.month)) S.month = months[0];
  const list = S.games.filter((g) => g.date.startsWith(S.month));
  const s = sums(list);
  const byDay = {};
  for (const g of list) (byDay[g.date] ||= []).push(g);
  const days = Object.keys(byDay).sort().reverse();
  shell(`
    <div class="chips">${months.map((m) => `<button class="chip ${m === S.month ? 'on' : ''}" data-act="month" data-v="${m}">${monthLabel(m)}</button>`).join('')}</div>
    <div class="board">
      <div class="board-top"><div class="board-title">${monthLabel(S.month)} · заработано</div></div>
      <div class="board-main num">${rub(s.earned)}</div>
      <div class="board-sub">${gamesWord(s.count)}</div>
      <div class="board-row">
        <div class="board-cell got"><b class="num">${rub(s.got)}</b><span>получено</span></div>
        <div class="board-cell due"><b class="num">${rub(s.due)}</b><span>ещё должны</span></div>
        <div class="board-cell"><b class="num">${s.count ? rub(s.earned / s.count) : '—'}</b><span>в среднем</span></div>
      </div>
    </div>
    ${s.due > 0 ? `<button class="btn ghost full" style="margin-top:12px" data-act="month-paid">Отметить всё за ${MONTHS[+S.month.slice(5) - 1].toLowerCase()} полученным</button>` : ''}
    ${days.length ? days.map((d) => { const ds = sums(byDay[d]); return `<div class="day"><div class="day-h"><span>${fmtDate(d)}</span><span class="num">${byDay[d].length > 1 ? gamesWord(byDay[d].length) + ' · ' : ''}${rub(ds.earned)}</span></div>${byDay[d].map(gameItem).join('')}</div>`; }).join('')
      : `<div class="empty">В этом месяце игр пока нет.<br><a class="btn" href="#add">Добавить игры</a></div>`}
  `);
}

// ---------- экран «Итоги» ----------
function renderStats() {
  const years = [...new Set(S.games.map((g) => g.date.slice(0, 4)))].sort().reverse();
  if (S.statYear !== 'all' && !years.includes(S.statYear)) S.statYear = 'all';
  const list = S.statYear === 'all' ? S.games : S.games.filter((g) => g.date.startsWith(S.statYear));
  const s = sums(list);
  const byMonth = {}, byLeague = {};
  for (const g of list) {
    (byMonth[g.date.slice(0, 7)] ||= []).push(g);
    const name = leagueById(g.leagueId)?.free || !leagueById(g.leagueId) ? g.leagueName : leagueById(g.leagueId).name;
    (byLeague[name] ||= []).push(g);
  }
  const months = Object.keys(byMonth).sort().reverse();
  const max = Math.max(1, ...months.map((m) => sums(byMonth[m]).earned));
  const main = list.filter((g) => g.role === 'Главный').length, line = list.filter((g) => g.role === 'Линейный').length;
  const leagues = Object.entries(byLeague).map(([n, l]) => [n, sums(l)]).sort((a, b) => b[1].earned - a[1].earned);
  shell(`
    <h1>Итоги</h1>
    <div class="chips"><button class="chip ${S.statYear === 'all' ? 'on' : ''}" data-act="stat-year" data-v="all">Всё время</button>${years.map((y) => `<button class="chip ${S.statYear === y ? 'on' : ''}" data-act="stat-year" data-v="${y}">${y} год</button>`).join('')}</div>
    ${!list.length ? '<div class="empty">Пока нет ни одной игры.<br><a class="btn" href="#add">Добавить игры</a></div>' : `
    <div class="kpis">
      <div class="kpi"><b class="num">${rub(s.earned)}</b><span>заработано</span></div>
      <div class="kpi"><b class="num">${s.count}</b><span>${plural(s.count, 'игра', 'игры', 'игр')} · главным ${main}, линейным ${line}</span></div>
      <div class="kpi got"><b class="num">${rub(s.got)}</b><span>получено</span></div>
      <div class="kpi due"><b class="num">${rub(s.due)}</b><span>ещё не получено</span></div>
    </div>
    <h2>По месяцам</h2>
    <div class="card bars">${months.map((m) => { const x = sums(byMonth[m]); return `<div class="b"><span>${MONTHS[+m.slice(5) - 1].slice(0, 3)} ${m.slice(2, 4)}</span><div class="track" title="${rub(x.earned)}"><i class="g" style="width:${(x.got / max) * 100}%"></i><i class="d" style="width:${(x.due / max) * 100}%"></i></div><span class="num">${rub(x.earned)}</span></div>`; }).join('')}
      <div class="legend"><span><i style="background:var(--green)"></i>получено</span><span><i style="background:var(--red)"></i>ещё должны</span></div></div>
    <div class="card scroll" style="margin-top:10px"><table>
      <thead><tr><th>Месяц</th><th>Игр</th><th>Заработано</th><th>Получено</th><th>Должны</th></tr></thead>
      <tbody>${months.map((m) => { const x = sums(byMonth[m]); return `<tr><td>${monthLabel(m)}</td><td class="num">${x.count}</td><td class="num">${rub(x.earned)}</td><td class="num">${rub(x.got)}</td><td class="num ${x.due ? 'due' : ''}">${rub(x.due)}</td></tr>`; }).join('')}</tbody>
    </table></div>
    <h2>По лигам</h2>
    <div class="card scroll"><table>
      <thead><tr><th>Лига</th><th>Игр</th><th>Заработано</th><th>Должны</th></tr></thead>
      <tbody>${leagues.map(([n, x]) => `<tr><td>${esc(n)}</td><td class="num">${x.count}</td><td class="num">${rub(x.earned)}</td><td class="num ${x.due ? 'due' : ''}">${rub(x.due)}</td></tr>`).join('')}</tbody>
    </table></div>
    <button class="btn ghost full" style="margin-top:14px" data-act="csv">Скачать таблицу (CSV для Excel)</button>`}
  `);
}
function exportCsv() {
  const list = S.statYear === 'all' ? S.games : S.games.filter((g) => g.date.startsWith(S.statYear));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Дата', 'Лига', 'Амплуа', 'Категория', 'Год рождения', 'Сумма', 'Получено', 'Заметка'].map(q).join(';')];
  for (const g of [...list].sort((a, b) => a.date.localeCompare(b.date))) rows.push([g.date, g.leagueName, g.role, g.category, g.birthYear || '', g.price, g.paid ? 'да' : 'нет', g.note || ''].map(q).join(';'));
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `igry-${S.statYear}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- профиль ----------
function renderProfile() {
  const cats = S.cfg.categories.map((c) => `<option ${c === S.me.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  shell(`
    <h1>${esc(S.me.name)}</h1>
    <p class="muted" style="margin-top:-8px">Логин: ${esc(S.me.login)}${S.me.isAdmin ? ' · администратор' : ''}</p>
    ${S.me.isAdmin ? '<a class="btn soft full" href="#admin" style="margin-bottom:14px">Админ-панель: судьи и ставки</a>' : ''}
    ${!standalone ? `<div class="card" style="margin-bottom:14px"><b>Установить на телефон</b><p class="small muted" style="margin:6px 0 0">${ios ? 'В Safari нажмите «Поделиться» → «На экран „Домой“».' : 'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».'}</p>${S.installEvt ? '<button class="btn full" style="margin-top:10px" data-act="install">Установить</button>' : ''}</div>` : ''}
    <form class="card" data-submit="profile">
      <label class="f"><span>Имя</span><input name="name" value="${esc(S.me.name)}" required maxlength="60"></label>
      <label class="f"><span>Судейская категория (подставляется в новые игры)</span><select name="category">${cats}</select></label>
      <button class="btn full">Сохранить</button>
    </form>
    <h2>Смена пароля</h2>
    <form class="card" data-submit="password">
      <label class="f"><span>Старый пароль</span><input name="old" type="password" autocomplete="current-password" required></label>
      <label class="f"><span>Новый пароль</span><input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
      <button class="btn full">Сменить пароль</button>
    </form>
    <h2>Код восстановления</h2>
    <form class="card" data-submit="recovery">
      <p class="small muted" style="margin-top:0">Потеряли код? Получите новый — старый перестанет работать.</p>
      <label class="f"><span>Ваш пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn ghost full">Получить новый код</button>
    </form>
    <button class="btn danger full" style="margin-top:20px" data-act="logout">Выйти</button>
  `);
}

// ---------- админка ----------
async function renderAdmin() {
  const t = S.adminTab;
  const head = `<h1>Админ-панель</h1><div class="chips"><button class="chip ${t === 'users' ? 'on' : ''}" data-act="admin-tab" data-v="users">Судьи</button><button class="chip ${t === 'leagues' ? 'on' : ''}" data-act="admin-tab" data-v="leagues">Лиги и ставки</button></div>`;
  if (t === 'users') {
    shell(head + '<div class="muted">Загрузка…</div>');
    try { S.adminUsers = await api('/admin/users'); } catch (e) { return toast(e.message, true); }
    if (S.route !== 'admin' || S.adminTab !== 'users') return;
    shell(head + `<p class="muted small">Всего судей: ${S.adminUsers.length}. Суммы заработка коллег админу не видны.</p>` + S.adminUsers.map((u) => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>${esc(u.name)}</b><span class="small muted">${esc(u.login)}</span></div>
        <div class="small muted" style="margin:2px 0 10px">${gamesWord(u.games)}${u.last_game ? ' · последняя ' + fmtDate(u.last_game) : ''}${u.is_admin ? ' · админ' : ''}</div>
        <div class="grid2"><label class="f"><span>Категория</span><select data-act-change="user-cat" data-id="${u.id}">${S.cfg.categories.map((c) => `<option ${c === u.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" data-act-change="user-admin" data-id="${u.id}" ${u.is_admin ? 'checked' : ''} ${u.id === S.me.id ? 'disabled' : ''}> Админ</label></div>
        <div class="btn-row"><button class="btn sm ghost" data-act="user-reset" data-id="${u.id}">Сбросить пароль</button>${u.id !== S.me.id ? `<button class="btn sm danger" data-act="user-del" data-id="${u.id}">Удалить</button>` : ''}</div>
      </div>`).join(''));
    return;
  }
  if (!S.leaguesDraft) S.leaguesDraft = JSON.parse(JSON.stringify(S.cfg.leagues));
  const roleOpt = (v) => ['', 'Главный', 'Линейный'].map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${x || 'Любое'}</option>`).join('');
  shell(head + `
    <p class="small muted">Правило: амплуа + категории + возраст → ставка. Подходит первое совпавшее сверху вниз. Пустое поле — «любое». Категории через запятую: <b>1,2</b>. Возраст: <b>18</b> или диапазон <b>15-17</b> (считается по году рождения и сезону). Нет подходящего правила — сумму вводят вручную.</p>
    ${S.leaguesDraft.map((l, i) => `
    <div class="card" data-l="${i}" style="margin-bottom:12px">
      <div class="row-head"><b>${i + 1}.</b><div class="icon-btns">
        <button class="btn sm ghost" data-act="lg-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
        <button class="btn sm ghost" data-act="lg-down" data-i="${i}" ${i === S.leaguesDraft.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
        <button class="btn sm danger" data-act="lg-del" data-i="${i}">Удалить</button></div></div>
      <label class="f"><span>Название</span><input data-lf="name" value="${esc(l.name)}" maxlength="80"></label>
      <div class="flags">
        <label class="check"><input type="checkbox" data-lf="active" ${l.active !== false ? 'checked' : ''}> Показывать</label>
        <label class="check"><input type="checkbox" data-lf="year" ${l.year ? 'checked' : ''}> Спрашивать год рождения</label>
        <label class="check"><input type="checkbox" data-lf="yearNoPrice" ${l.yearNoPrice ? 'checked' : ''}> Год не влияет на ставку</label>
        <label class="check"><input type="checkbox" data-lf="free" ${l.free ? 'checked' : ''}> Свободная форма</label>
      </div>
      ${l.free ? '' : `<div style="margin-top:10px">
        <div class="rule rule-h"><span>Амплуа</span><span>Категории</span><span>Возраст</span><span>Ставка, ₽</span><span></span></div>
        ${(l.rules || []).map((r, j) => `<div class="rule" data-r="${j}">
          <select class="r-role" data-rf="role">${roleOpt(r.role)}</select>
          <input class="r-cats" data-rf="cats" value="${esc(r.cats)}" placeholder="любые">
          <input class="r-ages" data-rf="ages" value="${esc(r.ages)}" placeholder="любой">
          <input class="r-price" data-rf="price" inputmode="numeric" value="${esc(r.price)}">
          <button class="x" data-act="rule-del" data-i="${i}" data-j="${j}" aria-label="Удалить правило">×</button></div>`).join('') || '<p class="small muted">Правил нет — сумму вводят вручную.</p>'}
        <button class="btn sm soft" data-act="rule-add" data-i="${i}">+ Правило</button></div>`}
    </div>`).join('')}
    <button class="btn soft full" data-act="lg-add">+ Добавить лигу</button>
    <div class="save-bar btn-row"><button class="btn ghost" data-act="lg-reset">Сбросить</button><button class="btn" data-act="lg-save">Сохранить лиги</button></div>`);
  S.onField = (el) => {
    const card = el.closest('[data-l]'); if (!card) return;
    const l = S.leaguesDraft[+card.dataset.l];
    if (el.dataset.lf) { const k = el.dataset.lf; l[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'free' && el.type === 'checkbox') renderAdmin(); }
    if (el.dataset.rf) { const r = l.rules[+el.closest('[data-r]').dataset.r]; r[el.dataset.rf] = el.dataset.rf === 'price' ? el.value.replace(/\D/g, '') : el.value; }
  };
}

// ---------- действия по клику ----------
const ACT = {
  'auth-tab': (b) => { S.authTab = b.dataset.v; renderAuth(); },
  month: (b) => { S.month = b.dataset.v; renderGames(); },
  'stat-year': (b) => { S.statYear = b.dataset.v; renderStats(); },
  'admin-tab': (b) => { S.adminTab = b.dataset.v; renderAdmin(); },
  csv: exportCsv,
  async install() { S.installEvt?.prompt(); S.installEvt = null; },
  async logout() { await api('/logout', { method: 'POST' }); S.me = null; S.games = []; S.forms = {}; location.hash = ''; route(); },
  edit: (b) => { const g = S.games.find((x) => x.id === +b.dataset.id); if (g) openEdit(g); },
  async 'toggle-paid'(b) {
    const g = S.games.find((x) => x.id === +b.dataset.id); if (!g) return;
    g.paid = !g.paid; renderGames();
    try { await api('/games/paid', { method: 'POST', body: { ids: [g.id], paid: g.paid } }); } catch (e) { g.paid = !g.paid; renderGames(); toast(e.message, true); }
  },
  async 'month-paid'() {
    const list = S.games.filter((g) => g.date.startsWith(S.month) && !g.paid);
    if (!(await confirmSheet(`Отметить ${gamesWord(list.length)} на ${rub(sums(list).earned)} полученными?`, 'Отметить'))) return;
    await api('/games/paid', { method: 'POST', body: { ids: list.map((g) => g.id), paid: true } });
    list.forEach((g) => (g.paid = true)); renderGames(); toast('Готово');
  },
  role: (b) => { const box = b.closest('[data-form]'), ctx = S.forms[box.dataset.form]; ctx.rows[+b.dataset.i].role = b.dataset.v; ctx.rows[+b.dataset.i].touched = false; recalc(ctx); rerenderForm(box.dataset.form); },
  'price-auto': (b) => { const box = b.closest('[data-form]'), ctx = S.forms[box.dataset.form]; ctx.rows[+b.dataset.i].touched = false; recalc(ctx); rerenderForm(box.dataset.form); },
  'row-add': () => { const ctx = S.forms.add; ctx.rows.push(newRow(ctx.rows.at(-1))); recalc(ctx); rerenderForm('add'); document.querySelector('[data-row]:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'row-copy': (b) => { const ctx = S.forms.add, src = ctx.rows[+b.dataset.i]; ctx.rows.splice(+b.dataset.i + 1, 0, { ...src, key: ++rowKey }); rerenderForm('add'); },
  'row-del': (b) => { S.forms.add.rows.splice(+b.dataset.i, 1); rerenderForm('add'); },
  async 'add-save'(b) {
    const ctx = S.forms.add; if (!validRows(ctx)) return;
    b.disabled = true;
    try {
      await api('/games', { method: 'POST', body: { games: ctx.rows.map((r) => rowToGame(ctx, r)) } });
      toast(`Сохранено: ${gamesWord(ctx.rows.length)}`);
      S.month = ctx.date.slice(0, 7); delete S.forms.add;
      await loadGames(); location.hash = 'games';
    } finally { b.disabled = false; }
  },
  async 'edit-save'(b) {
    const ctx = S.forms.edit; if (!validRows(ctx)) return;
    b.disabled = true;
    try { await api('/games/' + ctx.id, { method: 'PUT', body: rowToGame(ctx, ctx.rows[0]) }); closeSheet(); await loadGames(); route(); toast('Сохранено'); }
    finally { b.disabled = false; }
  },
  async 'edit-del'() {
    const id = S.forms.edit.id;
    if (!(await confirmSheet('Удалить эту игру?', 'Удалить', true))) return;
    await api('/games/' + id, { method: 'DELETE' }); await loadGames(); route(); toast('Игра удалена');
  },
  async 'user-reset'(b) {
    const u = S.adminUsers.find((x) => x.id === +b.dataset.id);
    if (!(await confirmSheet(`Сбросить пароль для ${u.name}?`, 'Сбросить'))) return;
    const r = await api(`/admin/users/${u.id}/reset`, { method: 'POST' });
    const sh = openSheet(`<h2>Временный пароль</h2><p>Передайте ${esc(u.name)} (логин <b>${esc(u.login)}</b>) этот пароль. После входа его лучше сменить в профиле.</p><div class="code-box">${esc(r.tempPassword)}</div><button class="btn full" data-ok>Готово</button>`);
    sh.querySelector('[data-ok]').onclick = closeSheet;
  },
  async 'user-del'(b) {
    const u = S.adminUsers.find((x) => x.id === +b.dataset.id);
    if (!(await confirmSheet(`Удалить ${u.name} и все его игры? Это нельзя отменить.`, 'Удалить', true))) return;
    await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('Удалён'); renderAdmin();
  },
  'rule-add': (b) => { S.leaguesDraft[+b.dataset.i].rules.push({ role: '', cats: '', ages: '', price: '' }); renderAdmin(); },
  'rule-del': (b) => { S.leaguesDraft[+b.dataset.i].rules.splice(+b.dataset.j, 1); renderAdmin(); },
  'lg-add': () => { S.leaguesDraft.push({ id: 'l' + Date.now().toString(36), name: 'Новая лига', year: false, active: true, rules: [] }); renderAdmin(); },
  'lg-up': (b) => { const i = +b.dataset.i, a = S.leaguesDraft; [a[i - 1], a[i]] = [a[i], a[i - 1]]; renderAdmin(); },
  'lg-down': (b) => { const i = +b.dataset.i, a = S.leaguesDraft; [a[i + 1], a[i]] = [a[i], a[i + 1]]; renderAdmin(); },
  async 'lg-del'(b) {
    const l = S.leaguesDraft[+b.dataset.i];
    if (!(await confirmSheet(`Удалить «${l.name}»? Старые игры сохранятся с этим названием. Чтобы просто скрыть лигу, снимите «Показывать».`, 'Удалить', true))) return;
    S.leaguesDraft.splice(+b.dataset.i, 1); renderAdmin();
  },
  async 'lg-save'() {
    const r = await api('/admin/leagues', { method: 'PUT', body: { leagues: S.leaguesDraft } });
    S.cfg.leagues = r.leagues; S.leaguesDraft = null; delete S.forms.add; toast('Лиги сохранены'); renderAdmin();
  },
  async 'lg-reset'() {
    if (!(await confirmSheet('Вернуть все лиги и ставки к исходным? Ваши правки пропадут.', 'Вернуть', true))) return;
    const r = await api('/admin/leagues/reset', { method: 'POST' });
    S.cfg.leagues = r.leagues; S.leaguesDraft = null; delete S.forms.add; toast('Восстановлено'); renderAdmin();
  },
};
const ACT_CHANGE = {
  async 'user-cat'(el) { await api(`/admin/users/${el.dataset.id}`, { method: 'PATCH', body: { category: el.value } }); toast('Категория изменена'); },
  async 'user-admin'(el) { await api(`/admin/users/${el.dataset.id}`, { method: 'PATCH', body: { isAdmin: el.checked } }); toast(el.checked ? 'Назначен админом' : 'Больше не админ'); },
};

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  if (b.dataset.act === 'edit' && e.target.closest('[data-act="toggle-paid"]')) return;
  e.preventDefault();
  try { await fn(b, e); } catch (err) { toast(err.message, true); }
});
for (const type of ['input', 'change']) {
  document.addEventListener(type, async (e) => {
    const el = e.target;
    if (type === 'change' && el.dataset.actChange) { try { await ACT_CHANGE[el.dataset.actChange](el); } catch (err) { toast(err.message, true); } return; }
    if (S.onField && (el.dataset.f || el.dataset.lf || el.dataset.rf)) S.onField(el, type);
  });
}
document.addEventListener('submit', async (e) => {
  const f = e.target; if (!f.dataset.submit) return;
  e.preventDefault();
  const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try { await SUBMITS[f.dataset.submit](f); } catch (err) { toast(err.message, true); } finally { if (btn && btn.isConnected) btn.disabled = false; }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });

// ---------- запуск ----------
async function loadGames() { S.games = await api('/games'); }
async function boot() {
  try {
    S.me = await api('/me', { auth: true });
    await loadGames();
  } catch { S.me = null; }
  S.forms = {}; S.leaguesDraft = null;
  route();
}
(async () => {
  try { S.cfg = await api('/config', { auth: true }); }
  catch { app.innerHTML = '<div class="boot">Нет связи с сервером. Проверьте интернет и обновите страницу.</div>'; return; }
  await boot();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
