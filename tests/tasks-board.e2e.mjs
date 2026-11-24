// The kanban board (tasks.html, Telegram Mini App) in headless Chrome: columns, tap-to-done, drag by mouse and by a
// finger (long press), quick add per column, the card sheet, filters, dark theme. telegram-web-app.js and the API are stubbed.
//   npm i puppeteer-core@23 && node tests/tasks-board.e2e.mjs            (screenshots → /tmp/board-*.png)
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, 'tasks.html'); r.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(8771);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const stub = scheme => `window.Telegram = { WebApp: (() => { const log = window.__tg = []; const rec = n => (...a) => log.push([n, ...a]);
  return { initData: 'user=%7B%22id%22%3A111%7D&hash=x', colorScheme: '${scheme}', ready: rec('ready'), expand: rec('expand'), setHeaderColor: rec('h'), setBackgroundColor: rec('b'), disableVerticalSwipes: rec('ns'),
    showConfirm: (t, cb) => cb(true), HapticFeedback: { impactOccurred: rec('hap'), notificationOccurred: rec('hap'), selectionChanged: rec('hap') } }; })() };`;
const T = new Date().toISOString().slice(0, 10), Y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const MOCK = `(() => { window.__ops = []; window.__errors = []; addEventListener('error', e => __errors.push(String(e.message)));
  let id = 10, tasks = [
    { id: 1, title: 'Fozilxonga qo\\'ng\\'iroq qilish', status: 'todo', priority: 2, due: '${Y}', sphere: 'work', progress: 0, note: 'qarz $800' },
    { id: 2, title: 'Narxlar ro\\'yxatini yangilash', status: 'todo', priority: 1, due: '${T}', sphere: 'work', progress: 0 },
    { id: 3, title: 'Oilaga sovg\\'a olish', status: 'todo', priority: 0, sphere: 'family', progress: 0, remind: { at: new Date(Date.now() + 3600e3).toISOString() } },
    { id: 4, title: 'Haftalik hisobot', status: 'doing', priority: 0, sphere: 'work', progress: 60 },
    { id: 5, title: 'Agentlar bilan yig\\'ilish', status: 'done', priority: 0, sphere: 'work', progress: 100, done_at: '${T}T09:00:00Z' },
  ];
  window.fetch = async (url, o = {}) => { const b = JSON.parse(o.body || '{}'); __ops.push(b);
    if (b.op === 'move' || b.op === 'edit') { const t = tasks.find(x => x.id === b.id); Object.assign(t, b.op === 'move' ? { status: b.status } : b); delete t.op; if (t.status === 'done') t.progress = 100; }
    if (b.op === 'add') tasks.push({ id: ++id, title: b.title, status: b.status || 'todo', priority: 0, sphere: b.sphere || 'work', progress: 0, due: b.due });
    if (b.op === 'del') tasks = tasks.filter(x => x.id !== b.id);
    await new Promise(r => setTimeout(r, 30));
    return new Response(JSON.stringify({ tasks, today: '${T}' }), { headers: { 'content-type': 'application/json' } }); };
})();`;
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  — ' + info : '')); };
async function page(scheme, w = 390, h = 800, touch = true) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, isMobile: touch, hasTouch: touch, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.setRequestInterception(true);
  p.on('request', r => r.url().startsWith('https://telegram.org/') ? r.respond({ status: 200, contentType: 'text/javascript', body: stub(scheme) }) : r.continue());
  await p.evaluateOnNewDocument(MOCK);
  await p.goto('http://localhost:8771/tasks.html?api=' + encodeURIComponent('https://abc.supabase.co/functions/v1/ai-bot'));
  await p.waitForSelector('.card');
  return p;
}
const ops = p => p.evaluate(() => __ops.filter(o => o.op !== 'list'));
const colOf = (p, id) => p.evaluate(i => document.querySelector(`.card[data-id="${i}"]`)?.closest('.col')?.dataset.col, id);
const center = (p, sel) => p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) }; });
const wait = ms => new Promise(r => setTimeout(r, ms));

