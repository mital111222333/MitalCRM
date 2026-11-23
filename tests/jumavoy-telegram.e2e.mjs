// JUMAVOY page opened INSIDE Telegram (Mini App): signed by initData, full screen under Telegram's bars, Telegram links/haptics.
//   npm i puppeteer-core@23 && node tests/jumavoy-telegram.e2e.mjs jumavoy      (headless Chrome; telegram-web-app.js is stubbed)
import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2] || 'jumavoy';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(r); }).listen(8766);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const STUB = `window.Telegram = { WebApp: (() => { const log = window.__tg = [];
  const rec = n => (...a) => log.push([n, ...a]);
  return { platform: 'android', version: '8.0', isVersionAtLeast: v => parseFloat(v) <= 8.0, ready: rec('ready'), expand: rec('expand'),
    setHeaderColor: rec('header'), setBackgroundColor: rec('bg'), setBottomBarColor: rec('bottom'), disableVerticalSwipes: rec('noswipe'),
    requestFullscreen: rec('fullscreen'), onEvent: rec('on'), openLink: rec('openLink'), openTelegramLink: rec('openTg'),
    safeAreaInset: { top: 24, bottom: 16, left: 0, right: 0 }, contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
    HapticFeedback: { impactOccurred: rec('haptic'), notificationOccurred: rec('haptic') } }; })() };`;
const MOCK = `(() => { window.__calls = []; window.__errors = [];
  addEventListener('error', e => __errors.push(String(e.message)));
  window.fetch = async (url, o = {}) => { __calls.push({ url: String(url), headers: o.headers, body: JSON.parse(o.body || '{}') });
    const b = JSON.parse(o.body || '{}');
    if (b.warm) return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ text: 'ответ: https://t.me/MitalAI_bot и https://kun.uz', done: true, status: 200 }) + '\\n', { headers: { 'content-type': 'application/x-ndjson' } }); };
})();`;
const init = new URLSearchParams({ query_id: 'Q', user: JSON.stringify({ id: 7777, first_name: 'Saidbonur' }), auth_date: '1763900000', hash: 'abc' }).toString();
const results = []; const check = (n, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  — ' + info : '')); };
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844 });
p.on('pageerror', e => console.log('  pageerror:', e.message));
await p.setRequestInterception(true);
p.on('request', r => r.url().startsWith('https://telegram.org/') ? r.respond({ status: 200, contentType: 'text/javascript', body: STUB }) : r.continue());
await p.evaluateOnNewDocument(MOCK);
await p.goto('http://localhost:8766/index.html#tgWebAppData=' + encodeURIComponent(init) + '&tgWebAppVersion=8.0&tgWebAppPlatform=android', { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 800));
const st = await p.evaluate(() => ({ setup: !document.getElementById('setup').classList.contains('hidden'), log: !document.getElementById('log').classList.contains('hidden'),
  tg: window.__tg.map(x => x[0]), sat: getComputedStyle(document.documentElement).getPropertyValue('--sat').trim(), sab: getComputedStyle(document.documentElement).getPropertyValue('--sab').trim(),
  logout: getComputedStyle(document.getElementById('logout')).display, errors: window.__errors, calls: window.__calls }));
check('no setup screen, the chat is shown', !st.setup && st.log);
check('Telegram: ready, expand, black, no swipe, full screen', ['ready', 'expand', 'header', 'bg', 'bottom', 'noswipe', 'fullscreen'].every(x => st.tg.includes(x)), st.tg.join(','));
check('below Telegram bars: --sat 70px, --sab 16px', st.sat === '70px' && st.sab === '16px', st.sat + ' / ' + st.sab);
check('no «disconnect» item in Telegram', st.logout === 'none');
check('warm-up signed by initData', st.calls.some(c => c.body.warm && c.headers['x-tg-init'] === init && !c.headers['x-app-key']), JSON.stringify(st.calls[0]?.headers));
await p.type('#input', 'привет');
await p.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 1200));
const after = await p.evaluate(() => ({ bot: [...document.querySelectorAll('.bot')].map(x => x.textContent).join(' | '), q: window.__calls.find(c => c.body.text === 'привет'), errors: window.__errors }));
check('a question goes with initData and is answered', !!after.q && after.q.headers['x-tg-init'] === init && /ответ:/.test(after.bot), after.bot.slice(0, 80));
await p.evaluate(() => [...document.querySelectorAll('.bot a')].forEach(a => a.click()));
const links = await p.evaluate(() => window.__tg.filter(x => /open/.test(x[0])).map(x => x[0] + ' ' + x[1]));
check('links open through Telegram', links.includes('openTg https://t.me/MitalAI_bot') && links.includes('openLink https://kun.uz/'), links.join(', '));
check('haptics through Telegram', (await p.evaluate(() => window.__tg.some(x => x[0] === 'haptic'))));
check('no page errors', !after.errors.length, after.errors.join('; '));
// the same page in a browser without Telegram still asks for the personal link
const b2 = await browser.newPage(); await b2.evaluateOnNewDocument(MOCK);
await b2.goto('http://localhost:8766/index.html', { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 400));
check('outside Telegram without a link: the setup screen as before', await b2.evaluate(() => !document.getElementById('setup').classList.contains('hidden')));
await browser.close(); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
