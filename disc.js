// Дисциплина (Агенты → Дисциплина): the period result of every agent — days started late, route completion, refusals without a
// reason, visits outside the plan. LINKO gives the first / last visit only for today («работа агентов сегодня»), so the CRM keeps
// a daily log itself: every time LINKO data comes in, today's first and last visit of each agent are saved (the earliest first,
// the latest last). A day when the CRM was not opened at all has no record.
// Stored in the synced state: ext.disc = { start: '09:00', route: 90, days: { 'YYYY-MM-DD': { [agent]: { first, last, plan, done, rej } } } }.
window.EXT_PAGES = window.EXT_PAGES || {};

const DS = {
  agent: '',
  cfg() { const x = CRMLocal.ext(); return (x.disc ||= { start: '09:00', route: 90, days: {} }); },
  hm: v => { const m = String(v || '').match(/(\d{2}):(\d{2})/); return m ? m[1] + ':' + m[2] : ''; },
  mins: t => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null),
  noReason: c => !String(c || '').trim() || /^без причины$/i.test(String(c).trim()),

  // today's working day from LINKO → the daily log (called whenever LINKO data is imported)
  capture() {
    try {
      if (!CRMLocal.engine || typeof LX === 'undefined' || !LX.has()) return;
      const rows = LX.d('workday'); if (!rows.length) return;
      const c = DS.cfg(), fallback = LX.st()?.to || UI.localDate(Date.now());
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
      const keep = UI.localDate(Date.now() - 70 * 864e5); for (const k of Object.keys(c.days)) if (k < keep) { delete c.days[k]; changed = true; }
      if (changed) CRMLocal.touch();
    } catch (e) { console.warn('disc capture', e); }
  },

  model() {
    const c = DS.cfg(), s = LX.st() || {}, from = s.from || '', to = s.to || UI.localDate(Date.now()), start = DS.mins(c.start || '09:00'), target = (Number(c.route) || 90) / 100;
    const days = Object.keys(c.days).filter(d => (!from || d >= from) && d <= to).sort();
    const per = LX.d('workper').map(r => ({ ...r, agent: LX.agentName([r.first_name, r.second_name].filter(Boolean).join(' ')) })).filter(r => r.agent);
    const rej = LX.d('rejects').map(r => ({ date: LX.day(r.created_date), comment: r.comment, agent: LX.agentName(LX.person(r, 'user')), client: r['market.name'] || '' })).filter(r => r.agent);
    const names = [...new Set([...per.map(r => r.agent), ...days.flatMap(d => Object.keys(c.days[d]))])].sort((a, b) => a.localeCompare(b));
    const rows = names.map(a => {
      const log = days.map(d => ({ day: d, ...(c.days[d][a] || {}) })).filter(x => x.first || x.plan);
      const started = log.filter(x => x.first), late = started.filter(x => DS.mins(x.first) > start), idle = log.filter(x => x.plan > 0 && !x.first);
      const p = per.find(r => r.agent === a) || {}, plan = LX.n(p.total_tasks_by_market), done = LX.n(p.total_tasks_done_by_market);
      const myRej = rej.filter(r => r.agent === a), noWhy = myRej.filter(r => DS.noReason(r.comment));
      const route = plan ? done / plan : null, avgFirst = started.length ? Math.round(started.reduce((s2, x) => s2 + DS.mins(x.first), 0) / started.length) : null;
      const lateMin = late.reduce((s2, x) => s2 + DS.mins(x.first) - start, 0);
      const marks = (late.length ? 1 : 0) + (route !== null && route < target ? 1 : 0) + (noWhy.length && noWhy.length / myRej.length > 0.2 ? 1 : 0) + (idle.length ? 1 : 0);
      return { agent: a, logged: log.length, late: late.length, lateMin, avgFirst, idle: idle.length, plan, done, route, rej: myRej.length, noWhy: noWhy.length, outside: LX.n(p.no_plan_count), marks, log };
    }).sort((x, y) => y.marks - x.marks || y.late - x.late || (x.route ?? 1) - (y.route ?? 1));
    return { from, to, days, rows, start, target, startTxt: c.start || '09:00' };
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
  el.innerHTML = `<div class="page-head"><div><h2>Дисциплина</h2><div class="sub">Итог за период плана по каждому агенту: опоздания, маршрут, отказы без причины</div></div></div><div id="dsBody"></div>`;
  const body = $('#dsBody', el);
  if (!LX.has() || (!LX.d('workper').length && !LX.d('workday').length)) { body.innerHTML = UI.empty('Нет данных о работе агентов', 'Нужны разделы LINKO «работа агентов» из автозагрузки (<a href="#/cloud">Данные → Синхронизация и настройки</a>).'); return; }
  const c = DS.cfg(), m = DS.model(), f = UI.fmt0, pc = v => (v === null ? '—' : Math.round(v * 100) + '%');
  const R = m.rows.filter(r => !DS.agent || r.agent === DS.agent), all = m.rows;
  const lateAll = all.reduce((s, r) => s + r.late, 0), rejAll = all.reduce((s, r) => s + r.rej, 0), noWhyAll = all.reduce((s, r) => s + r.noWhy, 0);
  const P = all.reduce((s, r) => s + r.plan, 0), D = all.reduce((s, r) => s + r.done, 0);
  const shown = m.days.slice(-14);
  body.innerHTML = `<div class="kpis">
    ${UI.tile('Опозданий за период', f(lateAll), { sub: `первый визит позже ${esc(m.startTxt)} · дней в журнале: ${m.days.length}`, tone: lateAll ? 'warn' : 'good' })}
    ${UI.tile('Маршрут выполнен', P ? pc(D / P) : '—', { sub: `визитов ${f(D)} из ${f(P)} · норма ${Math.round(m.target * 100)}%`, tone: P ? (D / P >= m.target ? 'good' : 'bad') : '' })}
    ${UI.tile('Отказы без причины', `${f(noWhyAll)} из ${f(rejAll)}`, { sub: rejAll ? pc(noWhyAll / rejAll) + ' отказов' : 'отказов нет', tone: noWhyAll ? 'bad' : 'good' })}
    ${UI.tile('Агентов с замечаниями', `${f(all.filter(r => r.marks).length)} из ${f(all.length)}`, { sub: 'хотя бы одно нарушение' })}</div>
    <div class="bar"><label class="mut">Начало дня — первый визит до <input id="dsStart" type="time" value="${esc(m.startTxt)}" style="width:110px"></label>
    <label class="mut">Норма маршрута, % <input id="dsRoute" type="number" min="10" max="100" step="5" value="${Math.round(m.target * 100)}" style="width:64px"></label>
    <select id="dsAg" aria-label="Агент"><option value="">Все агенты</option>${all.map(r => `<option ${r.agent === DS.agent ? 'selected' : ''}>${esc(r.agent)}</option>`).join('')}</select></div>
    ${m.days.length < 5 ? `<p class="mut">⚠ Журнал первых визитов ведётся с момента обновления CRM: пока в нём ${m.days.length} ${UI.plural(m.days.length, 'день', 'дня', 'дней')}. Дни, когда CRM ни разу не открывали, в журнал не попадают — откройте её хотя бы раз в рабочий день.</p>` : ''}
    <div class="grid">
    ${UI.panel('Агенты за период', R.length ? LX.table(['Агент', '#Замечаний', '#Опозданий', '#Сумма опозданий', '#Средний первый визит', '#Дней без визитов', '#Маршрут', '#Отказов', '#Без причины', '#Визитов вне плана'], R.map(r => `<tr><td>${LX.ag(r.agent)}</td><td class="n ${r.marks ? 'neg' : 'pos'}"><b>${r.marks || '✓'}</b></td><td class="n ${r.late ? 'neg' : ''}">${f(r.late)}<small class="mut"> из ${f(r.logged)}</small></td><td class="n">${r.lateMin ? DS.t(r.lateMin) + ' ч' : '—'}</td><td class="n">${DS.t(r.avgFirst)}</td><td class="n ${r.idle ? 'neg' : ''}">${f(r.idle)}</td><td class="n ${r.route !== null && r.route < m.target ? 'neg' : ''}">${pc(r.route)}<small class="mut"> ${f(r.done)}/${f(r.plan)}</small></td><td class="n">${f(r.rej)}</td><td class="n ${r.noWhy && r.noWhy / r.rej > 0.2 ? 'neg' : ''}">${f(r.noWhy)}${r.rej ? `<small class="mut"> (${pc(r.noWhy / r.rej)})</small>` : ''}</td><td class="n">${f(r.outside)}</td></tr>`)) : '<p class="mut">Нет данных.</p>', { cls: 'w12', sub: `Замечание — каждое из: были опоздания; маршрут ниже ${Math.round(m.target * 100)}%; больше 20% отказов без причины; дни с планом визитов, но без единого визита. Маршрут и отказы — из LINKO за весь период, опоздания — из журнала CRM.` })}
    ${UI.panel('Первый визит по дням', shown.length ? `<div class="tscroll"><table><thead><tr><th>Агент</th>${shown.map(d => `<th class="n">${UI.dm(d)}</th>`).join('')}</tr></thead><tbody>${R.map(r => `<tr><td>${esc(r.agent)}</td>${shown.map(d => { const x = DS.cfg().days[d]?.[r.agent]; if (!x) return '<td class="n mut">·</td>'; if (!x.first) return `<td class="n ${x.plan ? 'neg' : 'mut'}">${x.plan ? 'нет' : '—'}</td>`; return `<td class="n ${DS.mins(x.first) > m.start ? 'neg' : ''}" title="последний визит ${esc(x.last || '—')} · визитов ${x.done}/${x.plan}">${esc(x.first)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="mut">Журнал пока пуст.</p>', { cls: 'w12', sub: `Последние ${shown.length} дней журнала. Красным — позже ${esc(m.startTxt)} или день с планом без визитов; «·» — нет записи (CRM не открывали). Наведите на время — последний визит и визиты за день.` })}
    </div>`;
  $('#dsStart', body).onchange = e => { const v = DS.hm(e.target.value); if (!v) { e.target.value = c.start || '09:00'; return toast('Время ЧЧ:ММ'); } c.start = v; CRMLocal.touch(); EXT_PAGES.disc(el); };
  $('#dsRoute', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 10 && v <= 100)) { e.target.value = Number(c.route) || 90; return toast('Норма: от 10 до 100%'); } c.route = v; CRMLocal.touch(); EXT_PAGES.disc(el); };
  $('#dsAg', body).onchange = e => { DS.agent = e.target.value; EXT_PAGES.disc(el); };
};
