// Кабинет агента (me.html): the agent's own page. The personal link carries a secret code (k) and the address of the Google
// auto-loader (u); the page asks u?agent=k and gets back only this agent's file, prepared by the supervisor's CRM (agentcab.js).
// Read-only. The link is remembered on this phone, and the last data is kept so the page opens without internet.
// Inside Telegram (Mini App from the bot's button) there is no link: the page sends Telegram's signed initData instead (u?tg=…),
// the auto-loader checks the signature with the bot token and returns the file of that Telegram user.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');
  // dollars to the cent, as LINKO shows them: $5 692 or $5 692,40 (never a rounded-off cent)
  const $$ = n => { const v = Math.round((Number(n) || 0) * 100) / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: Math.abs(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  const pctT = v => (v == null ? '—' : (v > 0 && v < 10 ? (Math.round(v * 10) / 10).toLocaleString('ru-RU') : Math.round(v)) + '%'); // 0,4% — not «0%» when $123 of $35 000 is collected
  const pctV = (a, b) => (b > 0 ? a / b * 100 : null);
  const tashToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const dRu = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
  const dm = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);
  const tile = (label, value, sub = '', tone = '') => `<div class="tile ${tone ? 'tone-' + tone : ''}"><div class="tl">${label}</div><div class="tv">${value}</div><div class="ts">${sub}</div></div>`;
  const panel = (title, body, sub = '') => `<section class="panel w12"><div class="ph"><div><h4>${title}</h4>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>${body}</section>`;
  const ACADEMY = 'https://mital111222333.github.io/academy/'; // MITAL Akademiya: courses for agents
  const hhmm = v => (v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };

  // the personal link: #k=…&u=… (taken once, then remembered and removed from the address bar)
  const TGA = window.Telegram?.WebApp, inTg = !!TGA?.initData, qs = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('k') && h.get('u')) { store.set('mital_me', { k: h.get('k'), u: h.get('u') }); history.replaceState(null, '', location.pathname + location.search); }
  const link = inTg && qs.get('u') ? { tg: TGA.initData, u: qs.get('u') } : store.get('mital_me');
  if (inTg) { try { TGA.ready(); TGA.expand(); if (TGA.colorScheme === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* old Telegram */ } }
  // the third way in: the agent signed in to MITAL CRM with his own login (index.html sends agents here). The cabinet is read from
  // the MITAL database (agent_cabinets, only his own row — the database rules check it); it is written there by his supervisor's CRM.
  const SB_URL = 'https://oxchgcfyzszemqlvdjjr.supabase.co', SB_KEY = 'sb_publishable_FlwHIDb04LSfDA18DFo_Yw_YesRxk9g';
  const sbUid = (() => { try { return JSON.parse(localStorage.getItem('crm_auth') || 'null')?.user?.id || ''; } catch { return ''; } })();
  const SB = !link && sbUid && window.supabase?.createClient ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm_auth' } }) : null;
  const DATA_KEY = SB ? 'mital_me_data:' + sbUid : 'mital_me_data'; // a shared phone never shows the previous agent's cabinet
  const NO_ACT = 'Это отмечается в кабинете Telegram: кнопка «📱 Мой кабинет» в боте вашего руководителя.';
  let tab = 'main', q = '', cf = 'all', calDay = '', routeDay = '', S = store.get(DATA_KEY), loading = false, doing = null;

  // ---------- the cabinet as an app on the phone: install button (Android / Chrome — one tap; iPhone — Safari → «На экран Домой») ----------
  let installEv = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; const b = $('#meInst'); if (b) b.hidden = false; });
  addEventListener('appinstalled', () => { installEv = null; const b = $('#meInst'); if (b) b.hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
  const installCard = () => (standalone() || inTg ? '' : panel('📲 Приложение на телефоне', installEv ? '<button class="btn" type="button" data-inst="1">📲 Установить приложение</button><p class="mut" style="margin:8px 0 0">Иконка MITAL появится на экране телефона — кабинет будет открываться как обычное приложение, без браузера.</p>'
    : isIos ? '<ol style="margin:0;padding-left:20px;line-height:1.7"><li>Откройте кабинет в <b>Safari</b>.</li><li>Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой вверх).</li><li>Выберите <b>«На экран „Домой“»</b> → «Добавить».</li></ol>'
      : '<ol style="margin:0;padding-left:20px;line-height:1.7"><li>Откройте кабинет в <b>Chrome</b>.</li><li>Нажмите меню <b>⋮</b> справа вверху.</li><li>Выберите <b>«Установить приложение»</b> или «Добавить на главный экран».</li></ol>'));
  async function install() { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch { /* closed */ } installEv = null; draw(); }

  // ---------- language: Русский / Oʻzbekcha (lotin). The page is written in Russian; me-uz.js translates what is on the screen ----------
  const LANG_KEY = 'mital_me_lang';
  let lang = store.get(LANG_KEY) || (/^uz/i.test(TGA?.initDataUnsafe?.user?.language_code || navigator.language || '') ? 'uz' : 'ru');
  const langCard = () => panel('🌐 Til / Язык', `<div class="chips" style="margin:0"><button type="button" data-lang="ru" class="${lang === 'ru' ? 'on' : ''}">Русский</button><button type="button" data-lang="uz" class="${lang === 'uz' ? 'on' : ''}">Oʻzbekcha</button></div>`);
  function setLang(l) { lang = l; store.set(LANG_KEY, l); document.documentElement.lang = l === 'uz' ? 'uz-Latn' : 'ru'; location.reload(); }
  // sign out: the login session (agent / store keeper) or the personal link remembered on this phone; the saved data goes too,
  // so the next person on a shared phone sees nothing of it
  async function logout() {
    if (!confirm('Выйти из аккаунта на этом телефоне?')) return;
    try { if (SB) await SB.auth.signOut(); } catch { /* offline: the local session is removed anyway */ }
    for (const k of ['crm_me', 'crm_auth', 'mital_me', DATA_KEY, 'mital_me_data', 'mital_me_marks', 'mital_me_cq', 'mital_cnt']) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
    location.replace('./');
  }
  function bindExtras(root) {
    root.querySelectorAll('[data-out]').forEach(b => b.onclick = logout);
    root.querySelectorAll('[data-inst]').forEach(b => b.onclick = install);
    root.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { if (b.dataset.lang !== lang) setLang(b.dataset.lang); });
  }
  if (lang === 'uz' && window.ME_UZ) {
    document.documentElement.lang = 'uz-Latn';
    // a phrase that starts / ends with a letter matches only whole words: «план» never eats the start of «плана»
    const L = 'А-Яа-яЁё', rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const T = window.ME_UZ.slice().sort((a, b) => b[0].length - a[0].length).map(([ru, uz]) => [ru, new RegExp((/^[А-Яа-яЁё]/.test(ru) ? `(?<![${L}])` : '') + rx(ru) + (/[А-Яа-яЁё]$/.test(ru) ? `(?![${L}])` : ''), 'g'), uz]);
    const ATTR = ['placeholder', 'aria-label', 'title'];
    const tr = s => { if (!s || !/[А-Яа-яЁё]/.test(s)) return s; let o = s; for (const [ru, re, uz] of T) if (o.includes(ru)) o = o.replace(re, uz); return o; };
    const walk = root => {
      if (root.nodeType === 3) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
      if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.tagName === 'TEXTAREA') return;
      for (const a of ATTR) if (root.hasAttribute?.(a)) { const v = tr(root.getAttribute(a)); if (v !== root.getAttribute(a)) root.setAttribute(a, v); }
      if (root.tagName === 'INPUT' && /^(button|submit)$/.test(root.type)) root.value = tr(root.value);
      for (const c of root.childNodes) walk(c);
    };
    const mo = new MutationObserver(list => { mo.disconnect(); for (const m of list) { if (m.type === 'characterData') walk(m.target); else m.addedNodes.forEach(walk); } mo.observe(document.body, { childList: true, subtree: true, characterData: true }); });
    document.addEventListener('DOMContentLoaded', () => { walk(document.body); document.title = tr(document.title); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); });
    // alerts and confirms in Uzbek too
    const A = window.alert.bind(window), C = window.confirm.bind(window); window.alert = m => A(tr(String(m))); window.confirm = m => C(tr(String(m)));
  }
  // chat tab: the agent's conversation with the bot through the chat worker (/agent/*), signed in by Telegram's initData
  const CH = { msgs: [], last: 0, timer: null, sending: false };
  const chatUrl = p => S?.chat ? S.chat.replace(/\/+$/, '') + p : '';
  async function chatLoad() {
    if (!inTg || !S?.chat) return;
    try {
      const r = await fetch(chatUrl('/agent/messages?since=' + CH.last), { headers: { Authorization: 'tma ' + TGA.initData }, cache: 'no-store' });
      const j = await r.json(); if (!Array.isArray(j)) return;
      for (const m of j) if (!CH.msgs.some(x => x.id === m.id)) CH.msgs.push(m);
      CH.msgs.sort((a, b) => a.id - b.id); if (CH.msgs.length) CH.last = CH.msgs.at(-1).id;
      if (j.length && tab === 'chat') chatDraw();
    } catch { /* offline: try again on the next tick */ }
  }
  function chatDraw() {
    const box = $('#chatList'); if (!box) return;
    const at = s => new Date(s * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const file = id => chatUrl('/agent/file?file_id=' + encodeURIComponent(id) + '&init=' + encodeURIComponent(TGA.initData));
    box.innerHTML = CH.msgs.length ? CH.msgs.map(m => { const me = !m.out; let media = '';
      if (m.type === 'photo' && m.file_id) media = `<img src="${file(m.file_id)}" alt="Фото" loading="lazy">`;
      else if ((m.type === 'voice' || m.type === 'audio') && m.file_id) media = `<audio controls preload="none" src="${file(m.file_id)}"></audio>`;
      else if ((m.type === 'video' || m.type === 'video_note') && m.file_id) media = `<video controls preload="none" src="${file(m.file_id)}" style="max-width:100%"></video>`;
      else if (m.type === 'document' && m.file_id) media = `<a href="${file(m.file_id)}" target="_blank" rel="noopener">📎 ${esc(m.file_name || 'файл')}</a>`;
      return `<div class="chat-msg ${me ? 'me' : ''}">${media}${m.text ? esc(m.text) : ''}<small>${me ? 'Вы' : 'Руководитель'} · ${at(m.date)}</small></div>`; }).join('') : '<p class="mut">Сообщений пока нет. Напишите руководителю — он ответит здесь.</p>';
    box.scrollTop = box.scrollHeight;
  }
  function chatStop() { clearInterval(CH.timer); CH.timer = null; }
  // tasks marked here but not yet seen by the supervisor's CRM: shown as «отправлено» until the next data comes
  const marks = () => store.get('mital_me_marks') || {}, markKey = t => t.src + ':' + t.id;
  const isOpen = t => (t.status === 'open' || t.status === 'returned') && !marks()[markKey(t)];

  async function loadSb() {
    loading = true; $('#meUpd').disabled = true; $('#meUpd').textContent = 'Обновляю…';
    try {
      const { data: { session } } = await SB.auth.getSession();
      if (!session) { location.replace('./'); return; } // signed out: back to the sign-in page
      const { data, error } = await SB.from('agent_cabinets').select('data, updated_at, updated_by').eq('agent_id', session.user.id).maybeSingle();
      if (error) throw error;
      if (!data) msg('Кабинет ещё не готов: ваш руководитель должен открыть свою CRM — кабинет появится через минуту.', true);
      else if (data.data.role === 'store') {
        // завсклад: the list of goods and today's count come from the auto-loader (it checks this login with the MITAL database)
        const gas = data.data.gas; if (!gas) throw new Error('no gas');
        const r = await fetch(gas, { method: 'POST', body: JSON.stringify({ sb: session.access_token, act: 'load' }) }), j = await r.json();
        if (j.error) msg(j.error, true); else { S = j; S._gas = gas; store.set(DATA_KEY, S); msg(''); }
      }
      else { S = data.data; S._owner = data.updated_by; store.set(DATA_KEY, S); msg(''); keepMarks(S); }
    } catch (e) {
      // the server refused the sign-in (expired, password changed, account blocked): sign in again; otherwise there is no connection
      if (/jwt|token|auth|session|401|PGRST30/i.test(`${e?.code || ''} ${e?.message || ''} ${e?.status || ''}`)) {
        try { await SB.auth.signOut(); } catch { /* offline */ } location.replace('./'); return;
      }
      msg(S ? 'Нет интернета — показаны последние сохранённые данные' : 'Нет интернета. Откройте страницу, когда появится связь.', true);
    }
    loading = false; $('#meUpd').disabled = false; $('#meUpd').textContent = '🔄 Обновить';
    draw();
  }
  async function load() {
    if (SB) return loadSb();
    if (!link) return;
    loading = true; $('#meUpd').disabled = true; $('#meUpd').textContent = 'Обновляю…';
    try {
      const r = await fetch(link.u + (link.u.includes('?') ? '&' : '?') + (link.tg ? 'tg=' + encodeURIComponent(link.tg) : 'agent=' + encodeURIComponent(link.k)) + '&t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.error) { msg(j.error, true); if (/закрыт|устарел|неверн/.test(j.error)) { S = null; store.set(DATA_KEY, null); } }
      else { S = j; store.set(DATA_KEY, j); msg(''); keepMarks(j); }
    } catch { msg(S ? 'Нет интернета — показаны последние сохранённые данные' : 'Нет интернета. Откройте страницу, когда появится связь.', !S); }
    loading = false; $('#meUpd').disabled = false; $('#meUpd').textContent = '🔄 Обновить';
    draw();
  }
  // a phone photo is large: shrink to 1280 px JPEG before sending
  async function shrink(file) {
    const img = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72)); const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // a task marked «sent» stays so only until the supervisor's CRM has seen it (then the task comes back as «на проверке»)
  function keepMarks(j) { const m = marks(), keep = {}; for (const t of j.tasks || []) if (m[markKey(t)] && (t.status === 'open' || t.status === 'returned')) keep[markKey(t)] = m[markKey(t)]; store.set('mital_me_marks', keep); }
  // signed in with his own login: the mark goes to the MITAL database (crm_inbox), the supervisor's CRM applies it (botinbox.js).
  // The database accepts it only as this agent and only for the supervisor who published this cabinet.
  async function sbAct(body, file) {
    const { data: { session } } = await SB.auth.getSession();
    if (!session) { location.replace('./'); throw new Error('Войдите снова'); }
    if (!S?._owner) { await loadSb(); if (!S?._owner) throw new Error('Кабинет ещё не готов — обновите через минуту'); }
    const uid = Date.now() + '-' + Math.random().toString(36).slice(2, 8), at = new Date().toISOString();
    let photo = '';
    if (file) {
      const b64 = await shrink(file), bin = atob(b64), u8 = Uint8Array.from(bin, c => c.charCodeAt(0)), path = `${session.user.id}/${tashToday()}/${uid}.jpg`;
      const { error } = await SB.storage.from('agent-inbox').upload(path, new Blob([u8], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
      if (error) throw new Error('Фото не отправилось: ' + error.message);
      photo = 'sb:' + path;
    }
    const payload = { ...body, ...(photo ? { photo } : {}), agent: S.agent, agent_id: session.user.id, at, day: tashToday(), uid };
    const { error } = await SB.from('crm_inbox').insert({ owner_id: S._owner, kind: 'agent', payload });
    if (error) throw new Error(/row-level|policy/i.test(error.message) ? 'Нет доступа — обновите кабинет и попробуйте ещё раз' : 'Не отправилось: ' + error.message);
    return { ok: true };
  }
  async function sendDone(t, comment, file) {
    if (SB) { await sbAct({ act: 'done', src: t.src, id: t.id, title: t.title || '', comment }, file); const m = marks(); m[markKey(t)] = new Date().toISOString(); store.set('mital_me_marks', m); return; }
    if (!link) throw new Error(NO_ACT);
    const photo = file ? await shrink(file) : '';
    const body = JSON.stringify({ ...(link.tg ? { tg: link.tg } : { k: link.k }), act: 'done', src: t.src, id: t.id, comment, photo });
    const r = await fetch(link.u, { method: 'POST', body }); const j = await r.json();
    if (j.error) throw new Error(j.error);
    const m = marks(); m[markKey(t)] = new Date().toISOString(); store.set('mital_me_marks', m);
  }
  const msg = (t, bad) => { const m = $('#meMsg'); m.textContent = t; m.className = bad ? 'neg' : 'mut'; m.hidden = !t; };
  // chat with the supervisor = the chat with the bot: inside Telegram the button closes the cabinet and the agent is back in that chat
  // (voice, photos, files — everything Telegram has); the supervisor answers from CRM → «Чаты Telegram». Outside Telegram it opens the bot.
  const chatBtn = () => (inTg ? '<button class="btn gray" type="button" data-chat="1">💬 Чат с руководителем</button>' : S?.bot ? `<a class="btn gray" href="https://t.me/${esc(S.bot)}" target="_blank" rel="noopener">💬 Чат с руководителем</a>` : S?.boss ? `<a class="btn gray" href="https://t.me/${esc(S.boss)}" target="_blank" rel="noopener">💬 Написать руководителю</a>` : '');
  const search = () => { const i = $('#meQ'); if (i) i.oninput = () => { q = i.value; draw(); const j = $('#meQ'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; };


  // ---------- store keeper's cabinet (role 'store'): the daily blind stock count ----------
  // The list has product names only. «Начать сверку» asks the auto-loader to keep LINKO «Всего» of this minute; the counts are kept on
  // the phone while counting (the app may close), «Отправить» sends them. A recount shows only the items that did not match.
  // In a short count (setting in CRM) the auto-loader gives today's list: goods that moved since the last count + a few random ones.
  // Counting: boxes × pieces in a box + loose pieces (the app multiplies); «0» per row when the item is not there — no «0 everywhere».
  // Before sending, numbers far from the store keeper's OWN last count are asked once more (typos like 400 instead of 40).
  const CNT = { get: () => store.get('mital_cnt'), set: v => store.set('mital_cnt', v) };
  async function storePost(body) {
    if (SB && S?._gas) { // завсклад signed in with his login: the auto-loader, with the fresh sign-in token instead of the Telegram signature
      const { data: { session } } = await SB.auth.getSession(); if (!session) { location.replace('./'); throw new Error('Войдите снова'); }
      const r = await fetch(S._gas, { method: 'POST', body: JSON.stringify({ sb: session.access_token, ...body }) }), j = await r.json();
      if (j.error) throw new Error(j.error); return j;
    }
    if (SB && (body.act === 'collect' || body.act === 'absreq')) {
      if (body.act === 'collect' && body.r === 'promise' && (!body.pd || body.pd < tashToday() || !body.s)) throw new Error('Укажите дату и сумму обещания');
      return sbAct(body);
    }
    if (!link) throw new Error(NO_ACT);
    const r = await fetch(link.u, { method: 'POST', body: JSON.stringify({ ...(link.tg ? { tg: link.tg } : { k: link.k }), ...body }) });
    const j = await r.json(); if (j.error) throw new Error(j.error); return j;
  }
  // pieces in one box, from the product name (MITAL prices: 4–5 L — 4 pcs, but Mitanol 4 L — 5 pcs; 1–1.5 L — 12; 20 / 208 L — by
  // the piece; ECO FILTER by code). The supervisor can override in CRM (S.packs: article or a part of the name → pieces).
  // The same rule is in wcount.js (WC.pack) — change both together.
  const FILTER_PACK = { 'OF-00202': 60, 'OF-00201': 60, 'OF-00205': 60, 'OF-00208': 50, 'OF-00301': 18, 'OF-00211': 40, 'OF-00221': 40, 'AF-00511': 60, 'AF-00512': 40 };
  function packOf(i) {
    const o = S.packs || {}, n = String(i.name || '').toUpperCase(), b = String(i.brand || '').toUpperCase();
    if (o[i.art] > 0) return o[i.art];
    for (const k in o) if (k.length >= 3 && o[k] > 0 && n.includes(k.toUpperCase())) return o[k];
    for (const k in FILTER_PACK) if (n.includes(k)) return FILTER_PACK[k];
    const m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:LTR|LT|ЛИТРА|ЛИТР|Л|L)(?![A-ZА-ЯЁ])/), L = m ? Number(m[1].replace(',', '.')) : 0;
    if (!L || L >= 20) return 1;
    if (L <= 1.5) return 12;
    if (L === 4 && /MITANOL|МИТАНОЛ/.test(n + ' ' + b)) return 5;
    if (L === 4 || L === 5) return 4;
    return 1;
  }
  // far from his own last count: ×4 or more either way and at least 10 pieces apart
  const odd = (art, v) => { const p = (S.last || {})[art]; return p !== undefined && v !== undefined && Math.abs(v - p) >= 10 && (v >= p * 4 || v * 4 <= p) ? p : null; };
  const shelfOrder = () => (S.order && S.order.length ? S.order : store.get('mital_cnt_order') || []);
  const DOW = ['', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
  let ordering = null; // the shelf-order mode: { seq: [articles in the tapped order] }
  if (!document.getElementById('scCss')) document.head.insertAdjacentHTML('beforeend', `<style id="scCss">
    .sc-row{padding:10px 0;border-bottom:1px solid var(--line,#dde3e8)}.sc-row.sc-miss{border-left:4px solid #d9534f;padding-left:8px;background:rgba(217,83,79,.06)}
    .sc-in{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}.sc-in input{width:68px;font-size:18px;text-align:right;padding:8px}
    .sc-sum{min-width:56px;font-size:18px}.sc-w{display:block;color:#b8860b;margin-top:4px}.sc-pk{color:var(--accent,#1a73e8)}
    .sc-ord{display:flex;align-items:center;gap:10px;padding:12px 6px;border-bottom:1px solid var(--line,#dde3e8);cursor:pointer;user-select:none}
    .sc-ord b{min-width:30px;height:30px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;background:var(--line,#dde3e8)}.sc-ord.on b{background:var(--accent,#1a73e8);color:#fff}</style>`);

  function drawOrder(body) {
    const all = S.items || [], seq = ordering.seq, idx = a => seq.indexOf(a);
    const rows = all.slice().sort((x, y) => { const a = idx(x.art), b = idx(y.art); return (a < 0) - (b < 0) || (a - b) || 0; });
    body.innerHTML = panel('⇅ Порядок как на полках', `<p>Пройдите по складу и нажимайте товары <b>в том порядке, как они стоят</b> — по стеллажам, сверху вниз. Номер появится слева. Нажали не тот — нажмите ещё раз, номер снимется.</p>
      <p class="mut">Отмечено ${seq.length} из ${all.length}. Неотмеченные будут в конце списка.</p>
      ${rows.map(i => `<div class="sc-ord ${idx(i.art) >= 0 ? 'on' : ''}" data-o="${esc(i.art)}"><b>${idx(i.art) >= 0 ? idx(i.art) + 1 : ''}</b><span style="flex:1">${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></span></div>`).join('')}
      <div class="bar" style="position:sticky;bottom:0;background:var(--bg,#eef2f5);padding:10px 0"><button class="btn gray" id="soX">Отмена</button><button class="btn gray" id="soR">Сбросить</button><span class="spacer"></span><button class="btn" id="soS">✓ Сохранить порядок</button></div><small id="soE" class="neg" role="alert"></small>`);
    body.querySelectorAll('[data-o]').forEach(el => el.onclick = () => { const a = el.dataset.o, k = seq.indexOf(a); if (k >= 0) seq.splice(k, 1); else seq.push(a); const y = window.scrollY; drawOrder(body); window.scrollTo(0, y); });
    $('#soX').onclick = () => { ordering = null; drawStore(body); };
    $('#soR').onclick = () => { if (!seq.length || confirm('Сбросить порядок?')) { ordering.seq = []; drawOrder(body); } };
    $('#soS').onclick = async e => {
      e.target.disabled = true; store.set('mital_cnt_order', seq.slice()); S.order = seq.slice();
      try { await storePost({ act: 'order', order: seq }); } catch (err) { $('#soE').textContent = 'Сохранено на этом телефоне; на сервер не ушло: ' + err.message; }
      ordering = null; msg('✓ Порядок сохранён — теперь список идёт как на полках'); drawStore(body); window.scrollTo(0, 0);
    };
  }

  function drawStore(body) {
    const nav = document.querySelector('nav.tabs'); if (nav) nav.hidden = true;
    if (ordering) return drawOrder(body);
    const t0 = new Date().toLocaleDateString('sv-SE'), hm = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const rec = S.recount && S.recount.length ? S.recount : null;
    let st = CNT.get(); if (st && (st.day !== t0 || !!st.partial !== !!rec)) { st = null; CNT.set(null); }
    const plan = !rec && S.plan && S.plan.short ? S.plan : null;
    const want = rec ? null : st ? st.list : plan ? plan.list : null; // today's short list (null — everything)
    const byArt = new Map((S.items || []).map(i => [i.art, i]));
    let list = rec ? rec.map(r => ({ ...(byArt.get(r.art) || {}), ...r, brand: '' })) : want ? want.map(a => byArt.get(a) || { art: a, name: a, brand: '' }) : (S.items || []);
    const ord = shelfOrder(), oi = new Map(ord.map((a, k) => [a, k]));
    if (ord.length) list = list.slice().sort((x, y) => (oi.has(x.art) ? oi.get(x.art) : 1e6) - (oi.has(y.art) ? oi.get(y.art) : 1e6));
    $('#meName').textContent = 'Склад ' + S.warehouse;
    $('#meSub').textContent = `${S.name} · сверка до ${S.deadline || '10:00'}${S.today ? ` · сегодня отправлено в ${hm(S.today.at)}` : ''}`;
    const ordBtn = `<button class="btn gray" id="scOrd">⇅ ${ord.length ? 'Изменить порядок полок' : 'Расставить как на полках'}</button>`;
    // the result of the day (from the auto-loader): ok / closed with a discrepancy — nothing more to send today
    const R = S.round && S.round.status !== 'recount' ? S.round : null;
    if (!st && R) {
      body.innerHTML = R.status === 'ok'
        ? panel('Сверка склада', `<p class="pos" style="font-size:18px"><b>✅ Сверка прошла успешно — склад в порядке</b></p><p class="mut">Отправлено в ${hm(R.at)}${R.round === 2 ? ' (после пересчёта)' : ''}. Спасибо!</p>`)
        : panel('Сверка склада закрыта', `<p class="neg"><b>⚠️ Пересчёт не сошёлся по ${R.items.length} поз.</b></p><ul>${R.items.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul><p class="mut">Расхождение зафиксировано, руководитель получил отчёт. Сегодня сверка больше не отправляется.</p>`);
      body.insertAdjacentHTML('beforeend', `<div class="bar">${ordBtn}${chatBtn()}</div>`);
      $('#scOrd').onclick = () => { ordering = { seq: shelfOrder().slice() }; drawStore(body); window.scrollTo(0, 0); };
      return;
    }
    if (!st) {
      const what = rec ? `<p>По этим товарам цифры не сошлись. Пересчитайте их внимательно ещё раз (${rec.length} поз.) — <b>это последняя попытка</b>:</p><ul>${rec.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul>`
        : S.today ? `<p class="pos"><b>✓ Сегодняшняя сверка отправлена в ${hm(S.today.at)}</b></p><p class="mut">Если нужно — можно пересчитать и отправить заново.</p>`
        : plan ? `<p>Сегодня <b>короткая сверка: ${list.length} товаров</b> из ${plan.total} — те, что двигались со вчерашней сверки, и несколько случайных. Отправьте до <b>${esc(S.deadline || '10:00')}</b>.</p>${S.fullDay ? `<p class="mut">Полная сверка всего склада — в ${DOW[S.fullDay] || 'понедельник'}.</p>` : ''}`
        : `<p>Пересчитайте все товары склада (${list.length} поз.) и отправьте до <b>${esc(S.deadline || '10:00')}</b>. Считайте то, что физически лежит на складе, включая отложенное под заказы.</p>`;
      body.innerHTML = panel(rec ? '↻ Есть расхождение — пересчитайте' : 'Сверка склада', `${what}
        <p class="mut">Нажмите «Начать», когда готовы считать — с этой минуты CRM сравнит с остатком LINKO. Коробки можно вводить коробками — приложение само умножит.</p>
        <div class="bar"><button class="btn" id="scStart" style="padding:12px 20px;font-size:16px">▶ ${rec ? 'Начать пересчёт' : S.today ? 'Начать сверку заново' : 'Начать сверку'}</button></div><small id="scE" class="neg" role="alert"></small>`) + `<div class="bar">${rec ? '' : ordBtn}${chatBtn()}</div>`;
      $('#scStart').onclick = async e => { e.target.disabled = true; try { const j = await storePost({ act: 'count_start', partial: !!rec }); const pl = j.plan && j.plan.short ? j.plan.list : null; if (j.plan) S.plan = j.plan; CNT.set({ day: t0, start: j.at, partial: !!rec, counts: {}, box: {}, pcs: {}, list: pl }); drawStore(body); window.scrollTo(0, 0); } catch (err) { e.target.disabled = false; $('#scE').textContent = err.message; } };
      const ob = $('#scOrd'); if (ob) ob.onclick = () => { ordering = { seq: shelfOrder().slice() }; drawStore(body); window.scrollTo(0, 0); };
      return;
    }
    st.box ||= {}; st.pcs ||= {};
    const has = a => st.counts[a] !== undefined && st.counts[a] !== '';
    const filled = list.filter(i => has(i.art)).length;
    const groups = new Map(); for (const i of list) { const k = ord.length ? '' : i.brand || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    const row = i => { const pk = packOf(i), a = esc(i.art), v = st.counts[i.art], w = odd(i.art, v);
      return `<div class="sc-row" data-r="${a}" data-n="${esc((i.name + ' ' + i.art).toLowerCase())}"><div>${esc(i.name)}<br><small class="mut">${a}${pk > 1 ? ` · <span class="sc-pk">📦 1 коробка = ${pk} шт</span>` : ''}</small></div>
        <div class="sc-in">${pk > 1 ? `<input type="number" inputmode="numeric" min="0" step="1" placeholder="кор." aria-label="Коробок" data-b="${a}" value="${st.box[i.art] ?? ''}"><span class="mut">× ${pk} +</span>` : ''}<input type="number" inputmode="numeric" min="0" step="1" placeholder="шт" aria-label="Штук" data-p="${a}" value="${st.pcs[i.art] ?? (pk > 1 ? '' : v ?? '')}">
          <b class="sc-sum" data-s="${a}">${v !== undefined ? '= ' + v : ''}</b><span class="spacer" style="flex:1"></span><button class="btn gray sm" type="button" data-z="${a}" title="Товара нет">0</button></div>
        <small class="sc-w" data-w="${a}">${w !== null ? `⚠ Проверьте: в прошлый раз вы насчитали ${w}` : ''}</small></div>`; };
    body.innerHTML = `<div class="bar" style="position:sticky;top:52px;z-index:4;background:var(--bg,#eef2f5);padding:8px 0"><input id="scQ" type="search" placeholder="Поиск товара" value="${esc(q)}" style="flex:1;min-width:0"><b id="scN">${filled} / ${list.length}</b></div>
      <div class="bar"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="scOnly"> только непосчитанные</label><span class="spacer"></span>${rec ? '' : `<button class="btn gray sm" id="scOrd">⇅ Порядок полок</button>`}</div>
      ${panel(rec ? 'Пересчёт' : want ? 'Короткая сверка' : 'Пересчитайте товары', [...groups].map(([g, L]) => `<div class="sc-g">${g ? `<h4 style="margin:14px 0 6px">${esc(g)}</h4>` : ''}${L.map(row).join('')}</div>`).join(''), 'Коробки — в «кор.», россыпь — в «шт», приложение сложит. Товара нет — нажмите «0».')}
      ${panel('Отправить', `<div class="form"><label style="grid-column:1/-1">Комментарий (необязательно)<textarea id="scC" rows="2" maxlength="500" placeholder="например: 2 коробки повреждены"></textarea></label><label style="grid-column:1/-1">Фото (необязательно)<input id="scP" type="file" accept="image/*" capture="environment"></label></div>
        <div class="bar"><button class="btn gray" id="scX">Отменить</button><span class="spacer"></span><button class="btn" id="scGo">Отправить сверку</button></div><small id="scE" class="neg" role="alert"></small>`)}`;
    const upd = () => { $('#scN').textContent = list.filter(i => has(i.art)).length + ' / ' + list.length; };
    const filter = () => { const s = q.toLowerCase(), only = $('#scOnly').checked; body.querySelectorAll('.sc-row').forEach(r => { r.style.display = (!s || r.dataset.n.includes(s)) && (!only || !has(r.dataset.r)) ? '' : 'none'; }); body.querySelectorAll('.sc-g').forEach(g => { g.style.display = [...g.querySelectorAll('.sc-row')].some(r => r.style.display !== 'none') ? '' : 'none'; }); };
    const sel = (k, a) => body.querySelector(`[data-${k}="${CSS.escape(a)}"]`);
    const recalc = a => {
      const i = list.find(x => x.art === a), pk = packOf(i), bI = sel('b', a), pI = sel('p', a), b = bI ? bI.value.trim() : '', p = pI.value.trim();
      if (b === '') delete st.box[a]; else st.box[a] = Math.max(0, Math.round(Number(b)) || 0);
      if (p === '') delete st.pcs[a]; else st.pcs[a] = Math.max(0, Math.round(Number(p)) || 0);
      if (b === '' && p === '') delete st.counts[a]; else st.counts[a] = (st.box[a] || 0) * pk + (st.pcs[a] || 0);
      CNT.set(st); const v = st.counts[a], w = odd(a, v);
      sel('s', a).textContent = v !== undefined ? '= ' + v : ''; sel('w', a).textContent = w !== null ? `⚠ Проверьте: в прошлый раз вы насчитали ${w}` : '';
      if (v !== undefined) sel('r', a).classList.remove('sc-miss'); upd();
    };
    body.querySelectorAll('input[data-b],input[data-p]').forEach(inp => inp.oninput = () => recalc(inp.dataset.b || inp.dataset.p));
    body.querySelectorAll('[data-z]').forEach(bt => bt.onclick = () => { const a = bt.dataset.z, bI = sel('b', a); if (bI) bI.value = ''; sel('p', a).value = '0'; recalc(a); });
    $('#scQ').oninput = e => { q = e.target.value; filter(); };
    $('#scOnly').onchange = filter; filter();
    const ob = $('#scOrd'); if (ob) ob.onclick = () => { ordering = { seq: shelfOrder().slice() }; drawStore(body); window.scrollTo(0, 0); };
    $('#scX').onclick = () => { if (!confirm('Отменить сверку? Введённые цифры удалятся.')) return; CNT.set(null); drawStore(body); };
    $('#scGo').onclick = async e => {
      const empty = list.filter(i => !has(i.art));
      if (empty.length) {
        empty.forEach(i => sel('r', i.art)?.classList.add('sc-miss'));
        $('#scE').textContent = `Не посчитано ${empty.length} поз. — они подсвечены красным. Если товара нет — нажмите «0» в строке.`;
        q = ''; $('#scQ').value = ''; $('#scOnly').checked = true; filter(); sel('r', empty[0].art)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { TGA?.HapticFeedback?.notificationOccurred('error'); } catch { /* not in Telegram */ }
        return;
      }
      const ask = list.map(i => ({ i, p: odd(i.art, st.counts[i.art]) })).filter(x => x.p !== null);
      if (ask.length && !confirm(`Проверьте — сильно отличается от вашей прошлой сверки:\n${ask.slice(0, 8).map(x => `• ${x.i.name}: сейчас ${st.counts[x.i.art]}, в прошлый раз ${x.p}`).join('\n')}${ask.length > 8 ? `\n…и ещё ${ask.length - 8}` : ''}\n\nВсё верно — отправить?`)) { $('#scOnly').checked = false; filter(); sel('r', ask[0].i.art)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      e.target.disabled = true; e.target.textContent = 'Отправляю…';
      try {
        const file = $('#scP').files[0], photo = file ? await shrink(file) : '';
        const counts = {}; for (const i of list) counts[i.art] = st.counts[i.art];
        const j = await storePost({ act: 'count', counts, partial: !!rec, comment: $('#scC').value.trim(), photo });
        S.last = { ...(S.last || {}), ...counts };
        CNT.set(null); q = '';
        const at = new Date().toISOString(), items = j.items || [];
        S.today = { at }; S.round = j.result ? { status: j.result, round: j.round, at, items } : null; S.recount = j.result === 'recount' ? items : [];
        msg(j.result === 'ok' ? '✅ Сверка прошла успешно — склад в порядке' : j.result === 'recount' ? `↻ Есть расхождение: пересчитайте ${items.length} поз.` : j.result === 'final' ? '⚠️ Пересчёт не сошёлся — расхождение зафиксировано' : 'Сверка отправлена руководителю ✓', j.result === 'final');
        try { TGA?.HapticFeedback?.notificationOccurred(j.result === 'ok' ? 'success' : 'warning'); } catch { /* not in Telegram */ }
        drawStore(body); window.scrollTo(0, 0); load();
      } catch (err) { e.target.disabled = false; e.target.textContent = 'Отправить сверку'; $('#scE').textContent = err.message || 'Нет связи — попробуйте ещё раз, цифры сохранены'; }
    };
  }

  function draw() {
    const body = $('#meBody');
    if (!link && !SB) { body.innerHTML = '<div class="empty-state"><h3>Откройте кабинет из Telegram</h3><p>Нажмите кнопку «Мой кабинет» в боте MITAL — или откройте ссылку, которую прислал руководитель.</p></div>'; return; }
    if (S && S.role === 'store') return drawStore(body);
    if (!S) { body.innerHTML = loading ? '<p class="mut">Загружаю…</p>' : '<div class="empty-state"><h3>Нет данных</h3><p>Причина — в сообщении выше. Если доступ закрыт, попросите руководителя прислать новую ссылку.</p></div>'; return; }
    const k = S.kpi, sp = pctV(k.sold, k.plan), cp = pctV(k.paid, k.pool), me = S.board.find(b => b.me);
    // the collection queue with the same debts as «Мои клиенты» (fresh debts from LINKO replace the CRM's); a debt that is paid off
    // leaves the queue unless the agent marked the client today
    { const by = new Map(S.clients.map(c => [c.name, c])), today = new Date().toLocaleDateString('sv-SE'), mine = store.get('mital_me_cq');
      S.queue = (S.queue || []).map(x => (by.has(x.name) ? { ...x, debt: by.get(x.name).debt } : x)).filter(x => x.debt > 0 || (mine?.day === today && mine.m?.[x.name])); }
    $('#meName').textContent = S.agent;
    $('#meSub').innerHTML = `Период ${dm(S.period.from)} — ${dm(S.period.to)}${S.period.days_left != null ? ` · осталось <b>${S.period.days_left} дн.</b>` : ''}<br><span style="opacity:.75">Обновлено: план ${esc(hhmm(S.at))}${S.live?.debt ? ` · долги ${esc(hhmm(S.live.debt))}` : ''}${S.live?.stock ? ` · склад ${esc(hhmm(S.live.stock))}` : ''}</span>`;
    document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab || (a.dataset.tab === 'more' && ['clients', 'contracts', 'stock', 'disc', 'chat'].includes(tab))));
    const openN = (S.tasks || []).filter(isOpen).length; $('#meTaskN').textContent = openN ? `(${openN})` : '';
    if (tab !== 'chat') chatStop();
    if (tab === 'chat') {
      if (!inTg || !S.chat) { body.innerHTML = panel('Чат с руководителем', `<p>Чат работает в кабинете внутри Telegram.</p>${chatBtn() ? `<div class="bar">${chatBtn()}</div>` : ''}`); return; }
      body.innerHTML = panel('Чат с руководителем', `<div class="chat-list" id="chatList"><p class="mut">Загружаю…</p></div>
        <div class="chat-send"><label class="btn gray" title="Отправить фото" aria-label="Отправить фото" style="cursor:pointer;font-size:20px;padding:8px 12px;line-height:1">📷<input id="chatPh" type="file" accept="image/*" hidden></label><textarea id="chatT" rows="2" maxlength="3000" placeholder="Сообщение"></textarea><button class="btn" id="chatGo" type="button">➤</button></div><small id="chatE" class="neg" role="alert"></small>`, 'Голосовые и файлы можно отправить в самом чате с ботом — кнопка ниже');
      body.insertAdjacentHTML('beforeend', `<div class="bar">${chatBtn()}</div>`);
      chatDraw(); chatLoad(); if (!CH.timer) CH.timer = setInterval(chatLoad, 5000);
      const send = async (text, file) => {
        if (CH.sending) return; CH.sending = true; $('#chatE').textContent = '';
        try {
          let r;
          if (file) { const fd = new FormData(), b64 = await shrink(file), bin = atob(b64), u8 = Uint8Array.from(bin, c => c.charCodeAt(0)); fd.append('file', new Blob([u8], { type: 'image/jpeg' }), 'photo.jpg'); if (text) fd.append('caption', text); r = await fetch(chatUrl('/agent/send-photo'), { method: 'POST', headers: { Authorization: 'tma ' + TGA.initData }, body: fd }); }
          else r = await fetch(chatUrl('/agent/send'), { method: 'POST', headers: { Authorization: 'tma ' + TGA.initData, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
          const j = await r.json(); if (j.error) throw new Error(j.error);
          $('#chatT').value = ''; await chatLoad(); chatDraw();
        } catch (e) { $('#chatE').textContent = e.message || 'Не отправилось — проверьте интернет'; }
        CH.sending = false;
      };
      $('#chatGo').onclick = () => { const t = $('#chatT').value.trim(); if (t) send(t); };
      $('#chatPh').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) send($('#chatT').value.trim(), f); };
      return;
    }
    // ---------- Ещё (phone): the sections that do not fit the bottom bar ----------
    if (tab === 'more') {
      const L = [['clients', '👥', 'Мои клиенты'], ['contracts', '📄', 'Договоры'], ['stock', '📦', 'Склад'], ['disc', '⏰', 'Дисциплина'], ['chat', '💬', 'Чат с руководителем']];
      body.innerHTML = `<div class="cards">${L.map(([k, ic, t]) => `<a class="ccard" href="#" data-go="${k}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;font-weight:600"><span style="font-size:26px">${ic}</span>${t}</a>`).join('')}
        <a class="ccard" href="${ACADEMY}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;font-weight:600"><span style="font-size:26px">🎓</span>MITAL Akademiya</a></div>
        ${installCard()}${langCard()}${inTg ? '' : '<button class="btn gray" type="button" data-out="1" style="width:100%;margin-top:4px;padding:12px">🚪 Выйти из аккаунта</button>'}`;
      bindExtras(body);
      return;
    }
    // ---------- Оплаты: who must pay and when (spec orders by parts, contracts by month, promises) ----------
    if (tab === 'cal') {
      const C = S.cal || [], t0 = tashToday(), KIND = { spec: ['Спец · разовый договор', 'warn'], ct: ['Договор', 'info'], prom: ['Обещание', 'good'] };
      const ST = { paid: ['✓ оплачено', 'pos'], late: ['просрочено', 'neg'], wait: ['ждём', 'mut'] };
      if (!S.cal) { body.innerHTML = panel('📅 Календарь оплат', '<p class="mut">Календарь появится после следующего обновления кабинета руководителем.</p>'); return; }
      const days = []; for (let d = new Date(S.period.from + 'T12:00:00'); d.toISOString().slice(0, 10) <= S.period.to; d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
      if (!calDay || !days.includes(calDay)) calDay = days.includes(t0) ? t0 : days[0];
      const sumOf = L => L.reduce((t, x) => t + x.s, 0), late = C.filter(x => x.st === 'late').sort((a, b) => a.d.localeCompare(b.d));
      const by = new Map(); for (const x of C) (by.get(x.d) || by.set(x.d, []).get(x.d)).push(x);
      const row = x => `<div class="ccard"><div class="top"><b>${esc(x.client)}</b><span class="amt ${ST[x.st][1]}">${$$(x.s)}</span></div>
        <div class="meta"><span class="pill ${KIND[x.kind]?.[1] || ''}">${KIND[x.kind]?.[0] || ''}</span><span class="${ST[x.st][1]}">${ST[x.st][0]}${x.st === 'late' ? ' с ' + dm(x.d) : ''}</span></div>${x.why ? `<div class="mut" style="font-size:13px;margin-top:4px">${esc(x.why)}</div>` : ''}
        ${S.clients.find(c => c.name === x.client)?.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(S.clients.find(c => c.name === x.client).phone)}">📞 Позвонить</a></div>` : ''}</div>`;
      const dayL = (by.get(calDay) || []), wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      body.innerHTML = `<div class="kpis">${tile('Сегодня должны', $$(sumOf((by.get(t0) || []).filter(x => x.st !== 'paid'))), `${(by.get(t0) || []).filter(x => x.st !== 'paid').length} оплат`, 'warn')}${tile('Просрочено', $$(sumOf(late)), `${late.length} оплат`, late.length ? 'bad' : 'good')}${tile('Ждём до ' + dm(S.period.to), $$(sumOf(C.filter(x => x.st === 'wait' && x.d >= t0 && x.d <= S.period.to))), 'по графикам и обещаниям')}</div>
        <div class="chips" id="calStrip">${days.map(d => { const L = by.get(d) || [], s = sumOf(L.filter(x => x.st !== 'paid')); return `<button type="button" data-cd="${d}" class="${d === calDay ? 'on' : ''}" style="display:flex;flex-direction:column;align-items:center;min-width:54px;line-height:1.2${d === t0 ? ';font-weight:700' : ''}"><small>${wd[new Date(d + 'T12:00:00').getDay()]}</small><b>${Number(d.slice(8))}</b><small>${s ? (s >= 1000 ? '$' + (Math.round(s / 100) / 10).toLocaleString('ru-RU') + 'k' : '$' + Math.round(s)) : L.length ? '✓' : '·'}</small></button>`; }).join('')}</div>
        ${panel(`${dRu(calDay)}${calDay === t0 ? ' — сегодня' : ''}`, dayL.length ? `<div class="cards">${dayL.map(row).join('')}</div>` : '<p class="mut">В этот день оплат по графику нет.</p>', dayL.length ? `Всего ${$$(sumOf(dayL))} · оплачено ${$$(sumOf(dayL.filter(x => x.st === 'paid')))}` : '')}
        ${late.length ? panel('🔴 Просрочено — собрать в первую очередь', `<div class="cards">${late.map(row).join('')}</div>`) : ''}`;
      body.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { calDay = b.dataset.cd; draw(); });
      const on = body.querySelector('#calStrip .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
      return;
    }
    // ---------- Маршрут: the weekly route, today first; every stop with its debt, promise and phone ----------
    if (tab === 'route') {
      const R = S.route, DN = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
      if (!R || !Object.keys(R).length) { body.innerHTML = panel('🗺 Маршрут', '<p class="mut">Маршрут ещё не составлен. Попросите руководителя заполнить его в CRM: Агенты → Маршруты.</p>'); return; }
      const wd0 = new Date(tashToday() + 'T12:00:00').getDay() || 1; // Sunday → Monday's route
      if (!routeDay || !R[routeDay]) routeDay = R[wd0] ? String(wd0) : Object.keys(R)[0];
      const by = new Map(S.clients.map(c => [c.name, c])), calBy = new Map(); for (const x of S.cal || []) if (x.st !== 'paid' && x.d <= tashToday()) calBy.set(x.client, (calBy.get(x.client) || 0) + x.s);
      const D = R[routeDay], vis = S.disc?.days?.find(x => x.day === tashToday());
      const stops = D.clients.map((n, i) => { const c = by.get(n) || { name: n }, due = calBy.get(n) || 0;
        return `<div class="ccard"><div class="top"><b>${i + 1}. ${esc(n)}</b>${c.debt > 0 ? `<span class="amt neg">${$$(c.debt)}</span>` : '<span class="amt mut">долга нет</span>'}</div>
          <div class="meta">${due ? `<span class="neg">💰 к оплате сейчас ${$$(due)}</span>` : ''}${c.promise ? `<span>🤝 обещал ${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}</span>` : ''}${c.lastBuy ? `<span>посл. покупка ${dm(c.lastBuy)}</span>` : c.name && by.has(n) ? '<span>покупок не было — предложите заказ</span>' : ''}${c.landmark ? `<span>📍 ${esc(c.landmark)}</span>` : ''}</div>
          <div class="acts">${c.phone ? `<a class="btn gray sm" href="tel:${esc(c.phone)}">📞 Позвонить</a>` : ''}<a class="btn gray sm" href="https://yandex.uz/maps/?text=${encodeURIComponent(n + (c.landmark ? ' ' + c.landmark : ''))}" target="_blank" rel="noopener">🧭 Карта</a></div></div>`; });
      const debtSum = D.clients.reduce((t, n) => t + (by.get(n)?.debt > 0 ? by.get(n).debt : 0), 0);
      body.innerHTML = `<div class="chips">${Object.keys(R).sort().map(k => `<button type="button" data-rd="${k}" class="${k === routeDay ? 'on' : ''}">${DN[k]}${String(wd0) === k ? ' · сегодня' : ''} (${R[k].clients.length})</button>`).join('')}</div>
        ${routeDay === String(wd0) && vis?.plan ? `<div class="kpis">${tile('Визиты сегодня в LINKO', `${vis.done || 0} из ${vis.plan}`, 'отмечайте визит у каждого клиента', vis.done >= vis.plan ? 'good' : 'warn')}</div>` : ''}
        ${panel(`🗺 ${DN[routeDay]}${D.zone ? ' — ' + esc(D.zone) : ''}`, `<div class="cards">${stops.join('')}</div>`, `${D.clients.length} точек · долг на маршруте ${$$(debtSum)}. Порядок — как задал руководитель.`)}`;
      body.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { routeDay = b.dataset.rd; draw(); });
      return;
    }
    // ---------- Договоры: one-time (special offers, by parts) and long contracts of the agent's clients ----------
    if (tab === 'contracts') {
      const K = S.contracts, ST = { paid: ['✓', 'pos', 'оплачено'], late: ['!', 'neg', 'просрочено'], wait: ['·', 'mut', 'ждём'] };
      if (!K) { body.innerHTML = panel('📄 Договоры', '<p class="mut">Договоры появятся после следующего обновления кабинета руководителем.</p>'); return; }
      const part = p => `<span class="${ST[p.st][1]}" style="white-space:nowrap">${ST[p.st][0]} ${dm(p.d || p.to)} ${$$(p.s ?? p.plan)}${p.paid != null && p.st !== 'paid' ? ` (опл. ${$$(p.paid)})` : ''}</span>`;
      const once = K.once || [], long = K.long || [];
      body.innerHTML = `${panel(`🧾 Разовые договоры и спецпредложения (${once.length})`, once.length ? `<div class="cards">${once.map(o => { const left = o.parts.filter(p => p.st !== 'paid').reduce((t, p) => t + p.s, 0);
          return `<div class="ccard"><div class="top"><b>${esc(o.client)}</b><span class="amt">${$$(o.s)}</span></div>
            <div class="meta"><span>№${esc(o.id)} от ${dm(o.d)}</span>${o.spec ? '<span class="pill warn">спецпредложение</span>' : ''}${o.disc != null ? `<span>скидка ${esc(o.disc)}%</span>` : ''}${left ? `<span class="${o.parts.some(p => p.st === 'late') ? 'neg' : ''}">осталось ${$$(left)}</span>` : '<span class="pos">оплачено полностью</span>'}</div>
            ${o.cond ? `<div class="mut" style="font-size:13px;margin-top:4px">${esc(o.cond)}</div>` : ''}<div class="meta" style="margin-top:6px">${o.parts.map(part).join('')}</div></div>`; }).join('')}</div>` : '<p class="mut">Разовых договоров нет.</p>', 'Каждый заказ на спеццене платится по своему графику — по частям. Красным — просроченные части.')}
        ${panel(`📑 Большие договоры (${long.length})`, long.length ? `<div class="cards">${long.map(k => { const late = k.months.filter(m => m.st === 'late'), tot = k.months.reduce((t, m) => t + m.plan, 0), paid = k.months.reduce((t, m) => t + (m.paid || 0), 0);
          return `<div class="ccard"><div class="top"><b>${esc(k.title)}</b><span class="amt">${$$(tot)}</span></div>
            <div class="meta"><span>${esc(k.client)}</span><span>с ${dm(k.start)} · ${k.months.length} мес.</span><span>оплачено ${$$(paid)}</span>${late.length ? `<span class="neg">просрочено месяцев: ${late.length}</span>` : ''}</div>
            <div class="meta" style="margin-top:6px">${k.months.map(m => part({ ...m, d: m.to })).join('')}</div></div>`; }).join('')}</div>` : '<p class="mut">Больших договоров нет.</p>', 'Сумма месяца должна прийти до последнего дня этого месяца договора.')}`;
      return;
    }
    if (tab === 'tasks') {
      const T = S.tasks || [], ST = { open: ['info', 'в работе'], returned: ['crit', 'возвращено — доделать'], done: ['warn', 'на проверке'], closed: ['good', '✓ принято'] };
      const item = t => { const sent = marks()[markKey(t)], st = sent ? ['warn', 'отправлено руководителю'] : ST[t.status] || ST.open;
        return `<li><div><span class="pill ${st[0]}">${st[1]}</span> <b>${esc(t.title)}</b>${t.due ? ` <span class="mut">· до ${dRu(t.due)}</span>` : ''}${t.overdue && !sent ? ' <b class="neg">просрочено</b>' : ''}</div>
          ${t.text ? `<div class="mut">${esc(t.text)}</div>` : ''}${t.progress ? `<div>Факт: <b>${esc(t.progress)}</b></div>` : ''}${t.back && t.status === 'returned' ? `<div class="neg">↩ ${esc(t.back)}</div>` : ''}
          <div class="bar" style="margin-top:6px">${t.link ? `<a class="btn gray sm" href="${esc(t.link)}" target="_blank" rel="noopener">${t.kind === 'academy' ? '🎓 Открыть урок' : 'Открыть ссылку'}</a>` : ''}${isOpen(t) ? `<button class="btn sm" data-do="${esc(markKey(t))}">✅ Выполнено</button>` : ''}</div>
          ${doing === markKey(t) ? `<div class="form" style="margin-top:8px"><label style="grid-column:1/-1">Комментарий<textarea id="dnC" rows="3" maxlength="1000" placeholder="Что сделано"></textarea></label><label style="grid-column:1/-1">Фото (необязательно)<input id="dnP" type="file" accept="image/*" capture="environment"></label></div><small id="dnE" class="neg" role="alert"></small><div class="bar"><button class="btn gray sm" id="dnX">Отмена</button><button class="btn sm" id="dnOk">Отправить руководителю</button></div>` : ''}</li>`; };
      const open = T.filter(t => isOpen(t)), rest = T.filter(t => !isOpen(t));
      body.innerHTML = (chatBtn() ? `<div class="bar" style="margin-bottom:12px"><span class="mut">Вопрос по заданию?</span>${chatBtn()}</div>` : '') + panel(`Задания (${open.length} открыто)`, T.length ? `<ul class="notes">${[...open, ...rest].map(item).join('')}</ul>` : '<p class="mut">Заданий нет.</p>', 'Нажмите «Выполнено», напишите, что сделано, и приложите фото, если нужно — руководитель получит это сразу.');
      body.querySelectorAll('[data-do]').forEach(b => b.onclick = () => { doing = b.dataset.do; draw(); });
      const ok = $('#dnOk');
      if (ok) {
        $('#dnX').onclick = () => { doing = null; draw(); };
        ok.onclick = async () => {
          const t = T.find(x => markKey(x) === doing), comment = $('#dnC').value.trim(), file = $('#dnP').files[0];
          if (!comment && !file) return ($('#dnE').textContent = 'Напишите комментарий или приложите фото');
          ok.disabled = true; ok.textContent = 'Отправляю…';
          try { await sendDone(t, comment, file); doing = null; msg('Отправлено руководителю ✓'); try { TGA?.HapticFeedback?.notificationOccurred('success'); } catch { /* not in Telegram */ } draw(); }
          catch (e) { ok.disabled = false; ok.textContent = 'Отправить руководителю'; $('#dnE').textContent = e.message || 'Нет связи — попробуйте ещё раз'; }
        };
      }
      return;
    }
    if (tab === 'main') {
      const t = S.disc?.today, top = S.clients.filter(c => c.debt > 0 && (c.promise || c.pool > c.paid)).slice(0, 10), t0 = tashToday();
      // the pace of the period: how much of the plan should be done by today (days passed / days in the period)
      const total = S.period.from && S.period.to ? Math.round((Date.parse(S.period.to) - Date.parse(S.period.from)) / 864e5) + 1 : 0;
      const passed = total && S.period.days_left != null ? Math.min(total, Math.max(1, total - S.period.days_left)) : 0, pace = total ? passed / total : null;
      const paceRow = (label, fact, goal, perDay, verb) => { if (!goal) return ''; const p = fact / goal * 100, should = pace != null ? goal * pace : null, diff = should != null ? fact - should : 0;
        return `<div style="margin:10px 0 4px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${label}: ${$$(fact)} из ${$$(goal)}</b><b>${pctT(p)}</b></div>
          <div class="bar2" role="img" aria-label="${label}: ${pctT(p)} плана"><i style="width:${Math.min(100, p)}%;${should != null && fact < should ? 'background:#e9a23b' : ''}"></i>${pace != null ? `<u style="left:${Math.min(100, pace * 100)}%"></u>` : ''}</div>
          <div class="mut" style="font-size:13px">${should != null ? (diff >= 0 ? `✓ по темпу впереди на ${$$(diff)}` : `по темпу должно быть ${$$(should)} — не хватает <b class="neg">${$$(-diff)}</b>`) + ' · ' : ''}${perDay ? `сегодня ${verb} <b>${$$(perDay)}</b>` : ''}</div></div>`; };
      // what to do today: promises due, the collection queue, tasks, clients who stopped buying
      const due = S.clients.filter(c => c.promise && c.promise.date <= t0 && c.debt > 0).sort((a, b) => a.promise.date.localeCompare(b.promise.date));
      const sleep = S.clients.filter(c => c.lastBuy && c.buyDays != null && c.buyDays >= 21 && c.buyDays <= 120).sort((a, b) => a.buyDays - b.buyDays).slice(0, 6);
      const openT = (S.tasks || []).filter(isOpen), cqLeft = (S.queue || []).length;
      const todo = [
        ...due.map(c => `<li>🤝 <b>${esc(c.name)}</b> обещал${c.promise.date < t0 ? ` <b class="neg">${dm(c.promise.date)} — просрочено</b>` : ' сегодня'}${c.promise.sum ? ` ${$$(c.promise.sum)}` : ''} · долг ${$$(c.debt)}${c.phone ? ` · <a href="tel:${esc(c.phone)}">📞 позвонить</a>` : ''}</li>`),
        (() => { const L = (S.cal || []).filter(x => x.d === t0 && x.st !== 'paid'), s = L.reduce((t, x) => t + x.s, 0); return L.length ? `<li>📅 Сегодня по графику должны заплатить <b>${L.length}</b> клиентов на <b>${$$(s)}</b> — <a href="#" data-go="cal">кто именно</a></li>` : ''; })(),
        (() => { const wd = new Date(t0 + 'T12:00:00').getDay() || 1, D = S.route?.[wd]; return D ? `<li>🗺 Маршрут на сегодня${D.zone ? ' (' + esc(D.zone) + ')' : ''}: <b>${D.clients.length}</b> точек — <a href="#" data-go="route">открыть</a></li>` : ''; })(),
        cqLeft ? `<li>💰 Очередь сбора: <b>${cqLeft}</b> должников — <a href="#" data-go="collect">открыть и отметить результат</a></li>` : '',
        openT.length ? `<li>✅ Открытых заданий: <b>${openT.length}</b>${openT.some(x => x.overdue) ? ' <b class="neg">есть просроченные</b>' : ''} — <a href="#" data-go="tasks">открыть</a></li>` : '',
        S.disc && !t?.first && !t?.st && !S.disc.skip && !S.disc.free ? `<li>⏰ Первый фотоотчёт в LINKO — до <b>${esc(S.disc.start)}</b>, иначе штраф ${f0(S.disc.rate)} сум за минуту</li>` : '',
      ].filter(Boolean);
      // the next place in the leaderboard: the gap in % of the plan, in dollars of sales
      const prev = me && me.place > 1 ? S.board.find(b => b.place === me.place - 1) : null, gap = prev ? ((prev.sold ?? 0) + (prev.paid ?? 0)) - ((me.sold ?? 0) + (me.paid ?? 0)) : 0;
      body.innerHTML = `${S.day && (k.plan || k.pool) ? panel('📈 Темп периода', paceRow('Продажи', k.sold, k.plan, S.day.sell, 'продать') + paceRow('Сбор', k.paid, k.pool, S.day.collect, 'собрать'), pace != null ? `Прошло ${passed} из ${total} дн. Чёрная черта — где нужно быть сегодня, чтобы закрыть план к ${dm(S.period.to)}.` : '') : ''}
        ${todo.length ? panel('📋 Что сделать сегодня', `<ul class="todo">${todo.join('')}</ul>`) : ''}
        ${chatBtn() ? `<div class="bar" style="margin-bottom:12px">${chatBtn()}</div>` : ''}
        <div class="kpis">
        ${tile('Продано', $$(k.sold), k.plan ? `план ${$$(k.plan)} · ${pctT(sp)}` : 'план не задан', sp === null ? '' : sp >= 100 ? 'good' : '')}
        ${tile('Собрано', $$(k.paid), k.pool ? `пул ${$$(k.pool)} · ${pctT(cp)} · осталось ${$$(Math.max(0, k.pool - k.paid))}` : 'пул не задан', cp === null ? '' : cp >= 100 ? 'good' : '')}
        ${tile('Долг ваших клиентов', $$(k.debt), `должников ${f0(k.debtors)}`, k.debt ? 'warn' : '')}
        ${tile('Место в рейтинге', me ? `${me.place} из ${S.board.length}` : '—', prev ? `до ${prev.place}-го места: +${Math.max(1, Math.ceil(gap))} п.п.${k.plan ? ` (≈ ${$$(Math.max(1, Math.ceil(gap)) * k.plan / 100)} продаж)` : ''}` : me?.place === 1 ? 'вы лидер — держите темп 💪' : 'по % плана продаж и сбора', me?.place === 1 ? 'good' : '')}
        ${S.disc ? tile('Сегодня', t?.first ? `отчёт в ${esc(t.first)}` : t?.st ? esc(t.st) : 'нет отчёта', t?.late ? `опоздание ${t.late} мин · штраф ${f0(t.late * S.disc.rate)} сум` : t?.st ? (t.st === 'Невыход' ? 'отмечен невыход на работу' : 'без штрафа за опоздание') : t?.first ? 'вовремя ✓' : `первый фотоотчёт до ${esc(S.disc.start)}`, t?.late || t?.st === 'Невыход' ? 'bad' : t?.first || t?.st ? 'good' : 'warn') : ''}
        ${S.disc ? tile('Штрафы за период', f0(S.disc.fine) + ' сум', `опозданий ${S.disc.late} · ${S.disc.minutes} мин`, S.disc.fine ? 'bad' : 'good') : ''}
        ${tile('АКБ / ОКБ', `${k.akb} / ${k.okb}`, 'активные / все клиенты')}</div>
        ${S.pay ? panel(`💰 Зарплата за ${esc(S.pay.label)}`, `<table style="width:100%">${S.pay.lines.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="n" style="white-space:nowrap">${esc(b)}</td></tr>`).join('')}<tr><td><b>К выплате</b></td><td class="n"><b>${f0(S.pay.total)} сум</b></td></tr></table>${S.pay.voucher ? `<p class="pos" style="margin:8px 0 0">🎁 Ваучер в ресторан на ${f0(S.pay.voucher)} сум — поздравляем!</p>` : ''}`, 'Расчёт руководителя за закрытый месяц') : ''}
        ${panel('Рейтинг агентов', `<div class="tscroll"><table><thead><tr><th class="n">#</th><th>Агент</th><th class="n">План продаж</th><th class="n">Сбор пула</th></tr></thead><tbody>${S.board.map(b => `<tr${b.me ? ' style="font-weight:700"' : ''}><td class="n">${b.place}</td><td>${esc(b.agent)}${b.me ? ' — вы' : ''}</td><td class="n">${b.sold != null ? b.sold + '%' : '—'}</td><td class="n">${b.paid != null ? b.paid + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>`, 'Место — по сумме % плана продаж и % сбора пула')}
        ${top.length ? panel('Кому собрать в первую очередь', `<div class="cards">${top.map(c => `<div class="ccard"><div class="top"><b>${esc(c.name)}</b><span class="amt neg">${$$(c.debt)}</span></div><div class="meta">${c.pool ? `<span>по пулу осталось ${$$(Math.max(0, c.pool - c.paid))}</span>` : ''}${c.promise ? `<span>🤝 обещал ${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}</span>` : ''}${c.lastPay ? `<span>посл. оплата ${dm(c.lastPay)}</span>` : ''}</div>${c.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(c.phone)}">📞 Позвонить</a></div>` : ''}</div>`).join('')}</div>`) : ''}
        ${sleep.length ? panel('🛒 Давно не покупали — предложите заказ', `<div class="cards">${sleep.map(c => `<div class="ccard"><div class="top"><b>${esc(c.name)}</b><span class="amt">${c.buyDays} дн.</span></div><div class="meta">${c.lastBuy ? `<span>посл. покупка ${dm(c.lastBuy)}</span>` : ''}${c.debt > 0 ? `<span class="neg">долг ${$$(c.debt)}</span>` : '<span class="pos">долга нет</span>'}${c.landmark ? `<span>${esc(c.landmark)}</span>` : ''}</div>${c.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(c.phone)}">📞 Позвонить</a></div>` : ''}</div>`).join('')}</div>`, 'Эти клиенты брали товар, но перестали — каждый вернувшийся клиент поднимает и продажи, и АКБ.') : ''}
        <section class="panel w12" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="font-size:32px" aria-hidden="true">🎓</div><div style="flex:1;min-width:200px"><h4 style="margin:0">MITAL Akademiya</h4><div class="sub">Курсы для агентов: продажи, работа с клиентами и долгами, товары</div></div><a class="btn" style="padding:10px 18px;white-space:nowrap;line-height:1.2" href="${ACADEMY}" target="_blank" rel="noopener">Перейти к курсам →</a></section>${installCard()}`;
      bindExtras(body);
    }
    // ---------- Сбор: the queue of debtors from the supervisor's CRM; every contact is marked in one tap ----------
    const cqDay = new Date().toLocaleDateString('sv-SE'), cqMine = (() => { const x = store.get('mital_me_cq'); return x && x.day === cqDay ? x.m : {}; })();
    const cqSt = c => cqMine[c.name] || (c.last && c.last.d === cqDay ? c.last : null), CQ = { paid: ['✅', 'Оплатил'], promise: ['🤝', 'Обещал'], refuse: ['❌', 'Отказ'], noanswer: ['📵', 'Недозвон'] };
    { const Q = S.queue || [], left = Q.filter(c => !cqSt(c)).length, n = $('#meCqN'); if (n) n.textContent = left ? `(${left})` : ''; }
    if (tab === 'collect') {
      const Q = S.queue || [], done = Q.filter(cqSt).length;
      const row = (c, i) => { const st = cqSt(c);
        return `<div data-cq="${esc(c.name)}" style="padding:12px 0;border-bottom:1px solid var(--line)${st ? ';opacity:.6' : ''}"><div style="display:flex;justify-content:space-between;gap:10px"><b>${i + 1}. ${esc(c.name)}</b><b style="white-space:nowrap">${$$(c.debt)}</b></div>
          <div class="mut" style="font-size:13px;margin:4px 0 8px">${esc(c.why || '')}${c.phone ? `${c.why ? ' · ' : ''}<a href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}${st ? `<br>${CQ[st.r][0]} ${CQ[st.r][1]}${st.r === 'promise' && st.pd ? ` до ${dm(st.pd)}${st.s ? ' · ' + $$(st.s) : ''}` : ''} — отмечено сегодня` : c.last ? `<br>в прошлый раз (${dm(c.last.d)}): ${CQ[c.last.r] ? CQ[c.last.r][1].toLowerCase() : ''}${c.last.pd ? ' до ' + dm(c.last.pd) : ''}` : ''}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(CQ).map(([k, [ic, t]]) => `<button class="btn gray sm" type="button" data-cqr="${k}">${ic} ${t}</button>`).join('')}</div><div data-cqf></div></div>`; };
      body.innerHTML = `<div class="kpis">${tile('Сегодня собрать', S.day && S.day.collect ? $$(S.day.collect) : '—', 'чтобы закрыть пул к концу периода')}${tile('Отработано сегодня', `${done} из ${Q.length}`, 'отметьте каждого, с кем связались', done && done >= Math.min(Q.length, 5) ? 'good' : '')}${S.day && S.day.sell ? tile('Сегодня продать', $$(S.day.sell), 'чтобы закрыть план продаж') : ''}</div>
        ${panel('Кого дожимать сегодня', Q.length ? Q.map(row).join('') : '<p class="mut">Должников в очереди нет 👏</p>', 'Сверху — самые важные: просрочка и сорванные обещания. После звонка или визита нажмите результат — руководитель видит его сразу.')}`;
      const send = async (c, rec, btn) => { btn.disabled = true; try { await storePost({ act: 'collect', client: c.name, ...rec }); cqMine[c.name] = rec; store.set('mital_me_cq', { day: cqDay, m: cqMine }); draw(); } catch (err) { btn.disabled = false; alert(err.message); } };
      body.querySelectorAll('[data-cqr]').forEach(b => b.onclick = () => {
        const box = b.closest('[data-cq]'), c = (S.queue || []).find(x => x.name === box.dataset.cq), k = b.dataset.cqr, f = box.querySelector('[data-cqf]'); if (!c) return;
        if (k === 'noanswer') return send(c, { r: k }, b);
        const tm = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE');
        f.innerHTML = `<div style="display:grid;gap:8px;margin-top:10px">${k === 'promise' ? `<label>Когда заплатит<input type="date" data-pd value="${tm}" min="${cqDay}" style="width:100%"></label><label>Сколько, $<input type="number" inputmode="decimal" data-s min="0.01" step="0.01" value="${c.debt}" style="width:100%"></label>` : k === 'paid' ? '<label>Сколько заплатил, $<input type="number" inputmode="decimal" data-s min="0" step="0.01" style="width:100%"></label>' : ''}
          <label>${k === 'refuse' ? 'Причина отказа' : 'Заметка'}<input data-note style="width:100%" placeholder="${k === 'refuse' ? 'что сказал клиент' : 'необязательно'}"></label><button class="btn" type="button" data-cqgo>${CQ[k][0]} Отправить: ${CQ[k][1]}</button></div>`;
        f.querySelector("[data-cqgo]").onclick = e => {
          const s = Number(f.querySelector('[data-s]')?.value) || 0, pd = f.querySelector('[data-pd]')?.value || '', note = f.querySelector('[data-note]').value.trim();
          if (k === 'promise' && (!pd || s <= 0)) return alert('Укажите дату и сумму обещания');
          if (k === 'refuse' && !note) return alert('Напишите причину отказа');
          send(c, { r: k, ...(s ? { s } : {}), ...(pd ? { pd } : {}), ...(note ? { note } : {}) }, e.target);
        };
      });
    }
    if (tab === 'clients') {
      const F = { all: ['Все', () => true], debt: ['Должники', c => c.debt > 0], prom: ['Обещали', c => !!c.promise], sleep: ['Не покупали 21+ дн.', c => !!c.lastBuy && c.buyDays >= 21], never: ['Ещё не покупали', c => !c.lastBuy], buy: ['Купили в периоде', c => c.sold > 0] };
      const f = F[cf] ? cf : 'all', base = S.clients.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase())), L = base.filter(F[f][1]);
      const sum = (A, kk) => A.reduce((t, c) => t + (c[kk] > 0 ? c[kk] : 0), 0);
      body.innerHTML = `<div class="bar"><input id="meQ" type="search" placeholder="Поиск клиента" value="${esc(q)}" style="flex:1;min-width:0"></div>
        <div class="chips" role="tablist">${Object.entries(F).map(([kk, [tt, fn]]) => `<button type="button" data-cf="${kk}" class="${kk === f ? 'on' : ''}">${tt} · ${base.filter(fn).length}</button>`).join('')}</div>
        ${panel(`Мои клиенты (${f0(L.length)})`, L.length ? `<div class="cards">${L.map(c => `<div class="ccard"><div class="top"><b>${esc(c.name)}</b><span class="amt ${c.debt > 0 ? 'neg' : 'mut'}">${c.debt > 0 ? $$(c.debt) : 'долга нет'}</span></div>
          <div class="meta"><span>купил ${$$(c.sold)}</span><span>оплатил ${$$(c.paid)}</span>${c.pool ? `<span>по пулу осталось ${$$(Math.max(0, c.pool - c.paid))}</span>` : ''}<span>посл. оплата ${c.lastPay ? dm(c.lastPay) : '—'}</span>${c.lastBuy ? `<span class="${c.buyDays > 30 ? 'neg' : ''}">посл. покупка ${dm(c.lastBuy)} (${c.buyDays} дн.)</span>` : '<span>покупок не было</span>'}${c.promise ? `<span>🤝 обещал ${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}</span>` : ''}${c.landmark ? `<span>📍 ${esc(c.landmark)}</span>` : ''}</div>
          ${c.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a></div>` : ''}</div>`).join('')}</div>` : '<p class="mut">Нет клиентов по этому фильтру.</p>',
          `Долг: ${$$(sum(L, 'debt'))} · купили: ${$$(sum(L, 'sold'))} · оплатили: ${$$(sum(L, 'paid'))} — сверху самые большие долги`)}`;
      body.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { cf = b.dataset.cf; draw(); });
      search();
    }
    if (tab === 'stock') {
      if (!S.stock) { body.innerHTML = '<div class="empty-state"><h3>Склад не назначен</h3><p>Попросите руководителя указать ваш склад.</p></div>'; return; }
      const L = S.stock.items.filter(i => !q || (i.name + ' ' + i.brand + ' ' + i.art).toLowerCase().includes(q.toLowerCase()));
      body.innerHTML = `<div class="bar"><input id="meQ" type="search" placeholder="Поиск товара, бренда, артикула" value="${esc(q)}" style="flex:1;min-width:0"></div>
        ${panel(`Склад ${esc(S.stock.warehouse)} (${f0(L.length)})`, `<div class="cards">${L.map(i => `<div class="ccard"><div class="top"><b>${esc(i.name)}</b><span class="amt ${i.available <= 0 ? 'neg' : ''}">${f0(i.available)} шт</span></div><div class="meta"><span>${esc(i.art)}</span>${i.brand ? `<span>${esc(i.brand)}</span>` : ''}<span>всего ${f0(i.total)}${i.total > i.available ? ` · в резерве ${f0(i.total - i.available)}` : ''}</span></div></div>`).join('')}</div>`, `Остатки на ${S.live?.stock ? hhmm(S.live.stock) + ' (обновляются каждые 5 минут)' : dRu(S.stock.at)}. «Доступно» — без резерва под заказы.`)}`;
      search();
    }
    if (tab === 'disc') {
      const D = S.disc, half = v => String(v).replace('.', ',');
      const toneCss = { neg: 'color:#e0564a;font-weight:700', warn: 'color:#e9a23b;font-weight:600', pos: 'color:#3fbf73', st: 'font-weight:700', mut: 'opacity:.55' };
      // the month as a calendar: 7 columns from Monday, each day — its number and code (Я, О15, Н, Б, К…); a tap shows the details
      const t0 = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // Tashkent date
      const cal = s => { const lead = (new Date(s.days[0].day + 'T12:00:00').getDay() + 6) % 7;
        return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:12px">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => `<div class="mut">${w}</div>`).join('')}${'<div></div>'.repeat(lead)}${s.days.map(x => `<div data-tip="${esc(dRu(x.day) + (x.tip ? ' · ' + x.tip : ''))}" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:4px 2px;min-height:40px;cursor:pointer;${x.day === t0 ? 'outline:2px solid var(--oil,#f2b01e);' : ''}"><div class="mut" style="font-size:10px">${Number(x.day.slice(8))}</div><div style="${toneCss[x.tone] || ''}">${esc(x.code)}</div></div>`).join('')}</div>
          <p class="mut" id="calTip" style="min-height:1.2em;margin:8px 0 0"></p>`; };
      const types = D?.types || [];
      body.innerHTML = D ? `${D.skip ? '<p class="mut">Вы не учитываетесь в дисциплине: штрафов и замечаний нет.</p>' : ''}<div class="kpis">${tile('Штрафы за период', f0(D.fine) + ' сум', `${D.minutes} мин опозданий · ${f0(D.rate)} сум за минуту`, D.fine ? 'bad' : 'good')}${tile('Опозданий', f0(D.late), `первый фотоотчёт до ${esc(D.start)}`, D.late ? 'warn' : 'good')}${tile('Невыходов', D.absent ? half(D.absent) : '0', D.autoAbs ? `нет отчёта до ${esc(D.autoAbs)} — невыход` : '', D.absent ? 'bad' : 'good')}${D.end ? tile('Ранний уход', f0(D.early || 0), `последний отчёт раньше ${esc(D.end)}`, D.early ? 'warn' : 'good') : ''}${tile('Маршрут', D.route != null ? Math.round(D.route * 100) + '%' : '—', 'визитов из плана за период')}</div>
        ${D.sheet ? panel('Табель за период (16–15)', cal(D.sheet) + `<p class="mut" style="margin:6px 0 0">Явка ${half(D.sheet.worked)} дн. · опозданий ${D.sheet.late} · ранний уход ${D.sheet.early} · невыходов ${half(D.sheet.absent)}</p>`, 'Я — на работе, О15 — опоздание 15 мин, Я↓ — ушли раньше, Н — невыход (Н* — нет отчёта, автоматически), ½ — полдня, Б — больничный, К — командировка, О — отпросились, С — семейные обстоятельства, ОТ — отпуск, В — выходной, Д — другая причина. Нажмите на день — подробности.') : ''}
        ${types.length ? panel('📝 Отсутствие', `<div style="display:grid;gap:8px">
            <label>Что<select id="arType" style="width:100%">${types.map(x => `<option value="${x.k}">${esc(x.t)}</option>`).join('')}</select></label>
            <div style="display:flex;gap:8px"><label style="flex:1">С<input id="arFrom" type="date" value="${t0}" style="width:100%"></label><label style="flex:1">По<input id="arTo" type="date" value="${t0}" style="width:100%"></label></div>
            <label>Причина<textarea id="arNote" rows="2" maxlength="300" style="width:100%" placeholder="Например: температура, справка будет; поездка на склад в Ташкент"></textarea></label>
            <button class="btn" id="arSend" type="button">Отправить руководителю</button><p id="arMsg" class="mut" style="margin:0"></p></div>
          ${(D.reqs || []).length ? `<div class="tscroll" style="margin-top:10px"><table><thead><tr><th>Заявка</th><th>Дни</th><th>Ответ</th></tr></thead><tbody>${D.reqs.map(q => `<tr><td>${esc(q.type)}${q.note ? `<div class="mut" style="font-size:12px">${esc(q.note)}</div>` : ''}</td><td>${q.from === q.to ? dm(q.from) : dm(q.from) + '–' + dm(q.to)}</td><td class="${q.st === 'ok' ? 'pos' : q.st === 'no' ? 'neg' : 'mut'}">${q.st === 'ok' ? '✓ подтверждена' : q.st === 'no' ? 'отклонена' : 'ждёт ответа'}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
          'Заранее или в тот же день: руководитель подтвердит — день отметится в табеле без штрафа. Ответ придёт в Telegram.') : ''}
        ${panel('По дням', `<div class="tscroll"><table><thead><tr><th>День</th><th>Первый отчёт</th><th class="n">Опоздание</th><th class="n">Штраф</th><th class="n">Визиты</th></tr></thead><tbody>${D.days.slice().reverse().map(x => `<tr><td>${dRu(x.day)}</td><td class="${x.late || /^Невыход|без причины/.test(x.st) ? 'neg' : ''}">${esc(x.first || '')}${x.st ? `${x.first ? ' · ' : ''}<b>${esc(x.st)}</b>` : x.first ? '' : x.plan ? 'нет отчёта' : '—'}${x.early ? ` <small class="neg">· ушли раньше на ${x.early} мин</small>` : ''}${x.note ? `<div class="mut" style="font-size:12px">${esc(x.note)}</div>` : ''}</td><td class="n">${x.late ? x.late + ' мин' : x.first ? '✓' : ''}</td><td class="n ${x.late ? 'neg' : ''}">${x.late ? f0(x.late * D.rate) + ' сум' : ''}</td><td class="n">${x.plan ? `${x.done}/${x.plan}` : ''}</td></tr>`).join('')}</tbody></table></div>`)}` : '<p class="mut">Данных о дисциплине пока нет.</p>';
      if (D) {
        body.querySelectorAll('[data-tip]').forEach(c => c.onclick = () => { const t = $('#calTip'); if (t) t.textContent = c.dataset.tip; });
        const send = $('#arSend');
        if (send) send.onclick = async () => {
          const msg = $('#arMsg'), from = $('#arFrom').value, to = $('#arTo').value || from, note = $('#arNote').value.trim();
          if (!from || to < from) { msg.className = 'neg'; msg.textContent = 'Проверьте даты'; return; }
          if (!note) { msg.className = 'neg'; msg.textContent = 'Напишите причину'; return; }
          send.disabled = true; msg.className = 'mut'; msg.textContent = 'Отправляю…';
          try { await storePost({ act: 'absreq', type: $('#arType').value, from, to, note }); msg.className = 'pos'; msg.textContent = '✓ Заявка отправлена руководителю. Ответ придёт в Telegram.'; $('#arNote').value = ''; }
          catch (e) { msg.className = 'neg'; msg.textContent = e.message; }
          finally { send.disabled = false; }
        };
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.tab; q = ''; doing = null; draw(); scrollTo(0, 0); });
    document.addEventListener('click', e => { if (e.target.closest('[data-chat]') && inTg) { try { TGA.close(); } catch { /* old Telegram */ } } });
    document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (!g) return; e.preventDefault(); tab = g.dataset.go; doing = null; draw(); scrollTo(0, 0); });
    $('#meUpd').onclick = load;
    // header: language switch and «install» (shown when the browser offers it)
    const lb = document.createElement('button'); lb.type = 'button'; lb.textContent = lang === 'uz' ? 'RU' : 'UZ'; lb.title = lang === 'uz' ? 'Русский' : 'Oʻzbekcha'; lb.onclick = () => setLang(lang === 'uz' ? 'ru' : 'uz');
    const ib = document.createElement('button'); ib.type = 'button'; ib.id = 'meInst'; ib.textContent = '📲'; ib.title = 'Установить приложение'; ib.hidden = !installEv || standalone(); ib.onclick = install;
    $('#meUpd').before(ib, lb);
    // «Выйти» in the header (only the icon on the phone, so it always fits) — and a full button in «Ещё». Not inside Telegram:
    // there the cabinet is opened by the bot, without a login
    if (!inTg) {
      const out = document.createElement('button'); out.type = 'button'; out.id = 'meOut'; out.innerHTML = '🚪<span class="lbl"> Выйти</span>'; out.title = 'Выйти из аккаунта'; out.setAttribute('aria-label', 'Выйти из аккаунта'); $('#meUpd').after(out);
      out.onclick = logout;
    }
    // links inside Telegram: t.me opens in Telegram itself (the chat), other links in the browser — not inside the small app window
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="http"]'); if (!a || !inTg) return; e.preventDefault(); if (a.href.startsWith('https://t.me/')) TGA.openTelegramLink(a.href); else TGA.openLink(a.href); });
    draw(); load();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && Date.now() - Date.parse(S.at || 0) > 10 * 60000) load(); });
  });
})();
