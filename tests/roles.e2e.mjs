// Every role signs in and sees the right screens: РОП / admin (Обзор страны, Журнал действий, Пользователи with the hand-over of a
// team), supervisor (his own CRM, no country overview), agent and store keeper (sent to their cabinet). The MITAL database is a stub
// (window.supabase), so nothing real is touched.
//   npm i playwright-core && node tests/roles.e2e.mjs        (screenshots → /tmp/roles-*.png)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright-core'); } catch { pw = require(process.env.PLAYWRIGHT || 'playwright'); }
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname).slice(1) || 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(8781);

const now = Date.now(), iso = ms => new Date(ms).toISOString(), day = ms => iso(ms).slice(0, 10);
const R = { fe: 'r-fe', na: 'r-na', an: 'r-an' };
const people = [
  { id: 'u-admin', login: 'saidbonur', full_name: 'Саидбонур', role: 'admin', supervisor_id: null, region_id: null, is_active: true, linko_name: null },
  { id: 'u-rop', login: 'rop', full_name: 'Рустам РОП', role: 'rop', supervisor_id: null, region_id: null, is_active: true, linko_name: null },
  { id: 'u-sv1', login: 'sv1', full_name: 'Ботир Супервайзер', role: 'supervisor', supervisor_id: null, region_id: null, is_active: true, linko_name: null },
  { id: 'u-sv2', login: 'sv2', full_name: 'Олим Супервайзер', role: 'supervisor', supervisor_id: null, region_id: null, is_active: true, linko_name: null },
  { id: 'u-a1', login: 'a1', full_name: 'Азиз Агент', role: 'agent', supervisor_id: 'u-sv1', region_id: R.fe, is_active: true, linko_name: 'Азиз' },
  { id: 'u-a2', login: 'a2', full_name: 'Бобур Агент', role: 'agent', supervisor_id: 'u-sv1', region_id: R.fe, is_active: true, linko_name: 'Бобур' },
  { id: 'u-a3', login: 'a3', full_name: 'Шерзод Агент', role: 'agent', supervisor_id: 'u-sv2', region_id: R.na, is_active: true, linko_name: 'Шерзод' },
  { id: 'u-a4', login: 'a4', full_name: 'Без Имени', role: 'agent', supervisor_id: 'u-sv2', region_id: R.na, is_active: true, linko_name: null },
  { id: 'u-st', login: 'st', full_name: 'Завсклад Ферганы', role: 'store', supervisor_id: 'u-sv1', region_id: R.fe, is_active: true, linko_name: 'Склад Фергана' },
];
const period = { from: day(now - 14 * 864e5), to: day(now + 15 * 864e5), days_left: 15 };
const cab = (id, name, k, hoursAgo) => ({ agent_id: id, updated_at: iso(now - hoursAgo * 3600e3), updated_by: 'u-sv1', kpi: k, period, name, fine: 0, late: 1, absent: 0, data: { agent: name, kpi: k, period, at: iso(now - hoursAgo * 3600e3) } });
const DB = {
  profiles: people,
  regions: [{ id: R.an, name: 'Андижан', status: 'opening' }, { id: R.na, name: 'Наманган', status: 'active' }, { id: R.fe, name: 'Фергана', status: 'active' }],
  supervisor_regions: [{ supervisor_id: 'u-sv1', region_id: R.fe }, { supervisor_id: 'u-sv2', region_id: R.na }],
  workspaces: [{ owner_id: 'u-sv1', saved_at: iso(now - 2 * 3600e3), device: 'pc', version: 5, summary: { wh: 1, ag: 1, tasks: 0 } }, { owner_id: 'u-sv2', saved_at: iso(now - 50 * 3600e3), device: 'phone', version: 3, summary: { wh: 1, ag: 1, tasks: 0 } }],
  agent_cabinets: [
    cab('u-a1', 'Азиз', { sold: 30000, plan: 50000, paid: 26000, pool: 40000, debt: 18000, debtors: 12, akb: 40 }, 1),
    cab('u-a2', 'Бобур', { sold: 12000, plan: 50000, paid: 21000, pool: 40000, debt: 25000, debtors: 20, akb: 31 }, 2),
    cab('u-a3', 'Шерзод', { sold: 20000, plan: 40000, paid: 15000, pool: 30000, debt: 9000, debtors: 7, akb: 25 }, 50),
  ],
  audit_log: [
    { id: 2, at: iso(now - 3600e3), user_id: 'u-admin', table_name: 'profiles', action: 'UPDATE', row_id: 'u-a3', old_data: { full_name: 'Шерзод Агент', supervisor_id: 'u-sv1' }, new_data: { full_name: 'Шерзод Агент', supervisor_id: 'u-sv2' } },
    { id: 1, at: iso(now - 7200e3), user_id: 'u-rop', table_name: 'accounts', action: 'create', row_id: 'u-a4', old_data: null, new_data: { full_name: 'Без Имени', role: 'agent' } },
  ],
};

