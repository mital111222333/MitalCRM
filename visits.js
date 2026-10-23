// Визиты агентов (Агенты → Визиты): LINKO «Клиенты → Маршруты» — the plan of the day of every agent, which clients they visited,
// when they came in and left, what they did there. The Google auto-loader (autolinko.gs visits_) takes it every 30 minutes into
// linko-visits.json, every day also into archive/YYYY/MM/YYYY-MM-DD/visits.json.gz, keeping LINKO's answers whole.
// File: { at, day, agents: { <id>: { name, plan: [stop…], stats: <market/detail_plan/> } }, errors }, where a stop is
// { market: { id, name, address, location, currencies }, distance, location, plans: [task…] } and a task is
// { type: service_time|order|payment|order_return|rejection|march_report|quiz_answer|delivery|custom|no_plan_visit,
//   status: done|undone|pending, text, done_time, created_mobile_time, unscheduled, order_id, client_transaction(_id),
//   order_return(_id), rejection_id, rejection_image, image_url, response, service_time: { start_time, end_time, difference_time, audio_record_url } }.
// Times come without a zone: they are Tashkent wall-clock time. Order / payment / return sums are taken from the task itself
// or from the LINKO orders / payments / returns the CRM already has (same ids).
window.EXT_PAGES = window.EXT_PAGES || {};

