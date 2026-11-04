// Дисциплина (Агенты → Дисциплина): the period result of every agent — days started late, left early, route completion, refusals
// without a reason, visits outside the plan, and the attendance sheet (табель) of the month. The start of the day is the agent's first
// report in LINKO (the photo «вышел на работу» in Персонал → Активность — LINKO's first done task of the day); every minute after the
// start time is fined (ext.disc.fine сум). LINKO gives the first / last visit only for today («работа агентов сегодня»), so the CRM keeps
// a daily log itself: every time LINKO data comes in, today's first and last visit of each agent are saved (the earliest first,
// the latest last). A day when the CRM was not opened at all has no record (archive.js fills it from the auto-loader's archive).
// Stored in the synced state: ext.disc = { start: '09:00', end: '18:00', route: 90, fine: 1000, autoAbs: '12:00', notify: true,
//   days: { 'YYYY-MM-DD': { [agent]: { first, last, plan, done, rej } } }, abs: { 'YYYY-MM-DD': { [agent]: status } },
//   notes: { 'YYYY-MM-DD': { [agent]: reason } }, free: { [agent]: true }, skip: { [agent]: true },
//   req: { [uid]: { agent, type, from, to, note, at, st: 'new' | 'ok' | 'no' } }, publishedAt }.
// A status of the day is set by the manager or comes from an agent's request (approved by the manager): «absent» (невыход) and
// «halfbad» (полдня без причины, half of a невыход) are violations; sick / leave / trip / family / vac / off / other excuse the whole
// day; «half» (полдня — отпросился) is half a working day without a fine; «free» — the agent works without the start time.
// free[agent] — a permanent free schedule; skip[agent] — shown, but never fined nor counted (the owner himself, for example).
// Auto-невыход: a day with planned visits and no report by ext.disc.autoAbs (no status, not Sunday) counts as невыход until a report comes.
// The auto-loader (autolinko.gs discNotify_) reads the same rules from disc-rules.json and writes to the agents in Telegram.
window.EXT_PAGES = window.EXT_PAGES || {};
window.INBOX_HANDLERS = window.INBOX_HANDLERS || {};

