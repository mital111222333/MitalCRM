// «Поле» (#/field): a dashboard of the supervisor's agents in the field — live, by GPS.
// The server function field-watch (supabase/functions/field-watch) reads GPS every minute, opens a visit when an agent stands
// still near a client (his LINKO route or any client on the GPS map), and writes events (entered, 15 / 30 / 45 min, left,
// what LINKO shows) to field_events. Every device is tied to the agent's CRM account and his supervisor: the database gives a
// supervisor only his own agents; admin / РОП see everybody and pick whose agents to show (remembered on this device).
// The page: now (live cards with timers), the event feed, the day's results per agent (any past day too).
// Notifications: while the CRM is open (any page) new events of «my» agents pop up as toasts and, if allowed, as system
// notifications (FIELD.watch). «Пульс» shows a one-line strip (FIELD.strip).
window.EXT_PAGES = window.EXT_PAGES || {};

const FIELD = {
  timer: null, tick: null, watchT: null,
  sb: () => window.AUTH?.sb || null,
  me: () => window.AUTH?.profile || null,
  isMgr: () => ['admin', 'rop'].includes(window.AUTH?.profile?.role),
  today: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now()),
  hm: t => (t ? new Date(t).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }) : ''),
  dur(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; },
  mins: ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; },
  money: v => '$' + UI.fmt0(Math.round(v || 0)),
  end: v => (v.ended_at ? Date.parse(v.ended_at) : Date.now()),
  ICON: { order: '🛒', payment: '💵', order_return: '↩️', rejection: '✋', service_time: '⏱' },
  EV: { enter: '🚪', alert: '⏱', exit: '✅', outcome: '📋' },
  ls(k, v) { try { if (v === undefined) return localStorage.getItem('fd_' + k); localStorage.setItem('fd_' + k, v); } catch { return null; } return null; },

  // whose agents: a supervisor — his own (the database gives nothing else); a manager — a supervisor picked on the page,
  // by default the supervisor account with the manager's own name (the admin who is also a supervisor), else everybody
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

  async load(day) {
    const sb = FIELD.sb(); if (!sb) throw new Error('Войдите в CRM, чтобы видеть «Поле»');
    const today = day === FIELD.today();
    const [cfg, live, visits, routes, events, sups] = await Promise.all([
      sb.from('field_config').select('*'),
      today ? sb.from('field_live').select('*') : Promise.resolve({ data: [] }),
      sb.from('field_visits').select('id,device_id,agent_id,agent_name,supervisor_id,place_name,address,planned,started_at,last_seen_at,ended_at,alerts,outcome,outcome_final').eq('day', day).order('started_at', { ascending: true }),
      sb.from('field_routes').select('agent_id,agent_name,supervisor_id,stats').eq('day', day),
      sb.from('field_events').select('id,supervisor_id,kind,minutes,who,place,text,created_at').eq('day', day).order('id', { ascending: false }).limit(300),
      FIELD.sups(),
    ]);
    const err = [cfg, live, visits, routes, events].find(r => r.error)?.error; if (err) throw new Error(err.message);
    const scope = FIELD.scope(sups), f = rows => (rows || []).filter(r => FIELD.inScope(r, scope));
    return { day, today, scope, sups, cfg: cfg.data || [], live: f(live.data), visits: f(visits.data), routes: f(routes.data), events: f(events.data) };
  },

  // state of one device: at a client / standing / driving / no signal
  state(l, open) {
    const age = Date.now() - Date.parse(l.fix_at || 0);
    if (open) return { k: 'visit', order: 0, since: open.started_at };
    if (age > 30 * 60000) return { k: 'off', order: 3 };
    if (l.speed >= 3) return { k: 'drive', order: 2 };
    return { k: 'stop', order: 1, since: l.stop_since };
  },

  card(l, D) {
    const vs = D.visits.filter(v => v.device_id === l.device_id), open = vs.find(v => !v.ended_at), st = FIELD.state(l, open);
    const route = D.routes.find(r => r.agent_id === l.agent_id);
    const atClients = vs.reduce((s, v) => s + (FIELD.end(v) - Date.parse(v.started_at)), 0);
    const ago = Date.now() - Date.parse(l.fix_at || 0);
    const status = st.k === 'visit'
      ? `<div class="fd-now visit"><span>🚪 у клиента <b>${esc(open.place_name)}</b>${open.planned ? ' <span class="fd-tag">маршрут</span>' : ' <span class="fd-tag out">вне маршрута</span>'}</span><b class="fd-timer" data-since="${esc(open.started_at)}">${FIELD.dur(Date.now() - Date.parse(open.started_at))}</b></div>`
      : st.k === 'stop'
        ? `<div class="fd-now stop"><span>⏸ стоит${l.near_name ? ` у <b>${esc(l.near_name)}</b>` : ' — не у клиента'}</span><b class="fd-timer" data-since="${esc(l.stop_since || l.fix_at)}">${FIELD.dur(Date.now() - Date.parse(l.stop_since || l.fix_at))}</b></div>`
        : st.k === 'drive'
          ? `<div class="fd-now drive"><span>🚗 в пути</span><b>${Math.round(l.speed)} км/ч</b></div>`
          : `<div class="fd-now off"><span>📴 нет связи с ${FIELD.hm(l.fix_at)}</span><b>${FIELD.mins(ago)}</b></div>`;
    const stale = st.k !== 'off' && ago > 10 * 60000 ? `<div class="mut fd-small">GPS обновлялся ${FIELD.mins(ago)} назад</div>` : '';
    const s = route?.stats || {};
    const prog = route ? `<div class="fd-prog" title="Точек маршрута отработано"><i style="width:${s.plan ? Math.min(100, s.done / s.plan * 100).toFixed(0) : 0}%"></i></div>
      <div class="fd-nums"><span>точек <b>${s.done || 0}/${s.plan || 0}</b></span><span>заказы <b>${FIELD.money(s.orders)}</b></span><span>оплаты <b>${FIELD.money(s.paid)}</b></span>${s.rejections ? `<span>отказов <b>${s.rejections}</b></span>` : ''}</div>` : `<div class="mut fd-small">${l.agent_id ? 'маршрут LINKO ещё не загружен' : 'нет маршрута в LINKO'}</div>`;
    const list = vs.slice().reverse().slice(0, 6).map(v => FIELD.visitLi(v)).join('');
    return { order: st.order, since: st.since ? Date.parse(st.since) : 0, k: st.k, html: `<div class="fd-card ${st.k}">
      <div class="fd-h"><b>${esc(l.device_name)}</b>${l.agent_name ? `<small>${esc(l.agent_name)}</small>` : ''}</div>
      ${status}${stale}${prog}
      <div class="fd-sum mut fd-small">визитов ${vs.length} · у клиентов ${FIELD.mins(atClients)}</div>
      ${list ? `<ul class="fd-list">${list}</ul>` : ''}</div>` };
  },

  visitLi(v) {
    const d = FIELD.end(v) - Date.parse(v.started_at), m = d / 60000;
    const out = (v.outcome || []).map(t => `<span title="${esc(t.text)}">${FIELD.ICON[t.type] || '•'} ${esc(String(t.text).replace(/^Оформили заказ |^Оплатили |^Отказ: /, ''))}</span>`).join(' ');
    return `<li class="${m >= 45 ? 'long3' : m >= 30 ? 'long2' : m >= 15 ? 'long1' : ''}"><span class="fd-t">${FIELD.hm(v.started_at)}–${v.ended_at ? FIELD.hm(v.ended_at) : '…'}</span><span class="fd-c">${esc(v.place_name)}${v.planned ? '' : ' <span class="fd-tag out">вне</span>'}</span><span class="fd-d">${FIELD.mins(d)}</span>${out ? `<div class="fd-o">${out}</div>` : v.ended_at ? `<div class="fd-o mut">${v.outcome_final ? 'в LINKO ничего не отмечено' : 'жду, что отметят в LINKO…'}</div>` : ''}</li>`;
  },

  // the day per agent: visits, time at clients, average / longest visit, outside the route, first / last, LINKO sums
  summary(D) {
    const by = new Map();
    for (const v of D.visits) (by.get(v.agent_name) || by.set(v.agent_name, []).get(v.agent_name)).push(v);
    if (!by.size) return '<p class="mut" style="margin:0">За этот день визитов не найдено.</p>';
    const rows = [...by.entries()].map(([who, vs]) => {
      const ds = vs.map(v => FIELD.end(v) - Date.parse(v.started_at)), tot = ds.reduce((a, b) => a + b, 0);
      const r = D.routes.find(x => vs[0].agent_id && x.agent_id === vs[0].agent_id)?.stats || null;
      const noResult = vs.filter(v => v.ended_at && v.outcome_final && !(v.outcome || []).length).length;
      return { who, n: vs.length, tot, avg: tot / vs.length, max: Math.max(...ds), out: vs.filter(v => !v.planned).length, long: ds.filter(d => d >= 30 * 60000).length, first: vs[0].started_at, last: vs[vs.length - 1].ended_at || vs[vs.length - 1].last_seen_at, r, noResult };
    }).sort((a, b) => b.tot - a.tot);
    return `<div class="tscroll"><table class="fd-tab"><thead><tr><th>Агент</th><th>Визитов</th><th>У клиентов</th><th>Средний</th><th>Самый долгий</th><th>Дольше 30 мин</th><th>Вне маршрута</th><th>Первый – последний</th><th>Точек LINKO</th><th>Заказы</th><th>Оплаты</th><th>Без итога</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.who)}</td><td>${x.n}</td><td>${FIELD.mins(x.tot)}</td><td>${FIELD.mins(x.avg)}</td><td class="${x.max >= 45 * 60000 ? 'neg' : ''}">${FIELD.mins(x.max)}</td><td>${x.long || ''}</td><td>${x.out || ''}</td><td>${FIELD.hm(x.first)} – ${FIELD.hm(x.last)}</td><td>${x.r ? `${x.r.done}/${x.r.plan}` : '—'}</td><td>${x.r ? FIELD.money(x.r.orders) : '—'}</td><td>${x.r ? FIELD.money(x.r.paid) : '—'}</td><td>${x.noResult || ''}</td></tr>`).join('')}
    </tbody></table></div><p class="mut fd-small" style="margin:6px 0 0">«Без итога» — визиты, после которых за 2 часа в LINKO не появилось ни заказа, ни оплаты, ни отказа. Заказы и оплаты — суммы LINKO за день (у агентов с маршрутом в LINKO).</p>`;
  },

  feed(D) {
    if (!D.events.length) return '<p class="mut" style="margin:0">Событий пока нет.</p>';
    return `<ul class="fd-feed">${D.events.slice(0, 80).map(e => `<li class="${e.kind === 'alert' && e.minutes >= 45 ? 'bad' : e.kind === 'alert' ? 'warn' : ''}"><span class="fd-t">${FIELD.hm(e.created_at)}</span><span>${FIELD.EV[e.kind] || '•'} ${esc(e.text).replace(/\n/g, '<br>')}</span></li>`).join('')}</ul>`;
  },

  css() {
    if (document.getElementById('fdCss')) return;
    const s = document.createElement('style'); s.id = 'fdCss';
    s.textContent = `.fd-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}.fd-chips span{background:var(--fill);border-radius:999px;padding:6px 12px;font-size:13px}
