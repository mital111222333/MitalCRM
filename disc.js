// Дисциплина (Агенты → Дисциплина): the period result of every agent — days started late, route completion, refusals without a
// reason, visits outside the plan. The start of the day is the agent's first report in LINKO (the photo «вышел на работу» in
// Персонал → Активность — LINKO's first done task of the day); every minute after the start time is fined (ext.disc.fine сум). LINKO gives the first / last visit only for today («работа агентов сегодня»), so the CRM keeps
// a daily log itself: every time LINKO data comes in, today's first and last visit of each agent are saved (the earliest first,
// the latest last). A day when the CRM was not opened at all has no record.
// Stored in the synced state: ext.disc = { start: '09:00', route: 90, fine: 1000, days: { 'YYYY-MM-DD': { [agent]: { first, last, plan, done, rej } } },
// abs: { 'YYYY-MM-DD': { [agent]: status } }, free: { [agent]: true } }. A status of the day is set by the manager: «absent» (невыход) is a
// violation; sick / leave / vac / off excuse the day (no fine, the day is not counted); «free» (свободный график) — the agent works, but
// without the start time, so no fine. free[agent] = a permanent free schedule.
window.EXT_PAGES = window.EXT_PAGES || {};

const DS = {
  agent: '',
  ST: { absent: { t: 'Невыход', s: 'Н' }, sick: { t: 'Больничный', s: 'Б' }, leave: { t: 'Отпросился', s: 'О' }, vac: { t: 'Отпуск', s: 'ОТ' }, off: { t: 'Выходной', s: 'В' }, free: { t: 'Свободный график', s: 'СГ' } },
  cfg() { const x = CRMLocal.ext(); const c = (x.disc ||= { start: '09:00', route: 90, days: {} }); if (c.fine == null) c.fine = 1000; c.abs ||= {}; c.free ||= {}; return c; },
  lateOf(first, start) { const m = DS.mins(first); return m === null ? 0 : Math.max(0, m - start); }, // whole minutes after the start
  // the status of an agent's day: a mark of the manager, else the permanent free schedule, else '' (an ordinary working day)
  status(day, agent) { const c = DS.cfg(); return c.abs[day]?.[agent] || (c.free[agent] ? 'free' : ''); },
  away: st => !!st && st !== 'free', // the agent did not work that day (absent or excused)
  lateFor(day, agent, first, start) { return DS.status(day, agent) ? 0 : DS.lateOf(first, start); }, // any status — no fine
  setStatus(agent, from, to, st) {
    const c = DS.cfg(); let n = 0;
    for (let t = Date.parse(from + 'T12:00:00'), end = Date.parse(to + 'T12:00:00'); t <= end && n < 93; t += 864e5, n++) {
      const d = UI.localDate(t);
      if (st) (c.abs[d] ||= {})[agent] = st; else if (c.abs[d]) { delete c.abs[d][agent]; if (!Object.keys(c.abs[d]).length) delete c.abs[d]; }
    }
    CRMLocal.touch(); return n;
  },
  // marks grouped into runs of consecutive days with the same status, for the list of absences
  runs(from) {
    const c = DS.cfg(), out = [];
    for (const d of Object.keys(c.abs).filter(k => !from || k >= from).sort()) for (const [a, st] of Object.entries(c.abs[d])) {
      const last = out.findLast(r => r.agent === a);
      if (last && last.st === st && UI.localDate(Date.parse(last.to + 'T12:00:00') + 864e5) === d) last.to = d; else out.push({ agent: a, st, from: d, to: d });
    }
    return out.sort((x, y) => y.from.localeCompare(x.from) || x.agent.localeCompare(y.agent));
  },
  hm: v => { const m = String(v || '').match(/(\d{2}):(\d{2})/); return m ? m[1] + ':' + m[2] : ''; },
  mins: t => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null),
  noReason: c => !String(c || '').trim() || /^без причины$/i.test(String(c).trim()),

  // today's working day from LINKO → the daily log (called whenever LINKO data is imported); an archived day comes with its rows and date
  capture(rowsIn, dayIn) {
    try {
      if (!CRMLocal.engine || typeof LX === 'undefined' || (!rowsIn && !LX.has())) return false;
      const rows = rowsIn || LX.d('workday'); if (!rows.length) return false;
      const c = DS.cfg(), fallback = dayIn || LX.st()?.to || UI.localDate(Date.now());
      let changed = false;
      for (const r of rows) {
        const agent = LX.agentName([r.first_name, r.second_name].filter(Boolean).join(' ')); if (!agent) continue;
        const fRaw = String(r['first_done_task_time.date'] || ''), lRaw = String(typeof r.last_done_task_time === 'object' && r.last_done_task_time ? r.last_done_task_time.date || '' : r.last_done_task_time || '');
        const day = /^\d{4}-\d{2}-\d{2}/.test(fRaw) ? fRaw.slice(0, 10) : fallback, first = DS.hm(fRaw), last = DS.hm(lRaw);
        const plan = LX.n(r.total_tasks_by_market), done = LX.n(r.total_tasks_done_by_market), rej = LX.n(r.total_rejects);
        if (!first && !plan && !done) continue;
        const d = ((c.days[day] ||= {})[agent] ||= { first: '', last: '', plan: 0, done: 0, rej: 0 });
        const next = { first: d.first && first ? (first < d.first ? first : d.first) : d.first || first, last: d.last && last ? (last > d.last ? last : d.last) : d.last || last, plan: Math.max(d.plan, plan), done: Math.max(d.done, done), rej: Math.max(d.rej, rej) };
        if (JSON.stringify(next) !== JSON.stringify(d)) { Object.assign(d, next); changed = true; }
      }
      // keep about two plan periods
      const keep = UI.localDate(Date.now() - 70 * 864e5); for (const o of [c.days, c.abs]) for (const k of Object.keys(o)) if (k < keep) { delete o[k]; changed = true; }
      if (changed) CRMLocal.touch();
      return changed;
    } catch (e) { console.warn('disc capture', e); return false; }
  },

  model() {
    const c = DS.cfg(), s = LX.st() || {}, from = s.from || '', to = s.to || UI.localDate(Date.now()), start = DS.mins(c.start || '09:00'), target = (Number(c.route) || 90) / 100;
    const days = [...new Set([...Object.keys(c.days), ...Object.keys(c.abs)])].filter(d => (!from || d >= from) && d <= to).sort();
    const per = LX.d('workper').map(r => ({ ...r, agent: LX.agentName([r.first_name, r.second_name].filter(Boolean).join(' ')) })).filter(r => r.agent);
    const rej = LX.d('rejects').map(r => ({ date: LX.day(r.created_date), comment: r.comment, agent: LX.agentName(LX.person(r, 'user')), client: r['market.name'] || '' })).filter(r => r.agent);
    const names = [...new Set([...per.map(r => r.agent), ...days.flatMap(d => [...Object.keys(c.days[d] || {}), ...Object.keys(c.abs[d] || {})])])].sort((a, b) => a.localeCompare(b));
    const rows = names.map(a => {
      const all = days.map(d => ({ day: d, ...(c.days[d]?.[a] || {}), st: DS.status(d, a) })).filter(x => x.first || x.plan || DS.away(x.st));
      // a day off / sick / absent is not a working day: no lateness, no «day without visits»; free schedule — works without the start time
      const log = all.filter(x => !DS.away(x.st)), absent = all.filter(x => x.st === 'absent').length, away = {};
      for (const x of all) if (DS.away(x.st) && x.st !== 'absent') away[x.st] = (away[x.st] || 0) + 1;
      const started = log.filter(x => x.first), late = started.filter(x => !x.st && DS.mins(x.first) > start), idle = log.filter(x => x.plan > 0 && !x.first);
      const p = per.find(r => r.agent === a) || {}, plan = LX.n(p.total_tasks_by_market), done = LX.n(p.total_tasks_done_by_market);
      const myRej = rej.filter(r => r.agent === a), noWhy = myRej.filter(r => DS.noReason(r.comment));
      const route = plan ? done / plan : null, avgFirst = started.length ? Math.round(started.reduce((s2, x) => s2 + DS.mins(x.first), 0) / started.length) : null;
      const lateMin = late.reduce((s2, x) => s2 + DS.lateOf(x.first, start), 0), fine = lateMin * (Number(c.fine) || 0);
      const marks = (late.length ? 1 : 0) + (route !== null && route < target ? 1 : 0) + (noWhy.length && noWhy.length / myRej.length > 0.2 ? 1 : 0) + (idle.length ? 1 : 0) + (absent ? 1 : 0);
      return { agent: a, logged: log.length, late: late.length, lateMin, fine, avgFirst, idle: idle.length, absent, away, free: !!c.free[a], plan, done, route, rej: myRej.length, noWhy: noWhy.length, outside: LX.n(p.no_plan_count), marks, log };
    }).sort((x, y) => y.marks - x.marks || y.late - x.late || (x.route ?? 1) - (y.route ?? 1));
    return { from, to, days, rows, start, target, startTxt: c.start || '09:00', rate: Number(c.fine) || 0 };
  },
  t: m => (m === null ? '—' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')),
};