const DS = {
  agent: '', month: '',
  // k: bad — a violation, ok — the day is excused (not worked), half / halfbad — half a working day, free — works without the start time
  ST: {
    absent: { t: 'Невыход', s: 'Н', k: 'bad' }, halfbad: { t: 'Полдня без причины', s: '½Н', k: 'halfbad' }, half: { t: 'Полдня — отпросился', s: '½', k: 'half' },
    sick: { t: 'Больничный', s: 'Б', k: 'ok' }, leave: { t: 'Отпросился на день', s: 'О', k: 'ok' }, trip: { t: 'Командировка', s: 'К', k: 'ok' },
    family: { t: 'Семейные обстоятельства', s: 'С', k: 'ok' }, vac: { t: 'Отпуск', s: 'ОТ', k: 'ok' }, off: { t: 'Выходной', s: 'В', k: 'ok' },
    other: { t: 'Другая причина', s: 'Д', k: 'ok' }, free: { t: 'Свободный график', s: 'СГ', k: 'free' },
  },
  // what an agent may ask for from the cabinet (autolinko.gs doPost «absreq» accepts the same keys)
  REQ: ['leave', 'half', 'sick', 'trip', 'family', 'other'],
  cfg() {
    const x = CRMLocal.ext(); const c = (x.disc ||= { start: '09:00', route: 90, days: {} });
    if (c.fine == null) c.fine = 1000; if (c.end == null) c.end = '18:00'; if (c.autoAbs == null) c.autoAbs = '12:00'; if (c.notify == null) c.notify = true;
    c.abs ||= {}; c.free ||= {}; c.skip ||= {}; c.notes ||= {}; c.req ||= {}; return c;
  },
  lateOf(first, start) { const m = DS.mins(first); return m === null ? 0 : Math.max(0, m - start); }, // whole minutes after the start
  // the status of an agent's day: a mark of the manager, else the permanent free schedule, else '' (an ordinary working day)
  status(day, agent) { const c = DS.cfg(); return c.abs[day]?.[agent] || (c.free[agent] ? 'free' : ''); },
  away: st => !!st && (DS.ST[st]?.k === 'bad' || DS.ST[st]?.k === 'ok'), // the agent did not work that day (absent or excused)
  half: st => st === 'half' || st === 'halfbad',
  lateFor(day, agent, first, start) { return DS.cfg().skip[agent] || DS.status(day, agent) ? 0 : DS.lateOf(first, start); }, // any status — no fine
  nowMin: () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); },
  // no report by the auto-невыход time on a day with planned visits (not Sunday, no status) — counts as невыход until a report comes
  autoAbsent(day, agent, x) {
    const c = DS.cfg(); if (!c.autoAbs || c.skip[agent] || c.free[agent] || !x || x.first || !(x.plan > 0) || DS.status(day, agent)) return false;
    const t0 = UI.localDate(Date.now()); if (day > t0 || new Date(day + 'T12:00:00').getDay() === 0) return false;
    return day < t0 || DS.nowMin() >= DS.mins(c.autoAbs);
  },
  // the effective status of the day: { st, auto }
  eff(day, agent, x = DS.cfg().days[day]?.[agent]) { const st = DS.status(day, agent); return st ? { st, auto: false } : DS.autoAbsent(day, agent, x) ? { st: 'absent', auto: true } : { st: '', auto: false }; },
  // minutes the last report was before the end of the working day (0 — not early, no end time, any status but free, the day not over)
  earlyMin(day, agent, x) {
    const c = DS.cfg(), end = DS.mins(c.end); if (end === null || c.skip[agent] || !x?.last || (DS.status(day, agent) && DS.status(day, agent) !== 'free')) return 0;
    if (day === UI.localDate(Date.now()) && DS.nowMin() < end) return 0;
    return Math.max(0, end - DS.mins(x.last));
  },
  // how much of a working day the agent worked: full day 1, half 0.5, away 0
  worked(st, x) { if (DS.away(st)) return 0; if (DS.half(st)) return 0.5; return x?.first ? 1 : 0; },

  setStatus(agent, from, to, st, note = '') {
    const c = DS.cfg(); let n = 0;
    for (let t = Date.parse(from + 'T12:00:00'), end = Date.parse(to + 'T12:00:00'); t <= end && n < 93; t += 864e5, n++) {
      const d = UI.localDate(t);
      if (st) { (c.abs[d] ||= {})[agent] = st; if (note) (c.notes[d] ||= {})[agent] = note; else if (c.notes[d]) delete c.notes[d][agent]; }
      else { if (c.abs[d]) { delete c.abs[d][agent]; if (!Object.keys(c.abs[d]).length) delete c.abs[d]; } if (c.notes[d]) { delete c.notes[d][agent]; if (!Object.keys(c.notes[d]).length) delete c.notes[d]; } }
    }
    CRMLocal.touch(); DS.changed(); return n;
  },
  // a message to the agent in Telegram (bot of «Telegram агентам»); quiet when the agent has no chat or messages are off
  async tell(agent, text) {
    const c = DS.cfg(), tg = CRMLocal.ext().tg || {}, ch = tg.chats?.[agent]?.id;
    if (c.notify === false || !tg.token || !ch || typeof TG === 'undefined') return false;
    try { await TG.send(ch, esc(text)); return true; } catch (e) { toast('Telegram: ' + e.message); return false; }
  },
  period: (from, to) => (from === to ? UI.dateRu(from) : `${UI.dateRu(from)} — ${UI.dateRu(to)}`),
  // marks grouped into runs of consecutive days with the same status and reason, for the list of absences
  runs(from) {
    const c = DS.cfg(), out = [];
    for (const d of Object.keys(c.abs).filter(k => !from || k >= from).sort()) for (const [a, st] of Object.entries(c.abs[d])) {
      const note = c.notes[d]?.[a] || '', last = out.findLast(r => r.agent === a);
      if (last && last.st === st && last.note === note && UI.localDate(Date.parse(last.to + 'T12:00:00') + 864e5) === d) last.to = d; else out.push({ agent: a, st, note, from: d, to: d });
    }
    return out.sort((x, y) => y.from.localeCompare(x.from) || x.agent.localeCompare(y.agent));
  },
  hm: v => { const m = String(v || '').match(/(\d{2}):(\d{2})/); return m ? m[1] + ':' + m[2] : ''; },
  mins: t => (t && /^\d{2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null),
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
      // keep about two plan periods (the sheet shows this month and the previous one)
      const keep = UI.localDate(Date.now() - 70 * 864e5); for (const o of [c.days, c.abs, c.notes]) for (const k of Object.keys(o)) if (k < keep) { delete o[k]; changed = true; }
      for (const [id, q] of Object.entries(c.req)) if ((q.to || '') < keep) { delete c.req[id]; changed = true; }
      if (changed) CRMLocal.autoTouch();
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
      const skip = !!c.skip[a];
      const all = days.map(d => { const x = c.days[d]?.[a]; const e = DS.eff(d, a, x); return { day: d, ...(x || {}), st: e.st, auto: e.auto }; }).filter(x => x.first || x.plan || DS.away(x.st) || DS.half(x.st));
      // a day off / sick / absent is not a working day: no lateness, no «day without visits»; half a day — works, but without the start time
      const log = all.filter(x => !DS.away(x.st)), away = {};
      for (const x of all) if (x.st && x.st !== 'free' && x.st !== 'absent' && x.st !== 'halfbad') away[x.st] = (away[x.st] || 0) + 1;
      const absent = skip ? 0 : all.reduce((n, x) => n + (x.st === 'absent' ? 1 : x.st === 'halfbad' ? 0.5 : 0), 0), auto = skip ? 0 : all.filter(x => x.auto).length;
      const started = log.filter(x => x.first), late = skip ? [] : started.filter(x => !x.st && DS.mins(x.first) > start), idle = skip ? [] : log.filter(x => x.plan > 0 && !x.first && !x.st);
      const early = skip ? [] : log.filter(x => DS.earlyMin(x.day, a, x) > 0), earlyMin = early.reduce((n, x) => n + DS.earlyMin(x.day, a, x), 0);
      const p = per.find(r => r.agent === a) || {}, plan = LX.n(p.total_tasks_by_market), done = LX.n(p.total_tasks_done_by_market);
      const myRej = rej.filter(r => r.agent === a), noWhy = myRej.filter(r => DS.noReason(r.comment));
      const route = plan ? done / plan : null, avgFirst = started.length ? Math.round(started.reduce((s2, x) => s2 + DS.mins(x.first), 0) / started.length) : null;
      const lateMin = late.reduce((s2, x) => s2 + DS.lateOf(x.first, start), 0), fine = lateMin * (Number(c.fine) || 0);
      const marks = skip ? 0 : (late.length ? 1 : 0) + (route !== null && route < target ? 1 : 0) + (noWhy.length && noWhy.length / myRej.length > 0.2 ? 1 : 0) + (idle.length ? 1 : 0) + (absent ? 1 : 0) + (early.length ? 1 : 0);
      const worked = all.reduce((n, x) => n + DS.worked(x.st, x), 0);
      return { agent: a, skip, logged: log.length, late: late.length, lateMin, fine, avgFirst, idle: idle.length, absent, auto, away, early: early.length, earlyMin, worked, free: !!c.free[a], plan, done, route, rej: myRej.length, noWhy: noWhy.length, outside: LX.n(p.no_plan_count), marks, log };
    }).sort((x, y) => x.skip - y.skip || y.marks - x.marks || y.late - x.late || (x.route ?? 1) - (y.route ?? 1));
    return { from, to, days, rows, start, target, startTxt: c.start || '09:00', rate: Number(c.fine) || 0 };
  },
  t: m => (m === null ? '—' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')),

  // ---------- the attendance sheet of a month: a code per agent and day + totals ----------
  // Я — worked, О15 — late 15 min, Я↓ — left early, Н* — auto-невыход, the status letters for the rest; «·» — no record
  cell(day, agent) {
    const c = DS.cfg(), x = c.days[day]?.[agent], e = DS.eff(day, agent, x), t0 = UI.localDate(Date.now()), note = c.notes[day]?.[agent] || '';
    const start = DS.mins(c.start || '09:00'), late = x?.first ? DS.lateFor(day, agent, x.first, start) : 0, early = x ? DS.earlyMin(day, agent, x) : 0;
    let code = '', tone = 'mut'; const tip = [];
    if (e.st && e.st !== 'free') { code = DS.ST[e.st].s + (e.auto ? '*' : ''); tone = e.st === 'absent' || e.st === 'halfbad' ? 'neg' : 'st'; tip.push(DS.ST[e.st].t + (e.auto ? ` (авто: нет отчёта до ${c.autoAbs})` : '')); if (x?.first) tip.push('первый отчёт ' + x.first); }
    else if (x?.first) { code = late ? 'О' + late : early ? 'Я↓' : 'Я'; tone = late ? 'neg' : early ? 'warn' : 'pos'; tip.push('первый отчёт ' + x.first + (late ? `, опоздание ${late} мин` : '')); if (x.last) tip.push('последний ' + x.last + (early ? `, раньше на ${early} мин` : '')); if (e.st === 'free') tip.push('свободный график'); }
    else if (x?.plan && day <= t0) { code = day < t0 ? 'нет' : '…'; tone = day < t0 ? 'neg' : 'mut'; tip.push('визиты в плане, отчёта нет'); }
    else code = day > t0 ? '' : '·';
    if (x?.plan) tip.push(`визитов ${x.done || 0}/${x.plan}`);
    if (note) tip.push('причина: ' + note);
    return { code, tone, tip: tip.join(' · '), note, late, early, st: e.st, auto: e.auto, worked: DS.worked(e.st, x) };
  },
  sheet(month) {
    const c = DS.cfg(), y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7)), n = new Date(y, mo, 0).getDate();
    const days = Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    const names = [...new Set(days.flatMap(d => [...Object.keys(c.days[d] || {}), ...Object.keys(c.abs[d] || {})]))].sort((a, b) => a.localeCompare(b));
    const rows = names.map(a => {
      const cells = days.map(d => DS.cell(d, a)), skip = !!c.skip[a], cnt = st => cells.filter(x => x.st === st).length;
      return { agent: a, skip, cells, worked: cells.reduce((s, x) => s + x.worked, 0), late: skip ? 0 : cells.filter(x => x.late).length, lateMin: skip ? 0 : cells.reduce((s, x) => s + x.late, 0),
        early: skip ? 0 : cells.filter(x => x.early).length, absent: skip ? 0 : cnt('absent') + cnt('halfbad') / 2, sick: cnt('sick'), trip: cnt('trip'), vac: cnt('vac') + cnt('off'),
        other: cnt('leave') + cnt('family') + cnt('other'), half: cnt('half') };
    });
    return { month, days, rows };
  },

  // ---------- the rules for the auto-loader (late / auto-невыход messages to the agents): disc-rules.json ----------
  rules() {
    const c = DS.cfg(), tg = CRMLocal.ext().tg || {}, t0 = UI.localDate(Date.now());
    const marks = {}; for (const d of Object.keys(c.abs).filter(d => d >= t0)) marks[d] = c.abs[d];
    const alias = {}; for (const r of LX.d('workday')) { const n = [r.first_name, r.second_name].filter(Boolean).join(' '), a = LX.agentName(n); if (n && a) alias[n] = a; }
    const chats = {}; for (const [a, ch] of Object.entries(tg.chats || {})) if (ch?.id) chats[a] = String(ch.id);
    return { v: 1, start: c.start || '09:00', end: c.end || '', fine: Number(c.fine) || 0, autoAbs: c.autoAbs || '', notify: c.notify !== false, skip: c.skip, free: c.free, marks, alias, chats, me: tg.me?.id ? String(tg.me.id) : '' };
  },
  async publish() {
    const cc = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null; if (!cc || !cc.token) return { off: true };
    const url = `https://api.github.com/repos/${encodeURIComponent(cc.owner)}/${encodeURIComponent(cc.repo)}/contents/disc-rules.json`, h = { Authorization: 'Bearer ' + cc.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const text = JSON.stringify({ ...DS.rules(), at: new Date().toISOString() });
    const cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' }), sha = cur.ok ? (await cur.json()).sha : undefined;
    const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const r = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'CRM: правила дисциплины', content: btoa(bin), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub не принял правила дисциплины: ' + r.status);
    DS.cfg().publishedAt = new Date().toISOString(); CRMLocal.autoTouch(); return { ok: true };
  },
  changed() { clearTimeout(DS._pt); DS._pt = setTimeout(() => DS.publish().catch(e => console.warn('disc publish', e)), 2000); },

  // ---------- requests from the agents' cabinets ----------
  async decide(id, ok) {
    const c = DS.cfg(), q = c.req[id]; if (!q || q.st !== 'new') return;
    q.st = ok ? 'ok' : 'no'; q.done = new Date().toISOString();
    if (ok) DS.setStatus(q.agent, q.from, q.to, q.type, q.note ? q.note + ' (заявка)' : 'по заявке'); else { CRMLocal.touch(); DS.changed(); }
    const told = await DS.tell(q.agent, `${ok ? '✅ Заявка подтверждена' : '❌ Заявка отклонена'}: ${DS.ST[q.type]?.t || q.type}, ${DS.period(q.from, q.to)}${q.note ? '\nПричина: ' + q.note : ''}`);
    if (typeof AC !== 'undefined' && AC.publish) AC.publish({ force: true }).catch(() => {}); // the agent's cabinet shows the answer
    return told;
  },
};
// a request saved by the auto-loader (doPost «absreq»), pulled by atask.js from inbox/
INBOX_HANDLERS.absreq = m => {
  if (!m.uid || !m.agent || !DS.REQ.includes(m.type) || !/^\d{4}-\d{2}-\d{2}$/.test(m.from || '')) return false;
  const c = DS.cfg(); if (c.req[m.uid]) return false;
  c.req[m.uid] = { agent: m.agent, type: m.type, from: m.from, to: m.to && m.to >= m.from ? m.to : m.from, note: String(m.note || '').slice(0, 300), at: m.at, st: 'new' };
  CRMLocal.autoTouch(); return true;
};

