// Live data: the open CRM takes what is new by itself every 30 seconds — «🔄 Обновить» is no longer needed.
// 1) the cloud copy: changes made on another device (GitHub answers a tiny 304 when nothing changed — it does not count towards the limit);
// 2) the files of the Google auto-loader (stock, client balance, the 30-minute sections) — the same 304 when unchanged;
// 3) today's orders, goods, payments, returns, refusals, debts, agents' day and order statuses straight from LINKO
//    (sections marked "live" in linko-jobs.json): LINKO lets the browser ask it directly, so this needs neither GitHub
//    nor the Google script and its daily limits. These rows stay in this device's memory and are never sent to the cloud,
//    so devices cannot get into a «choose a version» conflict over them. Needs the LINKO key on the device: the computer
//    gets it from the «⚡ В MITAL CRM» bookmark, a phone from the link / QR code in «Синхронизация и настройки».
// The page is redrawn only when something new came, never while you type, have a window open or touched the page
// in the last 8 seconds; it is drawn aside and swapped in whole, so it does not blink and keeps its scroll.
window.LIVE = (() => {
  const EVERY = 30000, QUIET = 8000, STALE = 10 * 60000, API = 'https://mital.linko.uz/ru/api/v1/';
  let lastUse = 0, running = false, drawing = false, owed = false, err = '', okAt = 0, timer = null;
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(e, () => { lastUse = Date.now(); }, { passive: true, capture: true });

  const key = () => { try { return localStorage.getItem('crm_linko_key') || ''; } catch { return ''; } };
  const busyUser = () => {
    const ae = document.activeElement;
    return !!((ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) || document.querySelector('.modal-bg, dialog[open], #cloudConflict')
      || String(window.getSelection?.() || '') || Date.now() - lastUse < QUIET);
  };

  // one LINKO API answer; LINKO's "next" links may say http:// — the browser would block them on this https page
  async function api(path) {
    const k = key(); if (!k) throw new Error('нет ключа LINKO на этом устройстве');
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 20000);
    try {
      let r;
      try { r = await fetch((/^https?:/.test(path) ? path : API + path).replace(/^http:\/\//, 'https://'), { headers: { Authorization: 'Token ' + k }, cache: 'no-store', signal: ac.signal }); }
      catch (e) { throw new Error(e.name === 'AbortError' ? 'LINKO не ответил за 20 с' : 'нет связи с LINKO'); }
      if (r.status === 401) throw Object.assign(new Error('LINKO не принял ключ — нажмите закладку «⚡ В MITAL CRM» в LINKO'), { auth: true });
      if (!r.ok) throw new Error('LINKO ответил ' + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  async function rows(path) {
    let out = [], next = path, n = 0;
    while (next && n++ < 40) {
      const j = await api(next);
      if (Array.isArray(j)) { out = out.concat(j); next = null; } else if (j && Array.isArray(j.results)) { out = out.concat(j.results); next = j.next || null; } else { out.push(j); next = null; }
    }
    return out;
  }

  // today's live sections, all at once; a section that failed keeps its previous live rows
  async function pull() {
    if (!key()) return false;
    const jobs = (await LX.load()).filter(j => j.live), day = UI.localDate(Date.now()), at = new Date().toISOString();
    if (!jobs.length) return false;
    const prev = LX.live && LX.live.day === day ? LX.live : null, data = {}, date = {}, src = {};
    const res = await Promise.allSettled(jobs.map(j => rows(LX.fill(j.path, day, day))));
    let auth = null, fails = 0;
    jobs.forEach((j, i) => {
      if (typeof j.live === 'string') date[j.id] = j.live;
      src[j.id] = j.every && j.every < 30 ? 'fast' : 'extra';
      const r = res[i];
      if (r.status === 'fulfilled') data[j.id] = r.value.map(x => LX.pick(x, j.pick));
      else { fails++; if (r.reason?.auth) auth = r.reason; if (prev?.data[j.id]) data[j.id] = prev.data[j.id]; }
    });
    if (auth || fails === jobs.length) { err = String((auth || res.find(r => r.status === 'rejected').reason).message); return false; }
    err = fails ? `LINKO не отдал ${fails} из ${jobs.length} разделов` : ''; okAt = Date.now();
    const s = JSON.stringify(data);
    if (prev && prev.s === s) { prev.at = at; return false; } // nothing new: only the time of the check moves
    LX.live = { v: (LX.live?.v || 0) + 1, at, day, data, date, src, s };
    LX.cache = null; if (window.VZ) VZ._refs = null;
    return true;
  }

  // ---------- redraw: the page is drawn into a hidden copy next to the old one and swapped in when it has settled ----------
  const scrolls = root => [...root.querySelectorAll('*')].map((e, i) => [i, e.scrollTop, e.scrollLeft]).filter(x => x[1] || x[2]);
  async function redraw() {
    if (busyUser() || drawing) { owed = true; return; }
    const old = document.getElementById('page');
    if (!old || typeof route !== 'function') return;
    owed = false; drawing = true;
    const keep = scrolls(old), y = scrollY, fresh = old.cloneNode(false);
    // the same width as the page, so tables and charts measure themselves right
    fresh.style.cssText += `;position:absolute;left:-300vw;top:0;width:${old.getBoundingClientRect().width}px;visibility:hidden;pointer-events:none`;
    old.id = 'page-old'; fresh.id = 'page';
    old.parentNode.insertBefore(fresh, old); // before the old one: a lookup by id finds the new page first
    try {
      const done = new Promise(res => {
        let q = null;
        const fin = () => { clearTimeout(t); clearTimeout(q); mo.disconnect(); res(); };
        const t = setTimeout(fin, 6000), mo = new MutationObserver(() => { clearTimeout(q); q = setTimeout(fin, 300); });
        mo.observe(fresh, { childList: true, subtree: true, characterData: true });
        q = setTimeout(fin, 600);
      });
      try { route(); } catch (e) { console.warn('live redraw', e); }
      await done;
      if (!old.isConnected || !fresh.isConnected) { fresh.remove(); if (old.isConnected) old.id = 'page'; return; }
      for (const p of ['position', 'left', 'top', 'width', 'visibility', 'pointerEvents']) fresh.style[p] = '';
      old.remove();
      scrollTo(scrollX, y);
      const all = [...fresh.querySelectorAll('*')];
      for (const [i, t, l] of keep) if (all[i]) { all[i].scrollTop = t; all[i].scrollLeft = l; }
      dispatchEvent(new Event('crm:refresh'));
    } finally { drawing = false; }
  }

  // ---------- one check ----------
  async function tick() {
    if (running || document.visibilityState !== 'visible' || !window.CRMLocal) return;
    running = true; let changed = false;
    try {
      await CRMLocal.ready;
      const idle = !busyUser(), st = window.CLOUD?.on() ? CLOUD.status() : null;
      // the cloud copy first: when another device already loaded the new LINKO file, this one takes it from there instead of loading it again
      if (st && idle && !st.dirty && st.status !== 'conflict' && st.status !== 'error') await CLOUD.sync({ quiet: true });
      if (st && idle && CLOUD.status().status !== 'conflict' && window.LINKO_AUTO) { LINKO_AUTO.lastTry = 0; changed = (await LINKO_AUTO.check({ quiet: true })) || changed; }
      try { changed = (await pull()) || changed; } catch (e) { err = String(e.message || e); }
      if (window.VZ?.refresh && /^#\/visits/.test(location.hash)) changed = (await VZ.refresh()) || changed;
    } catch (e) { console.warn('live', e); }
    finally { running = false; paint(); }
    if (changed || owed) redraw();
  }
  addEventListener('crm:adopted', () => { owed = true; });

  // ---------- the top-bar button shows how fresh the LINKO data is ----------
  const hm = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; };
  function paint() {
    const b = document.getElementById('refreshBtn'); if (!b || b.disabled || !window.CRMLocal?.engine) return;
    const la = CRMLocal.ext().linkoAuto || {}, files = LX.payAt?.() || la.importedAt || '', live = okAt && Date.now() - okAt < 3 * EVERY;
    const h = new Date().getHours(), work = h >= 7 && h <= 22, fileAge = files ? Date.now() - Date.parse(files) : Infinity;
    const state = live ? (err ? 'warn' : 'ok') : !work ? 'ok' : fileAge > STALE || la.error ? 'bad' : 'warn';
    b.classList.remove('lv-ok', 'lv-warn', 'lv-bad'); b.classList.add('lv-' + state);
    b.querySelector('.rt').textContent = live ? 'LINKO · сейчас' : files ? 'LINKO ' + hm(files) : 'Обновить';
    b.title = (live ? `Сегодняшние заказы, оплаты, долги, возвраты и работа агентов — прямо из LINKO, проверено в ${hm(okAt)}, дальше каждые 30 секунд.`
      : key() ? `Прямо из LINKO сейчас не получается: ${err || 'ещё не проверено'}.` : 'На этом устройстве нет ключа LINKO — данные приходят из автозагрузки раз в 5 минут. Телефон: откройте ссылку или QR-код из «Синхронизация и настройки».')
      + `\nОстатки и баланс клиентов (автозагрузка): ${hm(la.importedAt) || 'нет данных'}${la.error ? ' — ошибка: ' + la.error : ''}\nНажмите, чтобы обновить всё прямо сейчас.`;
  }

  const start = () => { clearInterval(timer); timer = setInterval(tick, EVERY); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); start(); } });
  addEventListener('load', () => { setTimeout(tick, 6000); start(); setInterval(() => { paint(); if (owed && !busyUser()) redraw(); }, 5000); });

  return { tick, pull, api, rows, key, paint, redraw, status: () => ({ okAt, err, live: LX.live }) };
})();
