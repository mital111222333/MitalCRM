// The wallet (wallet.html, Telegram Mini App) in headless Chrome: month totals, categories, trips, history by day,
// add / edit / delete in the sheet, month switch, filters, the board ⇄ wallet tabs, dark theme. API and Telegram stubbed.
//   npm i puppeteer-core@23 && node tests/wallet.e2e.mjs            (screenshots → /tmp/wallet-*.png)
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, new URL(q.url, 'http://x').pathname.slice(1) || 'wallet.html'); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(8773);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const stub = scheme => `window.Telegram = { WebApp: { initData: 'user=%7B%22id%22%3A111%7D&hash=x', colorScheme: '${scheme}', ready() {}, expand() {}, setHeaderColor() {}, showConfirm: (t, cb) => cb(true),
  HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} } } };`;
const T = new Date().toISOString().slice(0, 10), Y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const MOCK = `(() => { window.__ops = []; window.__errors = []; addEventListener('error', e => __errors.push(String(e.message)));
  const CAT = { expense: ['Еда', 'Бензин', 'Транспорт', 'Командировка', 'Дом', 'Семья', 'Связь', 'Здоровье', 'Одежда', 'Подарки', 'Работа', 'Покупки', 'Развлечения', 'Прочее'], income: ['Зарплата', 'Бонус', 'Бизнес', 'OilBook', 'Подарок', 'Возврат', 'Прочее'] };
  const IC = { 'Еда': '🍽', 'Бензин': '⛽', 'Связь': '📱', 'Зарплата': '💵', 'Бонус': '🏆', 'Прочее': '📦' };
  let id = 10, rows = [
    { id: 1, kind: 'expense', amount: 200000, currency: 'UZS', category: 'Бензин', sphere: 'work', trip: 'Namangan', note: '', day: '${T}' },
    { id: 2, kind: 'expense', amount: 60000, currency: 'UZS', category: 'Еда', sphere: 'work', trip: 'Namangan', note: 'tushlik', day: '${T}' },
    { id: 3, kind: 'expense', amount: 45000, currency: 'UZS', category: 'Связь', sphere: 'personal', trip: null, note: 'Paynet', day: '${Y}' },
    { id: 4, kind: 'income', amount: 6000000, currency: 'UZS', category: 'Зарплата', sphere: 'work', trip: null, note: '', day: '${Y}' },
    { id: 5, kind: 'income', amount: 500, currency: 'USD', category: 'Бонус', sphere: 'work', trip: null, note: '', day: '${Y}' },
  ];
  const tot = rs => { const t = {}; for (const r of rs) { const c = t[r.currency] ||= { income: 0, expense: 0, balance: 0 }; c[r.kind] += r.amount; c.balance += r.kind === 'income' ? r.amount : -r.amount; } return t; };
  window.fetch = async (url, o = {}) => { const b = JSON.parse(o.body || '{}'); __ops.push(b);
    if (b.op === 'add') rows.unshift({ id: ++id, ...b, op: undefined });
    if (b.op === 'edit') Object.assign(rows.find(r => r.id === b.id), b);
    if (b.op === 'del') rows = rows.filter(r => r.id !== b.id);
    const m = b.month || '${T.slice(0, 7)}', list = rows.filter(r => r.day.startsWith(m));
    return new Response(JSON.stringify({ rows: list, from: m + '-01', to: m + '-30', today: '${T}', totals: tot(list), all_time: tot(rows), trips: ['Namangan'], categories: CAT, icons: IC }), { headers: { 'content-type': 'application/json' } }); };
})();`;
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  — ' + info : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function page(scheme, file = 'wallet.html') {
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.setRequestInterception(true);
  p.on('request', r => r.url().startsWith('https://telegram.org/') ? r.respond({ status: 200, contentType: 'text/javascript', body: stub(scheme) }) : r.continue());
  await p.evaluateOnNewDocument(MOCK);
  await p.goto(`http://localhost:8773/${file}?api=` + encodeURIComponent('https://abc.supabase.co/functions/v1/ai-bot'));
  return p;
}
const ops = p => p.evaluate(() => __ops.filter(o => o.op !== 'list'));
const txt = (p, s) => p.$eval(s, e => e.textContent.replace(/\s+/g, ' ').trim());

