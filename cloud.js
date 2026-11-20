// Cloud sync: the whole CRM state is kept as one compressed file, so the same data opens on the computer, the phone and any other device.
// Two stores:
//   • the MITAL database (Supabase): each team lead's own workspace, reached by signing in — no keys on devices. РОП and admin can read it.
//     file: Storage «workspaces»/<account id>/v<version>.json.gz; the keys inside the state (bot token, AI key…) go to workspace_secrets.
//   • the old way: YOUR PRIVATE GitHub repository, file crm-data.json.gz, reached with the access key saved on each device.
//   Once a device moved its data to the database («Синхронизация» → «База MITAL») it uses only the database.
//   Both files are gzip(JSON {app, savedAt, device, state}); every device remembers the version it last saw.
// LINKO files (linko-latest.json…) and the agents' cabinets are still read from / written to GitHub until LINKO moves to the server.
window.CLOUD = (() => {
  // user: set when the unsent changes include your own edits, not only LINKO data the CRM loaded by itself
  const LS = { cfg: 'crm_cloud', sha: 'crm_cloud_sha', dirty: 'crm_cloud_dirty', at: 'crm_cloud_at', user: 'crm_cloud_user' };
  const FILE = 'crm-data.json.gz';
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  let status = 'off', message = '', timer = null, busy = null, lastCheck = 0, conflict = null, autoN = 0;

  if (get(LS.dirty)) set(LS.user, '1'); // unsent changes left from before this page opened are always treated as yours
  const cfg = () => { try { const c = JSON.parse(get(LS.cfg) || 'null'); return c && c.owner && c.repo && c.token ? c : null; } catch { return null; } };
  const device = () => (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Телефон' : 'Компьютер') + ' · ' + (navigator.platform || '');

  // ---------- where the state is kept: the MITAL database (Supabase, per person) or the old GitHub file ----------
  // crm_ws_owner = the account this device's data belongs to. It is set only when the data is moved to the database
  // (or on a device that had no data yet). A different person signing in here never gets this data sent to his workspace.
  const WS = { owner: 'crm_ws_owner', BUCKET: 'workspaces' };
  const me = () => (window.AUTH && AUTH.sb && AUTH.profile && !['agent', 'store'].includes(AUTH.profile.role) ? AUTH.profile : null);
  const sbOn = () => { const p = me(); return !!p && get(WS.owner) === p.id; };
  const foreign = () => { const o = get(WS.owner), p = window.AUTH?.profile; return !!o && !!p && o !== p.id; }; // data of another account
  // once the data moved to the database this device never writes the GitHub file again (not even offline or signed out)
  const store = () => (get(WS.owner) ? (sbOn() ? 'sb' : null) : cfg() ? 'gh' : null);

  // a setup link (#/cloud?c=...) carries the connection settings to a new device: read it before the app starts routing
  try {
    const m = location.hash.match(/^#\/cloud\?c=([^&]+)/);
    if (m) {
      const c = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (c.lk) set('crm_linko_key', c.lk); // the LINKO key comes with the link, so this device also takes data live from LINKO
      delete c.lk;
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
  async function gh(c, method = 'GET', body = null, accept = 'application/vnd.github+json', extra = {}) {
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${FILE}`;
    let r;
    try {
      r = await fetch(url + (method === 'GET' && !extra['If-None-Match'] ? `?t=${Date.now()}` : ''), { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + c.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
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
  // quick check first: if the cloud file is unchanged since we last saw it, GitHub answers 304 with no body — nothing is downloaded or unpacked
  let etag = null, etagSha = null; const jsonMemo = {};
  const pull = (c = cfg(), o = {}) => (store() === 'sb' ? pullSb(o) : pullGh(c));
  const push = (c = cfg(), o = {}) => (store() === 'sb' ? pushSb(o) : pushGh(c, o));

  // ---------- the database store ----------
  // secrets (Telegram bot token, AI key, LINKO web key…) are kept apart: only the owner can read them, РОП and admin see the CRM without them
  const SECRET = ['token', 'key', 'secret'];
  function splitSecrets(state) {
    const ext = {}, secrets = {};
    for (const [k, v] of Object.entries(state.ext || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && SECRET.some(s => s in v)) {
        const keep = { ...v }, hide = {};
        for (const s of SECRET) if (s in keep) { hide[s] = keep[s]; delete keep[s]; }
        ext[k] = keep; secrets[k] = hide;
      } else ext[k] = v;
    }
    return { state: { ...state, ext }, secrets };
  }
  const joinSecrets = (state, secrets) => {
    const ext = { ...(state.ext || {}) };
    for (const [k, v] of Object.entries(secrets || {})) ext[k] = { ...(ext[k] || {}), ...v };
    return { ...state, ext };
  };
  const ver = sha => (/^sb\d+$/.test(sha || '') ? Number(sha.slice(2)) : null);
  const fileOf = (owner, v) => `${owner}/v${v}.json.gz`;
  const sbErr = (e, what) => new Error(`База MITAL: ${what}: ${e?.message || e}`);
  let lastSecrets = null;
  const verNow = async owner => { const { data } = await AUTH.sb.from('workspaces').select('version').eq('owner_id', owner).maybeSingle(); return data ? data.version : 0; };

  // ---------- restore points: only the last 5 versions are kept and a busy day makes ~60 saves, so 5 versions cover an hour or two.
  // Once a day the version from before the day's first save (= the end of the previous day) is copied to <owner>/daily/<day>.json.gz
  // and kept 30 days. A save that drops many clients/tasks/uploads at once (a bug or a wrong action) also keeps the version before it.
  const SNAP_KEEP_DAYS = 30, LS_SNAP = 'crm_snap_day';
  const snapDir = owner => `${owner}/daily`;
  const tashDay = (ms = Date.now()) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10); // Tashkent date
  const bigDrop = (a, b) => !!a && !!b && ['clients', 'tasks', 'ag', 'wh'].some(k => (a[k] || 0) >= 10 && (b[k] || 0) < a[k] * 0.6);
  async function snapshot(owner, cur, before, after) {
    if (!cur) return;
    const st = AUTH.sb.storage.from(WS.BUCKET), dir = snapDir(owner), day = tashDay();
    if (bigDrop(before, after)) await st.copy(fileOf(owner, cur), `${dir}/${day}-drop-v${cur}.json.gz`).catch(() => {});
    if (get(LS_SNAP) === day + owner) return;
    const r = await st.copy(fileOf(owner, cur), `${dir}/${day}.json.gz`);
    if (r.error && !/exist|duplicate|409/i.test(r.error.message || '')) return; // try again on the next save
    set(LS_SNAP, day + owner);
    const cutoff = tashDay(Date.now() - SNAP_KEEP_DAYS * 864e5);
    const { data: list } = await st.list(dir, { limit: 500 });
    const old = (list || []).map(f => f.name).filter(n => /^\d{4}-\d{2}-\d{2}/.test(n) && n.slice(0, 10) < cutoff);
    if (old.length) await st.remove(old.map(n => `${dir}/${n}`)).catch(() => {});
  }
  async function listSnaps() {
    const p = me(); if (!p || !sbOn()) throw new Error('Точки восстановления есть только у данных в базе MITAL');
    const { data, error } = await AUTH.sb.storage.from(WS.BUCKET).list(snapDir(p.id), { limit: 500 });
    if (error) throw sbErr(error, 'не удалось получить точки восстановления');
    return (data || []).filter(f => /^\d{4}-\d{2}-\d{2}.*\.json\.gz$/.test(f.name))
      .map(f => ({ name: f.name, day: f.name.slice(0, 10), drop: /-drop-/.test(f.name), pre: /-before-/.test(f.name), size: f.metadata?.size || 0 }))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }
  // the restored state becomes a new version (nothing is overwritten); the current version is kept as «<day>-before-restore»
  async function restoreSnap(name) {
    const p = me(); if (!p || !sbOn()) throw new Error('Войдите в свой аккаунт');
    if (!/^[\w.-]+\.json\.gz$/.test(name)) throw new Error('Неверное имя точки');
    const st = AUTH.sb.storage.from(WS.BUCKET);
    const { data: blob, error } = await st.download(`${snapDir(p.id)}/${name}`);
    if (error) throw sbErr(error, 'не удалось скачать точку восстановления');
    const data = JSON.parse(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    if (data?.app !== 'mitalcrm' || !data.state) throw new Error('Файл точки повреждён');
    const cur = await verNow(p.id);
    if (cur) { const c = await st.copy(fileOf(p.id, cur), `${snapDir(p.id)}/${tashDay()}-before-restore-v${cur}.json.gz`); if (c.error && !/exist|duplicate|409/i.test(c.error.message || '')) throw sbErr(c.error, 'не удалось сохранить текущую версию перед восстановлением'); }
    let secrets = {}; try { secrets = JSON.parse(lastSecrets || '{}'); } catch { /* none */ }
    await CRMLocal.replaceFromCloud(joinSecrets(data.state, secrets));
    set(LS.sha, 'sb' + cur); set(LS.dirty, '1'); set(LS.user, '1');
    await sync({ force: true });
    rerender();
    return { savedAt: data.savedAt };
  }

  // {missing:true} | {sha:'sb<version>', unchanged:true} | {sha, savedAt, device, state}
  async function pullSb({ fresh = false, owner = me()?.id } = {}) {
    const sb = AUTH.sb;
    const { data: row, error } = await sb.from('workspaces').select('version, saved_at, device').eq('owner_id', owner).maybeSingle();
    if (error) throw Object.assign(sbErr(error, 'не удалось проверить версию'), { net: /fetch/i.test(error.message) });
    if (!row) return { missing: true };
    const sha = 'sb' + row.version;
    if (!fresh && sha === get(LS.sha)) return { sha, unchanged: true };
    let { data: blob, error: e2 } = await sb.storage.from(WS.BUCKET).download(fileOf(owner, row.version));
    if (e2) {
      // the file of this version is missing (lost save): take the newest file that exists, so the CRM never gets stuck on it
      const { data: list } = await sb.storage.from(WS.BUCKET).list(owner, { limit: 100 });
      const prev = (list || []).map(f => Number((f.name.match(/^v(\d+)\.json\.gz$/) || [])[1])).filter(v => v && v < row.version).sort((a, b) => b - a)[0];
      if (!prev) throw sbErr(e2, 'не удалось скачать данные');
      ({ data: blob, error: e2 } = await sb.storage.from(WS.BUCKET).download(fileOf(owner, prev)));
      if (e2) throw sbErr(e2, 'не удалось скачать данные');
    }
    const data = JSON.parse(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    let state = data.state;
    if (owner === me()?.id) {
      const { data: s } = await sb.from('workspace_secrets').select('data').eq('owner_id', owner).maybeSingle();
      lastSecrets = JSON.stringify(s?.data || {}); state = joinSecrets(state, s?.data);
    }
    return { sha, savedAt: data.savedAt, device: data.device, state };
  }

  async function pushSb({ force = false } = {}) {
    const sb = AUTH.sb, owner = me().id;
    await CRMLocal.flushLocal?.();
    const full = CRMLocal.engine.getState(), savedAt = new Date().toISOString();
    const { state, secrets } = splitSecrets(full);
    const bytes = await gzip(JSON.stringify({ app: 'mitalcrm', savedAt, device: device(), state }));
    if (bytes.length > 48e6) throw new Error('Данных стало слишком много (больше 48 МБ). Удалите старые загрузки в разделах «Загрузки».');
    const { data: row, error } = await sb.from('workspaces').select('version, summary').eq('owner_id', owner).maybeSingle();
    if (error) throw sbErr(error, 'не удалось проверить версию');
    const known = ver(get(LS.sha)), cur = row ? row.version : 0;
    if (!force && row && known !== cur) return { conflict: true }; // somebody saved a newer version meanwhile
    const next = cur + 1, path = fileOf(owner, next);
    // never overwrite a version file: if another device already wrote v<next>, that is a conflict, not ours to replace
    let up = await sb.storage.from(WS.BUCKET).upload(path, new Blob([bytes], { type: 'application/gzip' }), { upsert: false, contentType: 'application/gzip' });
    if (up.error && /exist|duplicate|409/i.test(up.error.message || '') && (await verNow(owner)) === cur) {
      // a file left over from an earlier failed try (the version row still says cur): nobody uses it, replace it
      up = await sb.storage.from(WS.BUCKET).upload(path, new Blob([bytes], { type: 'application/gzip' }), { upsert: true, contentType: 'application/gzip' });
    }
    if (up.error) { if (/exist|duplicate|409/i.test(up.error.message || '')) return { conflict: true }; throw sbErr(up.error, 'не удалось сохранить данные'); }
    const s = CRMLocal.engine.summary(), meta = { version: next, saved_at: savedAt, saved_by: owner, device: device(), size: bytes.length, summary: s };
    const q = row ? sb.from('workspaces').update(meta).eq('owner_id', owner).eq('version', cur).select('version')
      : sb.from('workspaces').insert({ owner_id: owner, ...meta }).select('version');
    const { data: done, error: e3 } = await q;
    if (e3 || !done?.length) {
      // the answer may be lost on a weak mobile network while the server DID save it: ask again before deleting anything
      let now; try { now = await sb.from('workspaces').select('version, saved_at').eq('owner_id', owner).maybeSingle(); } catch { now = { error: true }; }
      if (now.error) throw sbErr(e3 || 'нет ответа', 'не удалось записать версию'); // unknown: keep the file, retry later
      const mine = now.data?.version === next && new Date(now.data.saved_at).getTime() === new Date(savedAt).getTime();
      if (!mine) {
        if ((now.data?.version ?? 0) < next) await sb.storage.from(WS.BUCKET).remove([path]); // only a file no version points to
        if (e3 && !/duplicate/i.test(e3.message)) throw sbErr(e3, 'не удалось записать версию');
        return { conflict: true };
      }
    }
    const sj = JSON.stringify(secrets);
    if (sj !== lastSecrets) {
      const { error: e4 } = await sb.from('workspace_secrets').upsert({ owner_id: owner, data: secrets, updated_at: savedAt });
      if (e4) throw sbErr(e4, 'не удалось сохранить ключи');
      lastSecrets = sj;
    }
    // the restore points are copied before the oldest version is removed; they never block or fail the save
    snapshot(owner, cur, row?.summary, s).catch(() => {}).finally(() => {
      if (next > 5) sb.storage.from(WS.BUCKET).remove([fileOf(owner, next - 5)]).catch(() => {}); // keep the last 5 versions
    });
    set(LS.sha, 'sb' + next); set(LS.dirty, null); set(LS.user, null); set(LS.at, savedAt);
    window.BOTSNAP?.soon(); // the summary for the Mital AI bot (botsnap.js) follows every save
    return { ok: true, size: bytes.length };
  }

  async function pullGh(c = cfg()) {
    const known = get(LS.sha), useTag = etag && etagSha && etagSha === known;
    const r = await gh(c, 'GET', null, 'application/vnd.github+json', useTag ? { 'If-None-Match': etag } : {});
    if (r.status === 304 && useTag) return { sha: etagSha, unchanged: true };
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
    etag = r.headers.get('ETag'); etagSha = meta.sha;
    return { sha: meta.sha, savedAt: data.savedAt, device: data.device, state: data.state };
  }

  async function pushGh(c = cfg(), { force = false } = {}) {
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
    set(LS.sha, d.content.sha); set(LS.dirty, null); set(LS.user, null); set(LS.at, savedAt);
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
      foreign: ['err', '☁ Данные другого аккаунта', 'На этом устройстве данные другого человека: синхронизация остановлена (Настройки → Синхронизация)'],
    }[status];
    b.className = 'cb-' + view[0]; b.innerHTML = `<span aria-hidden="true">☁</span><span class="cbt">${view[1].replace(/^☁ /, '')}</span>`; b.setAttribute('aria-label', view[1]); b.title = view[2] || '';
  };
  const setStatus = (s, m = '') => { status = s; message = m; badge(); document.dispatchEvent(new CustomEvent('cloud-status')); };

  const rerender = () => { if (typeof route === 'function') route(); };

  // quiet: picked up by the 30-second check (live.js) — the page is redrawn when you are not busy with it, without a message
  async function adopt(remote, quiet = false) {
    await CRMLocal.replaceFromCloud(remote.state);
    set(LS.sha, remote.sha); set(LS.dirty, null); set(LS.user, null); set(LS.at, remote.savedAt);
    if (quiet) { dispatchEvent(new Event('crm:adopted')); return; }
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
    const c = cfg(); if (!store()) return setStatus(foreign() ? 'foreign' : 'off');
    if (conflict) return;
    if (busy) return busy;
    busy = (async () => {
      try {
        const dirty = !!get(LS.dirty);
        if (dirty || force) {
          setStatus('saving');
          const r = await push(c, { force });
          if (r.conflict) {
            const remote = await pull(c, { fresh: true });
            // only LINKO data loaded by itself was unsent (two devices took the same new LINKO file at once):
            // take the cloud version and load LINKO on top of it if it is still newer — nothing of yours is lost, no question asked
            if (!get(LS.user) && !force && !remote.missing) {
              await adopt(remote, true); setStatus('ok');
              setTimeout(() => { if (window.LINKO_AUTO) { LINKO_AUTO.lastTry = 0; LINKO_AUTO.check({ quiet: true }); } }, 0);
              return;
            }
            return showConflict(remote);
          }
          return setStatus('ok');
        }
        if (!quiet) setStatus('loading');
        const remote = await pull(c);
        lastCheck = Date.now();
        if (remote.missing) { if (store() === 'sb' && isEmpty()) return setStatus('ok'); setStatus('saving'); await push(c); return setStatus('ok'); } // an empty device never creates an empty workspace
        const known = get(LS.sha);
        if (remote.sha === known) { setStatus('ok'); window.LINKO_AUTO?.check(); return; }
        const summary = CRMLocal.engine.summary(), localEmpty = !summary.wh && !summary.ag && !summary.tasks;
        if (!known && !localEmpty) return showConflict(remote); // first connection on a device that already has its own data
        await adopt(remote, quiet); setStatus('ok');
        window.LINKO_AUTO?.check();
      } catch (e) { setStatus('error', e.message); if (!quiet) toast('Синхронизация: ' + e.message); }
      finally { busy = null; }
    })();
    return busy;
  }

  // called by static-api.js after every local save
  function changed() {
    if (!store()) return;
    set(LS.dirty, '1'); if (!autoN) set(LS.user, '1'); setStatus('pending');
    clearTimeout(timer); timer = setTimeout(() => sync(), 3000);
  }

  // ---------- moving to the database ----------
  const counts = st => ({ wh: st?.wh?.uploads?.length || 0, ag: st?.ag?.uploads?.length || 0, clients: Object.keys(st?.ag?.clients || {}).length, tasks: st?.ag?.tasks?.length || 0, ext: Object.keys(st?.ext || {}).length });
  const isEmpty = () => { const s = CRMLocal.engine.summary(); return !s.wh && !s.ag && !s.tasks; };
  // the same JSON whatever the key order: used to prove the copy in the database equals the data on this device
  const stable = v => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}` : JSON.stringify(v ?? null));

  // a signed-in team lead on a device without an owner: if his workspace already exists, this device joins it
  // (sync asks which version to keep when this device has its own data); a device with no data at all starts in the database
  async function claim() {
    const p = me(); if (!p || get(WS.owner)) return;
    try {
      const { data: row, error } = await AUTH.sb.from('workspaces').select('version, summary').eq('owner_id', p.id).maybeSingle();
      if (error) return;
      const blank = row && !row.summary?.wh && !row.summary?.ag && !row.summary?.tasks;
      // a device with real data never joins an empty workspace by itself: its data is moved with the button, nothing is asked
      if (row ? !(blank && !isEmpty()) : isEmpty() && !cfg()) { set(WS.owner, p.id); set(LS.sha, null); }
    } catch { /* offline: next time */ }
  }

  // the button «Перенести мои данные в базу»: the first copy of this device's data goes to the signed-in person's workspace
  async function moveToDb() {
    const p = me(); if (!p) throw new Error('Войдите в свой аккаунт (агентам перенос не нужен)');
    if (p.role !== 'admin') throw new Error('Перенос со старого хранилища нужен только администратору: у вас данные сразу в базе');
    if (foreign()) throw new Error('На этом устройстве данные другого аккаунта');
    const { data: row, error } = await AUTH.sb.from('workspaces').select('version, summary').eq('owner_id', p.id).maybeSingle();
    if (error) throw sbErr(error, 'нет связи');
    const blank = row && !row.summary?.wh && !row.summary?.ag && !row.summary?.tasks; // only an empty start was saved there: safe to replace
    if (row && !blank) throw new Error('Ваши данные уже есть в базе. Обновите страницу: CRM предложит, какую версию оставить.');
    if (isEmpty()) throw new Error('На этом устройстве нет данных для переноса. Откройте CRM там, где ваши данные (обычно основной компьютер).');
    if (cfg() && get(LS.dirty) && !get(WS.owner)) await sync({ quiet: true }); // the GitHub copy gets the last changes too: it stays as a backup
    set(WS.owner, p.id); set(LS.sha, null);
    const r = await pushSb({ force: !!blank });
    if (r.conflict) throw new Error('Данные в базе только что изменились — обновите страницу');
    setStatus('ok');
    return checkDb();
  }

  // downloads the database copy again and compares it with this device, item by item
  // first sends what changed here since the last save (the LINKO auto-loader changes the data by itself every few minutes),
  // then compares the data exactly as it is written to the file (empty fields are not written, so they are not compared)
  async function checkDb() {
    await CRMLocal.save();
    if (store() === 'sb' && get(LS.dirty)) await sync({ quiet: true });
    const remote = await pullSb({ fresh: true });
    if (remote.missing) throw new Error('В базе ещё нет ваших данных');
    const local = JSON.parse(JSON.stringify(CRMLocal.engine.getState())), there = JSON.parse(JSON.stringify(remote.state));
    const diffs = [];
    (function walk(a, b, path) {
      if (diffs.length >= 8) return;
      if (stable(a) === stable(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        if (Array.isArray(a) && a.length !== b.length) return diffs.push(`${path} (${a.length} здесь, ${b.length} в базе)`);
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k);
      } else diffs.push(path || 'всё');
    })(local, there, '');
    return { same: !diffs.length, diffs, dirty: !!get(LS.dirty), local: counts(local), remote: counts(there), version: ver(remote.sha), savedAt: remote.savedAt };
  }

  // signing in or out on an open page: pick up the person's workspace without a reload
  addEventListener('crm:login', async () => { await claim(); if (store()) sync({ quiet: false }); else setStatus(foreign() ? 'foreign' : 'off'); });
  addEventListener('crm:logout', () => { clearTimeout(timer); setStatus(store() ? status : 'off'); });

  // start: after the local data is loaded
  (async () => {
    await CRMLocal.ready;
    badge();
    new MutationObserver(() => { if (!document.querySelector('nav.top #cloudBadge') && document.querySelector('nav.top')) badge(); }).observe(document.getElementById('app'), { childList: true });
    await claim(); if (store()) await sync({ quiet: false }); else if (foreign()) setStatus('foreign');
    // newer versions from other devices are picked up every 30 seconds by live.js (and by «🔄 Обновить»); unsaved local changes are sent on their own
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && get(LS.dirty)) { clearTimeout(timer); sync({ quiet: true }); }
    });
    addEventListener('online', () => store() && get(LS.dirty) && sync({ quiet: true }));
  })();

  return {
    on: () => !!store(), store, foreign, moveToDb, checkDb, listSnaps, restoreSnap, wsOwner: () => get(WS.owner),
    // «this device is now mine»: the other account's data is removed from this browser (it stays in the database) and the
    // signed-in person's own data is loaded from the database. Refused while the other account has unsent changes here.
    async takeDevice() {
      const p = me(); if (!p) throw new Error('Войдите в свой аккаунт');
      if (get(LS.dirty)) throw new Error('Здесь есть несохранённые изменения другого аккаунта. Пусть он войдёт и сохранит их, потом повторите.');
      CRMLocal.engine.reset(); await CRMLocal.save();
      set(WS.owner, p.id); set(LS.sha, null); set(LS.dirty, null); set(LS.user, null);
      await sync();
    },
    // may the signed-in person see the CRM data kept in THIS browser? (the data on a device is one, not per account)
    //   'agent'   — agents never see the CRM (their own screen comes later; now: the cabinet in Telegram)
    //   'foreign' — the data here belongs to another account (or to nobody known while there is data): nothing is shown
    //   'wait'    — the local data is still loading
    //   null      — yes: the device is his, or it is empty, or it is the admin's own old device not moved yet
    gate() {
      const p = window.AUTH?.profile; if (!p) return null; // not signed in: app.js shows the sign-in form
      if (p.role === 'agent' || p.role === 'store') return 'agent'; // a store keeper too: his cabinet, not the CRM
      if (!CRMLocal.engine) return 'wait';
      const o = get(WS.owner);
      if (o) return o === p.id ? null : 'foreign';
      return isEmpty() || p.role === 'admin' ? null : 'foreign';
    },
    // read another (small) file of the data repository, e.g. linko-latest.json written by the auto-loader
    // remembers each file's ETag: an unchanged file costs one tiny request (304) instead of a full download
    async readJson(path) {
      const c = cfg(); if (!c) return null;
      const memo = jsonMemo, m = memo[path];
      let r; try { r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}${m ? '' : `?t=${Date.now()}`}`, { cache: 'no-store', headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', ...(m ? { 'If-None-Match': m.etag } : {}) } }); } catch { return null; }
      if (r.status === 304 && m) return m.json;
      if (!r.ok) return null;
      let json; try { json = await r.json(); } catch { return null; }
      const tag = r.headers.get('ETag'); if (tag) memo[path] = { etag: tag, json };
      return json;
    },
    cfg,
    status: () => ({ status, message, at: get(LS.at), dirty: !!get(LS.dirty) }),
    changed,
    sync,
    // runs fn (loading LINKO data into the CRM) so that what it changes counts as loaded by itself, not as your edit
    async auto(fn) {
      autoN++;
      try { const r = await fn(); await CRMLocal.save(); return r; }
      finally { autoN--; }
    },
    async connect(c) {
      const test = await pullGh(c); // throws a readable error if the key or the repo is wrong
      set(LS.cfg, JSON.stringify(c)); set(LS.sha, null);
      if (test.missing) { set(LS.dirty, '1'); return sync(); }
      return sync({ quiet: false });
    },
    disconnect() { set(LS.cfg, null); set(LS.sha, null); set(LS.dirty, null); set(LS.at, null); setStatus('off'); },
    // the LINKO key goes along, so the phone opened by this link also takes data live from LINKO
    link() { const c = cfg(); if (!c) return ''; const lk = get('crm_linko_key'); return `${location.origin}${location.pathname}#/cloud?c=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(lk ? { ...c, lk } : c)))))}`; },
  };
})();

// ---------- page: Данные → Синхронизация и настройки ----------
window.EXT_PAGES = window.EXT_PAGES || {};
// the secret the «Обновить» button shows to the Google web app; made once, kept in the synced data (so the phone has it)
function webKey() {
  const x = CRMLocal.ext(); if (x.linkoWeb?.key) return x.linkoWeb.key;
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  const key = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  x.linkoWeb = { ...(x.linkoWeb || {}), key }; CRMLocal.touch(); return key;
}
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
    ${(() => { try { return localStorage.getItem('crm_linko_key'); } catch { return ''; } })() ? '<p class="mut">⚡ Вместе со ссылкой передаётся ключ LINKO: телефон тоже будет сам брать сегодняшние заказы, оплаты и долги прямо из LINKO каждые 30 секунд. Телефон, который уже подключён, — откройте на нём эту ссылку ещё раз.</p>' : ''}
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
      <p style="margin-top:0">${la.seenAt ? (la.error ? `<b class="neg">Последняя попытка ${t(la.seenAt)}: ${esc(maskKey(la.error))}</b>` : `✓ Работает. Последние данные из LINKO: <b>${t(la.seenAt)}</b>${la.importedAt ? `, загружены в CRM` : ''}.`) : 'Пока не настроена.'}</p>
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
    const w = ext.linkoWeb || {}, t = v => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return UI.panel('⚡ Кнопка «🔄 Обновить» — всё из LINKO сразу', `
      <p style="margin-top:0">${w.url ? (w.lastErr ? `<b class="neg">Последняя попытка не удалась: ${esc(maskKey(w.lastErr))}</b>` : w.lastAt ? `✓ Работает. Последний раз: <b>${t(w.lastAt)}</b>, за ${Math.max(1, Math.round((w.lastMs || 0) / 1000))} с.` : 'Адрес сохранён — нажмите «Проверить».') : 'Пока не настроено: кнопка «Обновить» берёт последние данные автозагрузки (до 5–30 минут назад).'}</p>
      <p class="mut">После настройки кнопка «🔄 Обновить» (на компьютере и на телефоне) просит ваш скрипт Google взять из LINKO <b>всё прямо сейчас</b> — баланс клиентов, остатки складов, заказы, оплаты, возвраты, долги, работу агентов. Все разделы LINKO запрашиваются одновременно, поэтому обычно это 5–20 секунд.</p>
      <ol class="steps">
        <li>Обновите скрипт: кнопка «📋 Скопировать готовый скрипт» выше → в script.google.com откройте файл <b>KOD</b>, сотрите всё, вставьте, 💾. Функцию <b>setup</b> запустите один раз (напоминания remind.gs она больше не трогает).</li>
        <li>Вверху справа: <b>Начать развёртывание → Новое развёртывание</b> → ⚙ «Веб-приложение». «Запуск от имени»: <b>Я</b>, «У кого есть доступ»: <b>Все</b> → «Начать развёртывание» → разрешить доступ.</li>
        <li>Скопируйте «URL веб-приложения» (заканчивается на <code>/exec</code>) и вставьте сюда. На телефоне вводить не нужно — адрес придёт через синхронизацию.</li>
      </ol>
      <div class="form"><label style="grid-column:1/-1">URL веб-приложения<input id="lwUrl" value="${esc(w.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label></div>
      <div class="bar" style="margin-top:10px"><button class="btn" id="lwSave">Сохранить и проверить</button><span id="lwMsg" class="mut" role="status"></span></div>
      <p class="mut" style="margin-bottom:0">Когда меняете скрипт потом: «Начать развёртывание → Управление развёртываниями» → ✏ → версия «Новая версия» → «Развернуть» — адрес останется прежним. Ключ кнопки уже вписан в скрипт: без него веб-приложение никому не отвечает.</p>`, { cls: 'w12' });
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
  el.querySelectorAll('[data-menu]').forEach(cb => cb.onchange = () => { const on = [...el.querySelectorAll('[data-menu]')].filter(x => x.checked).map(x => x.dataset.menu); try { localStorage.setItem('crm_menu_extra', JSON.stringify(on)); } catch { /* blocked */ } render(); });
  const gs = $('#gpsSave', el);
  if (gs) gs.onclick = () => { const g = { url: $('#gpsUrl', el).value.trim().replace(/\/+$/, ''), email: $('#gpsEmail', el).value.trim(), password: $('#gpsPass', el).value }; try { localStorage.setItem('crm_gps_login', JSON.stringify(g)); } catch { /* blocked */ } $('#gpsMsg', el).textContent = '✓ Сохранено. Теперь обновите скрипт автозагрузки: «Скопировать готовый скрипт» → вставить в script.google.com → setup.'; };
  const lw = $('#lwSave', el);
  if (lw) lw.onclick = async () => {
    const msg = $('#lwMsg', el), url = $('#lwUrl', el).value.trim(), x = CRMLocal.ext();
    if (url && !/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(url)) { msg.className = 'neg'; msg.textContent = 'Нужен адрес веб-приложения: https://script.google.com/macros/s/…/exec'; return; }
    webKey(); x.linkoWeb = { ...(x.linkoWeb || {}), url, lastErr: '' }; CRMLocal.touch();
    if (!url) { msg.className = 'mut'; msg.textContent = 'Отключено'; return; }
    msg.className = 'mut'; msg.textContent = 'Беру данные из LINKO…'; lw.disabled = true;
    try { const j = await LINKO_AUTO.now(); msg.className = 'pos'; msg.textContent = `✓ Работает: всё из LINKO за ${Math.max(1, Math.round((j.ms || 0) / 1000))} с`; toast('Кнопка «Обновить» теперь берёт всё из LINKO сразу'); }
    catch (e) { msg.className = 'neg'; msg.textContent = maskKey(String(e.message || e)) + (/доступа|ключ кнопки/.test(e.message) ? ' — скопируйте скрипт заново (шаг 1) и разверните новую версию' : ''); }
    finally { lw.disabled = false; }
  };
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
    code = code.replace("WEB_KEY: 'ВСТАВЬТЕ_КЛЮЧ_КНОПКИ',", `WEB_KEY: ${q(webKey())},`);
    { const tg = CRMLocal.ext().tg || {}; if (tg.token && tg.me?.id) code = code.replace("TG_BOT: '',", `TG_BOT: ${q(tg.token)},`).replace("TG_CHAT: '',", `TG_CHAT: ${q(tg.me.id)},`); } // сбои и стоп-отгрузка — вам в Telegram
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

// ---------- panel «База MITAL» on top of the sync page: move this device's data to the database and prove it arrived intact ----------
{
  const basePage = EXT_PAGES.cloud;
  EXT_PAGES.cloud = async el => {
    const at = location.hash;
    await basePage(el);
    if (!el.isConnected || location.hash !== at) return; // another page is open now
    const p = window.AUTH?.profile;
    if (!AUTH?.sb || !p || ['agent', 'store'].includes(p.role)) return;
    const grid = el.querySelector('.grid'); if (!grid) return;
    const box = document.createElement('div'); box.style.display = 'contents'; grid.prepend(box);
    const st = CLOUD.store(), foreign = CLOUD.gate() === 'foreign';
    const rows = r => `<div class="tscroll"><table><thead><tr><th></th><th class="n">На этом устройстве</th><th class="n">В базе</th></tr></thead><tbody>
      ${[['Загрузок склада', 'wh'], ['Загрузок по агентам', 'ag'], ['Клиентов с карточками', 'clients'], ['Заданий', 'tasks'], ['Разделов настроек', 'ext']]
        .map(([t, k]) => `<tr><td>${t}</td><td class="n">${UI.fmt0(r.local[k])}</td><td class="n ${r.local[k] === r.remote[k] ? '' : 'neg'}">${UI.fmt0(r.remote[k])}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin-bottom:0">${r.same ? '<b class="pos">✓ Полностью совпадает</b> — каждая запись в базе такая же, как здесь.' : `<b class="neg">✗ Есть различия.</b> Ничего не удаляйте и напишите об этом.${r.dirty ? ' Последние изменения ещё не отправились: подождите минуту и проверьте снова.' : ''}`}
      <span class="mut">Версия в базе: ${r.version}, сохранена ${new Date(r.savedAt).toLocaleString('ru-RU')}.</span></p>
      ${r.diffs?.length ? `<p class="mut" style="margin-bottom:0">Где различие: ${r.diffs.map(d => `<code>${esc(d)}</code>`).join(', ')}</p>` : ''}`;
    const body = foreign
      ? `<p style="margin-top:0"><b class="neg">На этом устройстве данные другого аккаунта.</b> Чтобы не перепутать данные, синхронизация здесь остановлена.</p>
         <p class="mut">Если тот человек уже сохранил свои данные в базу, это устройство можно очистить и загрузить ваши. Его данные останутся в базе.</p>
         <div class="bar"><button class="btn danger" id="dbClear">Очистить устройство и загрузить мои данные…</button></div>`
      : st === 'sb'
        ? `<p style="margin-top:0">✓ Ваши данные хранятся в <b>базе MITAL</b>: на любом устройстве войдите своим логином — данные откроются сами.
           Ключи (Telegram-бот, ИИ, LINKO) лежат отдельно, их видите только вы.</p>
           <div class="bar"><button class="btn gray" id="dbCheck">Проверить, что всё совпадает</button>
           <button class="btn gray" id="dbSnaps">Точки восстановления</button></div><div id="dbRes" role="status"></div>`
        : `<p style="margin-top:0">Сейчас данные хранятся ${CLOUD.cfg() ? 'в файле на GitHub' : 'только в этом браузере'}. Перенесите их в <b>базу MITAL</b> —
           тогда на других устройствах будет достаточно войти своим логином, без ключей и ссылок, а РОП увидит вашу CRM.</p>
           <p class="mut">Сначала сделайте резервную копию (Настройки → Резервная копия). Копия на GitHub остаётся как запасная, её никто не удаляет.</p>
           <div class="bar"><button class="btn" id="dbMove">Перенести мои данные в базу</button></div><div id="dbRes" role="status"></div>`;
    box.innerHTML = UI.panel('База MITAL', body, { cls: 'w12', sub: `Аккаунт: ${esc(p.full_name)} · ${esc(AUTH.ROLE_RU[p.role] || p.role)}` });
    const res = $('#dbRes', box);
    const run = async (btn, fn) => {
      btn.disabled = true; res.innerHTML = '<p class="mut">Работаю… не закрывайте страницу.</p>';
      try { res.innerHTML = rows(await fn()); } catch (e) { res.innerHTML = `<p class="neg">${esc(e.message || e)}</p>`; } finally { btn.disabled = false; }
    };
    $('#dbMove', box)?.addEventListener('click', e => {
      if (!confirm('Перенести все данные этого устройства в базу MITAL? После переноса это устройство будет сохранять данные только в базу.')) return;
      run(e.target, async () => { const r = await CLOUD.moveToDb(); setTimeout(() => EXT_PAGES.cloud(el).then(() => { const x = $('#dbRes', el); if (x) x.innerHTML = rows(r); }), 0); return r; });
    });
    $('#dbCheck', box)?.addEventListener('click', e => run(e.target, () => CLOUD.checkDb()));
    // restore points: one per day for 30 days, plus copies made before a big drop of data and before each restore
    $('#dbSnaps', box)?.addEventListener('click', async e => {
      const btn = e.target; btn.disabled = true; res.innerHTML = '<p class="mut">Загружаю список…</p>';
      try {
        const list = await CLOUD.listSnaps();
        const kind = s => (s.drop ? 'перед резким уменьшением данных' : s.pre ? 'перед восстановлением' : 'конец предыдущего дня');
        res.innerHTML = list.length
          ? `<p class="mut" style="margin-top:0">Каждый день сохраняется копия на конец предыдущего дня, хранится 30 дней. Восстановление создаёт новую версию, текущая тоже сохраняется как точка.</p>
             <div class="tscroll"><table><thead><tr><th>День</th><th>Что это</th><th class="n">Размер</th><th></th></tr></thead><tbody>
             ${list.map(s => `<tr><td>${esc(s.day.split('-').reverse().join('.'))}</td><td>${kind(s)}</td><td class="n">${UI.fmt0(Math.round(s.size / 1024))} КБ</td>
               <td><button class="btn gray sm" data-snap="${esc(s.name)}">Восстановить</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="mut">Точек пока нет. Первая появится при первом сохранении завтра.</p>';
        res.querySelectorAll('[data-snap]').forEach(b => b.addEventListener('click', async () => {
          const name = b.dataset.snap;
          if (!confirm(`Вернуть все данные CRM к точке «${name.slice(0, 10).split('-').reverse().join('.')}»? Изменения после неё пропадут из рабочей версии, но текущая версия сохранится как точка восстановления.`)) return;
          b.disabled = true;
          try { await CLOUD.restoreSnap(name); toast('Данные восстановлены'); } catch (er) { toast(er.message || String(er)); b.disabled = false; }
        }));
      } catch (er) { res.innerHTML = `<p class="neg">${esc(er.message || er)}</p>`; } finally { btn.disabled = false; }
    });
    $('#dbClear', box)?.addEventListener('click', async () => {
      if (!confirm('Удалить с этого устройства данные другого аккаунта и загрузить ваши из базы? В базе его данные останутся.')) return;
      try { await CLOUD.takeDevice(); } catch (e) { return toast(e.message || String(e)); }
      EXT_PAGES.cloud(el);
    });
  };
}
