// Signals (Отчёты → Сигналы): what needs attention right now, found automatically in the uploads,
// plus the comparison with the previous plan period on the same day of the period.
window.EXT_PAGES = window.EXT_PAGES || {};

// previous plan period on the same day: "on day 9 we have $X, last period on day 9 it was $Y"
const PREV = {
  compare(d) {
    if (d.empty) return null;
    const S = CRMLocal.engine.getState(), pf = d.upload.period_from, n = REP.days(pf, d.upload.taken_at) + 1;
    const dayBefore = UI.localDate(Date.parse(pf + 'T12:00:00') - 864e5), prevFrom = PLAN.from(dayBefore, +pf.slice(8, 10));
    const limit = UI.localDate(Date.parse(prevFrom + 'T12:00:00') + (n - 1) * 864e5);
    const cand = S.ag.uploads.filter(u => u.period_from === prevFrom && u.taken_at <= limit).sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0];
    if (!cand) return { n, prevFrom, missing: true };
    const agents = {}, total = { sold: 0, paid: 0 };
    for (const r of cand.rows) { const a = (agents[r.agent || S.ag.clients[r.client]?.agent || 'Без агента'] ||= { sold: 0, paid: 0 }); a.sold += r.sold; a.paid += r.paid; total.sold += r.sold; total.paid += r.paid; }
    return { n, prevFrom, prevDate: cand.taken_at, prevN: REP.days(prevFrom, cand.taken_at) + 1, total, agents };
  },
  chip(now, was) { if (!was) return ''; const p = Math.round((now - was) / was * 100); return UI.delta(p, { unit: '%', title: 'К прошлому периоду на тот же день' }); },
};