// 1) phone, light theme
const p = await page('light');
await p.screenshot({ path: '/tmp/board-light.png' });
const cols = await p.$$eval('.col h2', hs => hs.map(h => h.textContent.trim()));
check('three columns named as asked', cols[0].startsWith('Нужно сделать') && cols[1].startsWith('В процессе') && cols[2].startsWith('Готово'), cols.join(' | '));
check('cards in their columns', (await colOf(p, 1)) === 'todo' && (await colOf(p, 4)) === 'doing' && (await colOf(p, 5)) === 'done');
const badges = await p.$eval('.card[data-id="1"]', e => e.textContent);
check('labels and badges: urgent, overdue, description', /Срочно/.test(badges) && /🕑/.test(badges) && /≡/.test(badges) && !!(await p.$('.card[data-id="1"] .bd.late')), badges.replace(/\s+/g, ' '));
check('reminder badge', /⏰/.test(await p.$eval('.card[data-id="3"]', e => e.textContent)));
check('columns swipe sideways (phone: one column ~ the screen)', await p.$eval('.board', b => b.scrollWidth > b.clientWidth * 1.8));
// tap the circle → done
await p.tap('.card[data-id="2"] [data-chk]'); await wait(150);
check('tap the circle → done', (await colOf(p, 2)) === 'done' && (await ops(p)).some(o => o.op === 'move' && o.id === 2 && o.status === 'done'));
// a finger: long press, then drag to the «В процессе» column
const c = await center(p, '.card[data-id="1"]');
const cdp = await p.createCDPSession();
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', c.x, c.y); await wait(400);
check('long press lifts the card', !!(await p.$('.ghost')));
for (let i = 1; i <= 12; i++) { await touch('touchMove', c.x + i * 25, c.y + 20); await wait(30); }
// hold near the right edge: the board scrolls to the next column
for (let i = 0; i < 8; i++) { await touch("touchMove", 375, c.y + 30); await wait(30); }
const pos = await p.$eval('.col[data-col="doing"] .list', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 30 }; });
await touch('touchMove', pos.x, pos.y); await wait(60);
await touch('touchEnd'); await wait(200);
check('finger drag → «В процессе»', (await colOf(p, 1)) === 'doing' && (await ops(p)).some(o => o.op === 'move' && o.id === 1 && o.status === 'doing'), 'now in ' + await colOf(p, 1));
check('no ghost left', !(await p.$('.ghost')) && !(await p.$('.ph')));
// a short swipe is a scroll, not a drag
const n0 = (await ops(p)).length;
const c3 = await center(p, '.col[data-col="todo"] .card');
await p.evaluate(() => { document.querySelector('.board').scrollLeft = 0; }); await wait(100);
const c3b = await center(p, '.col[data-col="todo"] .card');
await touch('touchStart', c3b.x, c3b.y); await touch('touchMove', c3b.x - 60, c3b.y); await touch('touchEnd'); await wait(150);
check('a quick swipe does not move a card', (await ops(p)).length === n0); void c3;
// quick add at the bottom of a column
await p.evaluate(() => { document.querySelector('.board').scrollLeft = 0; });
await p.tap('.col[data-col="todo"] [data-add]');
await p.type('.composer textarea', 'Yangi mijoz bilan uchrashuv'); await p.keyboard.press('Enter'); await wait(200);
check('quick add in its column', (await ops(p)).some(o => o.op === 'add' && o.title === 'Yangi mijoz bilan uchrashuv' && o.status === 'todo') && await p.$$eval('.col[data-col="todo"] .card', cs => cs.some(c => /Yangi mijoz/.test(c.textContent))));
check('the composer stays open for the next card', !!(await p.$('.composer textarea')));
await p.keyboard.press('Escape');
// open a card → sheet → change status and priority → save
await p.tap('.card[data-id="3"] .t'); await wait(150);
await p.screenshot({ path: '/tmp/board-sheet.png' });
check('a tap opens the card', await p.$eval('#sheet', e => e.classList.contains('on')));
await p.click('#segSt [data-v="doing"]'); await p.click('#segPr [data-v="2"]');
await p.click('#edit .btn'); await wait(150);
const ed = (await ops(p)).find(o => o.op === 'edit' && o.id === 3);
check('sheet saves status and priority', ed && ed.status === 'doing' && ed.priority === 2 && (await colOf(p, 3)) === 'doing', JSON.stringify(ed));
// filters
await p.tap('.chip[data-f="family"]'); await wait(80);
check('sphere filter', (await p.$$eval('.card', cs => cs.length)) === 1);
await p.tap('.chip[data-f="today"]'); await wait(80);
check('«📌 Сегодня» filter', (await p.$$eval('.card', cs => cs.map(c => +c.dataset.id))).every(id => [1, 2, 3, 4, 5].includes(id)));
await p.tap('.chip[data-f=""]');
check('no page errors', !(await p.evaluate(() => __errors.length)));

// 2) desktop with a mouse: drag at once
const d = await page('light', 1200, 760, false);
const a = await center(d, '.card[data-id="4"]'), b = await d.$eval('.col[data-col="done"] .list', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; });
await d.mouse.move(a.x, a.y); await d.mouse.down();
for (let i = 1; i <= 10; i++) await d.mouse.move(a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10);
await d.mouse.up(); await wait(200);
check('mouse drag → «Готово»', (await colOf(d, 4)) === 'done');
check('the drop did not open the sheet', !(await d.$eval('#sheet', e => e.classList.contains('on'))));
await d.screenshot({ path: '/tmp/board-desktop.png' });

// 3) dark Telegram theme
const k = await page('dark');
check('dark theme', await k.evaluate(() => document.documentElement.classList.contains('dark')));
await k.screenshot({ path: '/tmp/board-dark.png' });

await browser.close(); srv.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
