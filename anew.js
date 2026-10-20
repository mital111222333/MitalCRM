// Новые точки (Агенты → Новые точки): a plan of new points per agent for the plan period and how it is done.
// A client is new when it appeared in «Баланс клиентов» after the CRM started (not in the very first upload: c.first) and had
// no sales in any upload before this period. It counts for the agent once its sales in the period reach the threshold
// (default $50), so a point opened for the plan with a $3 order does not count.
// Stored in the synced state: ext.newPts = { def: 3, min: 50, plans: { [period_from]: { [agent]: n } } }.
window.EXT_PAGES = window.EXT_PAGES || {};

const NP = {
  cfg() { const x = CRMLocal.ext(); return (x.newPts ||= { def: 3, min: 50, plans: {} }); },
  ups() { return (CRMLocal.engine.getState().ag.uploads || []).slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id)); },

  model() {
    const S = CRMLocal.engine.getState(), ups = NP.ups(), cur = ups.at(-1);
    if (!cur) return null;
    const pf = cur.period_from, pt = cur.period_to, cfg = NP.cfg(), min = Number(cfg.min) || 0;
    const before = ups.filter(u => u.period_to < pf), inP = ups.filter(u => u.period_from === pf);
    const soldBefore = new Set(); for (const u of before) for (const r of u.rows || []) if (r.sold > 0) soldBefore.add(r.client);
    const list = [];
    for (const c of Object.values(S.ag.clients || {})) {
      if (c.first || !c.added || soldBefore.has(c.name)) continue;
      if (c.added > pt) continue;
      // first snapshot of the period where it bought at all, and where it reached the threshold
      let firstBuy = null, metAt = null, sold = 0, paid = 0;
      for (const u of inP) {
        const r = (u.rows || []).find(x => x.client === c.name); if (!r) continue;
        sold = r.sold; paid = r.paid;
        if (r.sold > 0 && !firstBuy) firstBuy = u.taken_at;
        if (r.sold > 0 && r.sold >= min && !metAt) metAt = u.taken_at;
      }
      if (c.added < pf && !firstBuy) continue; // opened in an earlier period and never bought: not this period's new point
      const status = metAt ? 'ok' : sold > 0 ? 'small' : 'open';
      list.push({ name: c.name, agent: c.agent || 'Без агента', type: c.type || '', added: c.added, firstBuy, metAt, sold, paid, status });
    }
    const agents = [...new Set([...(cur.rows || []).map(r => r.agent).filter(Boolean), ...list.map(n => n.agent)])].filter(a => a !== 'Без агента').sort((a, b) => a.localeCompare(b));
    const plans = cfg.plans[pf] || {}, planOf = a => (plans[a] ?? (Number(cfg.def) || 0));
    const day = d => Date.parse(d + 'T00:00:00'), total = Math.round((day(pt) - day(pf)) / 864e5) + 1, elapsed = Math.min(total, Math.max(1, Math.round((day(cur.taken_at) - day(pf)) / 864e5) + 1));
    const rows = agents.map(a => {
      const mine = list.filter(n => n.agent === a), plan = planOf(a);
      return { agent: a, plan, custom: a in plans, done: mine.filter(n => n.status === 'ok').length, small: mine.filter(n => n.status === 'small').length, open: mine.filter(n => n.status === 'open').length, pace: plan * elapsed / total };
    }).sort((a, b) => (a.done - a.pace) - (b.done - b.pace) || a.agent.localeCompare(b.agent));
    return { pf, pt, at: cur.taken_at, min, list, rows, elapsed, total };
  },
};

