// JUMAVOY page tests in headless Chrome: the real jumavoy/index.html, the server mocked inside the page (fetch).
//   npm i puppeteer-core@23 && node tests/jumavoy-page.e2e.mjs jumavoy      (about 3 minutes: one test waits for the time limit)
// Not in CI (needs Chrome). Checks: loads clean (app and panel), a question typed while busy is kept, a queued question and
// queued board changes go once even with two windows (the app + the panel over other apps), a stalled answer stream ends.
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2] || 'jumavoy';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8765);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const MOCK = (cfg) => `(() => {
  const cfg = ${JSON.stringify(cfg)};
  window.__calls = []; window.__errors = [];
  addEventListener('error', e => __errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => __errors.push('rej ' + String(e.reason && e.reason.message || e.reason)));
  const realFetch = fetch;
  window.fetch = async (url, o = {}) => {
    if (!String(url).includes('/ai-bot/app')) return realFetch(url, o);
    const body = JSON.parse(o.body || '{}'); __calls.push(body);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (body.warm) return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    if (body.tasks) { await wait(cfg.taskDelay || 300); return new Response(JSON.stringify({ tasks: [] }), { headers: { 'content-type': 'application/json' } }); }
    if (cfg.hang) { return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"stage":"Думаю"}\\n')); } }), { headers: { 'content-type': 'application/x-ndjson' } }); }
    await wait(cfg.delay || 50);
    return new Response(JSON.stringify({ text: 'ответ на ' + (body.text || 'аудио'), done: true, status: 200 }) + '\\n', { headers: { 'content-type': 'application/x-ndjson' } });
  };
  if (cfg.store) for (const [k, v] of Object.entries(cfg.store)) localStorage.setItem('jv_' + k, JSON.stringify(v));
})();`;
const KEY = { chat: '42', key: '0123456789abcdef0123456789abcdef' };
async function page(cfg = {}, url = 'http://localhost:8765/index.html', ctx = null) {
  const p = await (ctx || browser).newPage();
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.evaluateOnNewDocument(MOCK({ ...cfg, store: { ...KEY, ...(cfg.store || {}) } }));
  await p.goto(url, { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 400));
  return p;
}
const results = []; const check = (name, ok, info = '') => { results.push([name, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. loads without errors
{ const p = await page(); const e = await p.evaluate(() => __errors); check('loads without JS errors', !e.length, e.join('; ')); await p.close(); }
// 2. a question typed while the previous one is still answered is not lost
{ const p = await page({ delay: 1500 });
  await p.type('#input', 'первый'); await p.keyboard.press('Enter'); await sleep(100);
  await p.type('#input', 'второй'); await p.keyboard.press('Enter'); await sleep(2600);
  const st = await p.evaluate(() => ({ input: document.getElementById('input').value, me: [...document.querySelectorAll('#log .me')].map(x => x.textContent), asked: __calls.filter(c => c.text).map(c => c.text) }));
  check('second question while busy is kept', st.input === 'второй' || st.asked.includes('второй'), JSON.stringify(st)); await p.close(); }
// 3. two pages of the same app (the app + the panel over other apps) share the queue: a queued question goes once
{ const ctx = await browser.createBrowserContext();
  const item = { id: 'x1', body: { text: 'вопрос из очереди' }, shown: 'вопрос из очереди', at: Date.now() };
  const a = await page({ delay: 1200, store: { outbox: [item] } }, undefined, ctx);
  const b = await page({ delay: 1200 }, undefined, ctx);
  await Promise.all([a.evaluate(() => flush()), b.evaluate(() => flush())]); await sleep(1600);
  const n = (await a.evaluate(() => __calls.filter(c => c.text === 'вопрос из очереди').length)) + (await b.evaluate(() => __calls.filter(c => c.text === 'вопрос из очереди').length));
  check('queued question sent once by two windows', n === 1, 'sent ' + n + ' times'); await ctx.close(); }
// 4. a queued kanban change goes once even when the board opens while the queue is sent
{ const p = await page({ taskDelay: 600, store: { taskq: [{ op: 'add', title: 'T1' }, { op: 'add', title: 'T2' }] } });
  await p.evaluate(() => { flushTasks(); openTasks(); }); await sleep(2500);
  const ops = await p.evaluate(() => __calls.filter(c => c.tasks && c.tasks.op === 'add').map(c => c.tasks.title));
  check('queued task changes sent once each, in order', JSON.stringify(ops) === '["T1","T2"]', JSON.stringify(ops)); await p.close(); }
// 5. an answer stream that stalls does not leave the app «думаю» forever (timeout shortened for the test)
{ const p = await page({ hang: true });
  await p.evaluate(() => { window.__t = ask({ text: 'висит' }, 'висит'); });
  const t0 = Date.now(); let busy = true;
  while (Date.now() - t0 < 200000 && busy) { await sleep(1000); busy = await p.evaluate(() => busy); }
  check('stalled answer stream ends with an error', !busy, Math.round((Date.now() - t0) / 1000) + ' s'); await p.close(); }
// 6. panel mode with the Android bridge mocked loads clean
{ const p = await browser.newPage(); p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.evaluateOnNewDocument(MOCK({ store: KEY }));
  await p.evaluateOnNewDocument(() => { window.JumavoyNative = { version: () => 5, isPanel: () => true, isOnline: () => true, canListen: () => true, canSpeak: () => true, hasMic: () => true, isAssistant: () => true, listen() {}, stopListen() {}, speak() {}, stopSpeak() {}, screen: () => JSON.stringify({ app: 'WhatsApp', text: 'привет', shot: false }), closePanel() {}, openApp() {} }; window.JumavoyDevice = { run: () => 'ok' }; });
  await p.goto('http://localhost:8765/index.html?panel=1&assist=1'); await sleep(800);
  const e = await p.evaluate(() => __errors); check('panel mode loads without JS errors', !e.length, e.join('; ')); await p.close(); }
console.log(`\n${results.filter(x => x[1]).length}/${results.length} passed`);
await browser.close(); srv.close();
process.exit(results.every(x => x[1]) ? 0 : 1);
