// Browser-only mode: replaces the server. The pages in public/ call fetch('/api/...'); this file answers those calls from the in-browser
// engine (static/engine.js, bundled as window.CRMEngine) and keeps all data in IndexedDB on this device. No server, no login.
(() => {
  const DB = 'mital-crm', STORE = 'state', KEY = 'v1';
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const idbGet = async () => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  const idbPut = async v => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, KEY); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); };

  let engine = null, timer = null, dirty = false, lastSaved = null, saveError = null;
  const flush = async () => {
    if (!dirty || !engine) return;
    dirty = false; clearTimeout(timer);
    try { await idbPut(engine.getState()); lastSaved = new Date(); saveError = null; window.CLOUD?.changed(); }
    catch (e) { saveError = e; dirty = true; if (typeof toast === 'function') toast('Не удалось сохранить данные в браузере: ' + (e.message || e) + '. Скачайте резервную копию (раздел «Данные»).'); }
  };
  const schedule = () => { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 250); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // the page can read the engine only after the stored state is loaded
  const ready = (async () => {
    let state;
    try { state = await idbGet(); } catch { state = undefined; }
    try { engine = CRMEngine.createEngine({ state, onChange: schedule }); }
    catch { engine = CRMEngine.createEngine({ onChange: schedule }); } // unreadable stored state: start empty (a backup file can be restored)
    try { navigator.storage?.persist?.(); } catch { /* optional */ }
    graceFix();
  })();


  // ---------- the first days of a plan period (the 16th and the 17th) are extra days for the PREVIOUS period's money ----------
  // Everything clients pay on the 16th–17th counts for the period that ended on the 15th; collection of the new period starts on the 18th.
  // Sales of the 16th–17th stay in the new period. The team moves those payments to the 15th in LINKO itself, so once that is done LINKO's
  // numbers are already right and the CRM must show them as they are. The CRM only takes out what LINKO still shows on the 16th–17th.
  // The rows keep LINKO's own numbers in paid0 / sold0 / ret0, so the shift is recomputed from scratch every time and never applied twice.
  //  • new period uploads through the 17th: paid = 0 (all of it is money of the previous period)
  //  • new period uploads from the 18th: paid = LINKO paid − what LINKO still shows paid on the 16th–17th, taken from the balance 16.11–17.11
  //    that came in the SAME auto-loader run (a snapshot from an earlier day is stale: the money may have been moved to the 15th since —
  //    that is exactly how «Сбор денег −16 000» appeared). The amount is frozen on the upload (u.grace), so history never shifts.
  //    No fresh balance for those days — LINKO's number as it is.
  //  • the previous period «16.10–16.11» from LINKO: sales/returns without the 16th, paid as LINKO shows it + payments still dated the 17th
  //  • no such file: a final upload of the previous period is built from its last upload (15.10) + payments of the 16th
  const GRACE = {
    DAYS: 2, // the 16th and the 17th
    SAME: 2 * 60000, // files of one auto-loader run are imported within seconds of each other (runs are 5 minutes apart)
    same: (a, b) => !!(a && b) && Math.abs((Date.parse(a.uploaded_at || '') || 0) - (Date.parse(b.uploaded_at || '') || -1e15)) <= GRACE.SAME,
    col: (u, k) => new Map(u ? u.rows.map(r => [r.client, GRACE.raw(r, k)]) : []),
    nz: m => { const o = {}; for (const [c, v] of m) if (Math.abs(v) > 1e-9) o[c] = Math.round(v * 1e6) / 1e6; return o; },
    day: (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
    end(pf) { const y = +pf.slice(0, 4), m = +pf.slice(5, 7), d = +pf.slice(8, 10), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), t = new Date(Date.UTC(y, m, Math.min(d, dim))); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); },
    raw: (r, k) => (r[k + '0'] !== undefined ? r[k + '0'] : r[k] || 0),
    // writes the shifted value, keeping LINKO's own number in <k>0; without a shift the LINKO number comes back
    set(r, k, v) {
      v = Math.round(v * 1e6) / 1e6; const raw = GRACE.raw(r, k);
      if (Math.abs(v - raw) < 1e-6) { if (r[k + '0'] === undefined) return false; r[k] = raw; delete r[k + '0']; return true; }
      if (r[k + '0'] === undefined) r[k + '0'] = r[k] || 0;
      if (r[k] === v) return false; r[k] = v; return true;
    },
    sums(u) { const t = k => u.rows.reduce((a, r) => a + (r[k] || 0), 0); u.sold = t('sold'); u.paid = t('paid'); u.returned = t('ret'); u.b1 = t('b1'); u.clients = u.rows.length; },
    latest: list => list.slice().sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0] || null,
    fix(S) {
      const U = S.ag.uploads; let changed = false;
      const real = U.filter(u => !u.synth), periods = [...new Set(real.map(u => u.period_from))].sort(), keepSynth = new Set();
      const touched = new Set();
      for (const P of periods) {
        const O = periods.filter(p => p < P).pop();
        const ok = O && GRACE.day(GRACE.end(O), 1) === P; // the previous period ends the day before P
        const mine = real.filter(u => u.period_from === P), last = GRACE.day(P, GRACE.DAYS - 1);
        const day1 = GRACE.latest(mine.filter(u => u.period_to === P && u.taken_at === P));
        const win = last > P ? GRACE.latest(mine.filter(u => u.period_to === last && u.taken_at === last)) : day1; // LINKO balance 16.11–17.11
        const G = GRACE.col(day1, 'paid'), S16 = GRACE.col(day1, 'sold'), R16 = GRACE.col(day1, 'ret'), B16 = new Map(day1 ? day1.rows.map(r => [r.client, r.b1]) : []);
        // new period: no money through the 17th; later — without what LINKO still shows on the 16th–17th
        for (const u of mine) {
          let g = null;
          if (u.period_to > last) {
            if (u.grace?.v === 2) g = u.grace.g;
            else if (win && GRACE.same(win, u)) { g = GRACE.nz(GRACE.col(win, 'paid')); u.grace = { v: 2, at: win.uploaded_at, g }; changed = true; }
          }
          let ch = false;
          for (const r of u.rows) { const raw = GRACE.raw(r, 'paid'); ch = GRACE.set(r, 'paid', u.period_to <= last ? 0 : raw - (g?.[r.client] || 0)) || ch; }
          if (ch) { touched.add(u); changed = true; }
        }
        if (!ok) continue;
        // the previous period through the 16th straight from LINKO: its sales and returns without the 16th; payments still dated the 17th are added
        const ext = real.filter(x => x.period_from === O && x.period_to === P);
        for (const u of ext) {
          let l = null;
          if (u.grace?.v === 2) l = u.grace.g;
          else if (last > P && win && day1 && GRACE.same(win, u) && GRACE.same(day1, u)) { const w = GRACE.col(win, 'paid'); for (const [c, v] of G) w.set(c, (w.get(c) || 0) - v); l = GRACE.nz(w); u.grace = { v: 2, at: win.uploaded_at, g: l }; changed = true; }
          let ch = false;
          for (const r of u.rows) {
            ch = GRACE.set(r, 'sold', GRACE.raw(r, 'sold') - (S16.get(r.client) || 0)) || ch; ch = GRACE.set(r, 'ret', GRACE.raw(r, 'ret') - (R16.get(r.client) || 0)) || ch;
            ch = GRACE.set(r, 'paid', GRACE.raw(r, 'paid') + (l?.[r.client] || 0)) || ch;
          }
          if (ch) { touched.add(u); changed = true; }
        }
        if (ext.length || !day1) continue;
        // no such file: build the final of the previous period from its last upload + payments of the 16th
        const end = GRACE.end(O), base = GRACE.latest(real.filter(u => u.period_from === O && u.taken_at <= end));
        if (!base) continue;
        const sig = `${base.id}|${base.uploaded_at || ''}|${day1.id}|${day1.uploaded_at || ''}`;
        let syn = U.find(u => u.synth && u.period_from === O && u.period_to === P);
        keepSynth.add(syn);
        if (syn && syn.sig === sig) { if (syn.snap_at !== (day1.snap_at || null)) { syn.snap_at = day1.snap_at || null; changed = true; } continue; }
        const rows = base.rows.map(r => { const g = G.get(r.client) || 0; return { client: r.client, agent: r.agent, b0: r.b0, sold: r.sold, ret: r.ret, paid: (r.paid || 0) + g, other_in: r.other_in || 0, other_out: r.other_out || 0, b1: B16.has(r.client) ? B16.get(r.client) : (r.b1 || 0) + g }; });
        const inBase = new Set(base.rows.map(r => r.client));
        for (const r of day1.rows) if (!inBase.has(r.client) && (G.get(r.client) || 0)) rows.push({ client: r.client, agent: r.agent, b0: r.b0, sold: 0, ret: 0, paid: G.get(r.client), other_in: 0, other_out: 0, b1: r.b1 });
        if (!syn) { syn = { id: ++S.seq.ag, synth: true }; U.push(syn); keepSynth.add(syn); }
        Object.assign(syn, { taken_at: P, period_from: O, period_to: P, sig, base_id: base.id, day1_id: day1.id, file: `Итог периода (авто): по ${end} + оплаты ${P}`, uploaded_at: day1.uploaded_at || base.uploaded_at, uploaded_by: 'авто', snap_at: day1.snap_at || null, rows });
        GRACE.sums(syn); changed = true;
      }
      // a final that is no longer needed (LINKO file came, or its base / 16th was deleted)
      const before = U.length; S.ag.uploads = U.filter(u => !u.synth || keepSynth.has(u)); if (S.ag.uploads.length !== before) changed = true;
      for (const u of touched) GRACE.sums(u);
      return changed;
    },
  };
  const graceFix = () => { try { if (engine && GRACE.fix(engine.getState())) schedule(); } catch (e) { console.warn('grace', e); } };

  // plans set per agent for a plan period (Лидерборд → «Планы агентов») replace the sum of the clients' plans
  function applyAgentPlans(d) {
    if (!d || d.empty || !d.upload || !engine) return d;
    const P = engine.getState().ext?.agentPlans?.[d.upload.period_from];
    if (!P) return d;
    const fc = d.forecast || {}, dl = Math.max(fc.days_left || 0, 1);
    for (const a of d.agents) {
      const p = P[a.agent]; if (!p) continue;
      if (p.plan > 0) a.plan = p.plan;
      if (p.pool > 0) a.pool = p.pool;
      if (fc.projectable) { a.need_sell_day = Math.max(0, a.plan - a.sold) / dl; a.need_collect_day = Math.max(0, a.pool - a.paid) / dl; }
    }
    return d;
  }

  // add-ons (cloud sync, reports, AI, Telegram) reach the data through this object
  window.CRMLocal = {
    ready,
    get engine() { return engine; },
    flush: async () => { dirty = true; await flush(); },
    touch: schedule, // call after changing engine.getState().ext directly
    save: flush, // write a pending change now (nothing to do when there is none)
    // a change the CRM makes by itself (the discipline log, «rules sent at», marks pulled from the cabinets…): it does not count as
    // your edit, so two open tabs or devices do not get the «choose a version» question over it (cloud.js takes the cloud copy then).
    // When an edit of yours is still waiting to be saved, everything stays yours — nothing of yours can be dropped.
    autoTouch: () => (window.CLOUD?.auto && !dirty ? CLOUD.auto(async () => schedule()).catch(() => {}) : schedule()),
    ext: () => engine.getState().ext,
    // replace everything with a state that came from the cloud: saved locally, but not sent back
    replaceFromCloud: async st => { engine.importState(st); GRACE.fix(engine.getState()); dirty = false; clearTimeout(timer); await idbPut(engine.getState()); lastSaved = new Date(); },
    grace: GRACE,
    request: (method, path, body) => engine.request(method, path, { json: body || {} }).then(r => (method === 'POST' && /^\/api\/ag\/(upload|uploads\/)/.test(path) && graceFix(), r)).then(r => (path.startsWith('/api/ag/dashboard') ? applyAgentPlans(r.json) : r.json)),
  };

  const ME = { name: 'Вы', login: 'local', role: 'Владелец', branch: '', demo: false, perms: ['stock.view', 'stock.edit', 'agents.view', 'agents.edit'] };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, opts = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.includes('/api/')) return realFetch(input, opts);
    const path = url.pathname.slice(url.pathname.indexOf('/api/')) + url.search;
    await ready;
    if (path === '/api/me') return json(ME);
    if (path === '/api/branches') return json([]);
    if (path === '/api/logout') return json({ ok: true });
    const method = (opts.method || 'GET').toUpperCase(), body = opts.body;
    let req = {};
    if (body instanceof Blob) req = { raw: new Uint8Array(await body.arrayBuffer()) };
    else if (typeof body === 'string' && body) { try { req = { json: JSON.parse(body) }; } catch { return json({ error: 'Некорректный запрос' }, 400); } }
    const r = await engine.request(method, path, req);
    if (method === 'POST' && /^\/api\/ag\/(upload|uploads\/)/.test(path)) graceFix();
    return json(path.startsWith('/api/ag/dashboard') ? applyAgentPlans(r.json) : r.json, r.status);
  };
  try { localStorage.setItem('token', 'local'); } catch { /* storage blocked: the page will show the sign-in form */ }

  // ---------- menu: only the two sections that work without a server, plus the data page ----------
  // The menu (2026-11-20): 7 sections, 16 entries, one line per hub. An entry whose route opens a hub (HUBS) shows the hub's tabs
  // above the page, so related screens live together instead of as separate menu lines (Спецпредложения, Сроки, Календарь оплат,
  // Страница агента and Сверка складов are tabs of their hubs now; every screen is also found by the quick search, Ctrl+K).
  window.EXT_MENU = {
    'Сегодня': { '': [['Пульс', 'pulse'], ['Мой день', 'my'], ['Сигналы', 'signals']] },
    'Деньги': { '': [['Дебиторка', 'collect'], ['Оплаты', 'lxpay'], ['Договоры', 'contracts']] },
    'Продажи': { '': [['Заказы по дням', 'lxday'], ['Клиенты и план', 'aclients'], ['Рост продаж', 'abc']] },
    'Команда': { '': [['Лидерборд', 'leaders'], ['Контроль агентов', 'disc'], ['Задания', 'atk'], ['Зарплата', 'pay']] },
    'Склад': { '': [['Склад', 'whstock']] },
    'Анализ': { '': [['Аналитика', 'ranalytics']] },
    'Настройки': { '': [['Настройки', 'cloud']] },
  };
  window.HUBS = [
    [['my', 'Мой день'], ['dayplan', 'План агентов на день']],
    [['collect', 'Очередь сбора'], ['lbal', '⚡ Баланс сейчас'], ['debt', 'Должники по агентам'], ['lxage', 'Просрочка'], ['rdebt', 'План сбора'], ['debtprev', 'Прошлый период']],
    [['lxpay', 'Оплаты по дням'], ['pcal', 'Календарь оплат']],
    [['contracts', 'Договоры'], ['specs', 'Спецпредложения'], ['invo', 'Накладные: сроки'], ['inst', 'Рассрочка'], ['credit', 'Кредитный стоп']],
    [['leaders', 'Лидерборд'], ['agents', 'Сводка'], ['agent', 'Страница агента']],
    [['disc', 'Дисциплина'], ['gps', 'Где агенты'], ['visits', 'Визиты'], ['amap', 'Маршруты']],
    [['atk', 'Задания агентам'], ['atasks', 'Задания по клиентам']],
    [['abc', 'ABC клиентов'], ['anew', 'Новые точки'], ['rsleep', 'Спящие клиенты'], ['wake', 'Возврат спящих'], ['assort', 'Ассортимент'], ['lxcross', 'Кому что предложить'], ['lxbrand', 'Бренды и товары']],
    [['whstock', 'Остатки'], ['whlow', 'Заканчивается'], ['whmove', 'Движение'], ['wcount', 'Сверка складов'], ['whorder', 'Заявка в Ташкент'], ['wh', 'Обзор']],
    [['ranalytics', 'Аналитика'], ['rdyn', 'По периодам'], ['rdays', 'По дням и неделям'], ['lxprof', 'Прибыль по товарам'], ['ai', 'ИИ-ассистент']],
    [['cloud', 'Синхронизация'], ['users', 'Пользователи'], ['tg', 'Telegram агентам'], ['access', 'Доступ агентов'], ['chat', 'Чаты Telegram'], ['up', 'Загрузить вручную'], ['aup', 'Загрузки баланса'], ['whup', 'Загрузки склада'], ['archive', 'Архив'], ['data', 'Резервная копия']],
  ];
  window.MENU_OPTIONAL = {};
  window.MENU_HIDDEN = r => { if (!(r in MENU_OPTIONAL)) return false; let on = []; try { on = JSON.parse(localStorage.getItem('crm_menu_extra') || '[]'); } catch { /* none */ } return !on.includes(r); };

  document.documentElement.classList.add('static-mode');

  // ---------- backup / restore page ----------
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const stamp = () => new Date().toISOString().slice(0, 10);
  window.EXT_PAGES = window.EXT_PAGES || {};
  window.EXT_PAGES.data = async el => {
    await ready; await flush();
    const s = engine.summary(), empty = !s.wh && !s.ag;
    const persisted = await (navigator.storage?.persisted?.() ?? Promise.resolve(false)).catch(() => false);
    let usage = '';
    try { const e = await navigator.storage?.estimate?.(); if (e?.usage) usage = ` · занято в браузере: ${(e.usage / 1048576).toFixed(1)} МБ`; } catch { /* optional */ }
    el.innerHTML = `<div class="page-head"><div><h2>Резервная копия</h2><div class="sub">${window.CLOUD?.on() ? 'Данные хранятся в браузере и синхронизируются с облаком' : 'Данные хранятся только в этом браузере — включите синхронизацию в «Данные → Синхронизация и настройки»'}${usage}</div></div></div>
      <div class="grid">
      ${UI.panel('Что сохранено', `<div class="kpis" style="margin:0">
        ${UI.tile('Загрузок склада', UI.fmt0(s.wh))}${UI.tile('Загрузок по агентам', UI.fmt0(s.ag))}${UI.tile('Клиентов', UI.fmt0(s.clients))}${UI.tile('Заданий', UI.fmt0(s.tasks))}</div>
        <p class="mut" style="margin:12px 0 0">${saveError ? '<b class="neg">Последнее сохранение не удалось — скачайте копию.</b>' : lastSaved ? 'Сохранено в браузере.' : 'Изменения сохраняются в браузере автоматически.'}
        ${persisted ? '' : ' Если очистить данные сайтов в браузере, эти данные пропадут — поэтому время от времени скачивайте копию.'}</p>`, { cls: 'w12' })}
      ${UI.panel('Скачать копию', `<p class="mut" style="margin-top:0">Файл со всеми загрузками, заданиями и настройками. Храните его на компьютере или в облаке — по нему можно восстановить всё на любом устройстве.</p>
        <button class="btn" id="bk">⬇ Скачать резервную копию</button>`, { cls: 'w6' })}
      ${UI.panel('Восстановить из копии', `<p class="mut" style="margin-top:0">Выберите ранее скачанный файл <b>.json</b>. Текущие данные в браузере будут заменены.</p>
        <button class="btn gray" id="rs">Выбрать файл копии…</button><input type="file" id="rsf" accept=".json,application/json" hidden><div id="rsmsg" class="mut" style="margin-top:8px" role="status"></div>`, { cls: 'w6' })}
      ${UI.panel('Начать с чистого листа', `<p class="mut" style="margin-top:0">Удаляет все загрузки, клиентов и задания из браузера. Сначала скачайте копию.</p>
        <button class="btn danger" id="rz"${empty ? ' disabled' : ''}>Удалить все данные…</button>`, { cls: 'w12' })}
      </div>`;
    $('#bk', el).onclick = async () => { await flush(); download(`crm-копия-${stamp()}.json`, engine.exportState(), 'application/json'); toast('Копия скачана — сохраните файл в надёжном месте'); };
    const input = $('#rsf', el), msg = $('#rsmsg', el);
    $('#rs', el).onclick = () => input.click();
    input.onchange = async () => {
      const f = input.files[0]; input.value = ''; if (!f) return;
      try {
        const probe = CRMEngine.normalizeState(JSON.parse(await f.text())), n = probe.wh.uploads.length + probe.ag.uploads.length;
        if (!confirm(`Заменить текущие данные копией из файла «${f.name}» (загрузок: ${n})?`)) return;
        engine.importState(probe); await flush();
        toast('Данные восстановлены'); EXT_PAGES.data(el);
      } catch (e) { msg.className = 'neg'; msg.textContent = e instanceof SyntaxError ? 'Файл повреждён: это не резервная копия CRM' : e.message; }
    };
    $('#rz', el).onclick = async () => {
      if (!confirm('Удалить ВСЕ данные из браузера? Это нельзя отменить (если нет скачанной копии).')) return;
      engine.reset(); await flush(); toast('Данные удалены'); EXT_PAGES.data(el);
    };
  };
})();