const VZ = {
  day: '', agent: '', tab: 'day', cache: {}, week: null,
  RULE: { short: 2, far: 300, gap: 60 }, // visit shorter than 2 min, checked in farther than 300 m from the shop, idle more than 60 min
  TYPES: {
    service_time: '🚪 Визит', order: '🛒 Заказ', payment: '💵 Оплата', order_return: '↩ Возврат', rejection: '✋ Отказ',
    march_report: '📷 Фотоотчёт', quiz_answer: '📝 Опрос', delivery: '🚚 Доставка', custom: '📌 Задача', no_plan_visit: '⚠ Визит вне плана',
  },

  // ---------- data ----------
  async load(day) {
    if (VZ.cache[day]) return VZ.cache[day];
    let j = null;
    if (day === UI.localDate(Date.now())) j = await CLOUD.readJson('linko-visits.json');
    if ((!j || j.day !== day) && typeof ARC !== 'undefined') {
      const f = ((await ARC.list()) || []).find(x => x.day === day && x.name === 'visits');
      if (f) j = await ARC.read(f.path);
    }
    if (j && j.day === day) VZ.cache[day] = j;
    return j && j.day === day ? j : null;
  },
  async days() {
    let d = [];
    try { d = ((await ARC.list()) || []).filter(f => f.name === 'visits').map(f => f.day); } catch { /* archive unavailable */ }
    return [...new Set([UI.localDate(Date.now()), ...d])].sort().reverse();
  },
  list(x) { return Array.isArray(x) ? x : Array.isArray(x?.results) ? x.results : []; },
  t: s => (s ? String(s).slice(11, 16) : ''),
  ms: s => (s ? Date.parse(String(s).slice(0, 19)) : NaN),
  num: v => Number(v) || 0,
  // LINKO rows the CRM already has, by id (orders, payments, returns) and refusals by shop + day
  refs() {
    if (VZ._refs) return VZ._refs;
    const by = id => new Map(LX.d(id).filter(r => r.id != null).map(r => [String(r.id), r]));
    const rej = new Map(); for (const r of LX.d('rejects')) rej.set(LX.norm(r['market.name']) + '|' + String(r.created_date || '').slice(0, 10), r.comment || '');
    return (VZ._refs = { orders: by('orders'), pays: by('pays'), rets: by('returns'), rej });
  },

  // one stop of the route → a visit
  stop(s, day) {
    const R = VZ.refs(), m = s.market || {}, client = m.name || 'Без названия', tasks = [];
    let order = 0, pay = 0, ret = 0, cur = '', inT = '', outT = '', st = null;
    for (const p of s.plans || []) {
      const type = p.type || '', done = p.status === 'done', time = p.created_mobile_time || p.done_time || '';
      const x = { type, done, status: p.status || '', text: p.text || '', time, sum: 0, note: '' };
      if (type === 'service_time' && p.service_time) { st = p.service_time; x.audio = st.audio_record_url || ''; }
      if (type === 'order' && p.order_id) { const o = R.orders.get(String(p.order_id)); if (o) { x.sum = VZ.num(o.total_price); cur ||= o['currency.name'] || ''; } order += x.sum; }
      if (type === 'payment') { const c = p.client_transaction || R.pays.get(String(p.client_transaction_id || '')); if (c) { x.sum = Math.abs(VZ.num(c.amount)); cur ||= c.currency?.name || c['currency.name'] || ''; } pay += x.sum; }
      if (type === 'order_return') { const c = p.order_return || R.rets.get(String(p.order_return_id || '')); if (c) { x.sum = VZ.num(c.total_price); x.note = c.reason || c.comment || ''; } ret += x.sum; }
      if (type === 'rejection') x.note = R.rej.get(LX.norm(client) + '|' + day) || '';
      if (type === 'custom' && p.response) x.note = String(p.response);
      x.img = p.rejection_image || p.image_url || (Array.isArray(p.merch_images) ? p.merch_images[0] : '') || '';
      tasks.push(x);
      if (done && time) { if (!inT || time < inT) inT = time; if (!outT || time > outT) outT = time; }
    }
    if (st?.start_time) inT = st.start_time;
    if (st?.end_time && st.end_time > (outT || '')) outT = st.end_time;
    const done = tasks.filter(x => x.done), unplanned = tasks.some(x => x.type === 'no_plan_visit') || ((s.plans || []).length > 0 && (s.plans || []).every(p => p.unscheduled));
    const min = inT && outT ? Math.max(0, (VZ.ms(outT) - VZ.ms(inT)) / 60000) : null;
    const visitMin = st?.start_time && st?.end_time ? Math.max(0, (VZ.ms(st.end_time) - VZ.ms(st.start_time)) / 60000) : null;
    const bal = (m.currencies || []).map(c => VZ.num(c.amount_total)).reduce((a, b) => a + b, 0);
    return {
      client, cid: m.id, address: m.address || '', distance: s.distance != null && s.distance !== '' ? VZ.num(s.distance) : null,
      tasks, visited: done.length > 0, unplanned, inT, outT, min, visitMin, order, pay, ret, cur,
      rej: tasks.some(x => x.type === 'rejection' && x.done), photo: tasks.some(x => x.done && x.img),
      result: order > 0 || pay > 0 || ret > 0 || tasks.some(x => x.done && ['order', 'payment', 'order_return', 'rejection', 'delivery'].includes(x.type)), bal,
    };
  },
  // a day file → [{ id, name, stops, vis, sus, k: day figures, stats }]
  parse(j) {
    if (!j) return [];
    if (j._p) return j._p;
    return (j._p = Object.entries(j.agents || {}).map(([id, a]) => {
      const stops = VZ.list(a.plan).map(s => VZ.stop(s, j.day));
      const vis = stops.filter(s => s.visited).sort((x, y) => (x.inT || '').localeCompare(y.inT || ''));
      // time on the road between visits
      for (let i = 1; i < vis.length; i++) { const g = (VZ.ms(vis[i].inT) - VZ.ms(vis[i - 1].outT || vis[i - 1].inT)) / 60000; vis[i].road = g >= 0 ? g : null; }
      const planned = stops.filter(s => !s.unplanned), durs = vis.map(s => s.visitMin ?? s.min).filter(v => v != null);
      const k = {
        plan: planned.length, visited: planned.filter(s => s.visited).length, unplanned: stops.filter(s => s.unplanned && s.visited).length,
        missed: planned.filter(s => !s.visited).length, first: vis[0]?.inT || '', last: vis.reduce((m, s) => ((s.outT || s.inT) > m ? s.outT || s.inT : m), ''),
        avg: durs.length ? durs.reduce((x, y) => x + y, 0) / durs.length : null,
        orders: vis.filter(s => s.order > 0 || s.tasks.some(x => x.done && x.type === 'order')).length, order: vis.reduce((x, s) => x + s.order, 0), pay: vis.reduce((x, s) => x + s.pay, 0),
        rej: vis.filter(s => s.rej).length, visits: vis.length, cur: vis.find(s => s.cur)?.cur || '',
      };
      k.field = k.first && k.last ? (VZ.ms(k.last) - VZ.ms(k.first)) / 60000 : null;
      const sus = VZ.suspicious(stops, vis);
      k.sus = sus.length;
      const st = a.stats && !Array.isArray(a.stats) ? a.stats : {};
      // sums LINKO itself counted for the day win when the CRM has not got these orders / payments yet
      if (VZ.num(st.order_total_price) > k.order) k.order = VZ.num(st.order_total_price);
      if (VZ.num(st.client_transaction_total_price) > k.pay) k.pay = VZ.num(st.client_transaction_total_price);
      return { id, name: a.name || id, stops, vis, sus, k, stats: st };
    }).filter(a => a.stops.length).sort((x, y) => String(x.name).localeCompare(String(y.name), 'ru')));
  },
  // what to look at: very short visits, check-in far from the shop, idle gaps, visits without any result, planned shops not visited
  suspicious(stops, vis) {
    const R = VZ.RULE, out = [];
    for (const s of vis) {
      if (s.visitMin != null && s.visitMin < R.short) out.push({ s, kind: 'short', text: `визит ${VZ.mm(s.visitMin)} — меньше ${R.short} мин` });
      if (s.distance != null && s.distance > R.far) out.push({ s, kind: 'far', text: `отметился в ${VZ.dist(s.distance)} от точки` });
      if (s.road != null && s.road > R.gap) out.push({ s, kind: 'gap', text: `перерыв ${VZ.mm(s.road)} перед визитом` });
      if (!s.result && !s.photo) out.push({ s, kind: 'empty', text: 'визит без заказа, оплаты, отказа и фото' });
    }
    for (const s of stops) if (!s.unplanned && !s.visited) out.push({ s, kind: 'missed', text: 'по плану, но не посещён' });
    return out;
  },
  KIND: { short: ['crit', 'Короткий визит'], far: ['crit', 'Далеко от точки'], gap: ['warn', 'Долгий перерыв'], empty: ['warn', 'Без результата'], missed: ['muted', 'Не посещён'] },
  mm: m => (m == null ? '—' : m < 1 ? Math.round(m * 60) + ' сек' : m < 60 ? Math.round(m) + ' мин' : Math.floor(m / 60) + ' ч ' + String(Math.round(m % 60)).padStart(2, '0') + ' мин'),
  dist: d => (d >= 1000 ? (d / 1000).toFixed(1) + ' км' : Math.round(d) + ' м'),
  money: (v, cur) => (v ? UI.fmt0(Math.round(v)) + LX.u(cur) : '<span class="mut">—</span>'),
  pct: (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—'),
  wd: d => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(d + 'T12:00:00').getDay()],

  // the last 7 days that have visits (archive + today)
  async loadWeek(days) {
    const out = [];
    for (const d of days.slice(0, 7)) { try { const j = await VZ.load(d); if (j) out.push({ day: d, ag: VZ.parse(j) }); } catch (e) { console.warn('visits', d, e); } }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  },

  // ---------- views ----------
  viewDay(A) {
    const T = A.reduce((t, a) => { for (const k of ['plan', 'visited', 'unplanned', 'missed', 'order', 'pay', 'visits', 'sus', 'orders']) t[k] = (t[k] || 0) + a.k[k]; return t; }, {});
    const durs = A.map(a => a.k.avg).filter(v => v != null), cur = A.find(a => a.k.cur)?.k.cur || '';
    return `<div class="kpis w12">
      ${UI.tile('Посещено по плану', `${T.visited || 0} из ${T.plan || 0}`, { sub: VZ.pct(T.visited, T.plan) + ' плана', tone: T.plan && T.visited / T.plan >= 0.8 ? 'good' : 'warn' })}
      ${UI.tile('Вне плана', String(T.unplanned || 0), { sub: 'визиты к точкам не из маршрута' })}
      ${UI.tile('Не посещено', String(T.missed || 0), { sub: 'точки маршрута без визита', tone: T.missed ? 'warn' : '' })}
      ${UI.tile('Заказы', VZ.money(T.order, cur), { sub: `${T.orders || 0} визитов с заказом из ${T.visits || 0} · ${VZ.pct(T.orders, T.visits)}` })}
      ${UI.tile('Оплаты', VZ.money(T.pay, cur), { sub: 'принято на визитах' })}
      ${UI.tile('Средний визит', durs.length ? VZ.mm(durs.reduce((x, y) => x + y, 0) / durs.length) : '—', { sub: 'от входа до выхода' })}
      ${UI.tile('Подозрительное', String(T.sus || 0), { sub: 'см. вкладку ⚠', tone: T.sus ? 'crit' : 'good' })}
    </div>
    ${UI.panel('Агенты за день', LX.table(['Агент', 'План', 'Посещено', 'Вне плана', 'Не посещено', 'Первый вход', 'Последний выход', 'В поле', 'Средний визит', 'Заказы', 'Оплаты', 'Отказы', 'Внимание'],
      A.map(a => `<tr><td><a href="#" data-ag="${esc(a.id)}">${esc(a.name)}</a></td><td>${a.k.plan}</td><td>${a.k.visited} <span class="mut">${VZ.pct(a.k.visited, a.k.plan)}</span></td><td>${a.k.unplanned || '<span class="mut">—</span>'}</td><td>${a.k.missed ? `<b class="neg">${a.k.missed}</b>` : '<span class="mut">—</span>'}</td>
        <td>${VZ.t(a.k.first) || '—'}</td><td>${VZ.t(a.k.last) || '—'}</td><td>${VZ.mm(a.k.field)}</td><td>${VZ.mm(a.k.avg)}</td><td>${VZ.money(a.k.order, a.k.cur)}${a.k.orders ? ` <span class="mut">· ${a.k.orders} шт</span>` : ''}</td><td>${VZ.money(a.k.pay, a.k.cur)}</td><td>${a.k.rej || '<span class="mut">—</span>'}</td><td>${a.k.sus ? UI.pill('crit', '⚠ ' + a.k.sus) : UI.pill('good', 'всё ок')}</td></tr>`)),
      { cls: 'w12', sub: 'Нажмите на агента — откроется его день по минутам. «В поле» — от первого входа до последнего выхода.' })}`;
  },

  viewAgent(a) {
    if (!a) return '<p class="mut">Нет данных по агенту за этот день.</p>';
    const k = a.k, row = s => {
      const chips = s.tasks.filter(x => x.type !== 'service_time').map(x => {
        const sum = x.sum ? ' ' + UI.fmt0(Math.round(x.sum)) + LX.u(s.cur) : '';
        const cls = !x.done ? 'muted' : x.type === 'rejection' || x.type === 'no_plan_visit' ? 'warn' : 'good';
        return UI.pill(cls, (VZ.TYPES[x.type] || x.text || x.type) + sum + (x.done ? '' : ' — не сделано'));
      }).join(' ');
      // the task's own text only when it says more than its type (e.g. «Взять оплату за прошлый заказ»), plus comments
      const own = x => x.text && x.type !== 'service_time' && !LX.norm(VZ.TYPES[x.type] || '').includes(LX.norm(x.text));
      const notes = s.tasks.filter(x => x.note || own(x)).map(x => `${own(x) ? esc(x.text) : esc((VZ.TYPES[x.type] || '').replace(/^\S+\s/, ''))}${x.note ? ` — <i>${esc(x.note)}</i>` : ''}${x.time && x.done ? ` <span class="mut">${VZ.t(x.time)}</span>` : ''}`);
      const media = s.tasks.filter(x => x.img || x.audio).map(x => (x.img ? `<a href="${esc(x.img)}" target="_blank" rel="noopener">📷 фото</a>` : '') + (x.audio ? ` <a href="${esc(x.audio)}" target="_blank" rel="noopener">🎧 запись разговора</a>` : '')).join(' ');
      const flags = a.sus.filter(f => f.s === s).map(f => UI.pill(VZ.KIND[f.kind][0], f.text)).join(' ');
      return `<tr><td><b>${VZ.t(s.inT) || '—'}</b>${s.outT && VZ.t(s.outT) !== VZ.t(s.inT) ? ' – ' + VZ.t(s.outT) : ''}</td><td>${VZ.mm(s.visitMin ?? s.min)}</td>
        <td><b>${esc(s.client)}</b>${s.unplanned ? ' ' + UI.pill('warn', 'вне плана') : ''}<div class="mut" style="font-size:12px">${esc(s.address)}</div></td>
        <td>${chips || '<span class="mut">—</span>'}${notes.length ? `<div style="font-size:12px;margin-top:4px">${notes.join('<br>')}</div>` : ''}${media ? `<div style="margin-top:4px">${media}</div>` : ''}</td>
        <td>${s.distance != null ? VZ.dist(s.distance) : '<span class="mut">—</span>'}</td><td>${s.road != null ? VZ.mm(s.road) : '<span class="mut">—</span>'}</td><td>${flags}</td></tr>`;
    };
    const missed = a.stops.filter(s => !s.visited), S = a.stats;
    return `<div class="kpis w12">
      ${UI.tile('Посещено по плану', `${k.visited} из ${k.plan}`, { sub: VZ.pct(k.visited, k.plan), tone: k.plan && k.visited / k.plan >= 0.8 ? 'good' : 'warn' })}
      ${UI.tile('Рабочий день', k.first ? `${VZ.t(k.first)} – ${VZ.t(k.last)}` : '—', { sub: 'в поле ' + VZ.mm(k.field) })}
      ${UI.tile('Средний визит', VZ.mm(k.avg), { sub: `визитов ${k.visits}, вне плана ${k.unplanned}` })}
      ${UI.tile('Заказы', VZ.money(k.order, k.cur), { sub: `${k.orders} визитов с заказом · ${VZ.pct(k.orders, k.visits)}` })}
      ${UI.tile('Оплаты', VZ.money(k.pay, k.cur), { sub: k.rej ? `отказов ${k.rej}` : 'без отказов' })}
      ${UI.tile('Подозрительное', String(a.sus.length), { tone: a.sus.length ? 'crit' : 'good' })}
    </div>
    ${UI.panel(`День агента: ${esc(a.name)}`, a.vis.length ? LX.table(['Вход – выход', 'У клиента', 'Клиент', 'Что сделал', 'От точки', 'В дороге', 'Внимание'], a.vis.map(row)) : '<p class="mut">Визитов пока нет.</p>', { cls: 'w12', sub: 'По порядку визитов. «От точки» — на каком расстоянии от магазина агент отметился, «В дороге» — время после предыдущего визита.' })}
    ${missed.length ? UI.panel('Не посещены', LX.table(['Клиент', 'Адрес', 'Задачи на визит'], missed.map(s => `<tr><td>${esc(s.client)}${s.unplanned ? ' ' + UI.pill('muted', 'вне плана') : ''}</td><td class="mut">${esc(s.address)}</td><td>${s.tasks.map(x => esc(x.text || VZ.TYPES[x.type] || x.type)).join(', ') || '—'}</td></tr>`)), { cls: 'w12', sub: 'Точки маршрута на этот день, где агент ничего не отметил.' }) : ''}
    ${Object.keys(S).length ? UI.panel('Итоги дня в LINKO', `<p>Задач ${VZ.num(S.all_tasks)}, выполнено ${VZ.num(S.all_done_tasks)} · визитов по плану ${VZ.num(S.visit_tasks)}, сделано ${VZ.num(S.visit_done_tasks)} · вне плана ${VZ.num(S.no_plan_count)} · заказы ${VZ.money(VZ.num(S.order_total_price), k.cur)} · оплаты ${VZ.money(VZ.num(S.client_transaction_total_price), k.cur)} · возвраты ${VZ.money(VZ.num(S.order_return_total_price), k.cur)} · заказы за месяц ${VZ.money(VZ.num(S.month_order_total_price), k.cur)}</p>`, { cls: 'w12' }) : ''}`;
  },

  viewWeek(W, agentId) {
    if (!W) return '<p class="mut">Загружаю неделю…</p>';
    if (!W.length) return '<p class="mut">Нет визитов за последние дни.</p>';
    const names = new Map(); for (const d of W) for (const a of d.ag) names.set(a.id, a.name);
    const ids = [...names.keys()].sort((x, y) => String(names.get(x)).localeCompare(String(names.get(y)), 'ru'));
    const cell = (d, id) => { const a = d.ag.find(x => x.id === id); if (!a) return '<td class="mut">—</td>'; const k = a.k; return `<td><b>${k.visited}/${k.plan}</b>${k.unplanned ? ` <span class="mut">+${k.unplanned}</span>` : ''}<div style="font-size:12px">${VZ.money(k.order, k.cur)}${k.sus ? ' ' + UI.pill('crit', '⚠' + k.sus) : ''}</div></td>`; };
    const sum = ids.map(id => {
      const ks = W.map(d => d.ag.find(x => x.id === id)).filter(Boolean), t = { plan: 0, visited: 0, unplanned: 0, visits: 0, orders: 0, order: 0, pay: 0, sus: 0, durs: [], clients: new Set(), cur: '' };
      for (const a of ks) { for (const k of ['plan', 'visited', 'unplanned', 'visits', 'orders', 'order', 'pay', 'sus']) t[k] += a.k[k]; if (a.k.avg != null) t.durs.push(a.k.avg); a.vis.forEach(s => t.clients.add(s.client)); t.cur ||= a.k.cur; }
      return { id, name: names.get(id), days: ks.length, ...t, avg: t.durs.length ? t.durs.reduce((x, y) => x + y, 0) / t.durs.length : null };
    });
    // who the chosen agent visits over the week
    const cl = new Map();
    for (const d of W) { const a = d.ag.find(x => x.id === agentId); if (!a) continue; for (const s of a.stops) { const c = cl.get(s.client) || { client: s.client, plan: 0, vis: [], order: 0, pay: 0, rej: 0, cur: s.cur }; if (!s.unplanned) c.plan++; if (s.visited) c.vis.push(d.day); c.order += s.order; c.pay += s.pay; c.rej += s.rej ? 1 : 0; c.cur ||= s.cur; cl.set(s.client, c); } }
    const clients = [...cl.values()].sort((a, b) => b.vis.length - a.vis.length || a.client.localeCompare(b.client, 'ru'));
    const dh = d => `${VZ.wd(d.day)} ${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`;
    return `${UI.panel('Неделя: агент × день', LX.table(['Агент', ...W.map(dh)], ids.map(id => `<tr><td><a href="#" data-ag="${esc(id)}">${esc(names.get(id))}</a></td>${W.map(d => cell(d, id)).join('')}</tr>`)), { cls: 'w12', sub: `В клетке: посещено / по плану, +вне плана, сумма заказов, ⚠ — подозрительное. Дней с данными: ${W.length} (визиты сохраняются с 23.10.2026).` })}
    ${UI.panel('Итоги по агентам', LX.table(['Агент', 'Дней', 'Выполнение плана', 'Визитов', 'Вне плана', 'Клиентов', 'Средний визит', 'Визиты с заказом', 'Заказ на визит', 'Заказы', 'Оплаты', 'Внимание'],
      sum.map(t => `<tr><td>${esc(t.name)}</td><td>${t.days}</td><td>${VZ.pct(t.visited, t.plan)}</td><td>${t.visits}</td><td>${t.unplanned || '—'}</td><td>${t.clients.size}</td><td>${VZ.mm(t.avg)}</td><td>${VZ.pct(t.orders, t.visits)}</td><td>${t.visits ? VZ.money(t.order / t.visits, t.cur) : '—'}</td><td>${VZ.money(t.order, t.cur)}</td><td>${VZ.money(t.pay, t.cur)}</td><td>${t.sus ? UI.pill('crit', '⚠ ' + t.sus) : UI.pill('good', 'всё ок')}</td></tr>`)),
      { cls: 'w12', sub: '«Визиты с заказом» — какая доля визитов закончилась заказом. «Заказ на визит» — сумма заказов, делённая на число визитов.' })}
    ${UI.panel(`Кого посещает: ${esc(names.get(agentId) || '')}`, clients.length ? LX.table(['Клиент', 'По плану, раз', 'Посещён, раз', ...W.map(d => VZ.wd(d.day) + ' ' + d.day.slice(8, 10)), 'Заказы', 'Оплаты', 'Отказы'],
      clients.map(c => `<tr><td>${esc(c.client)}</td><td>${c.plan}</td><td>${c.vis.length ? c.vis.length : '<b class="neg">0</b>'}</td>${W.map(d => `<td>${c.vis.includes(d.day) ? '✓' : '<span class="mut">·</span>'}</td>`).join('')}<td>${VZ.money(c.order, c.cur)}</td><td>${VZ.money(c.pay, c.cur)}</td><td>${c.rej || '—'}</td></tr>`)) : '<p class="mut">Нет визитов за неделю.</p>',
      { cls: 'w12', sub: 'Выберите агента вверху. Видно, к кому он ходит, как часто и с каким результатом; 0 — клиент маршрута без визита.' })}`;
  },

  viewSus(A) {
    const all = A.flatMap(a => a.sus.map(f => ({ a, ...f })));
    if (!all.length) return UI.panel('Подозрительное', '<p>За этот день ничего подозрительного: визиты нормальной длины, отметки у точек, без долгих перерывов.</p>', { cls: 'w12' });
    const cnt = k => all.filter(f => f.kind === k).length;
    return `<div class="kpis w12">${Object.entries(VZ.KIND).map(([k, [tone, name]]) => UI.tile(name, String(cnt(k)), { tone: cnt(k) ? tone : 'good' })).join('')}</div>
    ${UI.panel('Что проверить', LX.table(['Агент', 'Время', 'Клиент', 'Что не так'], all.sort((x, y) => String(x.a.name).localeCompare(String(y.a.name), 'ru') || (x.s.inT || '').localeCompare(y.s.inT || '')).map(f => `<tr><td><a href="#" data-ag="${esc(f.a.id)}">${esc(f.a.name)}</a></td><td>${VZ.t(f.s.inT) || '—'}</td><td>${esc(f.s.client)}</td><td>${UI.pill(VZ.KIND[f.kind][0], VZ.KIND[f.kind][1])} ${esc(f.text)}</td></tr>`), { max: '640px' }),
      { cls: 'w12', sub: `Правила: визит короче ${VZ.RULE.short} мин; отметка дальше ${VZ.RULE.far} м от магазина; перерыв между визитами больше ${VZ.RULE.gap} мин; визит без заказа, оплаты, отказа и фото; точка маршрута без визита.` })}`;
  },

  viewRaw(j, a) {
    const raw = a ? j?.agents?.[a.id] : null;
    return UI.panel('Данные LINKO (для проверки)', `<p class="mut">Как пришло из LINKO по выбранному агенту — нужно только для настройки.</p><pre style="max-height:420px;overflow:auto;font-size:12px;white-space:pre-wrap">${esc(JSON.stringify(raw, null, 1)?.slice(0, 60000) || 'нет')}</pre>`, { cls: 'w12' });
  },
};

