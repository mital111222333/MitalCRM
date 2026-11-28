// «Пульс» (#/field, the page was called «Поле»): the supervisor's dashboard of his agents in the field — today live, and any past period.
// Data (Supabase, read only, filtered by the database itself: a supervisor gets only his agents, admin / РОП everybody):
//   field_days   — one row per GPS device per day, rebuilt by field-watch from the GPS track: every stop (at a client or not),
//                  km, time moving / standing, first / last move, LINKO totals of the agent's day (orders, payments, refusals);
//   field_live   — where every agent is right now (updated every minute);
//   field_visits — today's visits found live (timers, 15 / 30 / 45 min); field_events — the feed of today.
// Layout: period + agent picker → KPI tiles → «Сейчас» (today) → the opened day of one agent (timeline 07–21, every stop with
// what LINKO shows, map) → agents compared over the period → day × agent heatmap. Notifications while the CRM is open: FIELD.watch.
window.EXT_PAGES = window.EXT_PAGES || {};

const FIELD = {
  timer: null, tick: null, watchT: null, map: null,
  st: { period: 'today', from: '', to: '', agent: '', focus: null }, // focus: {device, day} — the day opened on the page
  sb: () => window.AUTH?.sb || null,
  me: () => window.AUTH?.profile || null,
  isMgr: () => ['admin', 'rop'].includes(window.AUTH?.profile?.role),
  dayOf: ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms),
  today: () => FIELD.dayOf(Date.now()),
  addDays: (d, n) => FIELD.dayOf(Date.parse(d + 'T12:00:00+05:00') + n * 86400000),
  hm: t => (t ? new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }) : '—'),
  dlabel: (d, long) => new Date(d + 'T12:00:00+05:00').toLocaleDateString('ru-RU', long ? { weekday: 'short', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }).replace('.', ''),
  wd: d => new Date(d + 'T12:00:00+05:00').toLocaleDateString('ru-RU', { weekday: 'short' }),
  dur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; },
  mins: ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`; },
  money: v => '$' + UI.fmt0(Math.round(v || 0)),
  ls(k, v) { try { if (v === undefined) return localStorage.getItem('fd_' + k); localStorage.setItem('fd_' + k, v); } catch { return null; } return null; },
  // small line icons (decorative: aria-hidden; every button also has a text label)
  I: {
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4m-8.6 8.6-1.4 1.4',
    map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14m6-12v14',
    store: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6',
    pause: 'M9 5v14M15 5v14', car: 'M5 17h14M6 17v2m12-2v2M5 13l2-6h10l2 6v4H5zM8 13h.01M16 13h.01', off: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M12 20h.01',
    x: 'M18 6 6 18M6 6l12 12',
  },
  ic: (k, cls = 'fd-i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${FIELD.I[k]}"/></svg>`,
  OUT: { order: ['ok', 'заказ'], payment: ['ok', 'оплата'], order_return: ['warn', 'возврат'], rejection: ['bad', 'отказ'], service_time: ['', 'таймер LINKO'] },

  // ---------- whose agents ----------
  scope(sups) {
    if (!FIELD.isMgr()) return 'all';
    const saved = FIELD.ls('scope');
    if (saved && (saved === 'all' || saved === 'none' || sups.some(s => s.id === saved))) return saved;
    const mine = sups.find(s => s.full_name && s.full_name.trim().toLowerCase() === String(FIELD.me()?.full_name || '').trim().toLowerCase());
    return mine ? mine.id : 'all';
  },
  inScope: (row, scope) => scope === 'all' || (scope === 'none' ? !row.supervisor_id : row.supervisor_id === scope),
  async sups() {
    if (!FIELD.isMgr()) return [];
    if (FIELD._sups) return FIELD._sups;
    const { data } = await FIELD.sb().from('profiles').select('id,full_name,role').eq('role', 'supervisor').eq('is_active', true).order('full_name');
    return (FIELD._sups = data || []);
  },

  range() {
    const t = FIELD.today(), p = FIELD.st.period;
    if (p === 'yesterday') { const y = FIELD.addDays(t, -1); return [y, y]; }
    if (p === '7') return [FIELD.addDays(t, -6), t];
    if (p === '30') return [FIELD.addDays(t, -29), t];
    if (p === 'plan') return [FIELD.planStart(t), t]; // the plan period runs from the 16th to the 15th
    if (p === 'custom' && FIELD.st.from && FIELD.st.to) return FIELD.st.from <= FIELD.st.to ? [FIELD.st.from, FIELD.st.to] : [FIELD.st.to, FIELD.st.from];
    return [t, t];
  },
  planStart: t => (+t.slice(8) >= 16 ? t.slice(0, 8) + '16' : FIELD.addDays(t.slice(0, 8) + '01', -1).slice(0, 8) + '16'),
  daysOf([a, b]) { const out = []; for (let d = a; d <= b && out.length < 93; d = FIELD.addDays(d, 1)) out.push(d); return out; },

  async load() {
    const sb = FIELD.sb(); if (!sb) throw new Error('Войдите в CRM, чтобы видеть «Пульс»');
    const [a, b] = FIELD.range(), t = FIELD.today(), withToday = b >= t;
    const q = p => Promise.resolve(p).then(r => r, e => ({ error: e }));
    const [cfg, days, live, visits, routes, events, sups] = await Promise.all([
      q(sb.from('field_config').select('*')),
      q(sb.from('field_days').select('*').gte('day', a).lte('day', b).order('day')),
      withToday ? q(sb.from('field_live').select('*')) : { data: [] },
      withToday ? q(sb.from('field_visits').select('id,device_id,agent_id,agent_name,supervisor_id,place_key,place_name,planned,lat,lon,started_at,last_seen_at,ended_at,outcome,outcome_final').eq('day', t).order('started_at')) : { data: [] },
      withToday ? q(sb.from('field_routes').select('agent_id,agent_name,supervisor_id,stats').eq('day', t)) : { data: [] },
      withToday ? q(sb.from('field_events').select('id,supervisor_id,kind,minutes,text,created_at').eq('day', t).order('id', { ascending: false }).limit(200)) : { data: [] },
      FIELD.sups(),
    ]);
    const err = [live, visits].find(r => r.error)?.error; if (err) throw new Error(err.message || String(err));
    const scope = FIELD.scope(sups), f = rows => (rows || []).filter(r => FIELD.inScope(r, scope));
    const D = { range: [a, b], days: FIELD.daysOf([a, b]), withToday, scope, sups, cfg: cfg.data || [], noHistory: !!days.error,
      live: f(live.data), visits: f(visits.data), routes: f(routes.data), events: f(events.data), rows: f(days.data) };
    // today without a GPS-history row yet (rebuilt every 15 min): the live visits stand in for it
    if (withToday) for (const l of D.live) {
      if (D.rows.some(r => r.day === t && r.device_id === l.device_id)) continue;
      const vs = D.visits.filter(v => v.device_id === l.device_id);
      if (!vs.length) continue;
      const r = D.routes.find(x => x.agent_id === l.agent_id)?.stats || {};
      D.rows.push({ day: t, device_id: l.device_id, device_name: l.device_name, agent_id: l.agent_id, agent_name: l.agent_name, supervisor_id: l.supervisor_id, km: null, move_s: 0, stop_s: 0,
        first_at: vs[0].started_at, last_at: vs[vs.length - 1].ended_at || vs[vs.length - 1].last_seen_at, linko: r, live: true,
        stops: vs.map(v => ({ a: v.started_at, b: v.ended_at || v.last_seen_at, lat: v.lat, lon: v.lon, key: v.place_key, name: v.place_name, planned: v.planned, out: v.outcome || [] })) });
    }
    const ag = new Map();
    for (const r of [...D.rows, ...D.live]) if (!ag.has(r.device_id)) ag.set(r.device_id, { id: r.device_id, name: r.device_name, linko: r.agent_name || '' });
    D.agents = [...ag.values()].sort((x, y) => x.name.localeCompare(y.name));
    return D;
  },

  // ---------- numbers ----------
  stopMs: s => Math.max(0, Date.parse(s.b) - Date.parse(s.a)),
  isClient: s => !!s.key,
  // working mileage (07:00–22:00, from home and back); rows rebuilt before it existed have only the whole day
  wkm: r => (r?.work_km != null ? +r.work_km : r?.km != null ? +r.km : null),
  minOfDay: t => { const [h, m] = FIELD.hm(t).split(':').map(Number); return h * 60 + m; },
  hhmm: m => (m == null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`),
  // a stop outside 07:00–21:00 or longer than 6 h (night at home) is not «стоял не у клиента»
  inWork: s => { const a = FIELD.minOfDay(s.a), b = FIELD.minOfDay(s.b); return b > 7 * 60 && a < 21 * 60 && FIELD.stopMs(s) < 6 * 3600000; },
  kind: s => (!FIELD.isClient(s) ? 'other' : (s.out || []).some(t => t.type === 'order' || t.type === 'payment') ? 'sale' : (s.out || []).some(t => t.type === 'rejection') ? 'rej' : 'client'),
  agg(rows) {
    const k = { visits: 0, clients: new Set(), at: 0, other: 0, otherN: 0, km: 0, kmKnown: false, orders: 0, paid: 0, rej: 0, long: 0, out: 0, noRes: 0, days: new Set(), firsts: [], lasts: [] };
    for (const r of rows) {
      k.days.add(r.day);
      if (FIELD.wkm(r) != null) { k.km += FIELD.wkm(r) || 0; k.kmKnown = true; }
      if (r.first_at) k.firsts.push(FIELD.minOfDay(r.first_at));
      if (r.last_at) k.lasts.push(FIELD.minOfDay(r.last_at));
      const L = r.linko || {};
      k.orders += +L.orders || 0; k.paid += +L.paid || 0; k.rej += +L.rejections || 0;
      for (const s of r.stops || []) {
        const ms = FIELD.stopMs(s);
        // not at a client: only between the first and the last move of the day (the morning and the evening are at home)
        if (!FIELD.isClient(s)) { if (FIELD.inWork(s) && (!r.first_at || Date.parse(s.a) >= Date.parse(r.first_at) - 60000) && (!r.last_at || Date.parse(s.b) <= Date.parse(r.last_at) + 60000)) { k.other += ms; k.otherN++; } continue; }
        k.visits++; k.clients.add(s.key); k.at += ms;
        if (ms >= 30 * 60000) k.long++;
        if (!s.planned) k.out++;
        if (!(s.out || []).length && Date.now() - Date.parse(s.b) > 2 * 3600000) k.noRes++;
      }
    }
    k.avg = k.visits ? k.at / k.visits : 0; k.nDays = k.days.size;
    k.first = k.firsts.length ? k.firsts.reduce((a, b) => a + b, 0) / k.firsts.length : null;
    k.last = k.lasts.length ? k.lasts.reduce((a, b) => a + b, 0) / k.lasts.length : null;
    return k;
  },

  // ---------- pieces ----------
  kpis(D) {
    const k = FIELD.agg(D.rows), n = Math.max(1, k.nDays), multi = D.days.length > 1;
    const tile = (label, value, sub = '', cls = '') => `<div class="fd-kpi ${cls}" role="listitem"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `<div class="fd-kpis" role="list">
      ${tile('Визитов к клиентам', k.visits, multi ? `${(k.visits / n).toFixed(1)} в день` : '')}
      ${tile('Разных клиентов', k.clients.size, k.out ? `вне маршрута: ${k.out}` : '')}
      ${tile('Время у клиентов', FIELD.mins(k.at), k.visits ? `средний визит ${FIELD.mins(k.avg)}` : '')}
      ${tile('Визитов дольше 30 мин', k.long, '', k.long ? 'warn' : '')}
      ${tile('Стоял не у клиентов', FIELD.mins(k.other), k.otherN ? `${k.otherN} остановок` : '', k.other > 2 * 3600000 * n ? 'bad' : '')}
      ${tile('Рабочий пробег', k.kmKnown ? Math.round(k.km) + ' км' : '—', k.kmKnown && multi ? `${Math.round(k.km / n)} км в день` : '')}
      ${tile('Заказы (LINKO)', FIELD.money(k.orders), k.rej ? `отказов: ${k.rej}` : '', 'ok')}
      ${tile('Оплаты (LINKO)', FIELD.money(k.paid), k.noRes ? `визитов без итога: ${k.noRes}` : '', 'ok')}
    </div>`;
  },

  initials: n => esc(String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()),
  // route progress as a small ring with the number beside it (colour is never the only signal)
  ring(done, plan) {
    const r = 15, C = 2 * Math.PI * r, f = plan ? Math.min(1, done / plan) : 0;
    return `<span class="fd-ring" role="img" aria-label="Маршрут LINKO: ${done} из ${plan}"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="${r}" class="bg"/><circle cx="20" cy="20" r="${r}" class="fg" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/></svg><b>${done}<small>/${plan}</small></b></span>`;
  },
  // the day 07–21 as a thin strip: client visits, other stops, now
  miniLine(r, now) {
    const T0 = 420, T1 = 1260, pos = t => Math.min(100, Math.max(0, (FIELD.minOfDay(t) - T0) / (T1 - T0) * 100));
    const stops = (r?.stops || []).filter(s => FIELD.minOfDay(s.b) > T0 && FIELD.minOfDay(s.a) < T1);
    return `<span class="fd-mini" aria-hidden="true">${stops.map(s => `<b class="fd-seg ${FIELD.kind(s)}" style="left:${pos(s.a).toFixed(1)}%;width:${Math.max(0.8, pos(s.b) - pos(s.a)).toFixed(1)}%"></b>`).join('')}${now ? `<i style="left:${pos(new Date().toISOString()).toFixed(1)}%"></i>` : ''}</span><span class="fd-mini-h" aria-hidden="true"><span>7</span><span>10</span><span>13</span><span>16</span><span>19</span><span>21</span></span>`;
  },
  nowCards(D) {
    if (!D.withToday || !D.live.length) return '';
    const t = FIELD.today(), WORD = { visit: 'У клиента', stop: 'Стоит', drive: 'В пути', off: 'Нет связи' };
    const cards = D.live.map(l => {
      const open = D.visits.find(v => v.device_id === l.device_id && !v.ended_at), age = Date.now() - Date.parse(l.fix_at || 0);
      const k = open ? 'visit' : age > 30 * 60000 ? 'off' : l.speed >= 3 ? 'drive' : 'stop';
      const r = D.rows.find(x => x.device_id === l.device_id && x.day === t), g = FIELD.agg(r ? [r] : []);
      const L = (r?.linko && Object.keys(r.linko).length ? r.linko : D.routes.find(x => x.agent_id === l.agent_id)?.stats) || {};
      const line = k === 'visit' ? `${FIELD.ic('store')}<span><b>${esc(open.place_name)}</b>${open.planned ? '' : ' <em class="fd-tag out">вне маршрута</em>'}</span><b class="fd-timer" data-since="${esc(open.started_at)}"></b>`
        : k === 'stop' ? `${FIELD.ic('pause')}<span>${l.near_name ? `у <b>${esc(l.near_name)}</b>` : 'не у клиента'}</span><b class="fd-timer" data-since="${esc(l.stop_since || l.fix_at)}"></b>`
          : k === 'drive' ? `${FIELD.ic('car')}<span>едет</span><b class="fd-big">${Math.round(l.speed)} <small>км/ч</small></b>`
            : `${FIELD.ic('off')}<span>с ${FIELD.hm(l.fix_at)}</span><b class="fd-big">${FIELD.mins(age)}</b>`;
      const last = (r?.stops || []).filter(FIELD.isClient).slice(-3).reverse();
      const o = { visit: 0, stop: 1, drive: 2, off: 3 }[k];
      return { o, t: open ? Date.parse(open.started_at) : 0, html: `<button type="button" class="fd-ac ${k}" data-fda="${esc(l.device_id)}" data-day="${t}">
        <span class="fd-ac-top"><span class="fd-av" aria-hidden="true">${FIELD.initials(l.device_name)}</span><span class="fd-ac-name"><b>${esc(l.device_name)}</b>${l.agent_name ? `<small>${esc(l.agent_name)}</small>` : ''}</span><span class="fd-pill">${WORD[k]}</span></span>
        <span class="fd-ac-now">${line}</span>
        ${FIELD.miniLine(r, true)}
        <span class="fd-ac-stats">${L.plan ? FIELD.ring(L.done || 0, L.plan) : ''}
          <span class="fd-st"><b>${g.visits}</b><small>визитов</small></span>
          <span class="fd-st"><b>${FIELD.mins(g.at)}</b><small>у клиентов</small></span>
          <span class="fd-st"><b>${FIELD.wkm(r) != null ? Math.round(FIELD.wkm(r)) : '—'}</b><small>рабочих км</small></span></span>
        <span class="fd-ac-money"><span class="${L.orders ? 'ok' : ''}">заказы <b>${FIELD.money(L.orders)}</b></span><span class="${L.paid ? 'ok' : ''}">оплаты <b>${FIELD.money(L.paid)}</b></span>${L.rejections ? `<span class="bad">отказы <b>${L.rejections}</b></span>` : ''}${g.otherN ? `<span>стоял не у клиентов <b>${FIELD.mins(g.other)}</b></span>` : ''}</span>
        ${last.length ? `<span class="fd-ac-last">${last.map(s => `<span><i class="${FIELD.kind(s)}"></i>${FIELD.hm(s.a)} ${esc(s.name)} · ${FIELD.mins(FIELD.stopMs(s))}</span>`).join('')}</span>` : '<span class="fd-ac-last mut">визитов к клиентам сегодня ещё нет</span>'}
        <span class="fd-ac-more">Подробнее →</span></button>` };
    }).sort((x, y) => x.o - y.o || x.t - y.t);
    return `<section class="fd-sec fd-nowsec"><h3>Сейчас <small>карточка — сегодняшний день агента; нажмите, чтобы открыть подробно</small></h3><div class="fd-acgrid">${cards.map(c => c.html).join('')}</div></section>`;
  },

  // km for the fuel: per agent over the period (the whole day by GPS — from home and back home), with a cost estimate
  FUEL: { petrol: ['Бензин', 'л'], propane: ['Пропан', 'л'], methane: ['Метан', 'м³'] },
  fuelOf: id => { try { return JSON.parse(localStorage.getItem('fd_fuel_' + id) || '{}'); } catch { return {}; } },
  mileage(D) {
    const rows = D.agents.map(a => {
      const rs = D.rows.filter(r => r.device_id === a.id && FIELD.wkm(r) != null);
      const km = rs.reduce((s, r) => s + (FIELD.wkm(r) || 0), 0), max = rs.reduce((m, r) => Math.max(m, FIELD.wkm(r) || 0), 0), all = rs.reduce((s, r) => s + (+r.km || 0), 0);
      const f = FIELD.fuelOf(a.id), cost = f.rate > 0 && f.price > 0 ? km * f.rate / 100 * f.price : null;
      return { a, rs, km, all, max, f, cost };
    }).filter(x => x.rs.length);
    if (!rows.length) return '';
    const tot = rows.reduce((s, x) => s + x.km, 0), totAll = rows.reduce((s, x) => s + x.all, 0), totCost = rows.reduce((s, x) => s + (x.cost || 0), 0);
    const [a, b] = D.range;
    return `<section class="fd-sec"><h3>Пробег и топливо <small>${a === b ? FIELD.dlabel(a, true) : FIELD.dlabel(a) + ' – ' + FIELD.dlabel(b)} · рабочий пробег: поездки с 07:00 до 22:00 — из дома, по клиентам и обратно домой</small></h3>
      <div class="tscroll"><table class="fd-tab fd-km"><thead><tr><th scope="col">Агент</th><th scope="col">Дней с движением</th><th scope="col">Рабочие км</th><th scope="col">Всего за сутки</th><th scope="col">В среднем за день</th><th scope="col">Самый длинный день</th><th scope="col">Топливо</th><th scope="col">Расход на 100 км</th><th scope="col">Цена, сум</th><th scope="col">Расходы, сум</th></tr></thead><tbody>
      ${rows.map(x => `<tr><th scope="row"><button type="button" class="fd-link" data-fda="${esc(x.a.id)}">${esc(x.a.name)}</button></th><td>${x.rs.length}</td><td><b>${UI.fmt0(Math.round(x.km))}</b> км</td><td>${UI.fmt0(Math.round(x.all))} км</td><td>${Math.round(x.km / x.rs.length)} км</td><td>${Math.round(x.max)} км</td>
        <td><select data-fuel="${esc(x.a.id)}" data-k="type" aria-label="Топливо: ${esc(x.a.name)}">${Object.entries(FIELD.FUEL).map(([v, [n]]) => `<option value="${v}" ${(x.f.type || 'petrol') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td><input type="number" min="0" step="0.1" inputmode="decimal" data-fuel="${esc(x.a.id)}" data-k="rate" value="${x.f.rate ?? ''}" placeholder="${FIELD.FUEL[x.f.type || 'petrol'][1]}" aria-label="Расход на 100 км: ${esc(x.a.name)}"></td>
        <td><input type="number" min="0" step="100" inputmode="numeric" data-fuel="${esc(x.a.id)}" data-k="price" value="${x.f.price ?? ''}" placeholder="за ${FIELD.FUEL[x.f.type || 'petrol'][1]}" aria-label="Цена топлива: ${esc(x.a.name)}"></td>
        <td><b>${x.cost != null ? UI.fmt0(Math.round(x.cost)) : '—'}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><th scope="row">Итого</th><td></td><td><b>${UI.fmt0(Math.round(tot))}</b> км</td><td>${UI.fmt0(Math.round(totAll))} км</td><td colspan="5"></td><td><b>${totCost ? UI.fmt0(Math.round(totCost)) : '—'}</b></td></tr></tfoot></table></div>
      <p class="mut fd-note">Рабочий пробег — поездки по GPS с 07:00 до 22:00: от выхода из дома до возвращения домой; поездка через границу 07:00 или 22:00 считается только своей частью внутри. «Всего за сутки» — весь пробег трекера за 00:00–24:00, вместе с личными поездками. Расходы считаются по рабочему пробегу. Для периода плана нажмите «План 16–15». Расход и цену впишите один раз — они запомнятся на этом устройстве для каждого агента. Сегодняшний пробег обновляется каждые 15 минут.</p></section>`;
  },

  // the agent opened: his numbers over the period and, over several days, km and visits by day
  agentBlock(D, devId) {
    const rows = D.rows.filter(r => r.device_id === devId);
    let html = FIELD.kpis({ rows, days: D.days });
    const days = D.days.filter(d => rows.some(r => r.day === d));
    if (days.length > 1) {
      const by = d => rows.find(r => r.day === d), mk = Math.max(1, ...days.map(d => FIELD.wkm(by(d)) || 0)), mv = Math.max(1, ...days.map(d => FIELD.agg([by(d)]).visits));
      const bars = (label, val, max) => `<div class="fd-chart"><h4>${label}</h4><div class="fd-bars">${days.map(d => { const v = val(by(d)); return `<button type="button" class="fd-bar1" data-fda="${esc(devId)}" data-day="${d}" title="${FIELD.dlabel(d, true)}: ${v}"><span class="v">${v}</span><span class="b" style="height:${Math.max(2, v / max * 100).toFixed(0)}%"></span><span class="d">${d.slice(8)}</span></button>`; }).join('')}</div></div>`;
      html += `<div class="fd-charts">${bars('Рабочий пробег по дням, км', r => Math.round(FIELD.wkm(r) || 0), mk)}${bars('Визиты к клиентам по дням', r => FIELD.agg([r]).visits, mv)}</div>`;
    }
    return html;
  },

  table(D) {
    const rows = D.agents.map(a => ({ a, k: FIELD.agg(D.rows.filter(r => r.device_id === a.id)) })).filter(x => x.k.nDays).sort((x, y) => y.k.visits - x.k.visits);
    if (!rows.length) return '';
    const multi = D.days.length > 1;
    return `<section class="fd-sec"><h3>Агенты за период <small>нажмите на имя — откроется день агента</small></h3><div class="tscroll"><table class="fd-tab"><thead><tr>
      <th scope="col">Агент</th>${multi ? '<th scope="col">Дней</th>' : ''}<th scope="col">Визиты</th>${multi ? '<th scope="col">в день</th>' : ''}<th scope="col">Клиентов</th><th scope="col">Вне маршрута</th><th scope="col">У клиентов</th><th scope="col">Средний</th><th scope="col">&gt;30 мин</th><th scope="col">Не у клиентов</th><th scope="col">Км</th><th scope="col">Начало</th><th scope="col">Конец</th><th scope="col">Заказы</th><th scope="col">Оплаты</th><th scope="col">Отказы</th><th scope="col">Без итога</th></tr></thead><tbody>
      ${rows.map(({ a, k }) => `<tr><th scope="row"><button type="button" class="fd-link" data-fda="${esc(a.id)}">${esc(a.name)}</button>${a.linko ? `<small>${esc(a.linko)}</small>` : ''}</th>
        ${multi ? `<td>${k.nDays}</td>` : ''}<td><b>${k.visits}</b></td>${multi ? `<td>${(k.visits / k.nDays).toFixed(1)}</td>` : ''}<td>${k.clients.size}</td><td>${k.out || ''}</td><td>${FIELD.mins(k.at)}</td><td>${k.visits ? FIELD.mins(k.avg) : '—'}</td>
        <td class="${k.long ? 'neg' : ''}">${k.long || ''}</td><td class="${k.other > 2 * 3600000 * k.nDays ? 'neg' : ''}">${k.otherN ? FIELD.mins(k.other) : ''}</td><td>${k.kmKnown ? Math.round(k.km) : '—'}</td>
        <td>${FIELD.hhmm(k.first)}</td><td>${FIELD.hhmm(k.last)}</td><td>${k.orders ? FIELD.money(k.orders) : ''}</td><td>${k.paid ? FIELD.money(k.paid) : ''}</td><td>${k.rej || ''}</td><td class="${k.noRes ? 'neg' : ''}">${k.noRes || ''}</td></tr>`).join('')}
    </tbody></table></div><p class="mut fd-note">«Начало» и «Конец» — первое и последнее движение по GPS (в среднем за дни периода). «Не у клиентов» — остановки дольше 2 минут с 7:00 до 21:00 там, где рядом нет ни одного клиента. «Без итога» — визиты, после которых за 2 часа в LINKO не появилось ни заказа, ни оплаты, ни отказа. Заказы и оплаты — суммы LINKO за день.</p></section>`;
  },

  heat(D) {
    if (D.days.length < 2 || !D.agents.length) return '';
    const cell = (a, d) => { const r = D.rows.find(x => x.device_id === a.id && x.day === d); return r ? FIELD.agg([r]) : null; };
    const max = Math.max(1, ...D.agents.flatMap(a => D.days.map(d => cell(a, d)?.visits || 0)));
    return `<section class="fd-sec"><h3>По дням <small>число — визиты к клиентам, чем темнее — тем больше; нажмите на день</small></h3><div class="tscroll"><table class="fd-heat"><thead><tr><th scope="col">Агент</th>${D.days.map(d => `<th scope="col" class="${['сб', 'вс'].includes(FIELD.wd(d)) ? 'we' : ''}"><span>${FIELD.wd(d)}</span>${d.slice(8)}</th>`).join('')}</tr></thead><tbody>
      ${D.agents.map(a => `<tr><th scope="row">${esc(a.name)}</th>${D.days.map(d => { const k = cell(a, d); if (!k) return '<td class="nil"><span aria-label="нет данных">·</span></td>'; const lvl = Math.ceil(k.visits / max * 4);
        return `<td><button type="button" class="fd-hc l${lvl}" data-fda="${esc(a.id)}" data-day="${d}" title="${esc(a.name)}, ${FIELD.dlabel(d, true)}: визитов ${k.visits}, у клиентов ${FIELD.mins(k.at)}${k.kmKnown ? ', ' + Math.round(k.km) + ' км' : ''}${k.orders ? ', заказы ' + FIELD.money(k.orders) : ''}">${k.visits}</button></td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div></section>`;
  },

  // the day of one agent: timeline 07–21, every stop, map
  dayView(D, devId, day) {
    const r = D.rows.find(x => x.device_id === devId && x.day === day), a = D.agents.find(x => x.id === devId);
    const days = D.days.filter(d => D.rows.some(x => x.device_id === devId && x.day === d));
    const nav = days.length > 1 ? `<div class="fd-dnav" role="group" aria-label="День">${days.map(d => `<button type="button" class="fd-chip ${d === day ? 'on' : ''}" data-fda="${esc(devId)}" data-day="${d}" aria-pressed="${d === day}">${FIELD.dlabel(d)}</button>`).join('')}</div>` : '';
    const head = `<div class="fd-dhead"><div class="fd-dname"><span class="fd-av" aria-hidden="true">${FIELD.initials(a?.name)}</span><span><h3>${esc(a?.name || '')}</h3>${a?.linko ? `<small class="mut">${esc(a.linko)}</small>` : ''}</span></div><button type="button" class="btn gray sm" id="fdClose">${FIELD.ic('x')} Закрыть</button></div>`;
    const agentBox = FIELD.agentBlock(D, devId);
    if (!r) return `<section class="fd-sec fd-day" id="fdDay">${head}${agentBox}${nav}<p class="mut">За этот день данных нет.</p></section>`;
    const k = FIELD.agg([r]), L = r.linko || {};
    const T0 = 7 * 60, T1 = 21 * 60, pos = t => Math.min(100, Math.max(0, (FIELD.minOfDay(t) - T0) / (T1 - T0) * 100));
    const stops = (r.stops || []).filter(s => FIELD.minOfDay(s.b) > T0 && FIELD.minOfDay(s.a) < T1);
    const bar = `<div class="fd-tl" role="img" aria-label="День агента с 7:00 до 21:00: ${k.visits} визитов к клиентам, ${k.otherN} остановок не у клиентов">
      ${[8, 10, 12, 14, 16, 18, 20].map(h => `<i class="fd-hr" style="left:${((h * 60 - T0) / (T1 - T0) * 100).toFixed(2)}%"><span>${h}</span></i>`).join('')}
      ${stops.map(s => `<b class="fd-seg ${FIELD.kind(s)}" style="left:${pos(s.a).toFixed(2)}%;width:${Math.max(0.6, pos(s.b) - pos(s.a)).toFixed(2)}%" title="${FIELD.hm(s.a)}–${FIELD.hm(s.b)} ${esc(s.name || 'не у клиента')}"></b>`).join('')}
    </div><div class="fd-legend"><span><i class="sale"></i>заказ или оплата</span><span><i class="client"></i>клиент без итога</span><span><i class="rej"></i>отказ</span><span><i class="other"></i>стоял не у клиента</span><span><i class="drive"></i>в пути</span></div>`;
    const list = stops.map((s, i) => {
      const ms = FIELD.stopMs(s), outs = (s.out || []).map(t => { const [c, w] = FIELD.OUT[t.type] || ['', t.type]; return `<span class="fd-out ${c}">${w}: ${esc(String(t.text).replace(/^Оформили заказ |^Оплатили |^Отказ: |^Обслуживание заняло /, ''))}</span>`; }).join('');
      return `<li class="${FIELD.kind(s)}"><span class="fd-n">${i + 1}</span><span class="fd-t">${FIELD.hm(s.a)}–${FIELD.hm(s.b)}</span><span class="fd-c">${FIELD.isClient(s) ? `<b>${esc(s.name)}</b>${s.planned ? ' <em class="fd-tag">маршрут</em>' : ' <em class="fd-tag out">вне маршрута</em>'}` : `<span class="mut">${r.first_at && Date.parse(s.a) < Date.parse(r.first_at) - 60000 ? 'до первой поездки' : r.last_at && Date.parse(s.b) > Date.parse(r.last_at) + 60000 ? 'после последней поездки' : 'стоял не у клиента'}</span>`}</span><span class="fd-d ${FIELD.isClient(s) && ms >= 45 * 60000 ? 'neg' : ''}">${FIELD.mins(ms)}</span>${outs ? `<span class="fd-outs">${outs}</span>` : FIELD.isClient(s) ? `<span class="fd-outs mut">${Date.now() - Date.parse(s.b) > 2 * 3600000 ? 'в LINKO ничего не отмечено' : 'ждём, что отметят в LINKO'}</span>` : ''}</li>`;
    }).join('');
    return `<section class="fd-sec fd-day" id="fdDay">${head}${agentBox}<h4 class="fd-h4">День: ${FIELD.dlabel(day, true)}</h4>${nav}
      <div class="fd-dstats"><span>визитов <b>${k.visits}</b></span><span>у клиентов <b>${FIELD.mins(k.at)}</b></span><span>не у клиентов <b>${FIELD.mins(k.other)}</b></span><span>в пути <b>${r.move_s ? FIELD.mins(r.move_s * 1000) : '—'}</b></span><span>рабочий пробег <b>${FIELD.wkm(r) != null ? Math.round(FIELD.wkm(r)) + ' км' : '—'}</b>${r.km != null && r.work_km != null ? ` <small class="mut">(за сутки ${Math.round(r.km)})</small>` : ''}</span>${r.home_out ? `<span>вышел из дома <b>${FIELD.hm(r.home_out)}</b></span><span>${r.home_in ? `вернулся домой <b>${FIELD.hm(r.home_in)}</b>` : '<b>домой до 22:00 не вернулся</b>'}</span>` : `<span>движение <b>${FIELD.hm(r.first_at)}–${FIELD.hm(r.last_at)}</b></span>`}${L.plan ? `<span>маршрут LINKO <b>${L.done || 0}/${L.plan}</b></span><span>заказы <b>${FIELD.money(L.orders)}</b></span><span>оплаты <b>${FIELD.money(L.paid)}</b></span>${L.rejections ? `<span>отказы <b>${L.rejections}</b></span>` : ''}` : ''}</div>
      ${bar}
      <div class="fd-dgrid"><ol class="fd-stops">${list || '<li class="mut">Остановок нет.</li>'}</ol><div class="fd-map" id="fdMap" role="region" aria-label="Карта остановок"></div></div>
      ${r.live ? '<p class="mut fd-note">Пока показаны визиты, найденные в течение дня; полная картина по GPS-истории (пробег, остановки не у клиентов) обновляется каждые 15 минут.</p>' : ''}
      <p class="mut fd-note">О чём агент говорил с клиентом, узнать нельзя: LINKO не передаёт записи разговоров.</p></section>`;
  },

  async drawMap(D, devId, day) {
    const box = document.getElementById('fdMap'); if (!box) return;
    const r = D.rows.find(x => x.device_id === devId && x.day === day), pts = (r?.stops || []).filter(s => isFinite(+s.lat) && +s.lat && FIELD.minOfDay(s.b) > 420 && FIELD.minOfDay(s.a) < 1260);
    if (!pts.length) { box.innerHTML = '<p class="mut" style="padding:12px">Нет точек для карты.</p>'; return; }
    try { await Promise.all([loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'), loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js')]); } catch { box.innerHTML = '<p class="mut" style="padding:12px">Карта не загрузилась.</p>'; return; }
    if (!box.isConnected) return;
    if (FIELD.map) { try { FIELD.map.remove(); } catch { /* old map */ } }
    const L = window.L, m = FIELD.map = L.map(box, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const ll = pts.map(s => [+s.lat, +s.lon]);
    L.polyline(ll, { color: '#8e8e93', weight: 2, dashArray: '4 6' }).addTo(m);
    pts.forEach((s, i) => L.marker([+s.lat, +s.lon], { icon: L.divIcon({ className: '', html: `<span class="fd-pin ${FIELD.kind(s)}">${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
      .addTo(m).bindPopup(`<b>${i + 1}. ${esc(s.name || 'не у клиента')}</b><br>${FIELD.hm(s.a)}–${FIELD.hm(s.b)} · ${FIELD.mins(FIELD.stopMs(s))}`));
    m.fitBounds(L.latLngBounds(ll).pad(0.2));
  },

  feed(D) {
    if (!D.withToday || !D.events.length) return '';
    return `<details class="fd-sec fd-feedbox"><summary><h3>Лента событий сегодня <small>${D.events.length}</small></h3></summary><ul class="fd-feed">${D.events.slice(0, 120).map(e => `<li class="${e.kind === 'alert' && e.minutes >= 45 ? 'bad' : e.kind === 'alert' ? 'warn' : ''}"><span class="fd-t">${FIELD.hm(e.created_at)}</span><span>${esc(String(e.text)).replace(/\n/g, '<br>')}</span></li>`).join('')}</ul></details>`;
  },

  css() {
    if (document.getElementById('fdCss')) return;
    const s = document.createElement('style'); s.id = 'fdCss';
    s.textContent = `
.fd-i{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-4px}
.fd-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 16px}
.fd-seg-c{display:inline-flex;background:var(--fill);border-radius:12px;padding:3px;gap:2px;flex-wrap:wrap}
.fd-seg-c button{border:0;background:none;color:inherit;font:inherit;font-size:14px;padding:8px 14px;border-radius:9px;min-height:38px;cursor:pointer;transition:background .15s}
.fd-seg-c button[aria-pressed=true]{background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.18);font-weight:600}
.fd-seg-c button:focus-visible,.fd-link:focus-visible,.fd-hc:focus-visible,.fd-now:focus-visible,.fd-chip:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
.fd-bar select,.fd-bar input[type=date]{min-height:40px;max-width:100%}
.fd-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(170px,100%),1fr));gap:10px;margin:0 0 16px}
.fd-kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.fd-kpi span,.fd-kpi small{font-size:12px;color:var(--text-2,var(--muted))}.fd-kpi b{font-size:24px;font-variant-numeric:tabular-nums;line-height:1.25}
.fd-kpi.warn b{color:var(--st-warn-text,var(--st-warn))}.fd-kpi.bad b{color:var(--st-crit-text,var(--st-crit))}.fd-kpi.ok b{color:var(--st-good-text,var(--st-good))}
.fd-sec{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin:0 0 16px;min-width:0}
.fd-sec h3{margin:0 0 10px;font-size:17px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.fd-sec h3 small{font-weight:400;font-size:12px;color:var(--text-2,var(--muted))}
.fd-nowgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:8px}
.fd-now{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:12px;background:var(--fill);min-height:44px;transition:transform .15s}
.fd-now:hover{transform:translateY(-1px)}.fd-now-n{font-weight:600}.fd-now-s{display:flex;align-items:center;gap:8px;font-size:14px}.fd-now-s>span{flex:1;min-width:0;overflow-wrap:anywhere}
.fd-now.visit{background:var(--tint-soft,color-mix(in srgb,var(--tint) 15%,transparent))}.fd-now.off{opacity:.65}
.fd-timer{font-variant-numeric:tabular-nums;font-size:17px}.fd-timer.t15{color:var(--st-warn-text)}.fd-timer.t30{color:var(--st-serious-text)}.fd-timer.t45{color:var(--st-crit-text)}
.fd-tag{font-style:normal;font-size:11px;border-radius:6px;padding:1px 6px;background:var(--st-good-bg);color:var(--st-good-text);white-space:nowrap}.fd-tag.out{background:var(--st-warn-bg);color:var(--st-warn-text)}
.fd-tab th,.fd-tab td{white-space:nowrap;font-variant-numeric:tabular-nums}.fd-tab tbody th{text-align:left;white-space:normal;min-width:150px}.fd-tab tbody th small{display:block;font-weight:400;font-size:11px;color:var(--text-2,var(--muted))}
.fd-link{all:unset;cursor:pointer;font-weight:600;color:var(--tint)}.fd-link:hover{text-decoration:underline}
.fd-note{font-size:12px;margin:8px 0 0}
.fd-heat{border-collapse:separate;border-spacing:3px}.fd-heat th{font-size:11px;font-weight:500;color:var(--text-2,var(--muted));text-align:center}.fd-heat thead th span{display:block}.fd-heat th.we{color:var(--st-crit-text)}
.fd-heat tbody th{text-align:left;white-space:nowrap;font-size:13px;color:inherit;padding-right:8px}.fd-heat td{padding:0}.fd-heat td.nil{text-align:center;color:var(--text-2,var(--muted))}
.fd-hc{all:unset;cursor:pointer;display:block;width:34px;height:30px;line-height:30px;text-align:center;border-radius:6px;font-size:12px;font-variant-numeric:tabular-nums;background:var(--fill)}
.fd-hc.l1{background:color-mix(in srgb,var(--tint) 22%,var(--fill))}.fd-hc.l2{background:color-mix(in srgb,var(--tint) 42%,var(--fill))}.fd-hc.l3{background:color-mix(in srgb,var(--tint) 66%,var(--fill));color:#fff}.fd-hc.l4{background:var(--tint);color:#fff;font-weight:700}
.fd-day{scroll-margin-top:80px;border-color:var(--tint)}.fd-dhead{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.fd-dhead h3{margin:0}
.fd-dnav{display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px}.fd-chip{all:unset;cursor:pointer;white-space:nowrap;padding:6px 12px;border-radius:999px;background:var(--fill);font-size:13px;min-height:32px;box-sizing:border-box;display:inline-flex;align-items:center}.fd-chip.on{background:var(--tint);color:#fff}
.fd-dstats{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:8px 0 6px}.fd-dstats b{font-variant-numeric:tabular-nums}
.fd-tl{position:relative;height:40px;border-radius:8px;background:repeating-linear-gradient(90deg,transparent 0 6px,color-mix(in srgb,var(--text-2,#888) 14%,transparent) 6px 8px);margin:24px 0 6px}
.fd-hr{position:absolute;top:-18px;bottom:0;border-left:1px dashed var(--line)}.fd-hr span{position:absolute;top:0;left:3px;font-size:11px;font-style:normal;color:var(--text-2,var(--muted))}
.fd-seg{position:absolute;top:4px;bottom:4px;border-radius:4px;min-width:3px}
.fd-seg.sale,.fd-legend .sale,.fd-pin.sale{background:var(--st-good,#30a46c)}.fd-seg.client,.fd-legend .client,.fd-pin.client{background:var(--tint)}
.fd-seg.rej,.fd-legend .rej,.fd-pin.rej{background:var(--st-crit,#e5484d)}.fd-seg.other,.fd-legend .other,.fd-pin.other{background:#8e8e93}
.fd-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--text-2,var(--muted));margin:0 0 14px}.fd-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:4px}
.fd-legend .drive{background:repeating-linear-gradient(90deg,transparent 0 3px,color-mix(in srgb,var(--text-2,#888) 35%,transparent) 3px 5px);border:1px solid var(--line)}
.fd-dgrid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}@media (max-width:900px){.fd-dgrid{grid-template-columns:1fr}}
.fd-map{min-height:360px;border-radius:12px;overflow:hidden;background:var(--fill)}
.fd-stops{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:540px;overflow:auto}
.fd-stops li{display:grid;grid-template-columns:22px auto minmax(0,1fr) auto;gap:2px 10px;align-items:baseline;padding:8px 10px;border-radius:10px;background:var(--fill);border-left:4px solid transparent;font-size:14px}
.fd-stops li.sale{border-left-color:var(--st-good)}.fd-stops li.client{border-left-color:var(--tint)}.fd-stops li.rej{border-left-color:var(--st-crit)}.fd-stops li.other{border-left-color:#8e8e93}
.fd-n{font-size:12px;color:var(--text-2,var(--muted));font-variant-numeric:tabular-nums}.fd-t{font-variant-numeric:tabular-nums;color:var(--text-2,var(--muted));font-size:13px}.fd-c{overflow-wrap:anywhere}.fd-d{font-variant-numeric:tabular-nums}
.fd-outs{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px 8px;font-size:13px}
.fd-out{border-radius:6px;padding:1px 7px;background:var(--card)}.fd-out.ok{background:var(--st-good-bg);color:var(--st-good-text)}.fd-out.bad{background:var(--st-crit-bg);color:var(--st-crit-text)}.fd-out.warn{background:var(--st-warn-bg);color:var(--st-warn-text)}
.fd-pin{display:flex;width:24px;height:24px;border-radius:50%;color:#fff;font:600 12px/24px system-ui;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.fd-feedbox summary{cursor:pointer;list-style:none}.fd-feedbox summary h3{margin:0}.fd-feedbox summary::-webkit-details-marker{display:none}
.fd-feed{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px;max-height:420px;overflow:auto}
.fd-feed li{display:flex;gap:10px;padding:5px 8px;border-radius:8px;border-left:3px solid transparent}.fd-feed li.warn{border-left-color:var(--st-warn)}.fd-feed li.bad{border-left-color:var(--st-crit)}.fd-feed li span:last-child{flex:1;min-width:0;overflow-wrap:anywhere}
.fd-set label{display:block;margin:10px 0 4px;font-weight:600}.fd-set input[type=text],.fd-set input[type=number]{width:100%}
.fd-acgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:12px}
.fd-ac{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;min-width:0;position:relative;overflow:hidden;background:linear-gradient(160deg,color-mix(in srgb,var(--ac,#8e8e93) 16%,var(--card)) 0%,var(--card) 55%);border:1px solid color-mix(in srgb,var(--ac,#8e8e93) 35%,var(--line));transition:transform .18s,box-shadow .18s}
.fd-ac:hover{transform:translateY(-2px);box-shadow:0 10px 28px -12px color-mix(in srgb,var(--ac,#000) 60%,transparent)}.fd-ac:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
.fd-ac.visit{--ac:var(--tint)}.fd-ac.stop{--ac:var(--st-warn,#d98a00)}.fd-ac.drive{--ac:var(--st-good,#30a46c)}.fd-ac.off{--ac:#8e8e93}
.fd-ac-top{display:flex;align-items:center;gap:10px;min-width:0}.fd-ac-name{flex:1;min-width:0;display:flex;flex-direction:column}.fd-ac-name b{font-size:15px;overflow-wrap:anywhere}.fd-ac-name small{font-size:12px;color:var(--text-2,var(--muted))}
.fd-av{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;background:var(--ac,var(--tint));box-shadow:0 0 0 3px color-mix(in srgb,var(--ac,var(--tint)) 30%,transparent)}
.fd-ac.visit .fd-av{animation:fdPulse 2s ease-in-out infinite}@keyframes fdPulse{50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--ac) 12%,transparent)}}
.fd-pill{flex:none;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--ac) 20%,transparent);color:var(--text)}
.fd-ac-now{display:flex;align-items:center;gap:8px;font-size:14px;padding:8px 10px;border-radius:10px;background:var(--fill)}.fd-ac-now>span{flex:1;min-width:0;overflow-wrap:anywhere}
.fd-ac .fd-timer{font-size:22px;font-weight:700;letter-spacing:.5px}.fd-big{font-size:18px}.fd-big small{font-size:12px;font-weight:400}
.fd-mini{position:relative;display:block;height:10px;border-radius:5px;background:var(--fill);overflow:hidden}.fd-mini .fd-seg{top:0;bottom:0;border-radius:0}.fd-mini i{position:absolute;top:0;bottom:0;width:2px;background:var(--text)}
.fd-mini-h{display:flex;justify-content:space-between;font-size:10px;color:var(--text-2,var(--muted));margin-top:-6px}
.fd-ac-stats{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.fd-st{display:flex;flex-direction:column;line-height:1.15}.fd-st b{font-size:18px;font-variant-numeric:tabular-nums}.fd-st small{font-size:11px;color:var(--text-2,var(--muted))}
.fd-ring{display:inline-flex;align-items:center;gap:6px}.fd-ring svg{width:40px;height:40px}.fd-ring circle{fill:none;stroke-width:5}.fd-ring .bg{stroke:var(--fill)}.fd-ring .fg{stroke:var(--st-good,#30a46c);stroke-linecap:round}
.fd-ring b{font-size:18px;font-variant-numeric:tabular-nums;line-height:1}.fd-ring small{font-size:12px;font-weight:400;color:var(--text-2,var(--muted))}
.fd-ac-money{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:var(--text-2,var(--muted))}.fd-ac-money b{color:var(--text);font-variant-numeric:tabular-nums}.fd-ac-money .ok b{color:var(--st-good-text)}.fd-ac-money .bad b{color:var(--st-crit-text)}
.fd-ac-last{display:flex;flex-direction:column;gap:3px;font-size:12px;border-top:1px solid var(--line);padding-top:8px}.fd-ac-last>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-ac-last i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}.fd-ac-last i.sale{background:var(--st-good)}.fd-ac-last i.client{background:var(--tint)}.fd-ac-last i.rej{background:var(--st-crit)}
.fd-ac-more{font-size:12px;font-weight:600;color:var(--tint);align-self:flex-end}
.fd-dname{display:flex;align-items:center;gap:10px}.fd-dname .fd-av{--ac:var(--tint)}.fd-h4{margin:14px 0 2px;font-size:15px}
.fd-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:14px;margin:0 0 8px}.fd-chart{background:var(--fill);border-radius:12px;padding:10px 12px;min-width:0}.fd-chart h4{margin:0 0 6px;font-size:13px;font-weight:600}
.fd-bars{display:flex;align-items:flex-end;gap:3px;height:130px;overflow-x:auto}.fd-bar1{all:unset;cursor:pointer;flex:1 0 18px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px}
.fd-bar1 .b{width:100%;max-width:26px;border-radius:4px 4px 0 0;background:var(--tint);min-height:2px}.fd-bar1:hover .b{filter:brightness(1.2)}.fd-bar1:focus-visible{outline:2px solid var(--tint)}
.fd-bar1 .v,.fd-bar1 .d{font-size:10px;font-variant-numeric:tabular-nums;color:var(--text-2,var(--muted))}
.fd-km input,.fd-km select{width:96px;min-height:34px}.fd-km tfoot th,.fd-km tfoot td{font-weight:600;border-top:2px solid var(--line)}
@media (prefers-reduced-motion:reduce){.fd-now,.fd-seg-c button,.fd-ac{transition:none}.fd-now:hover,.fd-ac:hover{transform:none}.fd-ac.visit .fd-av{animation:none}}`;
    document.head.appendChild(s);
  },

  paintTimers(root) {
    for (const t of root.querySelectorAll('[data-since]')) {
      const ms = Date.now() - Date.parse(t.dataset.since); t.textContent = FIELD.dur(ms);
      const m = ms / 60000; t.classList.toggle('t15', m >= 15 && m < 30); t.classList.toggle('t30', m >= 30 && m < 45); t.classList.toggle('t45', m >= 45);
    }
  },

  settings(D, redraw) {
    const cfg = D.cfg[0]; if (!cfg) return toast('Настройки «Пульса» меняет администратор');
    const m = modal(`<h3>Настройки «Пульса»</h3><div class="fd-set">
      <label><input type="checkbox" id="fsOn" ${cfg.enabled ? 'checked' : ''}> следить за агентами</label>
      <label for="fsAl">Уведомления, минут у клиента</label><input type="text" id="fsAl" value="${esc((cfg.alerts || []).join(', '))}" placeholder="15, 30, 45">
      <label for="fsR">Радиус вокруг клиента, м</label><input type="number" id="fsR" min="30" max="500" value="${cfg.radius_m}">
      <label for="fsS">Визит начинается, когда агент стоит у клиента, секунд</label><input type="number" id="fsS" min="30" max="1800" value="${cfg.min_stop_s}">
      <p class="mut fd-note">Агент привязан к GPS по имени в его аккаунте CRM («Пользователи» → имя в LINKO). Точки «… 007 …», «… уй» — личные точки агентов, не клиенты.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn gray" id="fsX" type="button">Отмена</button><button class="btn" id="fsOk" type="button">Сохранить</button></div></div>`);
    const q = s => m.querySelector(s), close = () => (typeof m.close === 'function' ? m.close() : m.remove());
    q('#fsX').onclick = close;
    q('#fsOk').onclick = async () => {
      const alerts = [...new Set(q('#fsAl').value.split(/[^\d]+/).map(Number).filter(n => n > 0 && n <= 600))].sort((a, b) => a - b);
      const patch = { enabled: q('#fsOn').checked, alerts: alerts.length ? alerts : [15, 30, 45], radius_m: Math.min(500, Math.max(30, +q('#fsR').value || 100)), min_stop_s: Math.min(1800, Math.max(30, +q('#fsS').value || 120)), updated_at: new Date().toISOString() };
      const { error } = await FIELD.sb().from('field_config').update(patch).eq('owner_id', cfg.owner_id);
      if (error) return toast('Не сохранилось: ' + error.message);
      toast('Сохранено — сервер применит со следующей минуты'); close(); redraw();
    };
  },

  // ---------- notifications while the CRM is open ----------
  async watch() {
    clearTimeout(FIELD.watchT);
    FIELD.watchT = setTimeout(FIELD.watch, 60000);
    const p = FIELD.me(); if (!FIELD.sb() || !p || !['admin', 'rop', 'supervisor'].includes(p.role)) return;
    try {
      const day = FIELD.today(), sups = await FIELD.sups(), scope = FIELD.scope(sups);
      const key = 'seen_' + day, raw = FIELD.ls(key), last = +(raw || 0);
      const { data } = await FIELD.sb().from('field_events').select('id,supervisor_id,kind,minutes,text').eq('day', day).gt('id', last).order('id').limit(50);
      if (!data?.length) { if (raw == null) FIELD.ls(key, '0'); return; }
      FIELD.ls(key, String(data[data.length - 1].id));
      if (raw == null) return; // the first look today: no flood of the morning's events
      const mine = data.filter(e => FIELD.inScope(e, scope) && e.kind !== 'outcome');
      for (const e of mine.slice(-3)) toast(String(e.text).split('\n')[0]);
      if (mine.length && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification('Пульс: ' + (mine.length > 1 ? `${mine.length} событий` : String(mine[0].text).split('\n')[0]), { body: mine.slice(-3).map(x => String(x.text).split('\n')[0]).join('\n'), tag: 'field' }); } catch { /* not allowed here */ }
      }
    } catch { /* offline: next minute */ }
  },
};

EXT_PAGES.field = async el => {
  clearInterval(FIELD.timer); clearInterval(FIELD.tick);
  FIELD.css();
  const S = FIELD.st;
  S.period = FIELD.ls('period') || 'today';
  const PER = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['30', '30 дней'], ['plan', 'План 16–15'], ['custom', 'Период']];
  el.innerHTML = `<div class="page-head"><div><h2>Пульс</h2><div class="sub" id="fdSub">Загружаю…</div></div>
    <div class="actions"><button class="btn gray" id="fdBell" type="button" hidden>${FIELD.ic('bell')} Уведомления</button><button class="btn gray" id="fdSet" type="button" hidden>${FIELD.ic('gear')} Настройки</button><a class="btn gray" href="#/gps">${FIELD.ic('map')} Карта</a></div></div>
    <div class="fd-bar"><div class="fd-seg-c" role="group" aria-label="Период">${PER.map(([v, t]) => `<button type="button" data-p="${v}" aria-pressed="${S.period === v}">${t}</button>`).join('')}</div>
      <span id="fdCustom" ${S.period === 'custom' ? '' : 'hidden'}><input type="date" id="fdFrom" aria-label="С какого дня"> – <input type="date" id="fdTo" aria-label="По какой день"></span>
      <select id="fdAgent" aria-label="Агент"><option value="">Все агенты</option></select>
      <select id="fdScope" hidden aria-label="Чьи агенты"></select></div>
    <div id="fdBody"></div>`;
  const t = FIELD.today();
  for (const id of ['#fdFrom', '#fdTo']) $(id, el).max = t;
  $('#fdFrom', el).value = S.from || FIELD.addDays(t, -6); $('#fdTo', el).value = S.to || t;
  if (!S.from) S.from = $('#fdFrom', el).value; if (!S.to) S.to = $('#fdTo', el).value;
  const bell = $('#fdBell', el);
  if ('Notification' in window && Notification.permission === 'default') {
    bell.hidden = false;
    bell.onclick = async () => { try { await Notification.requestPermission(); } catch { /* ignored */ } bell.hidden = Notification.permission !== 'default'; toast(Notification.permission === 'granted' ? 'Уведомления включены — придут, даже когда вкладка свёрнута' : 'Уведомления не разрешены'); };
  }
  let D = null, busy = false;
  const draw = async soft => {
    if (!el.isConnected) { clearInterval(FIELD.timer); clearInterval(FIELD.tick); return; }
    if (busy) return; busy = true;
    try { D = await FIELD.load(); } catch (e) { busy = false; $('#fdBody', el).innerHTML = UI.empty('Не удалось загрузить «Пульс»', esc(e.message || e)); return; }
    busy = false;
    if (!el.isConnected) return;
    const sel = $('#fdScope', el);
    if (FIELD.isMgr()) {
      sel.hidden = false;
      sel.innerHTML = [...D.sups.map(s => [s.id, 'Агенты: ' + s.full_name]), ['all', 'Агенты всех супервайзеров'], ['none', 'Не закреплены за супервайзером']].map(([v, x]) => `<option value="${esc(v)}" ${v === D.scope ? 'selected' : ''}>${esc(x)}</option>`).join('');
    }
    if (S.agent && !D.agents.some(a => a.id === S.agent)) S.agent = '';
    $('#fdAgent', el).innerHTML = `<option value="">Все агенты (${D.agents.length})</option>${D.agents.map(a => `<option value="${esc(a.id)}" ${a.id === S.agent ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
    $('#fdSet', el).hidden = !D.cfg.length;
    const [a, b] = D.range;
    const view = { ...D, agents: S.agent ? D.agents.filter(x => x.id === S.agent) : D.agents, rows: S.agent ? D.rows.filter(r => r.device_id === S.agent) : D.rows, live: S.agent ? D.live.filter(r => r.device_id === S.agent) : D.live };
    $('#fdSub', el).textContent = `${a === b ? FIELD.dlabel(a, true) : FIELD.dlabel(a) + ' – ' + FIELD.dlabel(b)} · агентов: ${view.agents.length}${D.withToday ? ' · «Сейчас» обновляется каждые 30 секунд' : ''}`;
    // the opened day: a click, or the last day of the agent picked above
    let focus = S.focus && view.agents.some(x => x.id === S.focus.device) && S.focus.day >= a && S.focus.day <= b ? S.focus : null;
    if (!focus && S.agent) { const last = [...D.days].reverse().find(d => view.rows.some(r => r.day === d)); if (last) focus = { device: S.agent, day: last }; }
    const body = $('#fdBody', el), keep = soft ? window.scrollY : null;
    const empty = !view.agents.length ? UI.empty('Агентов не видно', FIELD.isMgr() ? 'Выберите выше, чьих агентов показать, или другой период.' : 'За этот период данных нет, или за вами пока не закреплены агенты с GPS.') : '';
    body.innerHTML = empty || `${FIELD.nowCards(view)}${focus ? FIELD.dayView(D, focus.device, focus.day) : ''}${FIELD.table(view)}${FIELD.mileage(view)}${FIELD.heat(view)}${FIELD.feed(view)}
      ${D.noHistory ? '<p class="mut fd-note">История по дням (вчера, неделя, месяц) ещё не подключена — видно только сегодня.</p>' : ''}`;
    FIELD.paintTimers(body);
    if (focus) FIELD.drawMap(D, focus.device, focus.day);
    if (keep != null) window.scrollTo(0, keep);
  };
  const openDay = (device, day) => {
    S.focus = { device, day: day || [...D.days].reverse().find(d => D.rows.some(r => r.device_id === device && r.day === d)) || D.range[1] };
    draw().then(() => document.getElementById('fdDay')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  };
  el.addEventListener('click', e => {
    const p = e.target.closest('[data-p]');
    if (p) { S.period = p.dataset.p; FIELD.ls('period', S.period); el.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', String(x === p))); $('#fdCustom', el).hidden = S.period !== 'custom'; S.focus = null; draw(); return; }
    const c = e.target.closest('[data-fda]');
    if (c && D) { openDay(c.dataset.fda, c.dataset.day); return; }
    if (e.target.closest('#fdClose')) { S.focus = null; S.agent = ''; draw(); }
  });
  el.addEventListener('change', e => {
    const f = e.target.closest('[data-fuel]'); if (!f) return;
    const id = f.dataset.fuel, cur = FIELD.fuelOf(id);
    cur[f.dataset.k] = f.dataset.k === 'type' ? f.value : (f.value === '' ? null : +f.value);
    try { localStorage.setItem('fd_fuel_' + id, JSON.stringify(cur)); } catch { /* private mode */ }
    draw(true);
  });
  $('#fdFrom', el).onchange = e => { S.from = e.target.value; S.focus = null; draw(); };
  $('#fdTo', el).onchange = e => { S.to = e.target.value; S.focus = null; draw(); };
  $('#fdAgent', el).onchange = e => { S.agent = e.target.value; S.focus = null; draw(); };
  $('#fdScope', el).onchange = e => { FIELD.ls('scope', e.target.value); S.agent = ''; S.focus = null; draw(); };
  $('#fdSet', el).onclick = () => D && FIELD.settings(D, draw);
  await draw();
  // live refresh every 30 s while today is shown; not while a day is opened (it would rebuild the map under the person)
  FIELD.timer = setInterval(() => { if (FIELD.range()[1] >= FIELD.today() && !document.hidden && !S.focus && !S.agent) draw(true); }, 30000);
  FIELD.tick = setInterval(() => { if (!el.isConnected) { clearInterval(FIELD.tick); return; } FIELD.paintTimers(el); }, 1000);
};
window.FIELD = FIELD;
// notifications: start once the person is signed in (AUTH loads the profile a moment after the page)
setTimeout(function start(n = 0) { if (window.AUTH?.profile) FIELD.watch(); else if (n < 30) setTimeout(() => start(n + 1), 2000); }, 3000);
