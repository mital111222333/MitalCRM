// «📍 Где агенты»: live positions of the supervisor's agents from the GPS platform (gps.logic.uz, GPS Server / GPSWOX API).
// The Google auto-loader logs in with the supervisor's GPS login (kept only in the script) and every 5 minutes writes
// gps-latest.json to the private data repository; if the GPS server lets the browser ask it directly, the open page
// refreshes every 30 seconds. Only "my" agents are shown: devices whose name matches an agent in the CRM, or picked by hand.
window.EXT_PAGES = window.EXT_PAGES || {};

const GPS = {
  snap: null, live: null, pois: null, poisRead: 0, liveOk: null, timer: null, map: null, layers: null, sel: null, showClients: true,
  cfg: () => (CRMLocal.ext().gps ||= { mine: null, names: {} }),
  // device → CRM agent name: set by hand, otherwise matched by words of the name (Latin / Cyrillic)
  agentOf(dev) {
    const c = GPS.cfg(); if (c.names[dev.id]) return c.names[dev.id];
    const want = ROUTE.norm(dev.name);
    const agents = GPS.agents();
    return agents.find(a => ROUTE.norm(a) === want) || agents.find(a => { const w = String(a).toLowerCase().split(/\s+/).map(ROUTE.norm).filter(x => x.length > 2); return w.length && w.every(x => want.includes(x)); }) || agents.find(a => { const f = ROUTE.norm(String(a).split(/\s+/)[0]); return f.length > 3 && want.includes(f); }) || '';
  },
  agents() { const s = new Set(); for (const c of Object.values(CRMLocal.engine.getState().ag.clients || {})) if (c.agent) s.add(c.agent); return [...s].sort((a, b) => a.localeCompare(b)); },
  isMine(dev) { const c = GPS.cfg(); return c.mine ? c.mine.includes(String(dev.id)) : !!GPS.agentOf(dev); },
  devices() { return (GPS.live || (GPS.snap?.devices || []).map(GPS.one)).filter(d => isFinite(+d.lat) && isFinite(+d.lng) && (+d.lat || +d.lng)); },
  // GPSWOX get_devices: [{title, items:[{id,name,online,time,timestamp,lat,lng,speed,course,stop_duration,address,tail}]}]
  parse(groups) {
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) for (const d of g.items || []) out.push(GPS.one({ ...d, group: g.title }));
    return out;
  },
  one(d) { return { id: String(d.id), name: d.name || '', group: d.group || '', online: d.online || '', time: d.time || '', ts: +d.timestamp || 0, lat: +d.lat, lng: +d.lng, speed: +d.speed || 0, course: +d.course || 0, stop: d.stop_duration || '', address: d.address && d.address !== '-' ? d.address : '', tail: (d.tail || []).slice(-15).map(p => [+p.lat, +p.lng]).filter(p => p[0] && p[1]) }; 
  },
  async load() {
    if (window.CLOUD?.on()) {
      const s = await CLOUD.readJson('gps-latest.json'); if (s && s.at) GPS.snap = s;
      if (!GPS.pois || Date.now() - GPS.poisRead > 30 * 60000) { const p = await CLOUD.readJson('gps-pois.json'); GPS.poisRead = Date.now(); if (p && Array.isArray(p.pois)) GPS.pois = p.pois; }
    }
    if (GPS.liveOk !== false && GPS.snap?.live?.url && GPS.snap.live.hash) {
      try {
        const r = await fetch(`${GPS.snap.live.url.replace(/\/+$/, '')}/api/get_devices?lang=ru&user_api_hash=${encodeURIComponent(GPS.snap.live.hash)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status); GPS.live = GPS.parse(await r.json()); GPS.liveAt = Date.now(); GPS.liveOk = true;
      } catch { GPS.liveOk = false; GPS.live = null; }
    }
  },
  ago(d) {
    const t = d.ts ? d.ts * 1000 : Date.parse(d.time); if (!t) return d.time || '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} мин назад` : new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  state(d) {
    const t = d.ts ? d.ts * 1000 : Date.parse(d.time), old = t && Date.now() - t > 30 * 60000;
    if (old || /offline/i.test(d.online)) return { k: 'off', t: 'нет связи', c: '#8a99a6' };
    if (d.speed > 3) return { k: 'go', t: `едет ${Math.round(d.speed)} км/ч`, c: '#2b7de9' };
    return { k: 'stop', t: d.stop ? `стоит ${d.stop}` : 'стоит', c: '#1e9e5a' };
  },
  initials: n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''),
  // clients from the GPS platform's map points that are clients of this CRM
  clients() {
    const pois = GPS.pois || [], S = CRMLocal.engine.getState(), names = new Map(Object.keys(S.ag.clients || {}).map(n => [ROUTE.norm(n), n]));
    return pois.map(p => ({ ...p, client: names.get(ROUTE.norm(p.name)) || '' })).filter(p => isFinite(p.lat) && isFinite(p.lng));
  },
  today(agent) {
    const t0 = UI.localDate(Date.now()), out = {};
    if (typeof LX !== 'undefined' && LX.has()) {
      const M = LX.model();
      out.paid = M.payments.filter(p => p.date === t0 && p.agent === agent).reduce((a, p) => a + p.amount, 0);
      out.orders = M.ords.filter(o => o.date === t0 && o.agent === agent);
      const w = LX.d('workday').find(r => LX.agentName([r.first_name, r.second_name].filter(Boolean).join(' ')) === agent);
      if (w) Object.assign(out, { plan: LX.n(w.total_tasks_by_market), done: LX.n(w.total_tasks_done_by_market), rej: LX.n(w.total_rejects), sales: LX.n(w.sales_fact), first: String(w['first_done_task_time.date'] || '').slice(11, 16) });
    }
    const r = typeof ROUTE !== 'undefined' && ROUTE.dayOf(agent, t0); out.route = r ? r.clients : [];
    return out;
  },
};

EXT_PAGES.gps = async el => {
  clearInterval(GPS.timer);
  el.innerHTML = `<div class="page-head"><div><h2>📍 Где агенты</h2><div class="sub" id="gSub">Загружаю…</div></div>
    <div class="actions"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="gCl" ${GPS.showClients ? 'checked' : ''}> клиенты на карте</label><button class="btn gray" id="gMine">Мои агенты…</button><a class="btn" id="gOpen" href="http://gps.logic.uz/objects" target="_blank" rel="noopener">Открыть gps.logic.uz ↗</a></div></div>
    <div class="gps-wrap"><div id="gMap" class="gps-map"></div><div id="gList" class="gps-list"></div></div><div id="gInfo"></div>`;
  await CRMLocal.ready;
  try { await Promise.all([loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'), loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js')]); }
  catch { $('#gMap', el).innerHTML = '<p class="mut" style="padding:16px">Карта не загрузилась — проверьте интернет.</p>'; }
  await GPS.load();
  if (GPS.snap?.live?.url) $('#gOpen', el).href = GPS.snap.live.url.replace(/\/+$/, '') + '/objects';
  if (!GPS.snap && !GPS.live) {
    $('#gSub', el).textContent = 'GPS ещё не подключён';
    $('.gps-wrap', el).outerHTML = UI.empty('Подключите GPS', `Впишите логин и пароль от <b>gps.logic.uz</b> в «<a href="#/cloud">Данные → Синхронизация и настройки</a>» → блок «📍 GPS агентов», затем обновите скрипт автозагрузки (скопировать → вставить в script.google.com → setup). Через 5 минут здесь появятся ваши агенты.`);
    return;
  }
  if (GPS.snap?.error && !GPS.live) $('#gInfo', el).innerHTML = `<p class="neg">GPS: ${esc(GPS.snap.error)}</p>`;
  const L = window.L;
  if (L) {
    if (GPS.map) { try { GPS.map.remove(); } catch { /* old map */ } }
    GPS.map = L.map($('#gMap', el), { zoomControl: true }).setView([40.6, 71.6], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(GPS.map);
    GPS.layers = { agents: L.layerGroup().addTo(GPS.map), clients: L.layerGroup(), trail: L.layerGroup().addTo(GPS.map) };
    if (GPS.showClients) GPS.layers.clients.addTo(GPS.map);
  }
  let first = true;
  const draw = () => {
    const all = GPS.devices(), mine = all.filter(GPS.isMine), at = GPS.live ? GPS.liveAt : Date.parse(GPS.snap?.at);
    $('#gSub', el).innerHTML = `Ваших агентов: <b>${mine.length}</b> из ${all.length} на платформе · обновлено ${at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}${GPS.live ? ' · <span class="pos">в реальном времени</span>' : ' · раз в 5 минут'}`;
    const items = mine.map(d => ({ d, agent: GPS.agentOf(d) || d.name, st: GPS.state(d) })).sort((a, b) => ({ go: 0, stop: 1, off: 2 }[a.st.k] - { go: 0, stop: 1, off: 2 }[b.st.k]) || a.agent.localeCompare(b.agent));
    $('#gList', el).innerHTML = items.length ? items.map(({ d, agent, st }) => {
      const t = GPS.today(agent), open = GPS.sel === d.id;
      return `<div class="gps-card ${open ? 'on' : ''}" data-dev="${esc(d.id)}" tabindex="0" role="button">
        <div class="gps-row"><span class="gps-dot" style="background:${st.c}">${esc(GPS.initials(agent))}</span><div style="min-width:0"><b>${esc(agent)}</b><div class="mut"><small>${esc(st.t)} · ${esc(GPS.ago(d))}</small></div></div></div>
        ${open ? `<div class="gps-more">
          ${d.address ? `<div>📍 ${esc(d.address)}</div>` : ''}
          ${t.plan != null ? `<div>Визиты сегодня: <b>${t.done} из ${t.plan}</b>${t.rej ? ` · отказов ${t.rej}` : ''}${t.first ? ` · первый визит ${esc(t.first)}` : ''}</div>` : ''}
          ${t.sales != null ? `<div>Продажи сегодня: <b>$${UI.fmt0(t.sales)}</b></div>` : t.orders ? `<div>Заказов сегодня: <b>${t.orders.length}</b> на $${UI.fmt0(t.orders.reduce((a, o) => a + o.sum, 0))}</div>` : ''}
          ${t.paid != null ? `<div>Собрано сегодня: <b class="pos">$${UI.fmt0(t.paid)}</b></div>` : ''}
          ${t.route.length ? `<div>Маршрут сегодня: ${t.route.length} клиентов</div>` : ''}
          <div class="bar" style="margin:8px 0 0"><a class="btn sm" data-agent="${esc(agent)}">Страница агента</a><a class="btn gray sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=${d.lat},${d.lng}">Открыть в картах</a></div>
        </div>` : ''}</div>`;
    }).join('') : `<p class="mut">Не нашёл ваших агентов среди ${all.length} устройств. Нажмите «Мои агенты…» и отметьте своих.</p>`;
    $('#gList', el).querySelectorAll('[data-dev]').forEach(c => c.onclick = e => { if (e.target.closest('a')) return; GPS.sel = GPS.sel === c.dataset.dev ? null : c.dataset.dev; draw(); const d = mine.find(x => x.id === GPS.sel); if (d && GPS.map) GPS.map.setView([d.lat, d.lng], 15); });
    if (!L || !GPS.map) return;
    GPS.layers.agents.clearLayers(); GPS.layers.trail.clearLayers(); GPS.layers.clients.clearLayers();
    for (const { d, agent, st } of items) {
      const icon = L.divIcon({ className: '', html: `<div class="gps-pin ${GPS.sel === d.id ? 'on' : ''}" style="background:${st.c}">${esc(GPS.initials(agent))}</div><div class="gps-lbl">${esc(agent.split(' ')[0])}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
      L.marker([d.lat, d.lng], { icon, title: agent }).addTo(GPS.layers.agents).bindPopup(`<b>${esc(agent)}</b><br>${esc(st.t)}<br><small>${esc(GPS.ago(d))}</small>`).on('click', () => { GPS.sel = d.id; draw(); });
      if (GPS.sel === d.id && d.tail.length > 1) L.polyline(d.tail, { color: st.c, weight: 4, opacity: .7 }).addTo(GPS.layers.trail);
    }
    const selAgent = items.find(x => x.d.id === GPS.sel)?.agent, route = new Set(selAgent ? GPS.today(selAgent).route.map(ROUTE.norm) : []);
    for (const p of GPS.clients()) {
      if (!p.client && GPS.clients().some(x => x.client)) continue; // only clients of this CRM when names match
      const inRoute = route.has(ROUTE.norm(p.client || p.name));
      L.circleMarker([p.lat, p.lng], { radius: inRoute ? 7 : 4, color: inRoute ? '#f2a516' : '#5b6b78', weight: inRoute ? 3 : 1, fillOpacity: .7 }).addTo(GPS.layers.clients).bindPopup(`<b>${esc(p.client || p.name)}</b>${inRoute ? '<br>в маршруте на сегодня' : ''}${p.client ? `<br><a class="clink" data-client="${esc(p.client)}">карточка клиента</a>` : ''}`);
    }
    if (first && items.length) { first = false; GPS.map.fitBounds(items.map(x => [x.d.lat, x.d.lng]), { padding: [40, 40], maxZoom: 14 }); }
  };
  draw();
  $('#gCl', el).onchange = e => { GPS.showClients = e.target.checked; if (GPS.map) { if (GPS.showClients) GPS.layers.clients.addTo(GPS.map); else GPS.map.removeLayer(GPS.layers.clients); } };
  $('#gMine', el).onclick = () => {
    const all = GPS.devices().sort((a, b) => a.name.localeCompare(b.name)), agents = GPS.agents();
    const m = modal(`<h3>Мои агенты на GPS</h3><p class="mut" style="margin-top:0">Отметьте своих агентов (агенты других менеджеров не будут показаны) и, если нужно, укажите, кто это в CRM.</p>
      <div class="tscroll" style="max-height:55vh"><table><thead><tr><th>Мой</th><th>Устройство на GPS</th><th>Агент в CRM</th></tr></thead><tbody>${all.map(d => `<tr><td><input type="checkbox" data-m="${esc(d.id)}" ${GPS.isMine(d) ? 'checked' : ''}></td><td>${esc(d.name)}<br><small class="mut">${esc(d.group)}</small></td><td><select data-n="${esc(d.id)}"><option value="">—</option>${agents.map(a => `<option ${GPS.agentOf(d) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
      <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="mX">Отмена</button><button class="btn" id="mOk">Сохранить</button></div>`);
    $('#mX', m.el).onclick = m.close;
    m.el.querySelectorAll('tbody tr').forEach(tr => { tr.style.cursor = 'pointer'; tr.onclick = e => { if (e.target.closest('input,select')) return; const cb = tr.querySelector('[data-m]'); cb.checked = !cb.checked; }; });
    $('#mOk', m.el).onclick = () => {
      const c = GPS.cfg(); c.mine = [...m.el.querySelectorAll('[data-m]')].filter(x => x.checked).map(x => x.dataset.m);
      c.names = {}; m.el.querySelectorAll('[data-n]').forEach(s => { if (s.value) c.names[s.dataset.n] = s.value; });
      CRMLocal.touch(); m.close(); draw(); toast('Сохранено');
    };
  };
  GPS.timer = setInterval(async () => {
    if (!document.body.contains(el.querySelector('#gMap'))) return clearInterval(GPS.timer);
    if (document.visibilityState !== 'visible') return;
    await GPS.load(); draw();
  }, GPS.liveOk ? 30000 : 60000);
};
addEventListener('hashchange', () => { if (location.hash !== '#/gps') clearInterval(GPS.timer); });
