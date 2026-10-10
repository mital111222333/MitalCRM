// Cloud sync: the whole CRM state is kept as one compressed file in YOUR PRIVATE GitHub repository,
// so the same data opens on the computer, the phone and any other device. GitHub Pages (this site) stays public;
// the data repository is private and is reached only with the access key saved on each device.
//
//   file in the data repo: crm-data.json.gz  =  gzip(JSON {app, savedAt, device, state})
//   every device remembers the version (sha) it last saw; a change made elsewhere is pulled on open and when the tab comes back.
window.CLOUD = (() => {
  const LS = { cfg: 'crm_cloud', sha: 'crm_cloud_sha', dirty: 'crm_cloud_dirty', at: 'crm_cloud_at' };
  const FILE = 'crm-data.json.gz';
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  let status = 'off', message = '', timer = null, busy = null, lastCheck = 0, conflict = null;

  const cfg = () => { try { const c = JSON.parse(get(LS.cfg) || 'null'); return c && c.owner && c.repo && c.token ? c : null; } catch { return null; } };
  const device = () => (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Телефон' : 'Компьютер') + ' · ' + (navigator.platform || '');

  // a setup link (#/cloud?c=...) carries the connection settings to a new device: read it before the app starts routing
  try {
    const m = location.hash.match(/^#\/cloud\?c=([^&]+)/);
    if (m) {
      const c = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (c.owner && c.repo && c.token) { set(LS.cfg, JSON.stringify(c)); set(LS.sha, null); }
      history.replaceState(null, '', location.pathname + location.search + '#/cloud');
    }
  } catch { /* broken link: ignore */ }

  // ---------- bytes helpers ----------
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => { const s = atob(str.replace(/\s/g, '')), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const gzip = text => pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
  const gunzip = async bytes => new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));

  // ---------- GitHub contents API ----------
  async function gh(c, method = 'GET', body = null, accept = 'application/vnd.github+json') {
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${FILE}`;
    let r;
    try {
      r = await fetch(url + (method === 'GET' ? `?t=${Date.now()}` : ''), { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + c.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Object.assign(new Error('Нет интернета или GitHub недоступен'), { net: true }); }
    return r;
  }
  const explain = async r => {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch { /* not json */ }
    if (r.status === 401) return 'Ключ доступа неверный или истёк. Создайте новый ключ (инструкция ниже).';
    if (r.status === 403) return 'У ключа нет права записи в репозиторий: в настройках ключа включите «Contents: Read and write».';
    if (r.status === 404) return 'Репозиторий не найден: проверьте имя владельца и репозитория и что ключ выдан именно на этот репозиторий.';
    return `GitHub ответил ошибкой ${r.status}${msg ? ': ' + msg : ''}`;
  };

  // returns {missing:true} | {sha, savedAt, device, state}
  async function pull(c = cfg()) {
    const r = await gh(c);
    if (r.status === 404) {
      const repo = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, { headers: { Authorization: 'Bearer ' + c.token } }).catch(() => null);
      if (repo && repo.ok) return { missing: true };
      throw new Error(await explain(r));
    }
    if (!r.ok) throw new Error(await explain(r));
    const meta = await r.json();
    let bytes;
    if (meta.content && meta.encoding === 'base64') bytes = unb64(meta.content);
    else { const raw = await gh(c, 'GET', null, 'application/vnd.github.raw'); if (!raw.ok) throw new Error(await explain(raw)); bytes = new Uint8Array(await raw.arrayBuffer()); }
    const data = JSON.parse(await gunzip(bytes));
    return { sha: meta.sha, savedAt: data.savedAt, device: data.device, state: data.state };
  }

  async function push(c = cfg(), { force = false } = {}) {
    await CRMLocal.flushLocal?.();
    const state = CRMLocal.engine.getState(), savedAt = new Date().toISOString();
    const bytes = await gzip(JSON.stringify({ app: 'mitalcrm', savedAt, device: device(), state }));
    if (bytes.length > 45e6) throw new Error('Данных стало слишком много для одного файла (больше 45 МБ). Удалите старые загрузки в разделах «Загрузки».');
    let sha = get(LS.sha) || undefined;
    if (force) { const cur = await gh(c); if (cur.ok) sha = (await cur.json()).sha; }
    const r = await gh(c, 'PUT', { message: `CRM: сохранено (${device()})`, content: b64(bytes), ...(sha ? { sha } : {}) });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (!r.ok) throw new Error(await explain(r));
    const d = await r.json();
    set(LS.sha, d.content.sha); set(LS.dirty, null); set(LS.at, savedAt);
    return { ok: true, size: bytes.length };
  }

  // ---------- status badge ----------
  const badge = () => {
    let b = document.getElementById('cloudBadge');
    if (!b) { b = document.createElement('a'); b.id = 'cloudBadge'; b.href = '#/cloud'; }
    const nav = document.querySelector('nav.top'), spot = nav?.querySelector('#me');
    if (spot && b.parentNode !== nav) nav.insertBefore(b, spot); else if (!nav && !b.parentNode) document.body.appendChild(b);
    const at = get(LS.at), time = at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const view = {
      off: ['off', '☁ Только на этом устройстве', 'Синхронизация выключена: нажмите, чтобы подключить'],
      saving: ['busy', '☁ Сохраняю…', ''],
      loading: ['busy', '☁ Загружаю из облака…', ''],
      ok: ['ok', `☁ Синхронизировано${time ? ' · ' + time : ''}`, 'Данные одинаковые на всех устройствах'],
      pending: ['busy', '☁ Есть несохранённые изменения', 'Отправятся в облако через несколько секунд'],
      error: ['err', '☁ Ошибка синхронизации', message],
      conflict: ['err', '☁ Нужно выбрать версию', 'Данные изменены и здесь, и на другом устройстве'],
    }[status];
    b.className = 'cb-' + view[0]; b.innerHTML = `<span aria-hidden="true">☁</span><span class="cbt">${view[1].replace(/^☁ /, '')}</span>`; b.setAttribute('aria-label', view[1]); b.title = view[2] || '';
  };
  const setStatus = (s, m = '') => { status = s; message = m; badge(); document.dispatchEvent(new CustomEvent('cloud-status')); };

  const rerender = () => { if (typeof route === 'function') route(); };

  async function adopt(remote) {
    await CRMLocal.replaceFromCloud(remote.state);
    set(LS.sha, remote.sha); set(LS.dirty, null); set(LS.at, remote.savedAt);
    rerender();
    if (typeof toast === 'function' && remote.device) toast(`Данные обновлены: ${remote.device.split(' · ')[0].toLowerCase()}, ${new Date(remote.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
  }

  function showConflict(remote) {
    conflict = remote; setStatus('conflict');
    document.getElementById('cloudConflict')?.remove();
    const s = CRMLocal.engine.getState(), rs = remote.state || { wh: { uploads: [] }, ag: { uploads: [] } };
    const n = st => (st.wh?.uploads?.length || 0) + (st.ag?.uploads?.length || 0);
    const d = document.createElement('div'); d.id = 'cloudConflict'; d.setAttribute('role', 'alertdialog');
    d.innerHTML = `<div><b>Данные различаются.</b> В облаке — версия от ${new Date(remote.savedAt).toLocaleString('ru-RU')} (${esc(remote.device || 'другое устройство')}, загрузок: ${n(rs)}). На этом устройстве — загрузок: ${n(s)}. Какую оставить?</div>
      <div class="cc-btns"><button class="btn" id="ccRemote">Взять из облака</button><button class="btn gray" id="ccLocal">Оставить эту и отправить в облако</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#ccRemote').onclick = async () => { d.remove(); conflict = null; setStatus('loading'); try { await adopt(remote); setStatus('ok'); } catch (e) { setStatus('error', e.message); } };
    d.querySelector('#ccLocal').onclick = async () => { d.remove(); conflict = null; set(LS.sha, remote.sha); await sync({ force: true }); };
  }

  // one sync step: send local changes, or pick up a newer cloud version
  async function sync({ force = false, quiet = false } = {}) {
    const c = cfg(); if (!c) return setStatus('off');
    if (conflict) return;
    if (busy) return busy;
    busy = (async () => {
      try {
        const dirty = !!get(LS.dirty);
        if (dirty || force) {
          setStatus('saving');
          const r = await push(c, { force });
          if (r.conflict) { const remote = await pull(c); return showConflict(remote); }
          return setStatus('ok');
        }
        if (!quiet) setStatus('loading');
        const remote = await pull(c);
        lastCheck = Date.now();
        if (remote.missing) { setStatus('saving'); await push(c); return setStatus('ok'); }
        const known = get(LS.sha);
        if (remote.sha === known) { setStatus('ok'); window.LINKO_AUTO?.check(); return; }
        const summary = CRMLocal.engine.summary(), localEmpty = !summary.wh && !summary.ag && !summary.tasks;
        if (!known && !localEmpty) return showConflict(remote); // first connection on a device that already has its own data
        await adopt(remote); setStatus('ok');
        window.LINKO_AUTO?.check();
      } catch (e) { setStatus('error', e.message); if (!quiet) toast('Синхронизация: ' + e.message); }
      finally { busy = null; }
    })();
    return busy;
  }

  // called by static-api.js after every local save
  function changed() {
    if (!cfg()) return;
    set(LS.dirty, '1'); setStatus('pending');
    clearTimeout(timer); timer = setTimeout(() => sync(), 3000);
  }

  // start: after the local data is loaded
  (async () => {
    await CRMLocal.ready;
    badge();
    new MutationObserver(() => { if (!document.querySelector('nav.top #cloudBadge') && document.querySelector('nav.top')) badge(); }).observe(document.getElementById('app'), { childList: true });
    if (cfg()) await sync({ quiet: false });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cfg() && Date.now() - lastCheck > 10000) sync({ quiet: true });
      if (document.visibilityState === 'hidden' && get(LS.dirty)) { clearTimeout(timer); sync({ quiet: true }); }
    });
    addEventListener('online', () => cfg() && sync({ quiet: true }));
    setInterval(() => { if (cfg() && document.visibilityState === 'visible' && Date.now() - lastCheck > 25000) sync({ quiet: true }); }, 30000);
  })();

  return {
    on: () => !!cfg(),
    // read another (small) file of the data repository, e.g. linko-latest.json written by the auto-loader
    async readJson(path) {
      const c = cfg(); if (!c) return null;
      let r; try { r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?t=${Date.now()}`, { cache: 'no-store', headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' } }); } catch { return null; }
      if (!r.ok) return null;
      try { return await r.json(); } catch { return null; }
    },
    cfg,
    status: () => ({ status, message, at: get(LS.at), dirty: !!get(LS.dirty) }),
    changed,
    sync,
    async connect(c) {
      const test = await pull(c); // throws a readable error if the key or the repo is wrong
      set(LS.cfg, JSON.stringify(c)); set(LS.sha, null);
      if (test.missing) { set(LS.dirty, '1'); return sync(); }
      return sync({ quiet: false });
    },
    disconnect() { set(LS.cfg, null); set(LS.sha, null); set(LS.dirty, null); set(LS.at, null); setStatus('off'); },
    link() { const c = cfg(); return c ? `${location.origin}${location.pathname}#/cloud?c=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(c)))))}` : ''; },
  };
})();

// ---------- page: Данные → Синхронизация и настройки ----------
window.EXT_PAGES = window.EXT_PAGES || {};
EXT_PAGES.cloud = async el => {
  await CRMLocal.ready;
  const c = CLOUD.cfg(), st = CLOUD.status(), ext = CRMLocal.ext();
  const stText = { off: 'выключена', ok: 'работает', saving: 'сохраняю…', loading: 'загружаю…', pending: 'есть несохранённые изменения', error: 'ошибка: ' + esc(st.message), conflict: 'нужно выбрать версию (вверху экрана)' }[st.status];
  el.innerHTML = `<div class="page-head"><div><h2>Синхронизация и настройки</h2><div class="sub">Чтобы CRM открывалась с одинаковыми данными на компьютере и телефоне</div></div></div>
  <div class="grid">
  ${UI.panel('Синхронизация между устройствами', c ? `
    <p style="margin-top:0">Статус: <b>${stText}</b>${st.at ? ` · последнее сохранение в облаке: ${new Date(st.at).toLocaleString('ru-RU')}` : ''}</p>
    <p class="mut">Хранилище: приватный репозиторий <b>${esc(c.owner)}/${esc(c.repo)}</b>. Всё, что вы загружаете и меняете, через несколько секунд попадает в облако; на других устройствах обновится при открытии.</p>
    <div class="bar"><button class="btn" id="cSync">Синхронизировать сейчас</button><button class="btn gray" id="cOff">Отключить на этом устройстве</button></div>` : `
    <p style="margin-top:0">Сейчас данные лежат только в этом браузере. Подключите облако — один раз на этом устройстве, а остальные устройства подключатся по ссылке или QR-коду.</p>
    <div class="form">
      <label>Владелец (ваш логин GitHub)<input id="cOwner" value="mital111222333" autocomplete="off"></label>
      <label>Приватный репозиторий для данных<input id="cRepo" value="mitalcrm-data" autocomplete="off"></label>
      <label style="grid-column:1/-1">Ключ доступа (fine-grained token)<input id="cTok" type="password" placeholder="github_pat_…" autocomplete="off"></label>
    </div>
    <div class="bar" style="margin-top:12px"><button class="btn" id="cGo">Подключить</button><span id="cMsg" role="status" class="mut"></span></div>`, { cls: 'w7' })}
  ${UI.panel(c ? 'Подключить телефон или другой компьютер' : 'Как получить ключ (5 минут, бесплатно)', c ? `
    <p class="mut" style="margin-top:0">Откройте камеру телефона и наведите на код — CRM откроется уже подключённой. Или отправьте ссылку себе в «Избранное» Telegram и откройте её на нужном устройстве.</p>
    <div id="qr" style="background:#fff;padding:10px;width:max-content;border-radius:8px"></div>
    <div class="bar" style="margin-top:10px"><button class="btn gray" id="cCopy">Скопировать ссылку</button></div>
    <p class="mut" style="margin-bottom:0"><b>Никому не пересылайте эту ссылку:</b> в ней ключ к вашим данным.</p>` : `
    <ol class="steps">
      <li>Зайдите на <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>. Имя: <b>mitalcrm-data</b>, выберите <b>Private</b>, нажмите «Create repository».</li>
      <li>Откройте <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">создание ключа</a>. Название — любое, срок — максимальный.</li>
      <li>«Repository access» → <b>Only select repositories</b> → выберите <b>mitalcrm-data</b>.</li>
      <li>«Permissions» → «Repository permissions» → <b>Contents</b> → <b>Read and write</b>.</li>
      <li>Нажмите «Generate token», скопируйте ключ и вставьте слева.</li>
    </ol>
    <p class="mut" style="margin-bottom:0">Ключ даёт доступ только к этому одному репозиторию с данными. Сам сайт CRM остаётся как есть.</p>`, { cls: 'w5' })}
  ${UI.panel('ИИ-ассистент (Google Gemini)', `
    <p class="mut" style="margin-top:0">Бесплатный ключ: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → «Create API key». Ключ хранится вместе с данными, поэтому вводить его на телефоне не нужно.</p>
    <div class="form"><label style="grid-column:1/-1">Ключ Gemini<input id="gKey" type="password" value="${esc(ext.ai?.key || '')}" placeholder="AIza…" autocomplete="off"></label>
    <label style="grid-column:1/-1">Модель<select id="gModel"><option value="">Автоматически (быстрая Flash)</option>${ext.ai?.model ? `<option selected>${esc(ext.ai.model)}</option>` : ''}</select></label></div>
    <div class="bar" style="margin-top:12px"><button class="btn" id="gSave">Сохранить и проверить</button><span id="gMsg" role="status" class="mut"></span></div>`, { cls: 'w6' })}
  ${(() => {
    const la = ext.linkoAuto || {}, hasKey = (() => { try { return !!localStorage.getItem('crm_linko_key'); } catch { return false; } })();
    const t = v => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return UI.panel('🤖 Автозагрузка из LINKO — каждые 5 минут, без вас', `
      <p style="margin-top:0">${la.seenAt ? (la.error ? `<b class="neg">Последняя попытка ${t(la.seenAt)}: ${esc(la.error)}</b>` : `✓ Работает. Последние данные из LINKO: <b>${t(la.seenAt)}</b>${la.importedAt ? `, загружены в CRM` : ''}.`) : 'Пока не настроена.'}</p>
      <p class="mut">Бесплатный скрипт Google сам берёт баланс и остатки из LINKO каждые 5 минут (с 7 до 22), а заказы, товары, оплаты, долги по срокам и работу агентов — раз в 30 минут. Открытая CRM на компьютере и телефоне сама подхватывает новые данные — нажимать закладку больше не нужно.</p>
      <ol class="steps">
        <li>${hasKey ? '✓ Ключ LINKO получен.' : (() => { let old = false; try { old = !!localStorage.getItem('crm_linko_oldbm'); } catch { /* ignore */ } return old ? '<b class="neg">Ваша закладка «⚡ В MITAL CRM» старая и не передаёт ключ.</b> Удалите её, перетащите новую из раздела <a href="#/up">⬆ Загрузить</a> и нажмите её в LINKO.' : '<b>Сначала один раз нажмите закладку «⚡ В MITAL CRM» в LINKO на этом компьютере</b> — CRM запомнит ключ LINKO для скрипта. Если закладка у вас давно — удалите её и перетащите новую из раздела <a href="#/up">⬆ Загрузить</a>.'; })()}</li>
        <li>Нажмите кнопку ниже — готовый скрипт скопируется (ключи уже внутри).</li>
        <li>Откройте <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → Новый проект</a>, сотрите всё в окне и вставьте скрипт (Ctrl+V). Нажмите 💾 (Ctrl+S).</li>
        <li>Вверху в списке функций выберите <b>setup</b> и нажмите <b>▶ Выполнить</b>. Google попросит разрешение: «Проверить разрешения» → ваш аккаунт → «Дополнительно» → «Перейти к проекту» → «Разрешить».</li>
        <li>Готово. Через минуту здесь появится «✓ Работает».</li>
      </ol>
      <div class="bar" style="margin:0"><button class="btn" id="laCopy" ${c ? '' : 'disabled'}>📋 Скопировать готовый скрипт</button>${!c ? '<span class="mut">Сначала подключите синхронизацию выше</span>' : ''}</div>
      <p class="mut" style="margin-bottom:0">Скрипт хранится в вашем аккаунте Google, ключи никуда кроме LINKO и вашего GitHub не отправляются. Не пересылайте скрипт другим людям. Если в LINKO выйти из аккаунта, ключ может смениться — тогда снова нажмите закладку и повторите шаги 2–4.</p>`, { cls: 'w12' });
  })()}
  ${(() => {
    let g = {}; try { g = JSON.parse(localStorage.getItem('crm_gps_login') || '{}'); } catch { /* none */ }
    return UI.panel('📍 GPS агентов (gps.logic.uz)', `<p class="mut" style="margin-top:0">Чтобы видеть агентов на карте в разделе <a href="#/gps">Агенты → 📍 Где агенты</a>, впишите здесь логин и пароль, с которыми вы входите на gps.logic.uz. Они сохраняются <b>только на этом компьютере</b> и попадают в ваш скрипт автозагрузки — никуда больше. Никому их не отправляйте, мне в чат тоже.</p>
      <div class="form"><label>Адрес платформы<input id="gpsUrl" value="${esc(g.url || 'http://gps.logic.uz')}" autocomplete="off"></label><label>Логин (e-mail)<input id="gpsEmail" value="${esc(g.email || '')}" autocomplete="off"></label><label>Пароль<input id="gpsPass" type="password" value="${esc(g.password || '')}" autocomplete="new-password"></label></div>
      <div class="bar" style="margin-top:10px"><button class="btn gray" id="gpsSave">Сохранить</button><span id="gpsMsg" class="mut" role="status">${g.email ? '✓ Сохранено. После этого обновите скрипт автозагрузки (кнопка «Скопировать готовый скрипт» выше → вставить → setup).' : ''}</span></div>`, { cls: 'w6' });
  })()}
  ${UI.panel('📲 Приложение на телефоне', `<p class="mut" style="margin-top:0">${window.PWA?.standalone() ? '✓ Вы уже открыли CRM как приложение.' : 'Установите CRM на главный экран — будет открываться одним нажатием, как обычное приложение, без браузера и адресной строки. Работает и без интернета: покажет последние сохранённые данные.'}</p>
    ${window.PWA?.standalone() ? '' : `<div class="bar" style="margin:0"><button class="btn" id="pwaGo">📲 Установить приложение</button></div>
    <ul class="steps" style="margin-top:10px"><li><b>Android (Chrome):</b> кнопка выше или меню ⋮ → «Установить приложение».</li><li><b>iPhone:</b> откройте в Safari → «Поделиться» → «На экран „Домой“».</li><li><b>Компьютер (Chrome / Edge):</b> кнопка выше или значок ⊕ в адресной строке.</li></ul>`}`, { cls: 'w6' })}
  ${UI.panel('Telegram', `<p class="mut" style="margin-top:0">Бот для отправки отчётов агентам настраивается в разделе <a href="#/tg">Отчёты → Telegram агентам</a>.</p>
    <p class="mut" style="margin-bottom:0">${ext.tg?.token ? '✓ Бот подключён' : 'Бот ещё не подключён'}${ext.tg?.chats ? ` · агентов с Telegram: ${Object.keys(ext.tg.chats).length}` : ''}</p>`, { cls: 'w6' })}
  </div>`;

  if (c) {
    $('#cSync', el).onclick = async () => { await CLOUD.sync({ quiet: false }); EXT_PAGES.cloud(el); };
    $('#cOff', el).onclick = () => { if (!confirm('Отключить синхронизацию на этом устройстве? Данные в облаке и в этом браузере останутся.')) return; CLOUD.disconnect(); EXT_PAGES.cloud(el); };
    const link = CLOUD.link();
    $('#cCopy', el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку:', link); } };
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const q = $('#qr', el); if (q) new QRCode(q, { text: link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L }); }).catch(() => { const q = $('#qr', el); if (q) q.outerHTML = '<p class="mut">QR-код не загрузился — используйте ссылку.</p>'; });
  } else {
    $('#cGo', el).onclick = async () => {
      const msg = $('#cMsg', el), cc = { owner: $('#cOwner', el).value.trim(), repo: $('#cRepo', el).value.trim(), token: $('#cTok', el).value.trim() };
      if (!cc.owner || !cc.repo || !cc.token) { msg.className = 'neg'; msg.textContent = 'Заполните все три поля'; return; }
      msg.className = 'mut'; msg.textContent = 'Проверяю…';
      try { await CLOUD.connect(cc); toast('Облако подключено'); EXT_PAGES.cloud(el); }
      catch (e) { msg.className = 'neg'; msg.textContent = e.message; }
    };
  }
  const pg = $('#pwaGo', el); if (pg) pg.onclick = () => PWA.install();
  const gs = $('#gpsSave', el);
  if (gs) gs.onclick = () => { const g = { url: $('#gpsUrl', el).value.trim().replace(/\/+$/, ''), email: $('#gpsEmail', el).value.trim(), password: $('#gpsPass', el).value }; try { localStorage.setItem('crm_gps_login', JSON.stringify(g)); } catch { /* blocked */ } $('#gpsMsg', el).textContent = '✓ Сохранено. Теперь обновите скрипт автозагрузки: «Скопировать готовый скрипт» → вставить в script.google.com → setup.'; };
  const lc = $('#laCopy', el);
  if (lc) lc.onclick = async () => {
    let key = ''; try { key = localStorage.getItem('crm_linko_key') || ''; } catch { /* ignore */ }
    if (!key) {
      const m = modal(`<h3>Сначала нужен ключ LINKO</h3>
        <p>CRM ещё не получила ключ LINKO на этом компьютере. Скорее всего, у вас в браузере <b>старая закладка</b> — она не передаёт ключ. Обновите её:</p>
        <ol class="steps">
          <li>На панели закладок нажмите правой кнопкой на «⚡ В MITAL CRM» → <b>Удалить</b>.</li>
          <li>В CRM откройте <a href="#/up">⬆ Загрузить</a> и перетащите новую кнопку «⚡ В MITAL CRM» на панель закладок.</li>
          <li>Откройте LINKO (app.linko.uz) и нажмите новую закладку. Дождитесь загрузки данных.</li>
          <li>Вернитесь сюда — кнопка «📋 Скопировать готовый скрипт» заработает.</li>
        </ol>
        <p class="mut">Делайте это в том же браузере на этом компьютере, где открыта CRM.</p>
        <div class="bar"><span class="spacer"></span><button class="btn" id="cx">Понятно</button></div>`);
      m.el.querySelector('#cx').onclick = m.close; m.el.querySelector('a[href="#/up"]').onclick = m.close;
      return;
    }
    const cc = CLOUD.cfg(), src = await (await fetch('autolinko.gs', { cache: 'no-cache' })).text();
    let code = src.replace('ВСТАВЬТЕ_КЛЮЧ_LINKO', key).replace('ВСТАВЬТЕ_КЛЮЧ_GITHUB', cc.token).replace("GH_OWNER: 'mital111222333'", `GH_OWNER: '${cc.owner}'`).replace("GH_REPO: 'mitalcrm-data'", `GH_REPO: '${cc.repo}'`).replace('PLAN_DAY: 16,', `PLAN_DAY: ${PLAN.day()},`).replace("CRM_URL: 'https://mital111222333.github.io/MitalCRM/'", `CRM_URL: '${location.origin + location.pathname.replace(/[^/]*$/, '')}'`);
    let gps = {}; try { gps = JSON.parse(localStorage.getItem('crm_gps_login') || '{}'); } catch { /* none */ }
    const q = v => JSON.stringify(String(v || ''));
    code = code.replace("GPS_URL: 'http://gps.logic.uz',", `GPS_URL: ${q(gps.url || 'http://gps.logic.uz')},`).replace("GPS_EMAIL: '',", `GPS_EMAIL: ${q(gps.email)},`).replace("GPS_PASSWORD: '',", `GPS_PASSWORD: ${q(gps.password)},`);
    try { await navigator.clipboard.writeText(code); toast('Скрипт скопирован — вставьте его в script.google.com'); }
    catch { const m = modal(`<h3>Скопируйте скрипт</h3><textarea style="width:100%;height:50vh;font:12px monospace">${esc(code)}</textarea><div class="bar"><span class="spacer"></span><button class="btn" id="cx">Закрыть</button></div>`); m.el.querySelector('textarea').select(); m.el.querySelector('#cx').onclick = m.close; }
  };
  $('#gSave', el).onclick = async () => {
    const msg = $('#gMsg', el), key = $('#gKey', el).value.trim();
    const x = CRMLocal.ext(); x.ai = { ...(x.ai || {}), key, model: $('#gModel', el).value };
    CRMLocal.touch();
    if (!key) { msg.textContent = 'Ключ удалён'; return; }
    msg.className = 'mut'; msg.textContent = 'Проверяю ключ…';
    try {
      const models = await AI.models(key), sel = $("#gModel", el), cur = x.ai.model; AI._list = models;
      sel.innerHTML = `<option value="">Автоматически (${esc(AI.pick(models))})</option>` + models.map(m => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
      msg.className = 'pos'; msg.textContent = `✓ Ключ работает, моделей: ${models.length}`;
    } catch (e) { msg.className = 'neg'; msg.textContent = e.message; }
  };
  $('#gModel', el).onchange = e => { const x = CRMLocal.ext(); x.ai = { ...(x.ai || {}), model: e.target.value }; CRMLocal.touch(); };
};

function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src && s.dataset.loaded)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.loaded = 1; res(); }; s.onerror = rej; document.head.appendChild(s);
  });
}
function loadCss(href) {
  return new Promise((ok, fail) => { if (document.querySelector(`link[href="${href}"]`)) return ok(); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = ok; l.onerror = fail; document.head.appendChild(l); });
}