// every import of LINKO data also updates the daily log
(() => {
  for (const k of ['importSnap', 'importFast', 'put']) {
    const orig = LX[k]; if (typeof orig !== 'function') continue;
    LX[k] = function (...a) { const r = orig.apply(this, a); setTimeout(DS.capture, 0); return r; };
  }
  Promise.resolve(CRMLocal.ready).then(() => setTimeout(DS.capture, 1500));
  // the rules for the auto-loader are sent again when they are older than 6 hours (chats and the LINKO names change)
  Promise.resolve(CRMLocal.ready).then(() => setTimeout(() => { if (Date.now() - Date.parse(DS.cfg().publishedAt || 0) > 6 * 3600e3) DS.publish().catch(() => {}); }, 20000));
})();

EXT_PAGES.disc = async el => {
  await CRMLocal.ready; await LX.load(); DS.capture();
  // days the CRM was not opened on: take them from the daily archive of the auto-loader (archive.js), then redraw once
  if (typeof ARC !== 'undefined' && !ARC._filled) ARC.fillDisc().then(n => { if (n && location.hash === '#/disc') { toast(`Журнал дополнен из архива: ${n} дн.`); EXT_PAGES.disc(el); } }).catch(() => {});
  el.innerHTML = `<div class="page-head"><div><h2>Дисциплина</h2><div class="sub">Начало дня — первый фотоотчёт агента в LINKO (Персонал → Активность). Опоздания со штрафом, ранний уход, невыходы, маршрут, отказы без причины, табель явки за месяц</div></div></div><div id="dsBody"></div>`;
  const body = $('#dsBody', el);
  if (!LX.has() || (!LX.d('workper').length && !LX.d('workday').length)) { body.innerHTML = UI.empty('Нет данных о работе агентов', 'Нужны разделы LINKO «работа агентов» из автозагрузки (<a href="#/cloud">Данные → Синхронизация и настройки</a>).'); return; }
  const c = DS.cfg(), m = DS.model(), f = UI.fmt0, pc = v => (v === null ? '—' : Math.round(v * 100) + '%'), half = v => (v % 1 ? String(v).replace('.', ',') : f(v));
  const R = m.rows.filter(r => !DS.agent || r.agent === DS.agent), all = m.rows, counted = all.filter(r => !r.skip);
  const lateAll = counted.reduce((s, r) => s + r.late, 0), rejAll = counted.reduce((s, r) => s + r.rej, 0), noWhyAll = counted.reduce((s, r) => s + r.noWhy, 0);
  const P = counted.reduce((s, r) => s + r.plan, 0), D = counted.reduce((s, r) => s + r.done, 0);
  const shown = m.days.slice(-14), sum = v => UI.fmt0(v) + ' сум', fineAll = counted.reduce((s, r) => s + r.fine, 0), minAll = counted.reduce((s, r) => s + r.lateMin, 0);
  const stName = st => DS.ST[st]?.t || '', skipTag = a => (c.skip[a] ? ' <small class="pill">без учёта</small>' : '');
  // today: every agent of the period; no report yet after the start time = already late (the fine is fixed by the time of the report)
  const t0 = UI.localDate(Date.now()), nowM = DS.nowMin(), td = c.days[t0] || {};
  const today = all.map(r => {
    const x = td[r.agent] || {}, e = DS.eff(t0, r.agent, td[r.agent]), st = e.st, skip = r.skip;
    const late = x.first && !st && !skip ? DS.lateOf(x.first, m.start) : 0, wait = !skip && !st && !x.first && x.plan > 0 && nowM > m.start ? nowM - m.start : 0, off = !x.first && !x.plan;
    return { agent: r.agent, st, auto: e.auto, skip, first: x.first || '', last: x.last || '', late, wait, off, early: DS.earlyMin(t0, r.agent, td[r.agent]), fine: late * m.rate, done: x.done || 0, plan: x.plan || 0 };
  }).filter(r => !DS.agent || r.agent === DS.agent).sort((a, b) => a.skip - b.skip || (b.late + b.wait) - (a.late + a.wait) || a.agent.localeCompare(b.agent));
  const tFine = today.reduce((s, r) => s + r.fine, 0), tLate = today.filter(r => r.late).length, tMiss = today.filter(r => r.wait && !r.auto).length;
  const tAway = today.filter(r => DS.away(r.st) || DS.half(r.st)), byKind = L => Object.entries(L.reduce((o, r) => ((o[r.st] = (o[r.st] || 0) + 1), o), {})).map(([k, n]) => `${stName(k).toLowerCase()} ${n}`).join(' · ');
  const stSel = (agent, day) => `<select data-dsst="${esc(agent)}" data-dsday="${day}" aria-label="Статус дня" style="padding:2px 4px;font-size:12px"><option value="">${c.free[agent] ? 'Свободный график' : 'Работает'}</option>${Object.entries(DS.ST).map(([k, v]) => `<option value="${k}" ${c.abs[day]?.[agent] === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select>`;
  const stBadge = (st, auto) => `<b title="${esc(stName(st))}${auto ? ' (авто)' : ''}">${DS.ST[st].s}${auto ? '*' : ''}</b>`;
  const runs = DS.runs(m.from).filter(x => !DS.agent || x.agent === DS.agent), freeAg = Object.keys(c.free).filter(a => c.free[a] && (!DS.agent || a === DS.agent)).sort(), skipAg = Object.keys(c.skip).filter(a => c.skip[a]).sort();
  const reqs = Object.entries(c.req).map(([id, q]) => ({ id, ...q })).filter(q => !DS.agent || q.agent === DS.agent).sort((a, b) => (b.st === 'new') - (a.st === 'new') || String(b.at).localeCompare(String(a.at)));
  const newReq = reqs.filter(q => q.st === 'new');
  // the sheet: this month or the previous one
  const months = [t0.slice(0, 7), UI.localDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).getTime()).slice(0, 7)];
  if (!months.includes(DS.month)) DS.month = months[0];
  const sh = DS.sheet(DS.month), shR = sh.rows.filter(r => !DS.agent || r.agent === DS.agent);
  const toneCss = { neg: 'color:var(--bad,#e0564a);font-weight:700', warn: 'color:var(--c4,#e9a23b);font-weight:600', pos: 'color:var(--good,#3fbf73)', st: 'font-weight:700', mut: 'color:var(--muted)' };

  body.innerHTML = `${newReq.length ? `<div class="panel" style="margin-bottom:12px;border-left:4px solid var(--oil,#f2b01e)"><b>📝 Заявки агентов на отсутствие: ${newReq.length}</b> <a href="#" id="dsGoReq">посмотреть ↓</a></div>` : ''}
    <div class="kpis">
    ${UI.tile('Штраф сегодня', sum(tFine), { sub: `опоздали ${f(tLate)} · ещё нет отчёта ${f(tMiss)}`, tone: tFine || tMiss ? 'bad' : 'good' })}
    ${UI.tile('Нет на работе сегодня', f(tAway.length), { sub: tAway.length ? byKind(tAway) : 'все в строю', tone: tAway.some(r => r.st === 'absent' || r.st === 'halfbad') ? 'bad' : tAway.length ? 'warn' : 'good' })}
    ${UI.tile('Штрафы за период', sum(fineAll), { sub: `опозданий ${f(lateAll)} · ${f(minAll)} мин · дней в журнале ${m.days.length}`, tone: fineAll ? 'warn' : 'good' })}
    ${UI.tile('Маршрут выполнен', P ? pc(D / P) : '—', { sub: `визитов ${f(D)} из ${f(P)} · норма ${Math.round(m.target * 100)}%`, tone: P ? (D / P >= m.target ? 'good' : 'bad') : '' })}
    ${UI.tile('Отказы без причины', `${f(noWhyAll)} из ${f(rejAll)}`, { sub: rejAll ? pc(noWhyAll / rejAll) + ' отказов' : 'отказов нет', tone: noWhyAll ? 'bad' : 'good' })}
    </div>
    <div class="bar" style="flex-wrap:wrap"><label class="mut">Первый отчёт до <input id="dsStart" type="time" value="${esc(m.startTxt)}" style="width:110px"></label>
    <label class="mut">Конец дня <input id="dsEnd" type="time" value="${esc(c.end || '')}" style="width:110px" title="Последний отчёт раньше — ранний уход. Пусто — не считать"></label>
    <label class="mut">Невыход, если нет отчёта до <input id="dsAuto" type="time" value="${esc(c.autoAbs || '')}" style="width:110px" title="Пусто — не ставить невыход автоматически"></label>
    <label class="mut">Штраф за минуту, сум <input id="dsFine" type="number" min="0" step="100" value="${m.rate}" style="width:90px"></label>
    <label class="mut">Норма маршрута, % <input id="dsRoute" type="number" min="10" max="100" step="5" value="${Math.round(m.target * 100)}" style="width:64px"></label>
    <label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="dsNotify" ${c.notify !== false ? 'checked' : ''}> Сообщать агентам в Telegram</label>
    <select id="dsAg" aria-label="Агент"><option value="">Все агенты</option>${all.map(r => `<option ${r.agent === DS.agent ? 'selected' : ''}>${esc(r.agent)}</option>`).join('')}</select></div>
    ${m.days.length < 5 ? `<p class="mut">⚠ Журнал первых визитов ведётся с момента обновления CRM: пока в нём ${m.days.length} ${UI.plural(m.days.length, 'день', 'дня', 'дней')}. Пропущенные дни CRM берёт из ежедневного архива автозагрузки (Данные → Архив данных), если он включён.</p>` : ''}
    <div class="grid">
    ${UI.panel(`Сегодня, ${UI.dateRu(t0)}`, today.length ? LX.table(['Агент', 'Статус', 'Первый отчёт', '#Опоздание, мин', '#Штраф', 'Последний', '#Визитов'], today.map(r => `<tr><td>${LX.ag(r.agent)}${skipTag(r.agent)}</td><td>${stSel(r.agent, t0)}</td>
      <td class="${r.late || r.wait || r.st === 'absent' ? 'neg' : ''}">${r.auto ? `<b>Невыход (авто)</b> <small class="mut">· нет отчёта до ${esc(c.autoAbs)}</small>` : (DS.away(r.st) || DS.half(r.st)) && !r.first ? `<b>${esc(stName(r.st))}</b>` : r.first ? esc(r.first) + (r.st === 'free' ? ' <small class="mut">· свободный график</small>' : DS.half(r.st) ? ` <small class="mut">· ${esc(stName(r.st).toLowerCase())}</small>` : '') : r.wait ? `<b>нет отчёта</b> <small>· уже ${f(r.wait)} мин</small>` : r.st === 'free' ? '<span class="mut">свободный график</span>' : r.off ? '<span class="mut">нет плана на сегодня</span>' : '<span class="mut">ещё рано</span>'}${c.notes[t0]?.[r.agent] ? `<div class="mut" style="font-size:12px">${esc(c.notes[t0][r.agent])}</div>` : ''}</td>
      <td class="n ${r.late ? 'neg' : ''}">${r.skip ? '<span class="mut">без учёта</span>' : r.late ? f(r.late) : r.first ? '✓' : '—'}</td><td class="n ${r.fine ? 'neg' : ''}">${r.fine ? '<b>' + sum(r.fine) + '</b>' : r.wait && !r.auto ? `<small class="mut">≥ ${sum(r.wait * m.rate)}</small>` : '—'}</td>
      <td>${esc(r.last || '—')}${r.early ? ` <small class="neg">раньше на ${f(r.early)} мин</small>` : ''}</td><td class="n">${r.plan ? `${f(r.done)}/${f(r.plan)}` : f(r.done)}</td></tr>`)) : '<p class="mut">Нет данных за сегодня.</p>',
      { cls: 'w12', sub: `Первый фотоотчёт до ${esc(m.startTxt)}; каждая минута позже — ${sum(m.rate)}.${c.autoAbs ? ` Нет отчёта до ${esc(c.autoAbs)} — невыход (снимется сам, если отчёт придёт).` : ''}${c.end ? ` Последний отчёт раньше ${esc(c.end)} — ранний уход (замечание).` : ''} Любой статус дня снимает штраф; невыход и полдня без причины — замечание.` })}
    ${reqs.length ? UI.panel('📝 Заявки агентов', `<div id="dsReq"></div>${LX.table(['Агент', 'Что', 'Дни', 'Причина', 'Отправлена', ''], reqs.slice(0, 30).map(q => `<tr><td>${LX.ag(q.agent)}</td><td><b>${esc(stName(q.type))}</b></td><td>${DS.period(q.from, q.to)}</td><td>${esc(q.note || '—')}</td><td class="mut">${q.at ? new Date(q.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</td>
      <td class="n">${q.st === 'new' ? `<button class="btn sm" data-dsreq="${esc(q.id)}" data-ok="1">✓ Подтвердить</button> <button class="btn gray sm" data-dsreq="${esc(q.id)}" data-ok="">✕</button>` : q.st === 'ok' ? '<span class="pos">подтверждена</span>' : '<span class="mut">отклонена</span>'}</td></tr>`))}`, { cls: 'w12', sub: 'Агент отправляет заявку из своего кабинета в Telegram (кнопка «📝 Отсутствие»). «Подтвердить» ставит отметку на эти дни и пишет агенту; «✕» — отклоняет и тоже пишет агенту.' }) : ''}
    ${UI.panel('Отсутствия и график', `<div class="bar" style="flex-wrap:wrap"><select id="dsMAg" aria-label="Агент">${all.map(r => `<option ${r.agent === DS.agent ? 'selected' : ''}>${esc(r.agent)}</option>`).join('')}</select>
      <label class="mut">с <input id="dsMFrom" type="date" value="${t0}"></label><label class="mut">по <input id="dsMTo" type="date" value="${t0}"></label>
      <select id="dsMSt" aria-label="Статус">${Object.entries(DS.ST).map(([k, v]) => `<option value="${k}">${v.t}${k === 'free' ? ' — на эти дни' : ''}</option>`).join('')}<option value="freeAlways">Свободный график — постоянно</option><option value="skipAlways">Не учитывать в дисциплине — постоянно</option><option value="">Снять отметку</option></select>
      <input id="dsMNote" placeholder="Причина (необязательно)" style="min-width:200px;flex:1">
      <button class="btn" id="dsMSave">Отметить</button></div>
      ${runs.length || freeAg.length || skipAg.length ? LX.table(['Агент', 'Статус', 'Дни', '#Дней', 'Причина', ''], [
        ...skipAg.map(a => `<tr><td>${LX.ag(a)}</td><td><b>Без учёта</b></td><td class="mut">постоянно</td><td class="n">—</td><td class="mut">не штрафуется, в итоги не входит</td><td class="n"><button class="btn" data-dsskip="${esc(a)}" title="Снова учитывать">✕</button></td></tr>`),
        ...freeAg.map(a => `<tr><td>${LX.ag(a)}</td><td><b>Свободный график</b></td><td class="mut">постоянно</td><td class="n">—</td><td></td><td class="n"><button class="btn" data-dsfree="${esc(a)}" title="Убрать свободный график">✕</button></td></tr>`),
        ...runs.map(x => `<tr><td>${LX.ag(x.agent)}</td><td class="${x.st === 'absent' || x.st === 'halfbad' ? 'neg' : ''}"><b>${esc(stName(x.st))}</b></td><td>${DS.period(x.from, x.to)}</td><td class="n">${f(Math.round((Date.parse(x.to) - Date.parse(x.from)) / 864e5) + 1)}</td><td>${esc(x.note || '')}</td><td class="n"><button class="btn" data-dsdel="${esc(x.agent)}" data-from="${x.from}" data-to="${x.to}" title="Снять отметку">✕</button></td></tr>`)]) : '<p class="mut">Отметок за период нет.</p>'}`,
      { cls: 'w12', sub: 'Невыход и полдня без причины — замечание агенту (без штрафа за минуты). Полдня — отпросился: полдня в табеле, без штрафа. Больничный, отпросился на день, командировка, семейные обстоятельства, отпуск, выходной, другая причина — день не считается: ни опоздания, ни «дня без визитов». Можно отметить сразу несколько дней и наперёд. «Не учитывать в дисциплине» — человек виден, но без штрафов и замечаний (например, вы сами). Агенту приходит сообщение в Telegram.' })}
    ${UI.panel('Табель явки', `<div class="bar"><select id="dsMonth">${months.map(mo => `<option value="${mo}" ${mo === DS.month ? 'selected' : ''}>${new Date(mo + '-15T12:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</option>`).join('')}</select><button class="btn gray sm" id="dsSheetCsv" type="button">⬇ Excel</button></div>
      ${shR.length ? `<div class="tscroll"><table class="dsheet"><thead><tr><th>Агент</th>${sh.days.map(d => { const wd = new Date(d + 'T12:00:00').getDay(); return `<th class="n" style="padding:4px 3px;${wd === 0 ? 'color:var(--muted);' : ''}${d === t0 ? 'background:var(--oil-soft,#fdf3d8);' : ''}">${Number(d.slice(8))}<div style="font-size:10px;font-weight:400">${'вс,пн,вт,ср,чт,пт,сб'.split(',')[wd]}</div></th>`; }).join('')}<th class="n" title="Отработано дней (полдня = 0,5)">Явка</th><th class="n">Опозд.</th><th class="n">Ран. уход</th><th class="n">Невых.</th><th class="n">Б</th><th class="n">К</th><th class="n">Отп./вых.</th><th class="n" title="Отпросился, семейные, другая причина, полдня">Прочее</th></tr></thead>
        <tbody>${shR.map(r => `<tr><td style="white-space:nowrap">${esc(r.agent)}${skipTag(r.agent)}</td>${r.cells.map((x, i) => `<td class="n" data-dscell="${esc(r.agent)}" data-day="${sh.days[i]}" style="cursor:pointer;padding:4px 3px;font-size:12px;${toneCss[x.tone] || ''}${x.note ? ';text-decoration:underline dotted' : ''}" title="${esc(UI.dateRu(sh.days[i]) + (x.tip ? ' · ' + x.tip : ''))}">${esc(x.code)}</td>`).join('')}
          <td class="n"><b>${half(r.worked)}</b></td><td class="n ${r.late ? 'neg' : ''}">${r.late || '—'}</td><td class="n ${r.early ? 'neg' : ''}">${r.early || '—'}</td><td class="n ${r.absent ? 'neg' : ''}">${r.absent ? half(r.absent) : '—'}</td><td class="n">${r.sick || '—'}</td><td class="n">${r.trip || '—'}</td><td class="n">${r.vac || '—'}</td><td class="n">${r.other + r.half || '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">За этот месяц записей нет.</p>'}`,
      { cls: 'w12', sub: `Я — был на работе, О15 — опоздал на 15 мин, Я↓ — ушёл раньше ${esc(c.end || 'конца дня')}, Н — невыход (Н* — авто: нет отчёта до ${esc(c.autoAbs || '—')}), ${['halfbad', 'half', 'sick', 'leave', 'trip', 'family', 'vac', 'off', 'other'].map(k => `${DS.ST[k].s} — ${DS.ST[k].t.toLowerCase()}`).join(', ')}; «·» — нет записи. Подчёркнуто — есть причина (в подсказке). Клик по клетке — отметить день.` })}
    ${UI.panel('Агенты за период', R.length ? LX.table(['Агент', '#Замечаний', '#Опозданий', '#Минут опоздания', '#Штраф за период', '#Средний первый отчёт', '#Ранний уход', '#Дней без визитов', '#Невыходов', 'Отсутствия', '#Маршрут', '#Отказов', '#Без причины', '#Визитов вне плана'], R.map(r => `<tr><td>${LX.ag(r.agent)}${r.free ? ' <small class="mut">· СГ</small>' : ''}${skipTag(r.agent)}</td><td class="n ${r.marks ? 'neg' : 'pos'}"><b>${r.skip ? '—' : r.marks || '✓'}</b></td><td class="n ${r.late ? 'neg' : ''}">${f(r.late)}<small class="mut"> из ${f(r.logged)}</small></td><td class="n">${r.lateMin ? f(r.lateMin) : '—'}</td><td class="n ${r.fine ? 'neg' : ''}">${r.fine ? '<b>' + sum(r.fine) + '</b>' : '—'}</td><td class="n">${DS.t(r.avgFirst)}</td><td class="n ${r.early ? 'neg' : ''}">${r.early ? `${f(r.early)}<small class="mut"> · ${f(r.earlyMin)} мин</small>` : '—'}</td><td class="n ${r.idle ? 'neg' : ''}">${f(r.idle)}</td><td class="n ${r.absent ? 'neg' : ''}">${r.absent ? '<b>' + half(r.absent) + '</b>' + (r.auto ? `<small class="mut"> (авто ${f(r.auto)})</small>` : '') : '—'}</td><td>${Object.keys(r.away).length ? `<small>${esc(Object.entries(r.away).map(([k, n]) => `${stName(k).toLowerCase()} ${n}`).join(' · '))}</small>` : '<span class="mut">—</span>'}</td><td class="n ${r.route !== null && r.route < m.target ? 'neg' : ''}">${pc(r.route)}<small class="mut"> ${f(r.done)}/${f(r.plan)}</small></td><td class="n">${f(r.rej)}</td><td class="n ${r.noWhy && r.noWhy / r.rej > 0.2 ? 'neg' : ''}">${f(r.noWhy)}${r.rej ? `<small class="mut"> (${pc(r.noWhy / r.rej)})</small>` : ''}</td><td class="n">${f(r.outside)}</td></tr>`)) : '<p class="mut">Нет данных.</p>',
      { cls: 'w12', sub: `Замечание — каждое из: были опоздания; ранний уход; маршрут ниже ${Math.round(m.target * 100)}%; больше 20% отказов без причины; дни с планом визитов, но без единого визита; невыход (полдня без причины — как полневыхода). Отсутствия по уважительной причине в опоздания и «дни без визитов» не входят. «Без учёта» — не штрафуется и в итоги не входит. Маршрут и отказы — из LINKO за весь период, опоздания — из журнала CRM.` })}
    ${UI.panel('Первый отчёт по дням', shown.length ? `<div class="tscroll"><table><thead><tr><th>Агент</th>${shown.map(d => `<th class="n">${UI.dm(d)}</th>`).join('')}</tr></thead><tbody>${R.map(r => `<tr><td>${esc(r.agent)}</td>${shown.map(d => { const x = c.days[d]?.[r.agent], e = DS.eff(d, r.agent, x), st = e.st, at = `data-dscell="${esc(r.agent)}" data-day="${d}" style="cursor:pointer"`; if (DS.away(st) && !x?.first) return `<td class="n ${st === 'absent' ? 'neg' : 'mut'}" ${at}>${stBadge(st, e.auto)}</td>`; if (!x) return `<td class="n mut" ${at}>·</td>`; if (!x.first) return `<td class="n ${x.plan && st !== 'free' && !DS.half(st) ? 'neg' : 'mut'}" ${at}>${DS.half(st) ? stBadge(st) : x.plan ? 'нет' : '—'}</td>`; const lt = DS.lateFor(d, r.agent, x.first, m.start); return `<td class="n ${lt ? 'neg' : ''}" ${at} title="${st === 'free' ? 'свободный график · ' : ''}${lt ? `опоздание ${lt} мин · штраф ${sum(lt * m.rate)} · ` : ''}последний визит ${esc(x.last || '—')} · визитов ${x.done}/${x.plan}">${esc(x.first)}${st === 'free' ? '<small class="mut"> СГ</small>' : DS.half(st) ? ` <small>${DS.ST[st].s}</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="mut">Журнал пока пуст.</p>', { cls: 'w12', sub: `Последние ${shown.length} дней журнала. Красным — позже ${esc(m.startTxt)} (в подсказке — минуты и штраф), день с планом без визитов или невыход; «·» — нет записи (CRM не открывали). Клик по клетке — отметить статус дня.` })}
    </div>`;

  const redraw = () => EXT_PAGES.disc(el), setRule = () => { CRMLocal.touch(); DS.changed(); redraw(); };
  $('#dsStart', body).onchange = e => { const v = DS.hm(e.target.value); if (!v) { e.target.value = c.start || '09:00'; return toast('Время ЧЧ:ММ'); } c.start = v; setRule(); };
  $('#dsEnd', body).onchange = e => { c.end = DS.hm(e.target.value); setRule(); };
  $('#dsAuto', body).onchange = e => { c.autoAbs = DS.hm(e.target.value); setRule(); };
  $('#dsNotify', body).onchange = e => { c.notify = e.target.checked; setRule(); };
  $('#dsFine', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 0 && v <= 1e6)) { e.target.value = m.rate; return toast('Штраф: сумма от 0'); } c.fine = v; setRule(); };
  $('#dsRoute', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 10 && v <= 100)) { e.target.value = Number(c.route) || 90; return toast('Норма: от 10 до 100%'); } c.route = v; CRMLocal.touch(); redraw(); };
  $('#dsAg', body).onchange = e => { DS.agent = e.target.value; redraw(); };
  $('#dsMonth', body).onchange = e => { DS.month = e.target.value; redraw(); };
  const goReq = $('#dsGoReq', body); if (goReq) goReq.onclick = e => { e.preventDefault(); $('#dsReq', body)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#dsSheetCsv', body).onclick = () => UI.csv('табель-' + sh.month, [['Агент', ...sh.days.map(d => d.slice(8)), 'Явка', 'Опозданий', 'Минут опоздания', 'Ранний уход', 'Невыходов', 'Больничный', 'Командировка', 'Отпуск/выходной', 'Прочее'],
    ...shR.map(r => [r.agent + (r.skip ? ' (без учёта)' : ''), ...r.cells.map(x => x.code + (x.note ? ' (' + x.note + ')' : '')), r.worked, r.late, r.lateMin, r.early, r.absent, r.sick, r.trip, r.vac, r.other + r.half])]);
  const tellMark = (a, from, to, st, note) => DS.tell(a, st ? `📋 Отметка в табеле: ${DS.period(from, to)} — ${stName(st)}${note ? '\nПричина: ' + note : ''}` : `📋 Отметка в табеле снята: ${DS.period(from, to)}`);
  // statuses of the day: the select in today's table, the form «Отсутствия и график», ✕ in its list, a click on a cell of the days tables
  body.addEventListener('change', e => { const s = e.target.closest('[data-dsst]'); if (!s) return; const a = s.dataset.dsst, d = s.dataset.dsday; DS.setStatus(a, d, d, s.value); tellMark(a, d, d, s.value, ''); toast(s.value ? `${a}: ${stName(s.value).toLowerCase()}` : 'Отметка снята'); redraw(); });
  $('#dsMSave', body).onclick = () => {
    const a = $('#dsMAg', body).value, from = $('#dsMFrom', body).value, to = $('#dsMTo', body).value || from, st = $('#dsMSt', body).value, note = $('#dsMNote', body).value.trim().slice(0, 300);
    if (!a) return toast('Выберите агента');
    if (st === 'freeAlways') { c.free[a] = true; setRule(); return toast(`${a}: свободный график постоянно`); }
    if (st === 'skipAlways') { c.skip[a] = true; setRule(); return toast(`${a}: не учитывается в дисциплине`); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || to < from) return toast('Проверьте даты');
    const n = DS.setStatus(a, from, to, st, note); tellMark(a, from, to, st, note);
    toast(st ? `${a}: ${stName(st).toLowerCase()}, ${n} ${UI.plural(n, 'день', 'дня', 'дней')}` : `Отметки сняты: ${n} ${UI.plural(n, 'день', 'дня', 'дней')}`); redraw();
  };
  body.addEventListener('click', async e => {
    const fr = e.target.closest('[data-dsfree]'), sk = e.target.closest('[data-dsskip]'), del = e.target.closest('[data-dsdel]'), cell = e.target.closest('[data-dscell]'), rq = e.target.closest('[data-dsreq]');
    if (fr) { delete c.free[fr.dataset.dsfree]; setRule(); }
    else if (sk) { delete c.skip[sk.dataset.dsskip]; setRule(); }
    else if (rq) { rq.disabled = true; const told = await DS.decide(rq.dataset.dsreq, !!rq.dataset.ok); toast((rq.dataset.ok ? 'Заявка подтверждена' : 'Заявка отклонена') + (told ? ', агенту отправлено сообщение' : '')); redraw(); }
    else if (del) { if (!confirm(`Снять отметку «${del.dataset.dsdel}» с ${UI.dateRu(del.dataset.from)} по ${UI.dateRu(del.dataset.to)}?`)) return; DS.setStatus(del.dataset.dsdel, del.dataset.from, del.dataset.to, ''); tellMark(del.dataset.dsdel, del.dataset.from, del.dataset.to, '', ''); redraw(); }
    else if (cell) { const a = cell.dataset.dscell, d = cell.dataset.day; $('#dsMAg', body).value = a; $('#dsMFrom', body).value = $('#dsMTo', body).value = d; const st = c.abs[d]?.[a]; if (st) $('#dsMSt', body).value = st; $('#dsMNote', body).value = c.notes[d]?.[a] || ''; $('#dsMSave', body).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
};