// the database stub: a chainable query that filters by eq / in and answers like supabase-js
const STUB = (me, DBJ) => `(() => {
  const DB = ${DBJ}, ME = ${JSON.stringify(me)}; window.__calls = [];
  const q = (table) => { const f = []; let one = false, lim = 0; const b = {
    select() { return b; }, order() { return b; }, limit(n) { lim = n; return b; },
    eq(k, v) { f.push(r => r[k] === v); return b; }, in(k, v) { f.push(r => v.includes(r[k])); return b; },
    maybeSingle() { one = true; return b; }, single() { one = true; return b; },
    insert(x) { __calls.push(['insert', table, x]); return b; }, update(x) { __calls.push(['update', table, x]); return b; },
    upsert(x) { __calls.push(['upsert', table, x]); return b; }, delete() { __calls.push(['delete', table]); return b; },
    then(res, rej) { let rows = (DB[table] || []).filter(r => f.every(fn => fn(r))); if (lim) rows = rows.slice(0, lim);
      return Promise.resolve({ data: one ? rows[0] || null : rows, error: null }).then(res, rej); } }; return b; };
  const session = ME ? { user: { id: ME }, access_token: 'jwt-' + ME } : null;
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session } }), signInWithPassword: async () => ({ error: null }), signOut: async () => ({}), updateUser: async () => ({}) },
    from: q,
    storage: { from: () => ({ download: async () => ({ error: { message: 'none' } }), upload: async () => ({ error: null }), list: async () => ({ data: [] }), remove: async () => ({}) }) },
    functions: { invoke: async (n, o) => { __calls.push(['fn', n, o.body]); return { data: { ok: true }, error: null }; } },
  }) };
})();`;

const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
let fails = 0;
const ok = (c, m) => { if (c) console.log('ok -', m); else { fails++; console.log('NOT OK -', m); } };

async function as(who, hash = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ contentType: 'text/javascript', body: STUB(who, JSON.stringify(DB)) }));
  await page.route(/fonts\.googleapis|fonts\.gstatic|telegram\.org|cdnjs\.cloudflare|api\.github\.com|supabase\.co/, r => r.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => { try { localStorage.setItem('token', 'sb'); } catch { /* none */ } });
  await page.goto('http://localhost:8781/index.html' + hash);
  await page.waitForTimeout(2500);
  return { page, ctx, errors };
}

// РОП: lands on the country overview
{
  const { page, ctx, errors } = await as('u-rop');
  ok(page.url().includes('#/country'), 'РОП starts on «Обзор страны»');
  const t = await page.textContent('#page');
  ok(/Обзор страны/.test(t), 'country page is drawn');
  ok(/Фергана/.test(t) && /Наманган/.test(t), 'regions listed');
  ok(/Ботир Супервайзер/.test(t) && /Олим Супервайзер/.test(t), 'supervisors listed');
  ok(/Шерзод/.test(t) && /кабинет не обновлялся больше суток/.test(t), 'stale cabinet of the Namangan agent is a signal');
  ok(/нет «Имени в LINKO»/.test(t), 'agent without LINKO name is a signal');
  ok(/\$62\s?000/.test(t.replace(/ /g, ' ')), 'country sales total = 62 000');
  ok(/Фергана: сбор \$47\s?000 — по правилу найма пора взять 1/.test(t.replace(/ /g, ' ')), 'hiring rule: Fergana collected 47k → +1 agent');
  ok(await page.$('.sidenav a[data-r="country"]') !== null, 'menu has «Обзор страны»');
  await page.screenshot({ path: '/tmp/roles-rop-country.png', fullPage: true });
  await page.goto('http://localhost:8781/index.html#/audit'); await page.waitForTimeout(1500);
  const a = await page.textContent('#page');
  ok(/Журнал действий/.test(a) && /руководитель: Ботир Супервайзер → Олим Супервайзер/.test(a), 'journal shows who moved an agent');
  await page.screenshot({ path: '/tmp/roles-rop-audit.png', fullPage: true });
  ok(!errors.length, 'no script errors for РОП: ' + errors.join(' | '));
  await ctx.close();
}

// admin: Пользователи → a supervisor with a team gets the hand-over choice
{
  const { page, ctx, errors } = await as('u-admin', '#/users');
  await page.waitForSelector('[data-edit="u-sv1"]', { timeout: 5000 }).catch(() => {});
  await page.click('[data-edit="u-sv1"]');
  await page.waitForTimeout(400);
  const m = await page.textContent('.modal');
  ok(/его люди \(3:/.test(m) && await page.$('#f_hand') !== null, 'supervisor form offers to hand over his 3 people');
  await page.selectOption('#f_hand', 'u-sv2');
  await page.selectOption('#f_role', 'agent');
  await page.selectOption('#f_sv', 'u-sv2'); await page.selectOption('#f_reg', R.na);
  await page.click('#f_ok'); await page.waitForTimeout(400);
  const calls = await page.evaluate(() => __calls.filter(c => c[0] === 'fn'));
  ok(calls.length && calls[0][2].action === 'update' && calls[0][2].reassign_to === 'u-sv2', 'update is sent with reassign_to');
  await page.screenshot({ path: '/tmp/roles-admin-users.png', fullPage: true });
  ok(!errors.length, 'no script errors for admin: ' + errors.join(' | '));
  await ctx.close();
}

// supervisor: his own CRM; the country overview is not his
{
  const { page, ctx, errors } = await as('u-sv1');
  ok(!page.url().includes('#/country'), 'supervisor does not start on the country overview');
  ok(await page.$('.sidenav a[data-r="country"]') === null, 'supervisor has no «Обзор страны» in the menu');
  await page.goto('http://localhost:8781/index.html#/country'); await page.waitForTimeout(1200);
  ok(!page.url().includes('#/country'), 'opening #/country as supervisor sends him to his own page');
  await page.goto('http://localhost:8781/index.html#/cloud'); await page.waitForTimeout(1500);
  ok(await page.$('#qr') === null, 'no QR code with keys on the settings page');
  ok(!errors.length, 'no script errors for supervisor: ' + errors.join(' | '));
  await page.screenshot({ path: '/tmp/roles-sv-cloud.png', fullPage: true });
  await ctx.close();
}

// agent and store keeper: sent to their cabinet
for (const who of ['u-a1', 'u-st']) {
  const { page, ctx } = await as(who);
  ok(/me\.html/.test(page.url()), `${who} is sent to his cabinet (me.html)`);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
