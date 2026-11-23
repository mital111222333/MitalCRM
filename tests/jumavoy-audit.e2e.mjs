// JUMAVOY audit 24.11 — the page bugs found in the full check, each reproduced here first (headless Chrome, server mocked):
//   npm i puppeteer-core@23 && node tests/jumavoy-audit.e2e.mjs jumavoy
// • a voice question while the offline queue is being sent was silently lost → now it waits and goes
// • the panel over other apps closed while speaking sent the half-said question → now nothing is sent
// • an offline voice question lives in IndexedDB (localStorage filled up after 2 recordings) and goes once, with the audio
// • a question and its retry carry the same id (the server does it once)
// • the phone's voice no longer reads emoji / arrows / links; links followed by a quote are not broken
// • ?ask=/dolg (the app icon's menu) asks at once; the native recognizer's late result after ✕ is dropped
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2] || 'jumavoy';
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(8768);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  — ' + info : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = cfg => `(() => { const cfg = ${JSON.stringify(cfg)}; window.__calls = []; window.__errors = []; window.__spoken = []; window.__dev = [];
  addEventListener('error', e => __errors.push(String(e.message)));
  window.__online = cfg.online !== false;
  Object.defineProperty(navigator, 'onLine', { get: () => window.__online, configurable: true });
  navigator.mediaDevices.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.5; const d = ac.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start(); return d.stream; };
  window.fetch = async (url, o = {}) => { const b = JSON.parse(o.body || '{}'); __calls.push(b);
    if (b.warm) return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    await new Promise(r => setTimeout(r, b.text === 'долгий' ? 2500 : 150));
    return new Response(JSON.stringify({ text: 'ответ на ' + (b.text || 'голос'), heard: b.audio ? 'голос' : undefined, done: true, status: 200 }) + '\\n', { headers: { 'content-type': 'application/x-ndjson' } }); };
  if (cfg.native) {
    window.JumavoyNative = { version: () => 6, isOnline: () => window.__online, canListen: () => true, hasMic: () => true, canSpeak: () => true, isPanel: () => !!cfg.panel,
      speak: (t, l) => __spoken.push(t), stopSpeak() {}, listen() { window.__listening = true; }, stopListen() { window.__listening = false; }, keepAwake(on) { (window.__awake ||= []).push(on); },
      isAssistant: () => true, diag: () => '{}', screen: () => null, closePanel() {}, openApp() {} };
    window.JumavoyDevice = { run: j => { __dev.push(JSON.parse(j)); return 'ok'; } };
  }
  localStorage.setItem('jv_chat', '"42"'); localStorage.setItem('jv_key', '"0123456789abcdef0123456789abcdef"');
  for (const [k, v] of Object.entries(cfg.store || {})) localStorage.setItem('jv_' + k, JSON.stringify(v));
})();`;
async function open(cfg = {}, q = '') {
  const p = await browser.newPage(); p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.evaluateOnNewDocument(MOCK(cfg));
  await p.goto('http://localhost:8768/index.html' + q, { waitUntil: 'load' }); await sleep(500);
  return p;
}

// 1. a voice question while the queue is being sent: it waits and then goes (it used to be lost without a word)
{
  const p = await open({ store: { outbox: [{ id: 'o1', body: { text: 'долгий', qid: 'qq1111' }, shown: 'долгий', at: 1 }] } });
  await sleep(1700); // the queue is being sent (flush after 1,5 s), 2,5 s answer
  const flushing = await p.evaluate(() => document.body.dataset.mode);
  await p.evaluate(() => window.jvNative.onResult && 0); // nothing
  await p.evaluate(() => ask({ text: 'голосом во время очереди', voice: true }, 'голосом во время очереди', true));
  await sleep(300);
  const calls = await p.evaluate(() => __calls.filter(c => c.text).map(c => c.text));
  check('a voice question while the queue goes is not lost', calls.includes('долгий') && calls.includes('голосом во время очереди') && calls.indexOf('долгий') < calls.indexOf('голосом во время очереди'), flushing + ' ' + JSON.stringify(calls));
  await p.close();
}

// 2. the panel closed while speaking: nothing is sent
{
  const p = await open({ native: true, panel: true }, '?panel=1');
  await p.evaluate(() => listen(true)); await sleep(900);
  await p.evaluate(() => window.jumavoyPanelHide()); await sleep(1500);
  const sent = await p.evaluate(() => __calls.filter(c => c.audio || c.text).length);
  check('panel closed while recording → nothing sent', sent === 0, 'sent ' + sent);
  // the phone's recognizer: a late result after the panel closed is dropped too
  await p.evaluate(() => { phoneVoice = true; nativeOff = {}; }); await p.evaluate(() => listen()); await sleep(100);
  await p.evaluate(() => window.jumavoyPanelHide()); await p.evaluate(() => window.jvNative.onResult('поздний результат')); await sleep(400);
  const late = await p.evaluate(() => __calls.filter(c => c.text === 'поздний результат').length);
  check('late native result after the panel closed is dropped', late === 0);
  await p.close();
}

// 3. offline voice: IndexedDB, not localStorage; goes once with the audio when the internet is back
{
  const p = await open({ native: true, online: false });
  await p.evaluate(() => listen(true)); await sleep(1200); await p.evaluate(() => listen(true)); await sleep(1500);
  const st = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('jv_outbox') || '[]'); return { n: o.length, inline: o.some(x => x.body.audio), ref: o.map(x => x.body.audioRef).filter(Boolean).length, size: (localStorage.getItem('jv_outbox') || '').length }; });
  check('offline recording waits in IndexedDB (the queue keeps only its id)', st.n === 1 && !st.inline && st.ref === 1 && st.size < 2000, JSON.stringify(st));
  await p.evaluate(() => { window.__online = true; dispatchEvent(new Event('online')); }); await sleep(2500);
  const r = await p.evaluate(async () => ({ audio: __calls.filter(c => c.audio && c.audio.length > 100).length, ref: __calls.filter(c => c.audioRef).length, left: JSON.parse(localStorage.getItem('jv_outbox') || '[]').length, qid: __calls.filter(c => c.audio).map(c => c.qid) }));
  check('back online: sent once, with the recording', r.audio === 1 && r.ref === 0 && r.left === 0 && /^[a-z0-9]{8,}$/.test(r.qid[0] || ''), JSON.stringify(r));
  await p.close();
}

// 4. a question and «Спросить ещё раз» carry the same id
{
  const p = await open();
  await p.evaluate(() => { const f = window.fetch; let k = 0; window.fetch = async (u, o) => { const b = JSON.parse(o.body || '{}'); if (b.text === 'дважды' && !k++) { __calls.push(b); return new Response(JSON.stringify({ done: true, status: 500, error: 'Gemini перегружен' }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }); } return f(u, o); }; });
  await p.evaluate(() => ask({ text: 'дважды' }, 'дважды')); await sleep(400);
  await p.evaluate(() => document.querySelector('.err .retry').click()); await sleep(600);
  const ids = await p.evaluate(() => __calls.filter(c => c.text === 'дважды').map(c => c.qid));
  check('retry carries the same question id', ids.length === 2 && ids[0] && ids[0] === ids[1], JSON.stringify(ids));
  await p.close();
}

// 5. what the phone reads aloud; links next to quotes
{
  const p = await open({ native: true });
  const r = await p.evaluate(() => ({ s: spoken('⏰ Напомню 05.01 ⏳ → завтра ▶️ ↪ https://t.me/x 👨‍👩‍👧 готово ✅'), h: rich('см. "https://kun.uz/news/1" и (https://t.me/a).') }));
  check('no emoji, arrows, links in the voice', !/[⏰⏳→▶↪✅]|https|‍/u.test(r.s) && /Напомню 05\.01/.test(r.s) && /готово/.test(r.s), JSON.stringify(r.s));
  check('a link before a quote / bracket is not broken', r.h.includes('href="https://kun.uz/news/1"') && r.h.includes('href="https://t.me/a"') && !r.h.includes('&quot;"'), r.h);
  // the screen is kept on while JUMAVOY works, released after
  await p.evaluate(() => ask({ text: 'тест' }, 'тест')); await sleep(500);
  const aw = await p.evaluate(() => window.__awake || []);
  check('screen kept on while answering, released after', aw[0] === true && aw.at(-1) === false, JSON.stringify(aw));
  await p.close();
}

// 6. ?ask=/dolg from the app icon's menu; native result after ✕ dropped; no page errors
{
  const p = await open({ native: true }, '?ask=%2Fdolg');
  await sleep(900);
  const r = await p.evaluate(() => ({ asked: __calls.filter(c => c.text === '/dolg').length, me: [...document.querySelectorAll('.me')].map(x => x.textContent), url: location.search }));
  check('?ask=/dolg asks at once, shown as «Должники»', r.asked === 1 && r.me.includes('Должники') && r.url === '', JSON.stringify(r));
  await p.evaluate(() => { phoneVoice = true; nativeOff = {}; listen(); }); await sleep(100);
  await p.evaluate(() => { document.getElementById('stopBtn').click(); window.jvNative.onResult('отменённое'); }); await sleep(300);
  check('result after ✕ is dropped', await p.evaluate(() => !__calls.some(c => c.text === 'отменённое')));
  check('the «Отправить» button shares an answer', await p.evaluate(() => { const b = [...document.querySelectorAll('.bot .pill')].find(x => x.textContent === 'Отправить'); b && b.click(); return !!b && __dev.some(d => d.action === 'share' && /ответ на/.test(d.text)); }));
  check('no page errors', (await p.evaluate(() => __errors)).length === 0);
  await p.close();
}
await browser.close(); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