// every import of LINKO data also updates the daily log
(() => {
  for (const k of ['importSnap', 'importFast', 'put']) {
    const orig = LX[k]; if (typeof orig !== 'function') continue;
    LX[k] = function (...a) { const r = orig.apply(this, a); setTimeout(DS.capture, 0); return r; };
  }
  Promise.resolve(CRMLocal.ready).then(() => setTimeout(DS.capture, 1500));
})();

EXT_PAGES.disc = async el => {
  await CRMLocal.ready; await LX.load(); DS.capture();
  // days the CRM was not opened on: take them from the daily archive of the auto-loader (archive.js), then redraw once
  if (typeof ARC !== 'undefined' && !ARC._filled) ARC.fillDisc().then(n => { if (n && location.hash === '#/disc') { toast(`Журнал дополнен из архива: ${n} дн.`); EXT_PAGES.disc(el); } }).catch(() => {});
  el.innerHTML = `<div class="page-head"><div><h2>Дисциплина</h2><div class="sub">Начало дня — первый фотоотчёт агента в LINKO (Персонал → Активность). Опоздания со штрафом, маршрут, отказы без причины — сегодня и за период плана</div></div></div><div id="dsBody"></div>`;
  const body = $('#dsBody', el);
  if (!LX.has() || (!LX.d('workper').length && !LX.d('workday').length)) { body.innerHTML = UI.empty('Нет данных о работе агентов', 'Нужны разделы LINKO «работа агентов» из автозагрузки (<a href="#/cloud">Данные → Синхронизация и настройки</a>).'); return; }
  const c = DS.cfg(), m = DS.model(), f = UI.fmt0, pc = v => (v === null ? '—' : Math.round(v * 100) + '%');
  const R = m.rows.filter(r => !DS.agent || r.agent === DS.agent), all = m.rows;
  const lateAll = all.reduce((s, r) => s + r.late, 0), rejAll = all.reduce((s, r) => s + r.rej, 0), noWhyAll = all.reduce((s, r) => s + r.noWhy, 0);
  const P = all.reduce((s, r) => s + r.plan, 0), D = all.reduce((s, r) => s + r.done, 0);
  const shown = m.days.slice(-14), sum = v => UI.fmt0(v) + ' сум', fineAll = all.reduce((s, r) => s + r.fine, 0), minAll = all.reduce((s, r) => s + r.lateMin, 0);
  // today: every agent of the period; no report yet after the start time = already late (the fine is fixed by the time of the report)
  const t0 = UI.localDate(Date.now()), nowM = new Date().getHours() * 60 + new Date().getMinutes(), td = DS.cfg().days[t0] || {};
  const today = all.map(r => { const x = td[r.agent] || {}, st = DS.status(t0, r.agent), late = x.first && !st ? DS.lateOf(x.first, m.start) : 0, wait = !st && !x.first && x.plan > 0 && nowM > m.start ? nowM - m.start : 0, off = !x.first && !x.plan; return { agent: r.agent, st, first: x.first || '', last: x.last || '', late, wait, off, fine: late * m.rate, done: x.done || 0, plan: x.plan || 0 }; })
    .filter(r => !DS.agent || r.agent === DS.agent).sort((a, b) => (b.late + b.wait) - (a.late + a.wait) || a.agent.localeCompare(b.agent));
  const tFine = today.reduce((s, r) => s + r.fine, 0), tLate = today.filter(r => r.late).length, tMiss = today.filter(r => r.wait).length;
  const tAway = today.filter(r => DS.away(r.st)), stName = st => DS.ST[st]?.t || '', byKind = L => Object.entries(L.reduce((o, r) => ((o[r.st] = (o[r.st] || 0) + 1), o), {})).map(([k, n]) => `${stName(k).toLowerCase()} ${n}`).join(' · ');
  const stSel = (agent, day) => `<select data-dsst="${esc(agent)}" data-dsday="${day}" aria-label="Статус дня" style="padding:2px 4px;font-size:12px"><option value="">${DS.cfg().free[agent] ? 'Свободный график' : 'Работает'}</option>${Object.entries(DS.ST).map(([k, v]) => `<option value="${k}" ${DS.cfg().abs[day]?.[agent] === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select>`;
  const stBadge = st => `<b title="${esc(stName(st))}">${DS.ST[st].s}</b>`;
  const runs = DS.runs(m.from).filter(x => !DS.agent || x.agent === DS.agent), freeAg = Object.keys(c.free).filter(a => c.free[a] && (!DS.agent || a === DS.agent)).sort();
  body.innerHTML = `<div class="kpis">
    ${UI.tile('Штраф сегодня', sum(tFine), { sub: `опоздали ${f(tLate)} · ещё нет отчёта ${f(tMiss)}`, tone: tFine || tMiss ? 'bad' : 'good' })}
    ${UI.tile('Нет на работе сегодня', f(tAway.length), { sub: tAway.length ? byKind(tAway) : 'все в строю', tone: tAway.some(r => r.st === 'absent') ? 'bad' : tAway.length ? 'warn' : 'good' })}
    ${UI.tile('Штрафы за период', sum(fineAll), { sub: `опозданий ${f(lateAll)} · ${f(minAll)} мин · дней в журнале ${m.days.length}`, tone: fineAll ? 'warn' : 'good' })}
    ${UI.tile('Маршрут выполнен', P ? pc(D / P) : '—', { sub: `визитов ${f(D)} из ${f(P)} · норма ${Math.round(m.target * 100)}%`, tone: P ? (D / P >= m.target ? 'good' : 'bad') : '' })}
    ${UI.tile('Отказы без причины', `${f(noWhyAll)} из ${f(rejAll)}`, { sub: rejAll ? pc(noWhyAll / rejAll) + ' отказов' : 'отказов нет', tone: noWhyAll ? 'bad' : 'good' })}
    </div>
    <div class="bar"><label class="mut">Первый отчёт до <input id="dsStart" type="time" value="${esc(m.startTxt)}" style="width:110px"></label>
    <label class="mut">Штраф за минуту, сум <input id="dsFine" type="number" min="0" step="100" value="${m.rate}" style="width:90px"></label>
    <label class="mut">Норма маршрута, % <input id="dsRoute" type="number" min="10" max="100" step="5" value="${Math.round(m.target * 100)}" style="width:64px"></label>
    <select id="dsAg" aria-label="Агент"><option value="">Все агенты</option>${all.map(r => `<option ${r.agent === DS.agent ? 'selected' : ''}>${esc(r.agent)}</option>`).join('')}</select></div>
    ${m.days.length < 5 ? `<p class="mut">⚠ Журнал первых визитов ведётся с момента обновления CRM: пока в нём ${m.days.length} ${UI.plural(m.days.length, 'день', 'дня', 'дней')}. Пропущенные дни CRM берёт из ежедневного архива автозагрузки (Данные → Архив данных), если он включён.</p>` : ''}
    <div class="grid">
    ${UI.panel(`Сегодня, ${UI.dateRu(t0)}`, today.length ? LX.table(['Агент', 'Статус', 'Первый отчёт', '#Опоздание, мин', '#Штраф', 'Последний', '#Визитов'], today.map(r => `<tr><td>${LX.ag(r.agent)}</td><td>${stSel(r.agent, t0)}</td><td class="${r.late || r.wait || r.st === 'absent' ? 'neg' : ''}">${DS.away(r.st) && !r.first ? `<b>${esc(stName(r.st))}</b>` : r.first ? esc(r.first) + (r.st === 'free' ? ' <small class="mut">· свободный график</small>' : '') : r.wait ? `<b>нет отчёта</b> <small>· уже ${f(r.wait)} мин</small>` : r.st === 'free' ? '<span class="mut">свободный график</span>' : r.off ? '<span class="mut">нет плана на сегодня</span>' : '<span class="mut">ещё рано</span>'}</td><td class="n ${r.late ? 'neg' : ''}">${r.late ? f(r.late) : r.first ? '✓' : '—'}</td><td class="n ${r.fine ? 'neg' : ''}">${r.fine ? '<b>' + sum(r.fine) + '</b>' : r.wait ? `<small class="mut">≥ ${sum(r.wait * m.rate)}</small>` : '—'}</td><td>${esc(r.last || '—')}</td><td class="n">${r.plan ? `${f(r.done)}/${f(r.plan)}` : f(r.done)}</td></tr>`)) : '<p class="mut">Нет данных за сегодня.</p>', { cls: 'w12', sub: `Первый фотоотчёт до ${esc(m.startTxt)}; каждая минута позже — ${sum(m.rate)}. Пока отчёта нет, штраф растёт и фиксируется по времени отчёта. Статус дня (больничный, отпросился, отпуск, выходной, свободный график) снимает штраф; невыход — замечание.` })}
    ${UI.panel('Отсутствия и график', `<div class="bar"><select id="dsMAg" aria-label="Агент">${all.map(r => `<option ${r.agent === DS.agent ? 'selected' : ''}>${esc(r.agent)}</option>`).join('')}</select>
      <label class="mut">с <input id="dsMFrom" type="date" value="${t0}"></label><label class="mut">по <input id="dsMTo" type="date" value="${t0}"></label>
      <select id="dsMSt" aria-label="Статус">${Object.entries(DS.ST).map(([k, v]) => `<option value="${k}">${v.t}${k === 'free' ? ' — на эти дни' : ''}</option>`).join('')}<option value="freeAlways">Свободный график — постоянно</option><option value="">Снять отметку</option></select>
      <button class="btn" id="dsMSave">Отметить</button></div>
      ${runs.length || freeAg.length ? LX.table(['Агент', 'Статус', 'Дни', '#Дней', ''], [...freeAg.map(a => `<tr><td>${LX.ag(a)}</td><td><b>Свободный график</b></td><td class="mut">постоянно</td><td class="n">—</td><td class="n"><button class="btn" data-dsfree="${esc(a)}" title="Убрать свободный график">✕</button></td></tr>`), ...runs.map(x => `<tr><td>${LX.ag(x.agent)}</td><td class="${x.st === 'absent' ? 'neg' : ''}"><b>${esc(stName(x.st))}</b></td><td>${x.from === x.to ? UI.dateRu(x.from) : `${UI.dateRu(x.from)} — ${UI.dateRu(x.to)}`}</td><td class="n">${f(Math.round((Date.parse(x.to) - Date.parse(x.from)) / 864e5) + 1)}</td><td class="n"><button class="btn" data-dsdel="${esc(x.agent)}" data-from="${x.from}" data-to="${x.to}" title="Снять отметку">✕</button></td></tr>`)]) : '<p class="mut">Отметок за период нет.</p>'}`, { cls: 'w12', sub: 'Невыход — замечание агенту (без штрафа за минуты). Больничный, отпросился, отпуск, выходной — день не считается: ни опоздания, ни «дня без визитов». Свободный график — агент работает, но без времени начала, штрафа за опоздание нет. Можно отметить сразу несколько дней (отпуск, больничный) и наперёд. Клик по клетке в «Первый отчёт по дням» подставляет агента и день.' })}
    ${UI.panel('Агенты за период', R.length ? LX.table(['Агент', '#Замечаний', '#Опозданий', '#Минут опоздания', '#Штраф за период', '#Средний первый отчёт', '#Дней без визитов', '#Невыходов', 'Отсутствия', '#Маршрут', '#Отказов', '#Без причины', '#Визитов вне плана'], R.map(r => `<tr><td>${LX.ag(r.agent)}${r.free ? ' <small class="mut">· СГ</small>' : ''}</td><td class="n ${r.marks ? 'neg' : 'pos'}"><b>${r.marks || '✓'}</b></td><td class="n ${r.late ? 'neg' : ''}">${f(r.late)}<small class="mut"> из ${f(r.logged)}</small></td><td class="n">${r.lateMin ? f(r.lateMin) : '—'}</td><td class="n ${r.fine ? 'neg' : ''}">${r.fine ? '<b>' + sum(r.fine) + '</b>' : '—'}</td><td class="n">${DS.t(r.avgFirst)}</td><td class="n ${r.idle ? 'neg' : ''}">${f(r.idle)}</td><td class="n ${r.absent ? 'neg' : ''}">${r.absent ? '<b>' + f(r.absent) + '</b>' : '—'}</td><td>${Object.keys(r.away).length ? `<small>${esc(Object.entries(r.away).map(([k, n]) => `${stName(k).toLowerCase()} ${n}`).join(' · '))}</small>` : '<span class="mut">—</span>'}</td><td class="n ${r.route !== null && r.route < m.target ? 'neg' : ''}">${pc(r.route)}<small class="mut"> ${f(r.done)}/${f(r.plan)}</small></td><td class="n">${f(r.rej)}</td><td class="n ${r.noWhy && r.noWhy / r.rej > 0.2 ? 'neg' : ''}">${f(r.noWhy)}${r.rej ? `<small class="mut"> (${pc(r.noWhy / r.rej)})</small>` : ''}</td><td class="n">${f(r.outside)}</td></tr>`)) : '<p class="mut">Нет данных.</p>', { cls: 'w12', sub: `Замечание — каждое из: были опоздания; маршрут ниже ${Math.round(m.target * 100)}%; больше 20% отказов без причины; дни с планом визитов, но без единого визита; невыход на работу. Больничный, отпросился, отпуск, выходной в опоздания и «дни без визитов» не входят. Маршрут и отказы — из LINKO за весь период, опоздания — из журнала CRM.` })}
    ${UI.panel('Первый отчёт по дням', shown.length ? `<div class="tscroll"><table><thead><tr><th>Агент</th>${shown.map(d => `<th class="n">${UI.dm(d)}</th>`).join('')}</tr></thead><tbody>${R.map(r => `<tr><td>${esc(r.agent)}</td>${shown.map(d => { const x = DS.cfg().days[d]?.[r.agent], st = DS.status(d, r.agent), at = `data-dscell="${esc(r.agent)}" data-day="${d}" style="cursor:pointer"`; if (DS.away(st)) return `<td class="n ${st === 'absent' ? 'neg' : 'mut'}" ${at}>${stBadge(st)}</td>`; if (!x) return `<td class="n mut" ${at}>·</td>`; if (!x.first) return `<td class="n ${x.plan && st !== 'free' ? 'neg' : 'mut'}" ${at}>${x.plan ? 'нет' : '—'}</td>`; const lt = DS.lateFor(d, r.agent, x.first, m.start); return `<td class="n ${lt ? 'neg' : ''}" ${at} title="${st === 'free' ? 'свободный график · ' : ''}${lt ? `опоздание ${lt} мин · штраф ${sum(lt * m.rate)} · ` : ''}последний визит ${esc(x.last || '—')} · визитов ${x.done}/${x.plan}">${esc(x.first)}${st === 'free' ? '<small class="mut"> СГ</small>' : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="mut">Журнал пока пуст.</p>', { cls: 'w12', sub: `Последние ${shown.length} дней журнала. Красным — позже ${esc(m.startTxt)} (в подсказке — минуты и штраф), день с планом без визитов или невыход; «·» — нет записи (CRM не открывали). ${Object.values(DS.ST).map(v => `${v.s} — ${v.t.toLowerCase()}`).join(', ')}. Клик по клетке — отметить статус дня.` })}
    </div>`;
  $('#dsStart', body).onchange = e => { const v = DS.hm(e.target.value); if (!v) { e.target.value = c.start || '09:00'; return toast('Время ЧЧ:ММ'); } c.start = v; CRMLocal.touch(); EXT_PAGES.disc(el); };
  $('#dsFine', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 0 && v <= 1e6)) { e.target.value = m.rate; return toast('Штраф: сумма от 0'); } c.fine = v; CRMLocal.touch(); EXT_PAGES.disc(el); };
  $('#dsRoute', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 10 && v <= 100)) { e.target.value = Number(c.route) || 90; return toast('Норма: от 10 до 100%'); } c.route = v; CRMLocal.touch(); EXT_PAGES.disc(el); };
  $('#dsAg', body).onchange = e => { DS.agent = e.target.value; EXT_PAGES.disc(el); };
  // statuses of the day: the select in today's table, the form «Отсутствия и график», ✕ in its list, a click on a cell of the days table
  body.addEventListener('change', e => { const s = e.target.closest('[data-dsst]'); if (!s) return; DS.setStatus(s.dataset.dsst, s.dataset.dsday, s.dataset.dsday, s.value); toast(s.value ? `${s.dataset.dsst}: ${stName(s.value).toLowerCase()}` : 'Отметка снята'); EXT_PAGES.disc(el); });
  $('#dsMSave', body).onclick = () => {
    const a = $('#dsMAg', body).value, from = $('#dsMFrom', body).value, to = $('#dsMTo', body).value || from, st = $('#dsMSt', body).value;
    if (!a) return toast('Выберите агента');
    if (st === 'freeAlways') { c.free[a] = true; CRMLocal.touch(); toast(`${a}: свободный график постоянно`); return EXT_PAGES.disc(el); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || to < from) return toast('Проверьте даты');
    const n = DS.setStatus(a, from, to, st); toast(st ? `${a}: ${stName(st).toLowerCase()}, ${n} ${UI.plural(n, 'день', 'дня', 'дней')}` : `Отметки сняты: ${n} ${UI.plural(n, 'день', 'дня', 'дней')}`); EXT_PAGES.disc(el);
  };
  body.addEventListener('click', e => {
    const fr = e.target.closest('[data-dsfree]'), del = e.target.closest('[data-dsdel]'), cell = e.target.closest('[data-dscell]');
    if (fr) { delete c.free[fr.dataset.dsfree]; CRMLocal.touch(); EXT_PAGES.disc(el); }
    else if (del) { if (!confirm(`Снять отметку «${del.dataset.dsdel}» с ${UI.dateRu(del.dataset.from)} по ${UI.dateRu(del.dataset.to)}?`)) return; DS.setStatus(del.dataset.dsdel, del.dataset.from, del.dataset.to, ''); EXT_PAGES.disc(el); }
    else if (cell) { $('#dsMAg', body).value = cell.dataset.dscell; $('#dsMFrom', body).value = $('#dsMTo', body).value = cell.dataset.day; const st = DS.cfg().abs[cell.dataset.day]?.[cell.dataset.dscell]; if (st) $('#dsMSt', body).value = st; $('#dsMSave', body).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
};
