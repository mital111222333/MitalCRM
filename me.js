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
  // tgCab: opened by the cabinet button of the supervisor's bot (signed initData, no login). Inside the MITAL CRM bot («Панель»)
  // the person signs in with his login instead: then the page works as in a browser (own logout, chat through the bot link)
  const tgCab = inTg && !!link?.tg;
  if (inTg) { try { TGA.ready(); TGA.expand(); if (TGA.colorScheme === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* old Telegram */ } }
  // the third way in: the agent signed in to MITAL CRM with his own login (index.html sends agents here). The cabinet is read from
  // the MITAL database (agent_cabinets, only his own row — the database rules check it); it is written there by his supervisor's CRM.
  const SB_URL = 'https://oxchgcfyzszemqlvdjjr.supabase.co', SB_KEY = 'sb_publishable_FlwHIDb04LSfDA18DFo_Yw_YesRxk9g';
  const sbUid = (() => { try { return JSON.parse(localStorage.getItem('crm_auth') || 'null')?.user?.id || ''; } catch { return ''; } })();
  const SB = !link && sbUid && window.supabase?.createClient ? window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm_auth' } }) : null;
  const DATA_KEY = SB ? 'mital_me_data:' + sbUid : 'mital_me_data'; // a shared phone never shows the previous agent's cabinet
  const NO_ACT = 'Это отмечается в кабинете Telegram: кнопка «📱 Мой кабинет» в боте вашего руководителя.';
  let tab = 'main', q = '', cf = 'all', calDay = '', routeDay = '', ctab = store.get('mital_ctab') || 'once', S = store.get(DATA_KEY), loading = false, doing = null;

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
    location.replace(inTg ? './?tg=1' : './');
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
    if (!tgCab || !S?.chat) return;
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
  const chatBtn = () => (tgCab ? '<button class="btn gray" type="button" data-chat="1">💬 Чат с руководителем</button>' : S?.bot ? `<a class="btn gray" href="https://t.me/${esc(S.bot)}" target="_blank" rel="noopener">💬 Чат с руководителем</a>` : S?.boss ? `<a class="btn gray" href="https://t.me/${esc(S.boss)}" target="_blank" rel="noopener">💬 Написать руководителю</a>` : '');
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
    .sc-ord b{min-width:30px;height:30px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;background:var(--line,#dde3e8)}.sc-ord.on b{background:var(--accent,#1a73e8);color:#fff}
    .sc-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px 0 10px;scrollbar-width:none}.sc-tabs button,.sc-seg button{flex:0 0 auto;border:1px solid var(--line,#dde3e8);background:var(--card,#fff);color:inherit;border-radius:20px;padding:9px 14px;font-size:14px;cursor:pointer}
    .sc-tabs button.on,.sc-seg button.on{background:var(--accent,#1a73e8);border-color:var(--accent,#1a73e8);color:#fff}.sc-seg{display:flex;gap:6px;flex-wrap:wrap}
    .sc-badge{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:#d9534f;color:#fff;font-size:12px;line-height:18px}
    .sc-kps{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.sc-kp{border:1px solid var(--line,#dde3e8);border-radius:12px;padding:12px}.sc-kp .v{font-size:24px;font-weight:700}.sc-kp .t{font-size:13px}.sc-kp .s{font-size:12px;opacity:.7;margin-top:2px}
    .sc-kp.good{border-color:#2e9d5b;background:rgba(46,157,91,.08)}.sc-kp.bad{border-color:#d9534f;background:rgba(217,83,79,.07)}
    .sc-cal{display:flex;flex-wrap:wrap;gap:5px}.sc-cal span{position:relative;width:34px;height:34px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#fff}.sc-cal span.ok{background:#2e9d5b}.sc-cal span.bad{background:#d9534f}.sc-cal i{position:absolute;top:-6px;right:-6px;font-size:11px;font-style:normal}
    .sc-dot{display:inline-block;width:10px;height:10px;border-radius:3px}.sc-dot.ok{background:#2e9d5b}.sc-dot.bad{background:#d9534f}
    .sc-hit{display:block;width:100%;text-align:left;padding:10px;border:0;border-bottom:1px solid var(--line,#dde3e8);background:var(--card,#fff);color:inherit;font-size:15px;cursor:pointer}
    .sc-row.sc-cur{background:rgba(26,115,232,.1);border-left:4px solid var(--accent,#1a73e8);padding-left:8px}.sc-live{background:#d9534f!important;color:#fff!important}</style>`);

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

  // ---------- store keeper's cabinet: tabs — the count, приход / отгрузка, what is running out, his rating ----------
  let stab = store.get('mital_stab') || 'count';
  function drawStore(body) {
    if (ordering) return drawOrder(body);
    const nav = document.querySelector('nav.tabs'); if (nav) nav.hidden = true;
    $('#meName').textContent = 'Склад ' + S.warehouse; $('#meSub').textContent = S.name;
    const nLow = ((S.low && S.low.items) || []).length;
    const T = [['count', '📋 Сверка'], ['move', '🚚 Приход / отгрузка'], ['low', '⚠ Заканчивается' + (nLow ? ` <b class="sc-badge">${nLow}</b>` : '')], ['me', '🏆 Мой рейтинг']];
    if (stab === 'move') drawMove(body); else if (stab === 'low') drawLow(body); else if (stab === 'me') drawMe(body); else drawCount(body);
    body.insertAdjacentHTML('afterbegin', `<div class="sc-tabs" role="tablist">${T.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === stab}" class="${k === stab ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div>`);
    body.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { stab = b.dataset.st; store.set('mital_stab', stab); drawStore(body); window.scrollTo(0, 0); });
  }

  // ⚠ what is running out on this warehouse: names and a status only (no LINKO numbers — the count stays blind)
  function drawLow(body) {
    const L = (S.low && S.low.items) || [], W = { out: ['✕ Закончился', 'neg'], blocked: ['⊘ Всё отложено под заказы', 'neg'], low: ['▼ Осталось мало', ''] };
    body.innerHTML = panel('⚠ Что заканчивается на складе', !S.low ? '<p class="mut">Данных пока нет — они появятся, когда руководитель обновит остатки складов.</p>'
      : !L.length ? '<p class="pos" style="font-size:17px"><b>✓ Всё есть — ничего не заканчивается</b></p>'
      : `<p class="mut">По остаткам${S.low.at ? ' на ' + dRu(S.low.at) : ''}. Отметьте, что нужно завезти, и отправьте руководителю.</p>${['out', 'blocked', 'low'].map(k => { const g = L.filter(i => i.s === k); return g.length ? `<h4 style="margin:14px 0 6px" class="${W[k][1]}">${W[k][0]} — ${g.length}</h4>${g.map(i => `<label class="sc-row" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-lw="${esc(i.art)}" ${k !== 'low' ? 'checked' : ''} style="width:22px;height:22px"><span>${esc(i.name)}${i.from ? `<br><small class="mut">есть на складе ${esc(i.from)}</small>` : ''}</span></label>`).join('')}` : ''; }).join('')}`)
      + `<div class="bar">${L.length ? '<button class="btn" id="lwAsk">📨 Попросить завезти</button>' : ''}${chatBtn()}</div><small id="lwE" role="status"></small>`;
    const b = $('#lwAsk'); if (b) b.onclick = async () => {
      const arts = [...body.querySelectorAll('[data-lw]:checked')].map(x => x.dataset.lw); if (!arts.length) { $('#lwE').textContent = 'Отметьте товары'; return; }
      b.disabled = true; try { await storePost({ act: 'lowask', items: arts.map(a => L.find(i => i.art === a)?.name || a) }); $('#lwE').className = 'pos'; $('#lwE').textContent = `✓ Руководитель получил список: ${arts.length} поз.`; } catch (err) { b.disabled = false; $('#lwE').className = 'neg'; $('#lwE').textContent = err.message; }
    };
  }

  // 🏆 his own rating and history (counted by the CRM from the accepted counts)
  function drawMe(body) {
    const T = S.stats;
    if (!T || !T.days || !T.days.length) { body.innerHTML = panel('🏆 Мой рейтинг', '<p class="mut">Здесь появятся ваша история сверок и место среди складов — после первых сверок.</p>'); return; }
    const m = T.month, pct = m.cnt ? Math.round(m.clean / m.cnt * 100) : 0, medal = T.rank === 1 ? '🥇' : T.rank === 2 ? '🥈' : T.rank === 3 ? '🥉' : '🏅';
    const kp = (v, t, s, tone) => `<div class="sc-kp ${tone || ''}"><div class="v">${v}</div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    body.innerHTML = panel('🏆 Мой рейтинг', `<div class="sc-kps">
        ${kp(T.streak, 'сверок подряд без расхождений', `лучший результат: ${T.best}`, T.streak >= 5 ? 'good' : '')}
        ${kp(`${m.clean} из ${m.cnt}`, 'в этом месяце без расхождений', pct + '%', pct >= 90 ? 'good' : pct < 60 ? 'bad' : '')}
        ${kp(`${m.onTime} из ${m.cnt}`, `вовремя — до ${esc(T.deadline || '10:00')}`, '', m.onTime === m.cnt ? 'good' : '')}
        ${T.rank ? kp(`${medal} ${T.rank}`, `место среди ${T.of} складов`, 'в этом месяце', T.rank === 1 ? 'good' : '') : ''}
        ${m.charged ? kp('$' + m.charged, 'удержано за недостачу в этом месяце', '', 'bad') : ''}
      </div>
      <h4 style="margin:16px 0 6px">Последние ${T.days.length} сверок</h4>
      <div class="sc-cal">${T.days.map(d => `<span class="${d.ok ? 'ok' : 'bad'}" title="${dRu(d.d)}: ${d.ok ? 'сошлось' : 'расхождений ' + d.n}${d.late ? ', с опозданием' : ''}">${Number(d.d.slice(8, 10))}${d.late ? '<i>⏰</i>' : ''}</span>`).join('')}</div>
      <p class="mut"><span class="sc-dot ok"></span> сошлось · <span class="sc-dot bad"></span> были расхождения · ⏰ после ${esc(T.deadline || '10:00')}</p>
      ${T.days.slice().reverse().slice(0, 10).map(d => `<div class="sc-row" style="display:flex;justify-content:space-between;gap:10px"><span>${dRu(d.d)}</span><span class="${d.ok ? 'pos' : 'neg'}">${d.ok ? '✓ сошлось' : '✕ расхождений: ' + d.n}${d.late ? ' · ⏰ опоздание' : ''}${d.ch ? ' · удержано $' + d.ch : ''}</span></div>`).join('')}`);
  }

  // 🚚 приход / отгрузка / возврат: what physically came in or went out (boxes × pieces like the count), with a photo of the waybill
  const MV = { get: () => store.get('mital_mv'), set: v => store.set('mital_mv', v) };
  const MVT = { in: '📥 Приход', out: '📤 Отгрузка', ret: '↩ Возврат', dmg: '🗑 Брак' };
  function drawMove(body) {
    const mv = MV.get() || { type: 'in', party: '', it: {} }; mv.it ||= {};
    const byArt = new Map((S.items || []).map(i => [i.art, i])), added = Object.keys(mv.it).filter(a => byArt.has(a));
    const qty = a => { const x = mv.it[a] || {}; return (Number(x.b) || 0) * packOf(byArt.get(a)) + (Number(x.p) || 0); };
    const total = () => added.reduce((t, a) => t + qty(a), 0);
    const row = a => { const i = byArt.get(a), pk = packOf(i), x = mv.it[a] || {};
      return `<div class="sc-row" data-mr="${esc(a)}"><div>${esc(i.name)}<br><small class="mut">${esc(a)}${pk > 1 ? ` · <span class="sc-pk">📦 1 коробка = ${pk} шт</span>` : ''}</small></div>
        <div class="sc-in">${pk > 1 ? `<input type="number" inputmode="numeric" min="0" placeholder="кор." aria-label="Коробок" data-mb="${esc(a)}" value="${x.b ?? ''}"><span class="mut">× ${pk} +</span>` : ''}<input type="number" inputmode="numeric" min="0" placeholder="шт" aria-label="Штук" data-mp="${esc(a)}" value="${x.p ?? ''}">
        <b class="sc-sum" data-ms="${esc(a)}">${qty(a) ? '= ' + qty(a) : ''}</b><span style="flex:1"></span><button class="btn gray sm" type="button" data-mx="${esc(a)}" aria-label="Убрать">✕</button></div></div>`; };
    const hist = (S.moves || []).slice(0, 15);
    body.innerHTML = panel('🚚 Приход / отгрузка', `<div class="sc-seg">${Object.entries(MVT).map(([k, t]) => `<button type="button" class="${mv.type === k ? 'on' : ''}" data-mt="${k}">${t}</button>`).join('')}</div>
      <label class="mut" style="display:block;margin-top:10px">${mv.type === 'in' ? 'Откуда (поставщик, машина, другой склад)' : mv.type === 'out' ? 'Кому (агент, клиент, другой склад)' : mv.type === 'dmg' ? 'Что случилось (помято, протекло, разбито, просрочено) — обязательно' : 'От кого (клиент, агент)'}<input id="mvP" maxlength="120" value="${esc(mv.party || '')}" style="width:100%;margin-top:4px"></label>
      <div style="margin-top:12px"><input id="mvQ" type="search" placeholder="🔍 Найти товар и добавить" style="width:100%"><div id="mvR"></div></div>
      <div id="mvL">${added.length ? added.map(row).join('') : '<p class="mut">Найдите товары поиском — они появятся здесь — и укажите количество (коробки и штуки).</p>'}</div>
      ${added.length ? `<p style="font-size:17px">Итого: <b id="mvT">${added.length} поз., ${total()} шт</b></p>` : ''}
      <div class="form">${mv.type === 'dmg' ? '<p class="neg" style="grid-column:1/-1;margin:0"><b>🗑 Брак:</b> сфотографируйте повреждённый товар и отложите его отдельно. <b>В сверке брак не считайте</b> — руководитель спишет его в LINKO.</p>' : ''}<label style="grid-column:1/-1">${mv.type === 'dmg' ? 'Фото брака — обязательно' : 'Фото накладной (лучше приложить)'}<input id="mvPh" type="file" accept="image/*" capture="environment"></label><label style="grid-column:1/-1">Комментарий<textarea id="mvC" rows="2" maxlength="500" placeholder="например: 1 коробка помята"></textarea></label></div>
      <div class="bar"><button class="btn gray" id="mvX" type="button">Очистить</button><span class="spacer"></span><button class="btn" id="mvGo" type="button">Отправить руководителю</button></div><small id="mvE" class="neg" role="alert"></small>`,
      'Записывайте то, что физически приняли или отдали. Руководитель сверит с накладной и LINKO.')
      + (hist.length ? panel('Мои записи', hist.map(h => `<div class="sc-row"><b>${MVT[h.type] || esc(h.type)}</b> · ${dRu(new Date(h.at).toLocaleDateString('sv-SE'))} ${new Date(h.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${h.party ? ' · ' + esc(h.party) : ''}${h.photo ? ' · 📷' : ''}<br><small class="mut">${h.items.slice(0, 8).map(i => esc(i.name) + ': ' + i.qty).join('; ')}${h.items.length > 8 ? ' …' : ''}</small></div>`).join('')) : '');
    const save = () => MV.set(mv);
    body.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { mv.type = b.dataset.mt; save(); drawStore(body); });
    $('#mvP').oninput = e => { mv.party = e.target.value; save(); };
    const q = $('#mvQ'), res = $('#mvR');
    q.oninput = () => { const s = q.value.trim().toLowerCase(); if (s.length < 2) { res.innerHTML = ''; return; }
      const hits = (S.items || []).filter(i => (i.name + ' ' + i.art).toLowerCase().includes(s)).slice(0, 8);
      res.innerHTML = hits.length ? hits.map(i => `<button type="button" class="sc-hit" data-ma="${esc(i.art)}">${mv.it[i.art] ? '✓ ' : '＋ '}${esc(i.name)}</button>`).join('') : '<p class="mut">Не найдено</p>';
      res.querySelectorAll('[data-ma]').forEach(b => b.onclick = () => { const a = b.dataset.ma; mv.it[a] ||= {}; save(); drawStore(body); const inp = document.querySelector(`[data-mb="${CSS.escape(a)}"],[data-mp="${CSS.escape(a)}"]`); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); } }); };
    body.querySelectorAll('[data-mb],[data-mp]').forEach(inp => inp.oninput = () => { const a = inp.dataset.mb || inp.dataset.mp, v = inp.value.trim(); mv.it[a] ||= {}; mv.it[a][inp.dataset.mb ? 'b' : 'p'] = v === '' ? undefined : Math.max(0, Math.round(Number(v)) || 0); save();
      const s = document.querySelector(`[data-ms="${CSS.escape(a)}"]`); if (s) s.textContent = qty(a) ? '= ' + qty(a) : ''; const t = $('#mvT'); if (t) t.textContent = `${added.length} поз., ${total()} шт`; });
    body.querySelectorAll('[data-mx]').forEach(b => b.onclick = () => { delete mv.it[b.dataset.mx]; save(); drawStore(body); });
    $('#mvX').onclick = () => { if (added.length && !confirm('Очистить список?')) return; MV.set(null); drawStore(body); };
    $('#mvGo').onclick = async e => {
      const items = added.map(a => ({ art: a, qty: qty(a) })).filter(i => i.qty > 0);
      if (!items.length) { $('#mvE').textContent = 'Добавьте товары и укажите количество'; return; }
      if (mv.type === 'dmg' && !(mv.party || '').trim()) { $('#mvE').textContent = 'Напишите, что случилось с товаром'; $('#mvP').focus(); return; }
      if (mv.type === 'dmg' && !$('#mvPh').files[0]) { $('#mvE').textContent = 'Для брака нужно фото'; return; }
      const empty = added.filter(a => !qty(a)); if (empty.length && !confirm(`У ${empty.length} поз. не указано количество — они не уйдут. Отправить остальные?`)) return;
      e.target.disabled = true; e.target.textContent = 'Отправляю…';
      try {
        const f = $('#mvPh').files[0], photo = f ? await shrink(f) : '', names = {}; items.forEach(i => { names[i.art] = byArt.get(i.art).name; });
        const j = await storePost({ act: 'move', type: mv.type, party: (mv.party || '').trim(), items, names, comment: $('#mvC').value.trim(), photo });
        S.moves = [{ id: j.id, at: j.at || new Date().toISOString(), type: mv.type, party: (mv.party || '').trim(), items: items.map(i => ({ name: names[i.art], qty: i.qty })), photo: !!photo }, ...(S.moves || [])];
        MV.set(null); msg(`✓ ${MVT[mv.type]} отправлен руководителю: ${items.length} поз., ${j.units ?? items.reduce((t, i) => t + i.qty, 0)} шт`); drawStore(body); window.scrollTo(0, 0);
      } catch (err) { e.target.disabled = false; e.target.textContent = 'Отправить руководителю'; $('#mvE').textContent = err.message || 'Нет связи — попробуйте ещё раз, список сохранён'; }
    };
  }

  // 🎤 numbers by voice while counting: «пять коробок три штуки», «двенадцать», «ноль», «дальше» (skip). Russian and Uzbek words,
  // digits as the phone hears them. One number for an item in boxes = boxes; «штук» after a number = pieces.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // the language the phone listens in — separate from the page language: many say numbers in Russian even with the page in Uzbek
  const vLang = () => store.get('mital_vlang') || (lang === 'uz' ? 'uz' : 'ru');
  // number words, Russian and Uzbek (Latin and Cyrillic, with the spellings the phone writes: «tort», «turt», «etti», «sakiz», «kirk»).
  // Text is normalised first: lower case, ё→е, ў→у, қ→к, ғ→г, ҳ→х, apostrophes dropped («to'rt» → «tort», «o'n» → «on»).
  const NUMW = { ноль: 0, нуль: 0, один: 1, одна: 1, одну: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
    nol: 0, nul: 0, bir: 1, ikki: 2, iki: 2, uch: 3, tort: 4, turt: 4, besh: 5, bes: 5, olti: 6, yetti: 7, etti: 7, sakkiz: 8, sakiz: 8, toqqiz: 9, toqiz: 9, tuqqiz: 9, tukkiz: 9, tokkiz: 9, on: 10, un: 10,
    yigirma: 20, igirma: 20, ottiz: 30, otiz: 30, uttiz: 30, qirq: 40, kirk: 40, qirk: 40, kirq: 40, ellik: 50, elik: 50, oltmish: 60, yetmish: 70, etmish: 70, sakson: 80, toqson: 90, tuqson: 90, tokson: 90,
    нол: 0, бир: 1, икки: 2, ики: 2, уч: 3, турт: 4, беш: 5, олти: 6, етти: 7, йетти: 7, саккиз: 8, сакиз: 8, туккиз: 9, токкиз: 9, ун: 10, йигирма: 20, игирма: 20, уттиз: 30, утиз: 30, кирк: 40, эллик: 50, элик: 50, олтмиш: 60, етмиш: 70, йетмиш: 70, саксон: 80, туксон: 90 };
  const HUNDRED = /^(сто|сотня|yuz|юз)$/, THOUSAND = /^(тысяч\w*|ming|минг)$/;
  const BOXW = /^(кор|короб|ящик|quti|kuti|qutt|karob|korob|yashik|кути|каробк)/, PCSW = /^(шт|штук|штуки|штука|штучек|dona|donasi|дона|донаси)$/, NEUTW = /^(ta|та|tasi|таси)$/;
  const SKIPW = /дальше|пропус|следующ|keyingi|кейинги|otkaz|утказ|next|keyin|кейин/;
  const voiceNorm = t => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/ў/g, 'у').replace(/қ/g, 'к').replace(/ғ/g, 'г').replace(/ҳ/g, 'х').replace(/[ʻʼ'`’‘´]/g, '');
  // a number word with the Uzbek counter glued on: «beshta», «ontasi», «бешта» → «besh» (neutral); digits too: «5ta»
  const numWord = t => { if (t in NUMW) return { v: NUMW[t] }; const m = t.match(/^(.+?)(ta|tasi|tadan|та|таси|тадан)$/); if (m && (m[1] in NUMW || /^\d+$/.test(m[1]))) return { v: /^\d+$/.test(m[1]) ? Number(m[1]) : NUMW[m[1]], ta: true }; return null; };
  function hearNums(text) {
    const norm = voiceNorm(text), toks = norm.replace(/(\d)\s+(?=\d{3}\b)/g, '$1').split(/[^a-zа-я0-9]+/).filter(Boolean), out = [];
    let total = null, group = 0;
    const flush = unit => { if (total !== null) { out.push({ n: total + group, unit }); total = null; group = 0; } };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const w = /^\d+$/.test(t) ? null : numWord(t);
      if (/^\d+$/.test(t)) { flush(null); total = 0; group = Number(t); }
      else if (HUNDRED.test(t)) { if (total === null) { total = 0; group = 0; } group = group > 0 && group < 10 ? group * 100 : group + 100; } // «besh yuz» = 500, «сто» = 100
      else if (THOUSAND.test(t)) { if (total === null) { total = 0; group = 1; } total += (group || 1) * 1000; group = 0; }
      else if (/^(нет|нету|yoq|yuq|йук|йок)$/.test(t)) { flush(null); total = 0; group = 0; flush(null); }
      else if (w) {
        if (total !== null && group % 10 !== 0 && w.v < 10) flush(null); // «ikki uch» → 2 and 3; «yigirma besh» → 25, «on ikki» → 12
        if (total === null) { total = 0; group = 0; }
        group += w.v;
      }
      else if (BOXW.test(t)) flush('b');
      else if (PCSW.test(t)) flush('p');
      else flush(null); // «ta» and any other word end the number
    }
    flush(null);
    return { nums: out, skip: SKIPW.test(norm) };
  }
  // 🔊 the phone reads the name of the next item aloud, then listens for the number — the store keeper need not look at the screen.
  // While it speaks the microphone is off (it would hear itself). «повтори» / «qaytar» — say the name again.
  const TTS = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const talkOn = () => TTS && store.get('mital_talk') !== false;
  // «Mitanol 4L» → «Mitanol 4 литра», «OF-00202» → «OF 00202»: what a speech voice reads well
  const sayable = (name, uz) => String(name || '').replace(/(\d+(?:[.,]\d+)?)\s*(?:LTR|LT|L|Л|ЛИТР|ЛИТРА)(?![A-ZА-ЯЁa-zа-яё])/gi, (m, n) => n.replace('.', ',') + (uz ? ' litr' : ' литра')).replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  function voiceCount(body, list, sel, recalc) {
    const btn = $('#scMic'), stat = $('#scV'); if (!btn) return;
    let on = false, rec = null, cur = null, speaking = false, sayT = null;
    body.addEventListener('focusin', e => { const r = e.target.closest && e.target.closest('.sc-row'); if (r) mark(r.dataset.r); });
    const visibleRows = () => [...body.querySelectorAll('.sc-row')].filter(r => r.style.display !== 'none');
    const mark = a => { body.querySelectorAll('.sc-cur').forEach(r => r.classList.remove('sc-cur')); cur = a; const r = a && sel('r', a); if (r) r.classList.add('sc-cur'); };
    const isEmpty = a => { const p = sel('p', a); return p && p.value === '' && !(sel('b', a)?.value); };
    const nextRow = () => { const R = visibleRows(), k = R.findIndex(r => r.dataset.r === cur), after = R.slice(k + 1).concat(R.slice(0, k + 1)); const r = after.find(x => isEmpty(x.dataset.r)) || (k >= 0 ? null : R[0]); mark(r ? r.dataset.r : null); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const target = () => { if (!cur || !sel('r', cur) || sel('r', cur).style.display === 'none') nextRow(); return cur; };
    const listen = () => { if (on && !speaking) start(); };
    // say a phrase, then listen again; a phone that never reports the end of speech still gets the microphone back after a pause
    const say = text => {
      if (!on || !talkOn() || !text) return listen();
      speaking = true; try { rec && rec.abort(); } catch { /* not listening */ }
      const uz = vLang() === 'uz', u = new SpeechSynthesisUtterance(text), want = uz ? 'uz' : 'ru', voices = speechSynthesis.getVoices();
      const v = voices.find(x => x.lang && x.lang.toLowerCase().startsWith(want)) || voices.find(x => x.lang && x.lang.toLowerCase().startsWith('ru'));
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = uz ? 'uz-UZ' : 'ru-RU';
      u.rate = 1.05;
      const done = () => { clearTimeout(sayT); if (!speaking) return; speaking = false; setTimeout(listen, 150); };
      u.onend = done; u.onerror = done; clearTimeout(sayT); sayT = setTimeout(done, 1500 + text.length * 110);
      try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { done(); }
    };
    const sayCur = () => { const i = cur && list.find(x => x.art === cur); if (!i) { stat.textContent = '✓ Все товары посчитаны'; say(vLang() === 'uz' ? 'Hammasi sanaldi' : 'Все товары посчитаны'); stop(); return; } say(sayable(i.name, vLang() === 'uz')); };
    const apply = text => {
      const a = target(); if (!a) { stat.textContent = '✓ Все товары посчитаны'; stop(); return; }
      const H = hearNums(text), i = list.find(x => x.art === a), pk = packOf(i), bI = sel('b', a), pI = sel('p', a);
      if (/повтор|еще раз|ещё раз|qaytar|yana bir|кайтар/.test(voiceNorm(text)) && !H.nums.length) { stat.textContent = '🔊 ' + i.name; sayCur(); return; }
      if (H.skip && !H.nums.length) { stat.textContent = '⏭ пропущено: ' + i.name; nextRow(); sayCur(); return; }
      if (!H.nums.length) { stat.textContent = `Не понял «${text}» — скажите число`; listen(); return; }
      let b = null, p = null; for (const x of H.nums) { if (x.unit === 'b' && b === null) b = x.n; else if (x.unit === 'p' && p === null) p = x.n; else if (pk > 1 && b === null && x.unit === null && p === null) b = x.n; else if (p === null) p = x.n; }
      if (!bI && b !== null) { p = (p || 0) + b * pk; b = null; }
      if (bI) bI.value = b !== null ? b : ''; pI.value = p !== null ? p : (b !== null ? '' : '0');
      recalc(a); const v = (Number(bI?.value) || 0) * pk + (Number(pI.value) || 0);
      stat.textContent = `✓ ${i.name}: ${b !== null && bI ? b + ' кор. ' : ''}${p !== null ? p + ' шт ' : ''}= ${v}`;
      try { TGA?.HapticFeedback?.impactOccurred('light'); } catch { /* not in Telegram */ }
      nextRow(); sayCur();
    };
    const start = () => {
      if (!on || speaking) return;
      rec = new SR(); rec.lang = vLang() === 'uz' ? 'uz-UZ' : 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 5; rec.continuous = false;
      rec.onresult = e => { const alts = [...e.results[e.results.length - 1]].map(r => r.transcript), t = alts.find(x => hearNums(x).nums.length) || alts[0]; apply(t); };
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); stat.textContent = 'Разрешите доступ к микрофону в настройках браузера'; } };
      rec.onend = () => { if (on && !speaking) setTimeout(() => { if (on && !speaking) start(); }, 250); }; // a new recogniser each time: picks up a changed voice language
      try { rec.start(); } catch { /* already started */ }
    };
    const stop = () => { on = false; speaking = false; clearTimeout(sayT); btn.textContent = '🎤'; btn.classList.remove('sc-live'); try { rec && rec.abort(); } catch { /* stopped */ } };
    const vl = $('#scVl'); if (vl) vl.onclick = () => { const v = vLang() === 'uz' ? 'ru' : 'uz'; store.set('mital_vlang', v); vl.textContent = v.toUpperCase(); stat.textContent = v === 'uz' ? '🎤 Ovoz: oʻzbekcha (sonlarni oʻzbekcha ayting)' : '🎤 Голос: по-русски (числа говорите по-русски)'; if (on && !speaking) { try { rec && rec.abort(); } catch { /* stopped */ } } };
    const tk = $('#scTk'); if (tk) tk.onclick = () => { const v = !talkOn(); store.set('mital_talk', v); tk.textContent = v ? '🔊' : '🔇'; stat.textContent = v ? '🔊 Буду называть товары вслух' : '🔇 Названия вслух выключены'; if (!v) try { speechSynthesis.cancel(); } catch { /* none */ } };
    btn.onclick = () => {
      if (on) { stop(); try { TTS && speechSynthesis.cancel(); } catch { /* none */ } stat.textContent = ''; mark(null); return; }
      on = true; btn.textContent = '⏹'; btn.classList.add('sc-live');
      target(); const r = cur && sel('r', cur); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      stat.textContent = talkOn() ? '🔊 Называю товар — вы говорите количество («5 коробок 3 штуки», «ноль», «дальше», «повтори»)' : '🔴 Слушаю: называйте количество по порядку («5 коробок 3 штуки», «ноль», «дальше»)';
      if (talkOn()) sayCur(); else start();
    };
  }

  function drawCount(body) {
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
      // «Сверить ещё раз» from the supervisor (the auto-loader has already opened today's count again)
      const again = !rec && S.again ? '<p class="neg" style="font-size:17px"><b>🔁 Руководитель просит провести сверку ещё раз — полностью, все товары.</b></p><p class="mut">Считайте внимательно: коробки и штуки, отложенное под заказы тоже.</p>' : '';
      const what = again + (rec ? `<p>По этим товарам цифры не сошлись. Пересчитайте их внимательно ещё раз (${rec.length} поз.) — <b>это последняя попытка</b>:</p><ul>${rec.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul>`
        : S.today ? `<p class="pos"><b>✓ Сегодняшняя сверка отправлена в ${hm(S.today.at)}</b></p><p class="mut">Если нужно — можно пересчитать и отправить заново.</p>`
        : plan ? `<p>Сегодня <b>короткая сверка: ${list.length} товаров</b> из ${plan.total} — те, что двигались со вчерашней сверки, и несколько случайных. Отправьте до <b>${esc(S.deadline || '10:00')}</b>.</p>${S.fullDay ? `<p class="mut">Полная сверка всего склада — в ${DOW[S.fullDay] || 'понедельник'}.</p>` : ''}`
        : `<p>Пересчитайте все товары склада (${list.length} поз.) и отправьте до <b>${esc(S.deadline || '10:00')}</b>. Считайте то, что физически лежит на складе, включая отложенное под заказы.</p>`);
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
    body.innerHTML = `<div class="bar" style="position:sticky;top:52px;z-index:4;background:var(--bg,#eef2f5);padding:8px 0"><input id="scQ" type="search" placeholder="Поиск товара" value="${esc(q)}" style="flex:1;min-width:0">${SR ? `<button class="btn gray" id="scMic" type="button" aria-label="Считать голосом" title="Считать голосом">🎤</button><button class="btn gray sm" id="scVl" type="button" title="Язык голоса">${vLang() === 'uz' ? 'UZ' : 'RU'}</button>${TTS ? `<button class="btn gray sm" id="scTk" type="button" title="Называть товары вслух">${talkOn() ? '🔊' : '🔇'}</button>` : ''}` : ''}<b id="scN">${filled} / ${list.length}</b><small id="scV" class="mut" role="status" style="flex-basis:100%"></small></div>
      <div class="bar"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="scOnly"> только непосчитанные</label><span class="spacer"></span>${rec ? '' : `<button class="btn gray sm" id="scOrd">⇅ Порядок полок</button>`}</div>
      ${panel(rec ? 'Пересчёт' : want ? 'Короткая сверка' : 'Пересчитайте товары', [...groups].map(([g, L]) => `<div class="sc-g">${g ? `<h4 style="margin:14px 0 6px">${esc(g)}</h4>` : ''}${L.map(row).join('')}</div>`).join(''), 'Коробки — в «кор.», россыпь — в «шт», приложение сложит. Товара нет — нажмите «0».' + (SR ? ' 🎤 — считать голосом: называйте количество по порядку. Одно число у товара в коробках — это коробки; со словом «штук» — штуки.' : ' Можно диктовать: микрофон на клавиатуре телефона.'))}
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
    voiceCount(body, list, sel, recalc);
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

  // ---------- a window over the page (contract picture, client card): ✕, a tap outside, Esc or Telegram's «Назад» close it ----------
  function sheet(html, onClose) {
    const bg = document.createElement('div'); bg.className = 'modal-bg me-sheet';
    bg.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><button class="btn gray sm me-x" type="button" aria-label="Закрыть">✕</button>${html}</div>`;
    document.body.appendChild(bg); document.body.style.overflow = 'hidden';
    const close = () => { bg.remove(); if (!document.querySelector('.me-sheet')) document.body.style.overflow = ''; try { if (!document.querySelector('.me-sheet')) TGA?.BackButton?.hide(); TGA?.BackButton?.offClick(close); } catch { /* old Telegram */ } onClose?.(); };
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.me-x')) close(); });
    try { TGA?.BackButton?.show(); TGA?.BackButton?.onClick(close); } catch { /* old Telegram */ }
    return { el: bg.firstElementChild, close };
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const l = [...document.querySelectorAll('.me-sheet')].pop(); l?.querySelector('.me-x')?.click(); } });

  // ---------- the contract as a picture: the same document the supervisor opens in the CRM (drawn there, shown here as is) ----------
  const DOC_W = 718; // 190 mm
  async function docPng(el) {
    const w = Math.ceil(el.offsetWidth), h = Math.ceil(el.offsetHeight), k = 2.5;
    const xml = new XMLSerializer().serializeToString(el.cloneNode(true));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * k)}" height="${Math.round(h * k)}"><foreignObject x="0" y="0" width="${w}" height="${h}" transform="scale(${k})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${S.contracts?.css || ''}</style>${xml}</div></foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('телефон не смог нарисовать картинку')); });
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); if (!blob) throw new Error('картинка не получилась'); return blob;
  }
  function openDoc(key) {
    const K = S.contracts || {}, html = K.docs?.[key]; if (!html) return;
    const o = key[0] === 'o' ? (K.once || []).find(x => 'o' + x.id === key) : null, ct = key[0] === 'k' ? (K.long || []).find(x => 'k' + x.id === key) : null;
    const title = o ? `🧾 Договор №${esc(o.id)} · ${esc(o.client)}` : `📑 ${esc(ct?.title || 'Договор')}`, file = (o ? 'Договор-' + o.id : 'Шартнома-' + (ct?.id || '')) + '.png';
    const canShare = !!(navigator.canShare && navigator.share);
    const m = sheet(`<h3 style="margin:0 36px 8px 0">${title}</h3>
      <div class="bar" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">${canShare ? '<button class="btn sm" type="button" data-dsh>📤 Отправить картинкой</button>' : ''}<button class="btn gray sm" type="button" data-dpng>🖼 Сохранить картинку</button><button class="btn gray sm" type="button" data-dzoom>🔍 Крупнее</button>${o || ct ? `<button class="btn gray sm" type="button" data-cl="${esc((o || ct).client)}">👤 Карточка клиента</button>` : ''}</div>
      <style>${K.css || ''}</style><div class="me-doc"><div class="me-doc-in">${html}</div></div><small class="mut" data-dmsg></small>`);
    const box = m.el.querySelector('.me-doc'), inn = m.el.querySelector('.me-doc-in'), doc = inn.firstElementChild;
    let big = false;
    const fit = () => { const k = big ? 1 : Math.min(1, (box.clientWidth || DOC_W) / DOC_W), h = doc.offsetHeight; inn.style.transform = `scale(${k})`; inn.style.width = DOC_W + 'px'; box.style.height = Math.ceil(h * k) + 'px'; box.style.overflowX = big ? 'auto' : 'hidden'; };
    fit(); setTimeout(fit, 60); addEventListener('resize', fit);
    const off = new MutationObserver(() => { if (!m.el.isConnected) { removeEventListener('resize', fit); off.disconnect(); } }); off.observe(document.body, { childList: true });
    m.el.querySelector('[data-dzoom]').onclick = e => { big = !big; e.target.textContent = big ? '🔍 По ширине экрана' : '🔍 Крупнее'; fit(); };
    const say = t => { m.el.querySelector('[data-dmsg]').textContent = t; };
    const blob = async () => { try { return await docPng(doc); } catch (e) { say('Не получилось сделать картинку: ' + (e.message || e)); return null; } };
    m.el.querySelector('[data-dpng]').onclick = async () => { const b = await blob(); if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); say('Картинка сохранена'); };
    const sh = m.el.querySelector('[data-dsh]'); if (sh) sh.onclick = async () => { const b = await blob(); if (!b) return; const f = new File([b], file, { type: 'image/png' }); try { if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: file.replace('.png', '') }); else say('Этот телефон не умеет отправлять файлы — сохраните картинку'); } catch (e) { if (e.name !== 'AbortError') say('Не получилось отправить: ' + (e.message || e)); } };
  }

  // ---------- the client card (tap a client's name): as the supervisor's card, only for the agent's own clients ----------
  let cardTab = 'ord', cardFrom = '', cardTo = '';
  function openCard(name) {
    const c = S.clients.find(x => x.name === name); if (!c) return;
    const C = S.cards?.[name], K = S.contracts || {};
    if (!cardFrom || cardFrom < (S.period?.from || '')) cardFrom = S.period?.from || ''; if (!cardTo) cardTo = S.period?.to || '';
    const m = sheet(`<div data-cbody></div>`);
    const ST = { paid: ['pos', '✓ оплачен'], late: ['neg', 'просрочен'], today: ['warn', 'срок сегодня'], wait: ['', 'ждём'] };
    const PST = { paid: ['pos', ' ✓'], late: ['neg', ' · просрочено'], today: ['warn', ' · сегодня'], wait: ['', ''] };
    const inR = d => (!cardFrom || d >= cardFrom) && (!cardTo || d <= cardTo);
    const draw1 = () => {
      const docs = K.docs || {}, ctOf = (K.long || []).filter(k => k.client === name && docs['k' + k.id]);
      const tabs = [['ord', '📦 Заказы'], ['pay', '💵 Оплаты'], ['days', '📈 По дням'], ['buy', '🛒 Покупки']];
      let inner = '';
      if (!C) inner = '<p class="mut">Заказы, оплаты и покупки клиента появятся после следующего обновления кабинета руководителем.</p>';
      else if (cardTab === 'ord') {
        const open = C.ord.filter(o => o.st !== 'paid'), paid = C.ord.filter(o => o.st === 'paid' && inR(o.d)), late = open.reduce((t, o) => t + o.parts.filter(p => p.st === 'late').reduce((a, p) => a + p.u, 0), 0);
        const nx = open.flatMap(o => o.parts.filter(p => p.st === 'today' || p.st === 'wait')).sort((a, b) => a.d.localeCompare(b.d))[0];
        const one = o => `<div class="ccard"${docs['o' + o.id] ? ` data-doc="o${esc(o.id)}" role="button" tabindex="0" style="cursor:pointer"` : ''}><div class="top"><b>№${esc(o.id)} от ${dm(o.d)}</b><span class="amt">${$$(o.s)}</span></div>
          <div class="meta"><span class="${ST[o.st]?.[0] || ''}">${ST[o.st]?.[1] || ''}${o.st === 'late' && o.ld ? ` ${o.ld} дн.` : ''}</span>${o.paid > 0.005 ? `<span>оплачено ${$$(o.paid)}</span>` : ''}${o.left > 0.005 ? `<span class="${o.st === 'late' ? 'neg' : ''}"><b>осталось ${$$(o.left)}</b></span>` : ''}${o.spec ? '<span class="pill warn">спец</span>' : ''}${docs['o' + o.id] ? '<span>📄 договор — нажмите</span>' : ''}</div>
          ${o.cond ? `<div class="mut" style="font-size:13px;margin-top:4px">${esc(o.cond)}</div>` : ''}
          <div class="meta" style="margin-top:6px">${o.parts.map(p => `<span class="${PST[p.st]?.[0] || ''}" style="white-space:nowrap">${dm(p.d)} ${$$(p.s)}${p.u > 0.005 && p.u < p.s - 0.005 ? ` (ещё ${$$(p.u)})` : ''}${PST[p.st]?.[1] || ''}</span>`).join('')}</div>
          <div class="mut" style="font-size:12px;margin-top:4px">${o.src === 'agreed' ? '🤝 срок по договорённости' : 'стандартный график'}</div></div>`;
        inner = `<div class="kpis">${tile('Просрочено', $$(late), late > 0.005 ? '' : 'просрочек нет', late > 0.005 ? 'bad' : 'good')}${tile('Ближайший срок', nx ? dm(nx.d) : '—', nx ? `${$$(nx.u)} по заказу` : 'нет ближайших')}${C.old > 0.5 ? tile('Долг прошлых периодов', $$(C.old), 'старые заказы, срок неизвестен', 'bad') : ''}</div>
          ${ctOf.length ? `<div class="bar" style="margin:8px 0">${ctOf.map(k => `<button class="btn gray sm" type="button" data-doc="k${esc(k.id)}">📑 ${esc(k.title)}</button>`).join('')}</div>` : ''}
          ${open.length ? `<h4 class="ch">Не оплачены (${open.length})</h4><div class="cards">${open.map(one).join('')}</div>` : '<p class="pos"><b>✓ Все заказы оплачены</b></p>'}
          ${paid.length ? `<h4 class="ch">Оплачены за выбранные дни (${paid.length})</h4><div class="cards">${paid.map(one).join('')}</div>` : ''}
          <p class="mut" style="font-size:12px">Что оплачено — считается от долга: оплаты закрывают самые старые заказы.</p>`;
      } else if (cardTab === 'pay') {
        const P = C.pay.filter(p => inR(p.d)), tot = P.reduce((t, p) => t + p.s, 0);
        inner = `<p>Оплачено за выбранные дни: <b class="pos">${$$(tot)}</b> · ${P.length} оплат</p>${P.length ? `<div class="tscroll"><table><thead><tr><th>Дата</th><th>Время</th><th class="n">Сумма</th><th>Как</th><th>Принял</th></tr></thead><tbody>${P.map(p => `<tr><td>${dRu(p.d)}</td><td>${esc(p.t)}</td><td class="n"><b class="pos">${$$(p.s)}</b></td><td>${esc(p.how || '—')}</td><td>${esc(p.by)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Оплат в эти дни нет.</p>'}`;
      } else if (cardTab === 'days') {
        const D = C.days.filter(p => inR(p.d)).slice().reverse();
        inner = D.length ? `<div class="tscroll"><table><thead><tr><th>День</th><th class="n">Купил</th><th class="n">Оплатил</th><th class="n">Долг на конец дня</th></tr></thead><tbody>${D.map(p => `<tr><td>${dRu(p.d)}${p.f ? ' <small class="mut">(с начала периода)</small>' : ''}</td><td class="n">${Math.abs(p.ds) > 0.005 ? $$(p.ds) : '—'}</td><td class="n">${Math.abs(p.dp) > 0.005 ? `<b class="pos">${$$(p.dp)}</b>` : '—'}</td><td class="n ${p.b <= -0.5 ? 'neg' : ''}">${Math.abs(p.b) < 0.005 ? '0' : $$(p.b)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">В эти дни данных нет.</p>';
      } else {
        const B = C.buy.filter(l => inR(l.d)), paidL = B.filter(l => !l.g), tot = paidL.reduce((t, l) => t + l.s, 0);
        const byP = new Map(); for (const l of paidL) { const x = byP.get(l.p) || { q: 0, s: 0 }; x.q += l.q; x.s += l.s; byP.set(l.p, x); }
        const brands = [...new Set(paidL.map(l => l.b).filter(Boolean))];
        const byO = new Map(); for (const l of B) (byO.get(l.o) || byO.set(l.o, []).get(l.o)).push(l);
        const R = (C.ret || []).filter(r => inR(r.d));
        inner = `<p>Купил за выбранные дни: <b>${$$(tot)}</b> · ${byO.size} заказ(ов)${brands.length ? ` · бренды: ${brands.map(esc).join(', ')}` : ''}</p>
          ${byP.size ? `<h4 class="ch">Что покупал больше всего</h4><div class="tscroll"><table><thead><tr><th>Товар</th><th class="n">Кол-во</th><th class="n">Сумма</th></tr></thead><tbody>${[...byP].sort((a, b) => b[1].s - a[1].s).slice(0, 15).map(([p, x]) => `<tr><td>${esc(p)}</td><td class="n">${Math.round(x.q * 100) / 100}</td><td class="n">${$$(x.s)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${byO.size ? `<h4 class="ch">По заказам</h4>${[...byO].map(([id, L]) => `<details class="ccard" style="margin-bottom:8px"><summary><b>${dm(L[0].d)} · №${esc(id)}</b> — ${$$(L.reduce((t, l) => t + l.s, 0))} · ${L.length} поз.</summary><div class="tscroll" style="margin-top:6px"><table><tbody>${L.map(l => `<tr><td>${l.g ? '🎁 ' : ''}${esc(l.p)}</td><td class="n">× ${l.q}</td><td class="n">${l.g ? 'бонус' : $$(l.s)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}` : '<p class="mut">Покупок в эти дни нет.</p>'}
          ${R.length ? `<h4 class="ch">Возвраты</h4><p>${R.map(r => `${dm(r.d)} <span class="neg">${$$(r.s)}</span>${r.why ? ` <small class="mut">(${esc(r.why)})</small>` : ''}`).join(' · ')}</p>` : ''}`;
      }
      m.el.querySelector('[data-cbody]').innerHTML = `<h3 style="margin:0 36px 2px 0">${esc(c.name)}</h3><div class="mut">${c.landmark ? '📍 ' + esc(c.landmark) : ''}</div>
        ${c.phone ? `<div class="bar" style="margin:8px 0"><a class="btn sm" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a></div>` : ''}
        <div class="kpis" style="margin-top:8px">${tile('Долг', c.debt > 0 ? $$(c.debt) : 'нет', c.lastPay ? `посл. оплата ${dm(c.lastPay)}` : 'оплат не было', c.debt > 0 ? 'warn' : 'good')}${tile('Купил за период', $$(c.sold), c.plan ? `план ${$$(c.plan)} · ${pctT(pctV(c.sold, c.plan))}` : (c.lastBuy ? `посл. покупка ${dm(c.lastBuy)}` : 'покупок не было'))}${tile('Оплатил за период', $$(c.paid), c.pool ? `пул ${$$(c.pool)} · осталось ${$$(Math.max(0, c.pool - c.paid))}` : '')}${c.promise ? tile('Обещал', dm(c.promise.date), c.promise.sum ? $$(c.promise.sum) : '') : ''}</div>
        <nav class="tabs" style="margin:12px 0 8px">${tabs.map(([k, t]) => `<a href="#" data-ctb="${k}" class="${cardTab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
        ${cardTab !== 'ord' || C ? `<div class="bar" style="gap:6px;margin-bottom:8px;flex-wrap:wrap"><label class="mut" style="display:flex;gap:4px;align-items:center">с <input type="date" data-cf1 value="${esc(cardFrom)}"></label><label class="mut" style="display:flex;gap:4px;align-items:center">по <input type="date" data-cf2 value="${esc(cardTo)}"></label><button class="btn gray sm" type="button" data-cfa>весь период</button></div>` : ''}
        ${inner}`;
      m.el.querySelectorAll('[data-ctb]').forEach(a => a.onclick = e => { e.preventDefault(); cardTab = a.dataset.ctb; draw1(); });
      const f1 = m.el.querySelector('[data-cf1]'), f2 = m.el.querySelector('[data-cf2]'), fa = m.el.querySelector('[data-cfa]');
      if (f1) f1.onchange = () => { cardFrom = f1.value; draw1(); }; if (f2) f2.onchange = () => { cardTo = f2.value; draw1(); };
      if (fa) fa.onclick = () => { cardFrom = S.period?.from || ''; cardTo = S.period?.to || ''; draw1(); };
    };
    draw1();
  }
  // a client's name opens his card, a contract (or the 📄 of an order) its picture — anywhere in the cabinet
  document.addEventListener('click', e => {
    if (!S || e.target.closest('a[href],input,select,textarea,summary')) return;
    const cl = e.target.closest('[data-cl]'); if (cl) { e.preventDefault(); e.stopPropagation(); openCard(cl.dataset.cl); return; }
    const d = e.target.closest('[data-doc]'); if (d && !e.target.closest('button:not([data-doc])')) { e.preventDefault(); openDoc(d.dataset.doc); }
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-doc][role=button]')) { e.preventDefault(); openDoc(e.target.dataset.doc); } });

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
      if (!tgCab || !S.chat) { body.innerHTML = panel('Чат с руководителем', `<p>Чат работает в кабинете внутри Telegram.</p>${chatBtn() ? `<div class="bar">${chatBtn()}</div>` : ''}`); return; }
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
        ${installCard()}${langCard()}${tgCab ? '' : '<button class="btn gray" type="button" data-out="1" style="width:100%;margin-top:4px;padding:12px">🚪 Выйти из аккаунта</button>'}`;
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
      const row = x => `<div class="ccard"><div class="top"><b data-cl="${esc(x.client)}">${esc(x.client)}</b><span class="amt ${ST[x.st][1]}">${$$(x.s)}</span></div>
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
        return `<div class="ccard"><div class="top"><b data-cl="${esc(n)}">${i + 1}. ${esc(n)}</b>${c.debt > 0 ? `<span class="amt neg">${$$(c.debt)}</span>` : '<span class="amt mut">долга нет</span>'}</div>
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
      // search: client, № of the invoice / contract, conditions — one box for both lists
      const ql = q.trim().toLowerCase(), hit = (...v) => !ql || v.some(x => String(x ?? '').toLowerCase().includes(ql));
      const once = (K.once || []).filter(o => hit(o.client, o.id, '№' + o.id, o.cond)), long = (K.long || []).filter(k => hit(k.client, k.title, k.id)), t0 = tashToday();
      const docBtn = key => (K.docs?.[key] ? ` data-doc="${esc(key)}" role="button" tabindex="0" style="cursor:pointer"` : '');
      // two separate sections (one-time orders can be 100+, so the long contracts used to sink to the very bottom)
      if (ctab !== 'once' && ctab !== 'long') ctab = 'once';
      const leftOf = o => o.parts.filter(p => p.st !== 'paid').reduce((t, p) => t + p.s, 0);
      // «⏰ Ближайшие оплаты» — the auto-reminder of the section: everything overdue plus what is due in the next 14 days
      // (if nothing is, the next 3 payments), nearest first
      const dues = ctab === 'once'
        ? once.flatMap(o => o.parts.filter(p => p.st !== 'paid').map(p => ({ client: o.client, d: p.d, s: p.s, late: p.st === 'late', what: `№${o.id}` })))
        : long.flatMap(k => k.months.filter(m => m.st !== 'paid').map(m => ({ client: k.client, d: m.to, s: Math.max(0, m.plan - (m.paid || 0)), late: m.st === 'late', what: k.title })));
      dues.sort((a, b) => (b.late - a.late) || String(a.d).localeCompare(String(b.d)));
      const lim = new Date(Date.parse(t0 + 'T12:00:00Z') + 14 * 864e5).toISOString().slice(0, 10);
      let near = dues.filter(x => x.late || x.d <= lim); if (!near.length) near = dues.slice(0, 3);
      const when = d => { const n = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(t0 + 'T12:00:00Z')) / 864e5); return n < 0 ? `просрочено с ${dm(d)}` : n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `${dm(d)} · через ${n} дн.`; };
      const phone = n => S.clients.find(c => c.name === n)?.phone;
      const nearP = dues.length ? panel(`⏰ Ближайшие оплаты (${near.length})`, `<div class="cards">${near.slice(0, 15).map(x => `<div class="ccard"><div class="top"><b data-cl="${esc(x.client)}">${esc(x.client)}</b><span class="amt ${x.late ? 'neg' : ''}">${$$(x.s)}</span></div>
          <div class="meta"><span class="${x.late ? 'neg' : x.d === t0 ? 'warn' : ''}">${x.late ? '🔴 ' : x.d === t0 ? '🟠 ' : '📅 '}${when(x.d)}</span><span class="mut">${esc(x.what)}</span></div>
          ${phone(x.client) ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(phone(x.client))}">📞 Позвонить</a></div>` : ''}</div>`).join('')}</div>`, `Всего ждём ${$$(dues.reduce((t, x) => t + x.s, 0))} · просрочено ${$$(dues.filter(x => x.late).reduce((t, x) => t + x.s, 0))}`) : '';
      const lateN = L => L.length ? ` <b class="neg">· ${L.length}!</b>` : '';
      const chips = `<div class="bar"><input id="meQ" type="search" placeholder="🔎 Поиск: клиент, № договора" value="${esc(q)}" style="flex:1;min-width:0"></div>
        <div class="chips"><button type="button" data-ct="once" class="${ctab === 'once' ? 'on' : ''}">🧾 Разовые и спец (${once.length})${lateN(once.filter(o => o.parts.some(p => p.st === 'late')))}</button><button type="button" data-ct="long" class="${ctab === 'long' ? 'on' : ''}">📑 Договоры (${long.length})${lateN(long.filter(k => k.months.some(m => m.st === 'late')))}</button></div>`;
      const onceS = [...once.filter(leftOf), ...once.filter(o => !leftOf(o))];
      const none = what => `<p class="mut">${ql ? `По запросу «${esc(q)}» ничего не найдено.` : `${what} нет.`}</p>`;
      const tapHint = K.docs && Object.keys(K.docs).length ? ' Нажмите на договор — откроется его картинка, на имя клиента — карточка клиента.' : '';
      body.innerHTML = chips + (ql ? '' : nearP) + (ctab === 'once' ? `${panel(`🧾 Разовые договоры и спецпредложения (${once.length})`, once.length ? `<div class="cards">${onceS.map(o => { const left = leftOf(o);
          return `<div class="ccard"${docBtn('o' + o.id)}><div class="top"><b data-cl="${esc(o.client)}">${esc(o.client)}</b><span class="amt">${$$(o.s)}</span></div>
            <div class="meta"><span>№${esc(o.id)} от ${dm(o.d)}</span>${o.spec ? '<span class="pill warn">спецпредложение</span>' : ''}${o.disc != null ? `<span>скидка ${esc(o.disc)}%</span>` : ''}${left ? `<span class="${o.parts.some(p => p.st === 'late') ? 'neg' : ''}">осталось ${$$(left)}</span>` : '<span class="pos">оплачено полностью</span>'}</div>
            ${o.cond ? `<div class="mut" style="font-size:13px;margin-top:4px">${esc(o.cond)}</div>` : ''}<div class="meta" style="margin-top:6px">${o.parts.map(part).join('')}</div></div>`; }).join('')}</div>` : none('Разовых договоров'), 'Каждый заказ на спеццене платится по своему графику — по частям. Красным — просроченные части.' + tapHint)}` : '')
        + (ctab === 'long' ? `${panel(`📑 Большие договоры (${long.length})`, long.length ? `<div class="cards">${long.map(k => { const late = k.months.filter(m => m.st === 'late'), tot = k.months.reduce((t, m) => t + m.plan, 0), paid = k.months.reduce((t, m) => t + (m.paid || 0), 0);
          return `<div class="ccard"${docBtn('k' + k.id)}><div class="top"><b>${esc(k.title)}</b><span class="amt">${$$(tot)}</span></div>
            <div class="meta"><span data-cl="${esc(k.client)}">👤 ${esc(k.client)}</span><span>с ${dm(k.start)} · ${k.months.length} мес.</span><span>оплачено ${$$(paid)}</span>${late.length ? `<span class="neg">просрочено месяцев: ${late.length}</span>` : ''}</div>
            <div class="meta" style="margin-top:6px">${k.months.map(m => part({ ...m, d: m.to })).join('')}</div></div>`; }).join('')}</div>` : none('Больших договоров'), 'Сумма месяца должна прийти до последнего дня этого месяца договора.' + tapHint)}` : '');
      body.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { ctab = b.dataset.ct; store.set('mital_ctab', ctab); draw(); window.scrollTo(0, 0); });
      search();
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
        ${top.length ? panel('Кому собрать в первую очередь', `<div class="cards">${top.map(c => `<div class="ccard"><div class="top"><b data-cl="${esc(c.name)}">${esc(c.name)}</b><span class="amt neg">${$$(c.debt)}</span></div><div class="meta">${c.pool ? `<span>по пулу осталось ${$$(Math.max(0, c.pool - c.paid))}</span>` : ''}${c.promise ? `<span>🤝 обещал ${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}</span>` : ''}${c.lastPay ? `<span>посл. оплата ${dm(c.lastPay)}</span>` : ''}</div>${c.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(c.phone)}">📞 Позвонить</a></div>` : ''}</div>`).join('')}</div>`) : ''}
        ${sleep.length ? panel('🛒 Давно не покупали — предложите заказ', `<div class="cards">${sleep.map(c => `<div class="ccard"><div class="top"><b data-cl="${esc(c.name)}">${esc(c.name)}</b><span class="amt">${c.buyDays} дн.</span></div><div class="meta">${c.lastBuy ? `<span>посл. покупка ${dm(c.lastBuy)}</span>` : ''}${c.debt > 0 ? `<span class="neg">долг ${$$(c.debt)}</span>` : '<span class="pos">долга нет</span>'}${c.landmark ? `<span>${esc(c.landmark)}</span>` : ''}</div>${c.phone ? `<div class="acts"><a class="btn gray sm" href="tel:${esc(c.phone)}">📞 Позвонить</a></div>` : ''}</div>`).join('')}</div>`, 'Эти клиенты брали товар, но перестали — каждый вернувшийся клиент поднимает и продажи, и АКБ.') : ''}
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
        ${panel(`Мои клиенты (${f0(L.length)})`, L.length ? `<div class="cards">${L.map(c => `<div class="ccard"><div class="top"><b data-cl="${esc(c.name)}">${esc(c.name)}</b><span class="amt ${c.debt > 0 ? 'neg' : 'mut'}">${c.debt > 0 ? $$(c.debt) : 'долга нет'}</span></div>
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
    document.addEventListener('click', e => { if (e.target.closest('[data-chat]') && tgCab) { try { TGA.close(); } catch { /* old Telegram */ } } });
    document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (!g) return; e.preventDefault(); tab = g.dataset.go; doing = null; draw(); scrollTo(0, 0); });
    $('#meUpd').onclick = load;
    // header: language switch and «install» (shown when the browser offers it)
    const lb = document.createElement('button'); lb.type = 'button'; lb.textContent = lang === 'uz' ? 'RU' : 'UZ'; lb.title = lang === 'uz' ? 'Русский' : 'Oʻzbekcha'; lb.onclick = () => setLang(lang === 'uz' ? 'ru' : 'uz');
    const ib = document.createElement('button'); ib.type = 'button'; ib.id = 'meInst'; ib.textContent = '📲'; ib.title = 'Установить приложение'; ib.hidden = !installEv || standalone(); ib.onclick = install;
    $('#meUpd').before(ib, lb);
    // «Выйти» in the header (only the icon on the phone, so it always fits) — and a full button in «Ещё». Not inside Telegram:
    // there the cabinet is opened by the bot, without a login (the MITAL CRM bot's «Панель» does sign in: logout is shown)
    if (!tgCab) {
      const out = document.createElement('button'); out.type = 'button'; out.id = 'meOut'; out.innerHTML = '🚪<span class="lbl"> Выйти</span>'; out.title = 'Выйти из аккаунта'; out.setAttribute('aria-label', 'Выйти из аккаунта'); $('#meUpd').after(out);
      out.onclick = logout;
    }
    // links inside Telegram: t.me opens in Telegram itself (the chat), other links in the browser — not inside the small app window
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="http"]'); if (!a || !inTg) return; e.preventDefault(); if (a.href.startsWith('https://t.me/')) TGA.openTelegramLink(a.href); else TGA.openLink(a.href); });
    draw(); load();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && Date.now() - Date.parse(S.at || 0) > 10 * 60000) load(); });
  });
})();
