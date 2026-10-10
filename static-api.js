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
  })();

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
    ext: () => engine.getState().ext,
    // replace everything with a state that came from the cloud: saved locally, but not sent back
    replaceFromCloud: async st => { engine.importState(st); dirty = false; clearTimeout(timer); await idbPut(engine.getState()); lastSaved = new Date(); },
    request: (method, path, body) => engine.request(method, path, { json: body || {} }).then(r => (path.startsWith('/api/ag/dashboard') ? applyAgentPlans(r.json) : r.json)),
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
    return json(path.startsWith('/api/ag/dashboard') ? applyAgentPlans(r.json) : r.json, r.status);
  };
  try { localStorage.setItem('token', 'local'); } catch { /* storage blocked: the page will show the sign-in form */ }

  // ---------- menu: only the two sections that work without a server, plus the data page ----------
  window.EXT_MENU = {
    'Сегодня': { '': [['Отчёт дня', 'rday'], ['🚨 Сигналы', 'signals'], ['📍 Где агенты', 'gps'], ['Работа агентов', 'lxwork']] },
    'Деньги': { '': [['Оплаты по дням', 'lxpay'], ['Дебиторка и план сбора', 'rdebt'], ['Просрочка долга', 'lxage']] },
    'Продажи': { '': [['Заказы по дням', 'lxday'], ['Бренды и товары', 'lxbrand'], ['🎯 Кому что предложить', 'lxcross'], ['Заказы и возвраты', 'lxord'], ['Прибыль по товарам', 'lxprof'], ['Спящие клиенты', 'rsleep']] },
    'Агенты': { '': [['Сводка по агентам', 'agents'], ['Страница агента', 'agent'], ['Лидерборд', 'leaders'], ['🗺 Маршруты', 'amap'], ['Клиенты и план', 'aclients'], ['Задания агентам', 'atasks'], ['Загрузки', 'aup']] },
    'Склад': { '': [['Заявка в Ташкент', 'whorder'], ['Рекомендация LINKO', 'lxrec'], ['Остатки по складам', 'whstock'], ['Что заканчивается', 'whlow'], ['Обзор склада', 'wh'], ['Движение склада', 'whmove'], ['Загрузки склада', 'whup']] },
    'Аналитика': { '': [['ИИ-ассистент', 'ai'], ['По дням и неделям', 'rdays'], ['Динамика по периодам', 'rdyn']] },
    'Данные': { '': [['Загрузить данные', 'up'], ['Telegram агентам', 'tg'], ['Синхронизация и настройки', 'cloud'], ['Резервная копия', 'data']] },
  };
  // sections the supervisor does not use: hidden from the menu (the pages still open by link); can be shown again in settings
  window.MENU_OPTIONAL = { aup: 'Загрузки (агенты)', whup: 'Загрузки склада', atasks: 'Задания агентам', data: 'Резервная копия' };
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