const p = await page('light');
await p.waitForSelector('.it');
await p.screenshot({ path: '/tmp/wallet-light.png' });
const bal = await txt(p, '#bal');
check('month result: income − expense in so‘m', /\+5 695 000 сум/.test(bal) && /Приход ?\+6 000 000 сум/.test(bal) && /Расход ?−305 000 сум/.test(bal), bal);
check('dollars apart, never mixed', /USD: приход \+\$500/.test(bal), bal);
check('categories by size', (await p.$$eval('#cats .cat .nm', es => es.map(e => e.textContent.split(' ')[0]))).join() === 'Бензин,Еда,Связь');
check('business trip block', /Namangan.*260 000 сум/.test(await txt(p, '#trips')));
check('history by day: Сегодня / Вчера', (await p.$$eval('.day span:first-child', es => es.map(e => e.textContent))).join() === 'Сегодня,Вчера');
// add an expense in the sheet
await p.tap('#fab'); await wait(300);
await p.type('#amount', '150000');
check('amount gets spaces', (await p.$eval('#amount', e => e.value)) === '150 000');
await p.tap('#catGrid [data-c="Еда"]'); await p.type('#trip', 'Namangan'); await p.type('#note', 'kechki ovqat');
await p.screenshot({ path: '/tmp/wallet-sheet.png' });
await p.click('#f .btn'); await wait(200);
const add = (await ops(p)).find(o => o.op === 'add');
check('add: expense, so‘m, category, trip → work', add && add.kind === 'expense' && add.amount === 150000 && add.currency === 'UZS' && add.category === 'Еда' && add.trip === 'Namangan' && add.sphere === 'work' && add.day === T, JSON.stringify(add));
check('new row on top of today', /kechki ovqat/.test(await txt(p, '.it')));
// income in dollars
await p.tap('#fab'); await wait(250);
await p.tap('#kind [data-v="income"]'); await p.tap('#cur [data-v="USD"]'); await p.type('#amount', '120.5');
check('income categories shown', (await p.$$eval('#catGrid button', b => b.map(x => x.dataset.c))).includes('Зарплата'));
await p.click('#f .btn'); await wait(200);
const inc = (await ops(p)).filter(o => o.op === 'add')[1];
check('add income $120.5', inc && inc.kind === 'income' && inc.currency === 'USD' && inc.amount === 120.5 && inc.category === 'Зарплата', JSON.stringify(inc));
// edit: tap a row → change the amount
await p.tap('.it[data-id="3"]'); await wait(250);
check('the sheet opens with the record', (await p.$eval('#amount', e => e.value)) === '45 000' && (await p.$eval('#note', e => e.value)) === 'Paynet');
await p.$eval('#amount', e => { e.value = ''; }); await p.type('#amount', '50000');
await p.click('#f .btn'); await wait(200);
const ed = (await ops(p)).find(o => o.op === 'edit');
check('edit saves', ed && ed.id === 3 && ed.amount === 50000, JSON.stringify(ed));
// delete
await p.tap('.it[data-id="2"]'); await wait(250); await p.tap('#del'); await wait(200);
check('delete', (await ops(p)).some(o => o.op === 'del' && o.id === 2) && !(await p.$('.it[data-id="2"]')));
// filters: a category from the chart, a trip
await p.tap('#cats .cat[data-cat="Бензин"]'); await wait(100);
check('tap a category → only it', (await p.$$eval('.it', es => es.length)) === 1 && /Итог по фильтру/.test(await txt(p, '#bal')));
await p.tap('.chip[data-f=""]');
await p.tap('.chip[data-f="income"]'); await wait(80);
check('income filter', (await p.$$eval('.it .am', es => es.every(e => e.classList.contains('in')))));
await p.tap('.chip[data-f=""]');
// month switch
await p.tap('#prev'); await wait(200);
const last = (await p.evaluate(() => __ops.at(-1)));
check('previous month asked', last.op === 'list' && last.month < T.slice(0, 7), last.month);
check('empty month says how to add', /Записей нет/.test(await txt(p, '#hist')));
check('tab to the board keeps the api link', /tasks\.html\?api=/.test(await p.$eval('#toBoard', a => a.getAttribute('href'))));
check('no page errors', !(await p.evaluate(() => __errors.length)));

const k = await page('dark'); await k.waitForSelector('.it');
check('dark theme', await k.evaluate(() => document.documentElement.classList.contains('dark')));
await k.screenshot({ path: '/tmp/wallet-dark.png' });

// the board has the wallet tab too
const b = await page('light', 'tasks.html');
await wait(400);
check('board → wallet tab', /wallet\.html\?api=/.test(await b.$eval('#toWallet', a => a.getAttribute('href'))));

await browser.close(); srv.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