const SIG = {
  LEVEL: { crit: ['crit', 'Срочно'], warn: ['warn', 'Внимание'], info: ['info', 'К сведению'] },
  compute(d) {
    const out = [], f = UI.fmt0, S = CRMLocal.engine.getState(), t0 = REP.today(), pace = agPace(d);
    const histDays = d.hist.since ? REP.days(d.hist.since, t0) : 0;
    // promises to pay
    for (const p of NOTES.promises(d)) {
      if (p.status === 'overdue') out.push({ level: 'crit', icon: '🤝', client: p.client, agent: p.agent, title: 'Не выполнил обещание', text: `обещал оплатить ${UI.dateRu(p.date)}${p.sum ? ` $${f(p.sum)}` : ''}, оплаты нет · долг $${f(p.debt)}` });
      else if (p.status === 'today') out.push({ level: 'warn', icon: '📅', client: p.client, agent: p.agent, title: 'Обещал оплатить сегодня', text: `${p.sum ? `$${f(p.sum)} · ` : ''}долг $${f(p.debt)}${p.text ? ' · ' + p.text : ''}` });
    }
    // debt grew since the previous upload without any payment
    if (d.prev) {
      const prev = new Map(S.ag.uploads.find(u => u.id === d.prev.id).rows.map(r => [r.client, r]));
      for (const c of d.clients) {
        const p = prev.get(c.name); if (!p) continue;
        const grew = -c.b1 - (-p.b1);
        if (grew >= 300 && c.paid <= p.paid + 0.5) out.push({ level: 'warn', icon: '📈', client: c.name, agent: c.agent, title: 'Долг вырос', text: `+$${f(grew)} с ${UI.dateRu(d.prev.taken_at)} без оплаты · долг $${f(c.debt)}` });
      }
    }
    // big debtor not paying for 2+ weeks
    const debts = d.clients.filter(c => c.debt > 0).map(c => c.debt).sort((a, b) => b - a), big = Math.max(1000, debts[Math.floor(debts.length * 0.2)] || 0);
    if (histDays >= 14) for (const c of d.clients) if (c.debt >= big && c.payDays >= 14) out.push({ level: 'crit', icon: '⏳', client: c.name, agent: c.agent, title: 'Крупный должник не платит', text: `долг $${f(c.debt)} · ${c.lastPay ? `последняя оплата ${UI.dateRu(c.lastPay)} (${c.payDays} дн.)` : `нет оплат с ${UI.dateRu(d.hist.since)}`}` });
    // agent collected nothing for 3 uploaded days in a row
    const days = REP.daily(S).filter(x => !x.first).slice(-3);
    if (days.length === 3) for (const a of d.agents) {
      if (a.agent === 'Без агента' || !(a.pool > 0 || a.debt > 0)) continue;
      if (days.every(x => (x.agents[a.agent]?.paid || 0) <= 0.5)) out.push({ level: 'crit', icon: '💸', agent: a.agent, title: 'Агент 3 дня ничего не собрал', text: `${UI.dm(days[0].date)}–${UI.dm(days[2].date)} оплат нет · долг его клиентов $${f(a.debt)}` });
      if (days.every(x => (x.agents[a.agent]?.sold || 0) <= 0.5)) out.push({ level: 'warn', icon: '🛒', agent: a.agent, title: 'Агент 3 дня ничего не продал', text: `${UI.dm(days[0].date)}–${UI.dm(days[2].date)} продаж нет` });
    }
    // agent far behind the schedule
    if (pace !== null && pace > 0.2) for (const a of d.agents) {
      if (a.pool > 0 && a.paid / a.pool < pace * 0.6) out.push({ level: 'warn', icon: '🐢', agent: a.agent, title: 'Сильно отстаёт по сбору', text: `собрано ${Math.round(a.paid / a.pool * 100)}% пула при ${Math.round(pace * 100)}% прошедшего периода · осталось $${f(a.pool - a.paid)}` });
      if (a.plan > 0 && a.sold / a.plan < pace * 0.6) out.push({ level: 'warn', icon: '🐢', agent: a.agent, title: 'Сильно отстаёт по продажам', text: `продано ${Math.round(a.sold / a.plan * 100)}% плана при ${Math.round(pace * 100)}% периода · осталось $${f(a.plan - a.sold)}` });
    }
    // overdue tasks
    const od = {}; for (const t of d.tasks) if (t.status === 'overdue') od[t.agent] = (od[t.agent] || 0) + 1;
    for (const [agent, n] of Object.entries(od)) out.push({ level: 'warn', icon: '✕', agent, title: 'Просроченные задания', text: `${n} шт.` });
    // stock
    if (d.low) {
      for (const st of ['out', 'blocked']) {
        const items = d.low.items.filter(i => i.status === st);
        if (items.length) out.push({ level: st === 'out' ? 'crit' : 'warn', icon: '📦', link: '#/whorder', title: st === 'out' ? 'Товар закончился на складах' : 'Весь остаток в резерве', text: `${items.length} поз.: ${items.slice(0, 5).map(i => i.name).join(', ')}${items.length > 5 ? '…' : ''}` });
      }
      const soon = d.low.items.filter(i => i.status === 'soon' || i.status === 'low');
      if (soon.length) out.push({ level: 'info', icon: '📦', link: '#/whorder', title: 'Заканчивается на складе', text: `${soon.length} поз. — посмотрите заявку в Ташкент` });
    }
    const rank = { crit: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  },
  item(s) {
    const who = s.client ? `<a class="clink" data-client="${esc(s.client)}">${esc(s.client)}</a>${s.agent ? ` <small class="mut">· ${esc(s.agent)}</small>` : ''}` : s.agent ? `<a class="clink" data-agent="${esc(s.agent)}">${esc(s.agent)}</a>` : s.link ? `<a href="${s.link}">открыть</a>` : '';
    return `<li class="${s.level}"><span aria-hidden="true">${s.icon}</span><span><b>${esc(s.title)}</b>${who ? ' — ' + who : ''}<br><small>${esc(s.text)}</small></span></li>`;
  },
};

let sigState = { agent: '', level: '' };
EXT_PAGES.signals = async el => {
  const d = await REP.load(), body = REP.shell(el, 'signals', d);
  if (d.empty) return REP.empty(body);
  const all = SIG.compute(d), S = sigState;
  const list = all.filter(s => (!S.agent || s.agent === S.agent) && (!S.level || s.level === S.level));
  const cnt = l => all.filter(s => s.level === l).length;
  const agents = [...new Set(all.map(s => s.agent).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  body.innerHTML = `<div class="kpis">${UI.tile('🚨 Срочно', String(cnt('crit')), { tone: cnt('crit') ? 'bad' : 'good' })}${UI.tile('⚠ Внимание', String(cnt('warn')), { tone: cnt('warn') ? 'warn' : '' })}${UI.tile('ℹ К сведению', String(cnt('info')))}</div>
    <div class="bar"><select id="sAg" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === S.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select id="sLv" aria-label="Важность"><option value="">Любая важность</option>${Object.entries(SIG.LEVEL).map(([k, v]) => `<option value="${k}" ${k === S.level ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></div>
    ${UI.panel(`Сигналы (${list.length})`, list.length ? `<ul class="insights">${list.map(SIG.item).join('')}</ul>` : '<p class="mut">Всё спокойно — тревожных событий нет 👍</p>', { cls: 'w12', sub: 'Нажмите на клиента или агента — откроется его карточка' })}
    <p class="mut">Сигналы считаются по загрузкам: обещания из заметок клиентов, рост долга с прошлой загрузки, крупные должники без оплат 2+ недели, агенты без сбора или продаж 3 загруженных дня подряд, сильное отставание от графика, просроченные задания и склад. Чем регулярнее загрузки, тем точнее.</p>`;
  $('#sAg', body).onchange = e => { S.agent = e.target.value; EXT_PAGES.signals(el); };
  $('#sLv', body).onchange = e => { S.level = e.target.value; EXT_PAGES.signals(el); };
};
