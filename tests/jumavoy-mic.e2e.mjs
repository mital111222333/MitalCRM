// Inside Telegram the microphone is opened once per launch (Telegram asks «allow?» on every opening); elsewhere — each time.
//   npm i puppeteer-core@23 && node tests/jumavoy-mic.e2e.mjs jumavoy
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2] || 'jumavoy';
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(8767);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const MOCK = `(() => { window.__calls = []; window.__gum = 0; window.__errors = [];
  addEventListener('error', e => __errors.push(String(e.message)));
  navigator.mediaDevices.getUserMedia = async () => { __gum++; const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); window.__last = d.stream; return d.stream; };
  window.fetch = async (url, o = {}) => { const b = JSON.parse(o.body || '{}'); __calls.push(b);
    return new Response(JSON.stringify({ text: 'ok', heard: 'x', done: true, status: 200 }) + '\\n', { headers: { 'content-type': 'application/x-ndjson' } }); };
})();`;
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  — ' + info : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(url) {
  const p = await browser.newPage(); p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.setRequestInterception(true);
  p.on('request', r => r.url().startsWith('https://telegram.org/') ? r.respond({ status: 200, contentType: 'text/javascript', body: 'window.Telegram={WebApp:{platform:"android",isVersionAtLeast:()=>true,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},disableVerticalSwipes(){},requestFullscreen(){},onEvent(){},safeAreaInset:{},contentSafeAreaInset:{}}}' }) : r.continue());
  await p.evaluateOnNewDocument(MOCK);
  await p.evaluateOnNewDocument(`localStorage.setItem('jv_chat','"42"');localStorage.setItem('jv_key','"0123456789abcdef0123456789abcdef"')`);
  await p.goto(url, { waitUntil: 'load' }); await sleep(600);
  for (let i = 0; i < 3; i++) { await p.click('#mic'); await sleep(900); await p.click('#mic'); await sleep(1500); }
  return p;
}
const init = new URLSearchParams({ query_id: 'Q', user: JSON.stringify({ id: 7 }), auth_date: '1', hash: 'h' }).toString();
const tg = await run('http://localhost:8767/index.html#tgWebAppData=' + encodeURIComponent(init) + '&tgWebAppVersion=8.0');
const t = await tg.evaluate(() => ({ gum: __gum, audio: __calls.filter(c => c.audio).length, live: __last.getAudioTracks()[0].readyState, on: __last.getAudioTracks()[0].enabled, err: __errors }));
check('Telegram: 3 recordings, the microphone asked ONCE', t.gum === 1 && t.audio === 3, JSON.stringify(t));
check('between questions the kept microphone is muted', t.live === 'live' && t.on === false);
await tg.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); dispatchEvent(new Event('visibilitychange')); });
check('JUMAVOY hidden → the microphone is released', await tg.evaluate(() => __last.getAudioTracks()[0].readyState === 'ended'));
const br = await run('http://localhost:8767/index.html');
const b = await br.evaluate(() => ({ gum: __gum, audio: __calls.filter(c => c.audio).length, live: __last.getAudioTracks()[0].readyState }));
check('browser / app: opened and closed each time, as before', b.gum === 3 && b.audio === 3 && b.live === 'ended', JSON.stringify(b));
await browser.close(); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