EXT_PAGES.visits = async el => {
  await CRMLocal.ready;
  el.innerHTML = `<div class="page-head"><div><h2>Визиты агентов</h2><div class="sub">Из LINKO «Клиенты → Маршруты»: кто к кому пришёл, во сколько вошёл и вышел, что сделал — заказ, оплата, отказ, фото. Обновляется каждые 30 минут, каждый день сохраняется в архив.</div></div></div><div id="vzBody"><p class="mut">Загружаю визиты…</p></div>`;
  const body = $('#vzBody', el);
  if (!CLOUD.on()) { body.innerHTML = UI.empty('Синхронизация не настроена', 'Визиты приходят через тот же приватный репозиторий, что и данные CRM. Включите <a href="#/cloud">Данные → Синхронизация и настройки</a>.'); return; }
  const today = UI.localDate(Date.now());
  VZ.day ||= today; VZ._refs = null;
  let j, days;
  try { [j, days] = await Promise.all([VZ.load(VZ.day), VZ.days()]); } catch (e) { body.innerHTML = `<p class="neg">Не удалось получить визиты: ${esc(e.message)}</p>`; return; }
  if (!days.includes(VZ.day)) days.unshift(VZ.day);
  const A = VZ.parse(j);
  if (!A.some(a => a.id === VZ.agent)) VZ.agent = A[0]?.id || VZ.agent;
  const a = A.find(x => x.id === VZ.agent), key = days.join();
  const tabs = [['day', 'День'], ['agent', 'Агент по минутам'], ['week', 'Неделя'], ['sus', `⚠ Подозрительное (${A.reduce((n, x) => n + x.sus.length, 0)})`], ['raw', 'Данные LINKO']];
  const errs = Object.entries(j?.errors || {}).filter(([k]) => k !== 'summary');
  const head = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <label>День <select id="vzDay">${days.map(d => `<option value="${d}"${d === VZ.day ? ' selected' : ''}>${VZ.wd(d)} ${UI.dateRu(d)}${d === today ? ' (сегодня)' : ''}</option>`).join('')}</select></label>
      ${A.length ? `<label>Агент <select id="vzAg">${A.map(x => `<option value="${esc(x.id)}"${x.id === VZ.agent ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn" id="vzRe" type="button">🔄 Обновить</button>
      ${j ? `<span class="mut">Данные LINKO на ${esc(new Date(j.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</span>` : ''}
    </div>
    <nav class="tabs" style="margin-bottom:12px">${tabs.map(([k, t]) => `<a href="#" data-tab="${k}" class="${VZ.tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    ${errs.length ? `<p class="mut">LINKO не отдал часть данных: ${errs.slice(0, 4).map(([k, v]) => esc(k + ' — ' + v)).join('; ')}</p>` : ''}`;
  let main;
  if (VZ.tab === 'week') main = VZ.viewWeek(VZ.week?.key === key ? VZ.week.W : null, VZ.agent);
  else if (!j) main = UI.empty('За этот день визитов нет', VZ.day === today ? 'Их собирает скрипт автозагрузки каждые 30 минут. Если пусто долго — обновите скрипт в Google: <a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт».' : 'В архиве нет визитов за этот день — их начали сохранять 23.10.2026.');
  else if (VZ.tab === 'agent') main = VZ.viewAgent(a);
  else if (VZ.tab === 'sus') main = VZ.viewSus(A);
  else if (VZ.tab === 'raw') main = VZ.viewRaw(j, a);
  else main = A.length ? VZ.viewDay(A) : '<p class="mut">За этот день LINKO не прислал маршрутов.</p>';
  body.innerHTML = head + `<div class="grid">${main}</div>`;

  const redraw = () => EXT_PAGES.visits(el);
  $('#vzDay', body).onchange = e => { VZ.day = e.target.value; redraw(); };
  if ($('#vzAg', body)) $('#vzAg', body).onchange = e => { VZ.agent = e.target.value; redraw(); };
  $('#vzRe', body).onclick = () => { VZ.cache = {}; VZ.week = null; redraw(); };
  body.querySelectorAll('[data-tab]').forEach(x => x.onclick = e => { e.preventDefault(); VZ.tab = x.dataset.tab; redraw(); });
  body.querySelectorAll('[data-ag]').forEach(x => x.onclick = e => { e.preventDefault(); VZ.agent = x.dataset.ag; VZ.tab = 'agent'; redraw(); });
  if (VZ.tab === 'week' && VZ.week?.key !== key) {
    const W = await VZ.loadWeek(days);
    VZ.week = { key, W };
    if (VZ.tab === 'week' && el.isConnected) redraw();
  }
};