EXT_PAGES.anew = async el => {
  await CRMLocal.ready;
  const m = NP.model(), f = UI.fmt0, cfg = NP.cfg();
  if (!m) { el.innerHTML = `<div class="page-head"><div><h2>Новые точки</h2></div></div>${UI.empty('Нет данных', 'Загрузите «Баланс клиентов» — новые точки считаются по нему.')}`; return; }
  const P = m.rows.reduce((a, r) => a + r.plan, 0), D = m.rows.reduce((a, r) => a + r.done, 0), left = m.total - m.elapsed;
  const ST = { ok: ['good', '✓ засчитана'], small: ['warn', 'купила меньше порога'], open: ['muted', 'ещё не купила'] };
  el.innerHTML = `<div class="page-head"><div><h2>Новые точки</h2><div class="sub">Период плана ${UI.dateRu(m.pf)} — ${UI.dateRu(m.pt)} · данные на ${UI.dateRu(m.at)} · прошло ${m.elapsed} из ${m.total} дн. · точка засчитывается, когда купила за период на ${m.min > 0 ? '$' + f(m.min) + ' и больше' : 'любую сумму'}</div></div></div>
    <div class="kpis">${UI.tile('Засчитано новых точек', `${f(D)} из ${f(P)}`, { sub: P ? UI.pct(D, P) + '% плана' : 'план не задан', tone: P && D >= P * m.elapsed / m.total ? 'good' : P ? 'warn' : '' })}
    ${UI.tile('Купили меньше порога', f(m.list.filter(n => n.status === 'small').length), { sub: 'дожать до порога' })}
    ${UI.tile('Открыты, ещё не купили', f(m.list.filter(n => n.status === 'open').length), { sub: 'первая отгрузка — задача агента' })}
    ${UI.tile('До конца периода', `${left} дн.`, { sub: P > D ? `нужно ещё ${f(P - D)} точек` : 'план выполнен' })}</div>
    <div class="bar"><label class="mut">План на агента по умолчанию <input id="npDef" type="number" min="0" max="50" value="${Number(cfg.def) || 0}" style="width:60px"></label>
    <label class="mut">Порог первой покупки, $ <input id="npMin" type="number" min="0" step="10" value="${Number(cfg.min) || 0}" style="width:80px"></label>
    <span class="mut">план агента можно поменять прямо в таблице — только на этот период</span></div>
    <div class="grid">
    ${UI.panel('Агенты: план и факт', m.rows.length ? LX.table(['Агент', '#План', '#Засчитано', '#Отставание от темпа', '#Меньше порога', '#Ещё не купили'], m.rows.map(r => { const gap = r.done - r.pace; return `<tr><td>${LX.ag(r.agent)}</td><td class="n"><input type="number" min="0" max="50" data-ag="${esc(r.agent)}" value="${r.plan}" style="width:56px${r.custom ? ';font-weight:600' : ''}" aria-label="План новых точек"></td><td class="n"><b>${f(r.done)}</b>${r.plan ? ` <span class="mut">(${UI.pct(r.done, r.plan)}%)</span>` : ''}</td><td class="n ${gap < -0.5 ? 'neg' : 'pos'}">${r.plan ? (gap < -0.5 ? '−' + UI.fmt1(-gap) : 'в темпе') : '—'}</td><td class="n">${f(r.small)}</td><td class="n">${f(r.open)}</td></tr>`; })) : '<p class="mut">Нет агентов в последней загрузке.</p>', { cls: 'w12', sub: 'Сверху — кто сильнее всего отстаёт от темпа: к сегодняшнему дню должно быть «план × прошедшие дни ÷ дни периода»' })}
    ${UI.panel(`Новые точки периода (${f(m.list.length)})`, m.list.length ? LX.table(['Клиент', 'Агент', 'Тип', 'Появилась в LINKO', 'Первая покупка', '#Купила за период', '#Оплатила', 'Статус'], m.list.sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || b.sold - a.sold).map(n => `<tr><td>${LX.cl(n.name)}</td><td>${LX.ag(n.agent)}</td><td>${esc(n.type)}</td><td>${UI.dateRu(n.added)}</td><td>${n.firstBuy ? UI.dateRu(n.firstBuy) : '—'}</td><td class="n">$${f(n.sold)}</td><td class="n">$${f(n.paid)}</td><td>${UI.pill(ST[n.status][0], ST[n.status][1])}</td></tr>`), { max: '520px' }) : '<p class="mut">В этом периоде новых точек пока нет.</p>', { cls: 'w12', sub: 'Сначала незасчитанные — их надо довести до первой нормальной покупки' })}
    </div>`;
  const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  $('#npDef', el).onchange = e => { const v = num(e.target.value, 0, 50); if (v === null) { e.target.value = Number(cfg.def) || 0; return toast('План: от 0 до 50'); } cfg.def = v; CRMLocal.touch(); EXT_PAGES.anew(el); };
  $('#npMin', el).onchange = e => { const v = num(e.target.value, 0, 100000); if (v === null) { e.target.value = Number(cfg.min) || 0; return toast('Порог: сумма от 0'); } cfg.min = v; CRMLocal.touch(); EXT_PAGES.anew(el); };
  el.querySelectorAll('input[data-ag]').forEach(i => i.onchange = () => { const v = num(i.value, 0, 50); if (v === null) { i.value = m.rows.find(x => x.agent === i.dataset.ag)?.plan ?? 0; return toast('План: от 0 до 50'); } (cfg.plans[m.pf] ||= {})[i.dataset.ag] = v; CRMLocal.touch(); EXT_PAGES.anew(el); });
};