.fd-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.fd-bar select,.fd-bar input{max-width:100%}
.fd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px;margin-bottom:16px}
.fd-card{background:var(--card,var(--bg2,#fff));border:1px solid var(--line,rgba(127,127,127,.2));border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.fd-card.visit{border-color:var(--tint,#0a84ff);box-shadow:0 0 0 1px var(--tint,#0a84ff) inset}.fd-card.off{opacity:.7}
.fd-h{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.fd-h small{color:var(--mut,#888);font-size:12px;text-align:right}
.fd-now{display:flex;justify-content:space-between;gap:8px;align-items:center;border-radius:10px;padding:8px 10px;background:var(--fill)}
.fd-now span{min-width:0;overflow-wrap:anywhere}.fd-now.visit{background:color-mix(in srgb,var(--tint,#0a84ff) 14%,transparent)}
.fd-timer{font-variant-numeric:tabular-nums;font-size:18px}.fd-timer.t15{color:#d98a00}.fd-timer.t30{color:#e06c00}.fd-timer.t45{color:var(--st-crit,#e5484d)}
.fd-tag{font-size:11px;border-radius:6px;padding:1px 6px;background:color-mix(in srgb,#30a46c 18%,transparent);color:#30a46c;white-space:nowrap}.fd-tag.out{background:color-mix(in srgb,#d98a00 18%,transparent);color:#b87500}
.fd-prog{height:6px;border-radius:3px;background:var(--fill);overflow:hidden}.fd-prog i{display:block;height:100%;background:var(--tint,#0a84ff)}
.fd-nums{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}.fd-small{font-size:12px}
.fd-list,.fd-feed{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.fd-list li,.fd-feed li{display:flex;flex-wrap:wrap;gap:2px 8px;padding:4px 6px;border-radius:8px;border-left:3px solid transparent}
.fd-list li.long1,.fd-feed li.warn{border-left-color:#d98a00}.fd-list li.long2{border-left-color:#e06c00}.fd-list li.long3,.fd-feed li.bad{border-left-color:var(--st-crit,#e5484d)}
.fd-list li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline}.fd-o{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:2px 10px}
.fd-feed{max-height:420px;overflow:auto}.fd-feed li span:last-child{flex:1;min-width:0;overflow-wrap:anywhere}
.fd-t{font-variant-numeric:tabular-nums;color:var(--mut,#888)}.fd-c{flex:1;min-width:0;overflow-wrap:anywhere}.fd-d{font-variant-numeric:tabular-nums}
.fd-tab td,.fd-tab th{white-space:nowrap}.fd-tab td:first-child{white-space:normal;min-width:120px}
.fd-strip{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;text-decoration:none;color:inherit;background:var(--fill);border-radius:12px;padding:10px 14px;margin:0 0 12px}
.fd-strip b{font-variant-numeric:tabular-nums}
.fd-set label{display:block;margin:10px 0 4px;font-weight:600}.fd-set input[type=text],.fd-set input[type=number]{width:100%}`;
    document.head.appendChild(s);
  },

  paintTimers(root) {
    for (const t of root.querySelectorAll('[data-since]')) {
      const ms = Date.now() - Date.parse(t.dataset.since); t.textContent = FIELD.dur(ms);
      const m = ms / 60000; t.classList.toggle('t15', m >= 15 && m < 30); t.classList.toggle('t30', m >= 30 && m < 45); t.classList.toggle('t45', m >= 45);
    }
  },

  // only the owner of the GPS account / a manager can change these (field_config RLS)
  settings(D, redraw) {
    const cfg = D.cfg[0]; if (!cfg) return toast('Настройки «Поля» меняет администратор');
    const m = modal(`<h3>Настройки «Поля»</h3><div class="fd-set">
      <label><input type="checkbox" id="fsOn" ${cfg.enabled ? 'checked' : ''}> следить за агентами</label>
      <label for="fsAl">Уведомления, минут у клиента</label><input type="text" id="fsAl" value="${esc((cfg.alerts || []).join(', '))}" placeholder="15, 30, 45">
      <label for="fsR">Радиус вокруг клиента, м</label><input type="number" id="fsR" min="30" max="500" value="${cfg.radius_m}">
      <label for="fsS">Визит начинается, когда агент стоит у клиента, секунд</label><input type="number" id="fsS" min="30" max="1800" value="${cfg.min_stop_s}">
      <p class="mut fd-small">Агент привязан к GPS по имени в его аккаунте CRM («Пользователи» → имя в LINKO). Точки «… 007 …», «… уй» — личные точки агентов, не клиенты.</p>
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
      for (const e of mine.slice(-3)) toast(`${FIELD.EV[e.kind] || ''} ${String(e.text).split('\n')[0]}`);
      if (mine.length && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification('Поле: ' + (mine.length > 1 ? `${mine.length} событий` : String(mine[0].text).split('\n')[0]), { body: mine.slice(-3).map(x => String(x.text).split('\n')[0]).join('\n'), tag: 'field' }); } catch { /* not allowed here */ }
      }
    } catch { /* offline: next minute */ }
  },

  // one line on «Пульс»
  async strip(el) {
    try {
      if (!FIELD.sb() || !el.isConnected) return;
      const D = await FIELD.load(FIELD.today()); if (!D.live.length || !el.isConnected) return;
      FIELD.css();
      const open = D.visits.filter(v => !v.ended_at), drive = D.live.filter(l => l.speed >= 3 && Date.now() - Date.parse(l.fix_at) < 30 * 60000).length;
      const long = open.filter(v => Date.now() - Date.parse(v.started_at) >= 30 * 60000).length;
      const a = document.createElement('a'); a.href = '#/field'; a.className = 'fd-strip';
      a.innerHTML = `<span>📡 <b>Поле</b></span><span>агентов <b>${D.live.length}</b></span><span>у клиентов <b>${open.length}</b></span><span>в пути <b>${drive}</b></span><span>визитов сегодня <b>${D.visits.length}</b></span>${long ? `<span class="neg">дольше 30 мин: <b>${long}</b></span>` : ''}<span class="mut" style="margin-left:auto">открыть →</span>`;
      el.querySelector('.fd-strip')?.remove();
      const head = el.querySelector('.page-head'); head ? head.after(a) : el.prepend(a);
    } catch { /* the strip is optional */ }
  },
};

EXT_PAGES.field = async el => {
  clearInterval(FIELD.timer); clearInterval(FIELD.tick);
  FIELD.css();
  let day = FIELD.today(), D = null;
  el.innerHTML = `<div class="page-head"><div><h2>📡 Поле</h2><div class="sub" id="fdSub">Загружаю…</div></div>
    <div class="actions"><button class="btn gray" id="fdBell" type="button" hidden>🔔 Уведомления</button><button class="btn gray" id="fdSet" type="button" hidden>⚙ Настройки</button><a class="btn gray" href="#/gps">Карта</a></div></div>
    <div class="fd-bar"><select id="fdScope" hidden aria-label="Чьи агенты"></select><input type="date" id="fdDay" value="${day}" max="${day}" aria-label="День"></div>
    <div id="fdBody"></div>`;
  const bell = $('#fdBell', el);
  if ('Notification' in window && Notification.permission === 'default') {
    bell.hidden = false;
    bell.onclick = async () => { try { await Notification.requestPermission(); } catch { /* ignored */ } bell.hidden = Notification.permission !== 'default'; toast(Notification.permission === 'granted' ? 'Уведомления включены — придут, даже когда вкладка свёрнута' : 'Уведомления не разрешены'); };
  }
  const draw = async () => {
    if (!el.isConnected) { clearInterval(FIELD.timer); clearInterval(FIELD.tick); return; }
    try { D = await FIELD.load(day); } catch (e) { $('#fdBody', el).innerHTML = UI.empty('Не удалось загрузить «Поле»', esc(e.message || e)); return; }
    if (!el.isConnected) return;
    const sel = $('#fdScope', el);
    if (FIELD.isMgr()) {
      sel.hidden = false;
      sel.innerHTML = [...D.sups.map(s => [s.id, 'Агенты: ' + s.full_name]), ['all', 'Все агенты'], ['none', 'Не закреплены за супервайзером']].map(([v, t]) => `<option value="${esc(v)}" ${v === D.scope ? 'selected' : ''}>${esc(t)}</option>`).join('');
      sel.onchange = () => { FIELD.ls('scope', sel.value); draw(); };
    }
    $('#fdSet', el).hidden = !D.cfg.length;
    const body = $('#fdBody', el);
    const cards = D.live.map(l => FIELD.card(l, D)).sort((a, b) => a.order - b.order || (a.since && b.since ? a.since - b.since : 0));
    const n = k => cards.filter(c => c.k === k).length;
    const at = D.visits.reduce((s, v) => s + (FIELD.end(v) - Date.parse(v.started_at)), 0);
    const upd = D.live.reduce((m, l) => Math.max(m, Date.parse(l.updated_at || 0)), 0);
    $('#fdSub', el).textContent = D.today
      ? `${D.live.length} агентов · обновлено ${FIELD.hm(upd) || '—'} · сервер проверяет GPS каждую минуту, 7:00–21:00`
      : `итоги за ${new Date(day + 'T12:00:00+05:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
    const now = D.today ? (cards.length
      ? `<div class="fd-chips"><span>🚪 у клиента <b>${n('visit')}</b></span><span>⏸ стоят <b>${n('stop')}</b></span><span>🚗 в пути <b>${n('drive')}</b></span><span>📴 нет связи <b>${n('off')}</b></span><span>визитов <b>${D.visits.length}</b></span><span>у клиентов всего <b>${FIELD.mins(at)}</b></span></div><div class="fd-grid">${cards.map(c => c.html).join('')}</div>`
      : UI.empty('Агентов не видно', FIELD.isMgr() ? 'Выберите выше, чьих агентов показать.' : 'За вами пока не закреплены агенты с GPS. Агент привязывается к GPS по имени в его аккаунте CRM.')) : '';
    body.innerHTML = `${now}<div class="grid">${UI.panel('Итоги дня по агентам', FIELD.summary(D), { cls: 'w12' })}${UI.panel('Лента событий', FIELD.feed(D), { sub: 'зашёл · 15 / 30 / 45 мин · вышел · что отмечено в LINKO', cls: 'w12' })}</div>`;
    FIELD.paintTimers(body);
  };
  $('#fdSet', el).onclick = () => D && FIELD.settings(D, draw);
  $('#fdDay', el).onchange = e => { day = e.target.value || FIELD.today(); draw(); };
  await draw();
  FIELD.timer = setInterval(() => { if (day === FIELD.today()) draw(); }, 30000);
  FIELD.tick = setInterval(() => { if (!el.isConnected) { clearInterval(FIELD.tick); return; } FIELD.paintTimers(el); }, 1000);
};
window.FIELD = FIELD;
// notifications: start once the person is signed in (AUTH loads the profile a moment after the page)
setTimeout(function start(n = 0) { if (window.AUTH?.profile) FIELD.watch(); else if (n < 30) setTimeout(() => start(n + 1), 2000); }, 3000);
