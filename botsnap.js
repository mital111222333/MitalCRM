// Сводка для бота Mital AI. The bot (supabase/functions/ai-bot) must give exactly the numbers the CRM screens show, so it does not
// recount salaries, discipline or the leaderboard itself: this module runs the CRM's own functions (PAY.rows, DS.model, LB.build,
// SIG.compute, CAL.items, ATK) and saves the result next to the CRM data in the MITAL database:
//   Storage «workspaces»/<owner>/bot.json.gz = { v, at, today, data_at, period, leaderboard, leaderboard_past, pay, discipline,
//                                               signals, calendar, tasks, errors }
// Written by the owner's CRM only (the same device rule as cloud.js: crm_ws_owner === the signed-in account), a few seconds after
// every save to the database and every 10 minutes while the CRM is open (or in «Режим офиса»). Unchanged content is not re-sent.
// A part that fails is left out and named in `errors` — the bot then says that this part is not available, never guesses.
const BOTSNAP = {
  FILE: 'bot.json.gz',
  last: '',
  busy: false,
  r: v => Math.round((Number(v) || 0) * 100) / 100,
  text: s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(),
  owner() {
    let o = null; try { o = localStorage.getItem('crm_ws_owner'); } catch { /* storage blocked */ }
    const p = window.AUTH?.profile;
    return o && p && p.id === o && !['agent', 'store'].includes(p.role) && window.AUTH?.sb ? o : null;
  },
  async part(out, name, fn) {
    try { const v = await fn(); if (v !== undefined && v !== null) out[name] = v; } catch (e) { out.errors[name] = String(e?.message || e); console.warn('botsnap', name, e); }
  },

  board(d) {
    const L = LB.build(d), row = r => ({
      rank: r.rank, agent: r.a.agent, value: BOTSNAP.r(r.v), plan: BOTSNAP.r(r.plan), pct: r.p === null ? null : Math.round(r.p * 100),
      state: LB.TONE_TEXT[r.tone] || '', change: r.dv == null ? null : BOTSNAP.r(r.dv), need_per_day: r.need == null ? null : BOTSNAP.r(r.need),
    });
    return {
      data_at: d.upload.taken_at, period_from: d.upload.period_from, period_to: d.upload.period_to, period_end: d.forecast?.period_end || '',
      sales: L.sales.map(row), money: L.money.map(row),
      overall: (L.overall || []).map((x, i) => ({ rank: i + 1, agent: x.a.agent, score_pct: x.score == null ? null : Math.round(x.score * 100) })),
    };
  },

  pay(from, D) {
    const p = PAY.per(from), rows = p.closed && Array.isArray(p.rows) ? p.rows : PAY.rows(from, D);
    return {
      period_from: from, period_end: PLAN.end(from), label: PLAN.label(from), closed: p.closed || null, rate: Number(p.rate) || 0, work_days: Number(p.days) || 26,
      collected_source: D ? `баланс LINKO от ${D.at}${D.final ? ' (итог периода)' : ''}` : 'нет баланс-файла',
      rows: rows.map(r => ({
        name: r.name, role: PAY.ROLE[r.role] || r.role, worked_days: r.worked, paid_days: r.paidDays, collected: BOTSNAP.r(r.collected), own: BOTSNAP.r(r.own), team: BOTSNAP.r(r.team),
        percent: BOTSNAP.r(r.pct), bonus: BOTSNAP.r(r.bonus), fix: BOTSNAP.r(r.fix), fix_currency: r.fixCur, usd_total: BOTSNAP.r(r.usd), fuel_uzs: Math.round(r.fuel || 0), km: r.km || 0,
        advances_uzs: Math.round(r.adv || 0), extra_uzs: Math.round(r.extra || 0), fine_uzs: Math.round(r.fine || 0), late_minutes: r.fineMin || 0, total_uzs: Math.round(r.total || 0),
        voucher: PAY.hasV(p, r.name) ? PAY.cfg().voucher : 0,
        lines: (r.lines || PAY.slip(r, from, p)).map(([a, b]) => `${BOTSNAP.text(a)}: ${BOTSNAP.text(b)}`),
      })),
    };
  },

  discipline() {
    if (typeof DS === 'undefined' || !LX.has()) return null;
    const m = DS.model(), c = DS.cfg(), t0 = UI.localDate(Date.now()), start = DS.mins(c.start || '09:00');
    const ST = k => DS.ST[k]?.t || k || '';
    const days = (a, list) => list.map(x => ({ day: x.day, first: x.first || '', last: x.last || '', status: ST(x.st), auto: !!x.auto, late_min: x.first ? DS.lateFor(x.day, a, x.first, start) : 0, early_min: DS.earlyMin(x.day, a, x), visits_plan: x.plan || 0, visits_done: x.done || 0 }));
    const ahead = {};
    for (const [day, by] of Object.entries(c.abs || {})) if (day >= t0) for (const [a, st] of Object.entries(by || {})) (ahead[a] ||= []).push({ day, status: ST(st) });
    return {
      from: m.from, to: m.to, start: m.startTxt, end: c.end || '', fine_per_min_uzs: m.rate, route_target_pct: Math.round(m.target * 100),
      rows: m.rows.map(r => ({
        agent: r.agent, not_tracked: r.skip, free_schedule: r.free, worked_days: r.worked, late_days: r.late, late_minutes: r.lateMin, fine_uzs: r.fine, avg_start: r.avgFirst == null ? '' : DS.t(r.avgFirst),
        absent: r.absent, auto_absent: r.auto, left_early_days: r.early, left_early_minutes: r.earlyMin, idle_days: r.idle, excused: Object.fromEntries(Object.entries(r.away || {}).map(([k, v]) => [ST(k), v])),
        route_pct: r.route == null ? null : Math.round(r.route * 100), rejects: r.rej, rejects_no_reason: r.noWhy, visits_outside_plan: r.outside, violations: r.marks,
        days: days(r.agent, r.log || []), ahead: (ahead[r.agent] || []).sort((x, y) => x.day.localeCompare(y.day)),
      })),
      requests: Object.entries(c.req || {}).map(([id, q]) => ({ id, agent: q.agent, type: ST(q.type), from: q.from, to: q.to, note: q.note || '', state: q.st === 'ok' ? 'одобрено' : q.st === 'no' ? 'отказано' : 'ждёт решения', at: q.at || '' }))
        .sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 60),
    };
  },

  async calendar() {
    const t0 = UI.localDate(Date.now()), from = UI.localDate(Date.now() - 14 * 864e5), to = UI.localDate(Date.now() + 31 * 864e5);
    const { list } = await CAL.items(), KIND = { spec: 'Спец · разовый договор', ct: 'Договор', prom: 'Обещание' }, ST = { paid: 'оплачено', late: 'просрочено', wait: 'ждём' };
    return { today: t0, from, to, items: list.filter(x => x.d >= from && x.d <= to).sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ date: x.d, sum: BOTSNAP.r(x.s), client: x.client, title: x.title || undefined, agent: x.agent, kind: KIND[x.kind] || x.kind, state: ST[x.st] || x.st, why: BOTSNAP.text(x.why) })) };
  },

  tasks(d) {
    const ST = { open: 'открыто', done: 'выполнено агентом — ждёт проверки', closed: 'принято', returned: 'возвращено агенту' };
    const names = [...new Set([...d.agents.map(a => a.agent), ...ATK.all().map(t => t.agent)])].filter(a => a && a !== 'Без агента');
    return names.flatMap(agent => ATK.forAgent(agent, d).map(t => ({ agent, kind: t.kind === 'academy' ? 'Академия' : t.kind === 'client' ? 'по клиенту' : 'задание', title: BOTSNAP.text(t.title), text: BOTSNAP.text(t.text), due: t.due || '', state: ST[t.status] || t.status, overdue: !!t.overdue, progress: t.progress || undefined, returned_comment: t.back || undefined })));
  },

  async build() {
    const t0 = UI.localDate(Date.now()), out = { v: 1, at: new Date().toISOString(), today: t0, errors: {} };
    const d = await REP.load();
    if (!d || d.empty) { out.errors.data = 'В CRM нет загрузок баланса'; return out; }
    out.data_at = d.upload.taken_at; out.period = { from: d.upload.period_from, to: d.upload.period_to, end: d.forecast?.period_end || '', days_left: d.forecast?.days_left ?? null };
    await BOTSNAP.part(out, 'leaderboard', () => BOTSNAP.board(d));
    await BOTSNAP.part(out, 'leaderboard_past', async () => { const info = lbPastInfo(d); return info ? { ...BOTSNAP.board(await lbPastData(info)), judged: `продажи по ${info.end}, деньги по ${info.end} + оплаты ${info.grace}` } : null; });
    await BOTSNAP.part(out, 'pay', async () => {
      const cur = PLAN.from(t0), prev = PAY.periods().find(p => p < cur), res = [];
      res.push(BOTSNAP.pay(cur, await PAY.dash(cur)));
      if (prev) res.push(BOTSNAP.pay(prev, await PAY.dash(prev)));
      return res;
    });
    await BOTSNAP.part(out, 'discipline', () => BOTSNAP.discipline());
    await BOTSNAP.part(out, 'signals', () => SIG.compute(d).map(s => ({ level: s.level === 'crit' ? 'срочно' : s.level === 'warn' ? 'внимание' : 'к сведению', title: BOTSNAP.text(s.title), text: BOTSNAP.text(s.text), agent: s.agent || undefined, client: s.client || undefined })));
    await BOTSNAP.part(out, 'calendar', () => BOTSNAP.calendar());
    await BOTSNAP.part(out, 'tasks', () => BOTSNAP.tasks(d));
    return out;
  },

  async gzip(text) { return new Uint8Array(await new Response(new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); },

  async publish({ force = false } = {}) {
    const owner = BOTSNAP.owner();
    if (!owner || BOTSNAP.busy || window.CLOUD?.gate?.()) return false;
    BOTSNAP.busy = true;
    try {
      const snap = await BOTSNAP.build(), key = JSON.stringify({ ...snap, at: '' });
      if (!force && key === BOTSNAP.last) return false;
      const bytes = await BOTSNAP.gzip(JSON.stringify(snap));
      const { error } = await AUTH.sb.storage.from('workspaces').upload(`${owner}/${BOTSNAP.FILE}`, new Blob([bytes], { type: 'application/gzip' }), { upsert: true, contentType: 'application/gzip' });
      if (error) throw error;
      BOTSNAP.last = key;
      return true;
    } catch (e) { console.warn('botsnap publish', e); return false; } finally { BOTSNAP.busy = false; }
  },
  // after a save to the database (cloud.js) — once things settle
  soon() { clearTimeout(BOTSNAP._t); BOTSNAP._t = setTimeout(() => BOTSNAP.publish(), 5000); },
};

(() => {
  Promise.resolve(window.CRMLocal?.ready).then(() => setTimeout(() => BOTSNAP.publish(), 20000));
  setInterval(() => { if (document.visibilityState === 'visible' || (typeof AC !== 'undefined' && AC.office())) BOTSNAP.publish(); }, 10 * 60000);
})();
