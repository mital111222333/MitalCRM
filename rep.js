// Ready-made reports (section «Отчёты»): day report, receivables with ageing, sleeping clients, month-to-month dynamics.
// Everything is computed from the uploads already in the CRM: every «Баланс клиентов» upload is a dated snapshot,
// so comparing snapshots tells when a client last paid or bought (to the accuracy of how often files are uploaded).
window.EXT_PAGES = window.EXT_PAGES || {};

const REP = {
  TABS: [['rday', 'Отчёт дня'], ['signals', '🚨 Сигналы'], ['rdebt', 'Дебиторка'], ['rsleep', 'Спящие клиенты'], ['rdays', 'По дням и неделям'], ['rdyn', 'Динамика по периодам'], ['tg', 'Telegram агентам']],
  BUCKETS: [['b7', 'до 7 дней', 'var(--c3)'], ['b30', '8–30 дней', 'var(--c4)'], ['b60', '31–60 дней', 'var(--c2)'], ['b99', 'больше 60 дней', 'var(--c8)']],
  MONTHS: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  today: () => UI.localDate(Date.now()),
  days: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5),
  month: d => { const m = REP.MONTHS[+d.slice(5, 7) - 1]; return m[0].toUpperCase() + m.slice(1) + ' ' + d.slice(0, 4); },
  money: n => '$' + UI.fmt0(n),
  bucket(c) { if (!c.debt) return null; const d = c.payDays ?? 999; return d <= 7 ? 'b7' : d <= 30 ? 'b30' : d <= 60 ? 'b60' : 'b99'; },

  // when each client last paid / bought, from the sequence of snapshots
  history(S) {
    const ups = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const prev = new Map(), out = new Map(), first = ups[0]?.period_from || null;
    for (const u of ups) {
      for (const r of u.rows) {
        const key = u.period_from + '|' + r.client, p = prev.get(key) || { paid: 0, sold: 0 };
        const c = out.get(r.client) || { lastPay: null, lastBuy: null, firstSeen: u.taken_at };
        if (r.paid > p.paid + 0.5) c.lastPay = u.taken_at;
        if (r.sold > p.sold + 0.5) c.lastBuy = u.taken_at;
        prev.set(key, { paid: r.paid, sold: r.sold }); out.set(r.client, c);
      }
    }
    // month by month: the latest snapshot of each period
    const byPeriod = new Map();
    for (const u of ups) { const cur = byPeriod.get(u.period_from); if (!cur || u.taken_at >= cur.taken_at) byPeriod.set(u.period_from, u); }
    const rule = S.ag.akb || 'paid', act = { paid: r => r.paid > 0, sold: r => r.sold > 0, any: r => r.paid > 0 || r.sold > 0 }[rule] || (r => r.paid > 0);
    const months = [...byPeriod.values()].sort((a, b) => (a.period_from < b.period_from ? -1 : 1)).map(u => {
      const agents = {}, t = { sold: 0, paid: 0, ret: 0, debt: 0, akb: 0, okb: 0 }, active = new Set();
      for (const r of u.rows) {
        const name = r.agent || S.ag.clients[r.client]?.agent || 'Без агента', a = (agents[name] ||= { sold: 0, paid: 0, ret: 0, debt: 0, akb: 0, okb: 0 });
        for (const x of [a, t]) { x.sold += r.sold; x.paid += r.paid; x.ret += r.ret; x.okb++; if (r.b1 < 0) x.debt -= r.b1; if (act(r)) x.akb++; }
        if (act(r)) active.add(r.client);
      }
      return { from: u.period_from, to: u.period_to, taken: u.taken_at, label: PLAN.label(u.period_from), agents, total: t, active };
    });
    return { clients: out, months, since: first, uploads: ups.length };
  },

  async load() {
    await CRMLocal.ready;
    const d = await CRMLocal.request('GET', '/api/ag/dashboard');
    if (d.empty) return d;
    const S = CRMLocal.engine.getState(), h = REP.history(S), t0 = REP.today();
    REP.since = h.since;
    const prevMonth = h.months.filter(m => m.from < d.upload.period_from).at(-1) || null;
    for (const c of d.clients) {
      const x = h.clients.get(c.name) || {};
      c.debt = c.b1 < 0 ? -c.b1 : 0;
      c.lastPay = x.lastPay || null; c.lastBuy = x.lastBuy || null;
      c.payDays = c.lastPay ? REP.days(c.lastPay, t0) : (h.since ? REP.days(h.since, t0) : null);
      c.buyDays = c.lastBuy ? REP.days(c.lastBuy, t0) : (h.since ? REP.days(h.since, t0) : null);
      c.bucket = REP.bucket(c);
      c.lost = !!prevMonth && prevMonth.active.has(c.name) && !c.active;
      c.score = c.debt * (1 + Math.min(c.payDays ?? 60, 90) / 30);
    }
    let low = null; try { const l = await CRMLocal.request('GET', '/api/wh/low'); if (l.items?.length) low = l; } catch { /* no stock data */ }
    return { ...d, hist: h, prevMonth, low };
  },

  shell(el, tab, d, tools = '') {
    el.innerHTML = `<div class="page-head"><div><h2>Отчёты</h2><div class="sub">${d.empty ? 'Нет загруженных данных' : `Данные на <b>${UI.dateRu(d.upload.taken_at)}</b> · период ${UI.dateRu(d.upload.period_from)} — ${UI.dateRu(d.upload.period_to)} · все суммы в долларах`}</div></div>
      <div class="actions no-print">${tools}</div></div>
      <nav class="tabs no-print" aria-label="Отчёты">${REP.TABS.map(([r, t]) => `<a href="#/${r}" class="${r === tab ? 'on' : ''}">${t}</a>`).join('')}</nav><div id="repBody"></div>`;
    return $('#repBody', el);
  },
  empty(body) { body.innerHTML = UI.empty('Отчётов пока нет', 'Загрузите выгрузку «Баланс клиентов» на странице <a href="#/up">⬆ Загрузить</a>. Чем чаще загружаете (лучше каждый день), тем точнее «дни без оплаты» и «дни без покупок».'); },
  agentFilter(d, cur) { const names = [...new Set(d.clients.map(c => c.agent))].sort((a, b) => a.localeCompare(b)); return `<select id="repAg" aria-label="Агент"><option value="">Все агенты</option>${names.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; },
  pay(c) { return c.lastPay ? `${UI.dateRu(c.lastPay)}<br><small>${c.payDays} дн. назад</small>` : `<span class="pill crit" title="В загруженных файлах оплат от клиента нет">нет оплат${REP.since ? ' с ' + UI.dm(REP.since) : ''}</span>`; },
  buy(c) { return c.lastBuy ? `${UI.dateRu(c.lastBuy)}<br><small>${c.buyDays} дн. назад</small>` : `<span class="pill muted">нет покупок${REP.since ? ' с ' + UI.dm(REP.since) : ''}</span>`; },
  print() { window.print(); },
};

// ---------- texts for Telegram / clipboard ----------
REP.teamText = d => {
  const T = agTotals(d), fc = d.forecast, f = REP.money, lines = [];
  lines.push(`<b>📊 Отчёт на ${UI.dateRu(d.upload.taken_at)}</b>`);
  lines.push(`Продано: <b>${f(T.sold)}</b>${T.plan ? ` из ${f(T.plan)} (${UI.pct(T.sold, T.plan)}%)` : ''}${T.d_sold ? ` · за день +${f(T.d_sold)}` : ''}`);
  lines.push(`Собрано: <b>${f(T.paid)}</b>${T.pool ? ` из ${f(T.pool)} (${UI.pct(T.paid, T.pool)}%)` : ''}${T.d_paid ? ` · за день +${f(T.d_paid)}` : ''}`);
  lines.push(`Долг клиентов: <b>${f(T.debt)}</b> · должников ${T.debtors}`);
  lines.push(`АКБ: ${T.akb} из ${T.okb} (${UI.pct(T.akb, T.okb) ?? 0}%)`);
  if (fc.projectable) lines.push(`Период плана ${UI.dateRu(d.upload.period_from)}–${UI.dateRu(fc.period_end)}: прошло ${Math.round(fc.elapsed / fc.month_days * 100)}%, осталось ${fc.days_left} дн.`);
  lines.push('', '<b>По агентам</b> (продажи / сбор):');
  for (const a of d.agents) lines.push(`${a.plan && a.sold >= a.plan ? '🟢' : a.plan && fc.projectable && a.sold / a.plan < fc.elapsed / fc.month_days * 0.8 ? '🔴' : '🟡'} ${esc(a.agent)}: ${f(a.sold)}${a.plan ? ` (${UI.pct(a.sold, a.plan)}%)` : ''} / ${f(a.paid)}${a.pool ? ` (${UI.pct(a.paid, a.pool)}%)` : ''}`);
  return lines.join('\n');
};
REP.agentText = (d, name) => {
  const a = d.agents.find(x => x.agent === name); if (!a) return '';
  const f = REP.money, fc = d.forecast, mine = d.clients.filter(c => c.agent === name), lines = [];
  const rank = [...d.agents].sort((x, y) => y.sold - x.sold).findIndex(x => x.agent === name) + 1;
  lines.push(`<b>${esc(name)}, отчёт на ${UI.dateRu(d.upload.taken_at)}</b>`);
  lines.push(`🛒 Продано: <b>${f(a.sold)}</b>${a.plan ? ` из ${f(a.plan)} — ${UI.pct(a.sold, a.plan)}%` : ''}${a.d_sold ? ` (за день +${f(a.d_sold)})` : ''}`);
  lines.push(`💰 Собрано: <b>${f(a.paid)}</b>${a.pool ? ` из ${f(a.pool)} — ${UI.pct(a.paid, a.pool)}%` : ''}${a.d_paid ? ` (за день +${f(a.d_paid)})` : ''}`);
  if (fc.projectable && fc.days_left) lines.push(`📅 Осталось ${fc.days_left} дн. Нужно в день: продавать ${f(a.need_sell_day || 0)}, собирать ${f(a.need_collect_day || 0)}`);
  lines.push(`📌 Долг ваших клиентов: <b>${f(a.debt)}</b> (${a.debtors} кл.) · АКБ ${a.akb} из ${a.okb} · место в рейтинге: ${rank} из ${d.agents.length}`);
  const rt = typeof ROUTE !== 'undefined' && ROUTE.text(d, name);
  if (rt) lines.push('', rt);
  else {
    const debt = mine.filter(c => c.debt > 0).sort((x, y) => y.score - x.score).slice(0, 7);
    if (debt.length) { lines.push('', '<b>Собрать в первую очередь:</b>'); for (const c of debt) lines.push(`• ${esc(c.name)} — ${f(c.debt)}${c.lastPay ? `, без оплаты ${c.payDays} дн.` : `, нет оплат с ${UI.dm(d.hist.since)}`}`); }
  }
  const sleep = mine.filter(c => c.buyDays !== null && c.buyDays > 30 && c.lastBuy).sort((x, y) => y.buyDays - x.buyDays).slice(0, 5);
  if (sleep.length) { lines.push('', '<b>Давно не покупали:</b>'); for (const c of sleep) lines.push(`• ${esc(c.name)} — ${c.buyDays} дн.`); }
  const tasks = d.tasks.filter(t => t.agent === name && t.status !== 'done');
  if (tasks.length) { lines.push('', '<b>Ваши задания:</b>'); for (const t of tasks.slice(0, 8)) lines.push(`${t.status === 'overdue' ? '❌' : '⏳'} ${esc(t.client)}: ${esc(t.kind)}${t.target ? ` ${f(t.target)}` : ''}${t.due ? ` до ${UI.dateRu(t.due)}` : ''}${t.fact ? ` (сделано ${f(t.fact)})` : ''}`); }
  return lines.join('\n');
};

// ---------- hero: where the plan period stands (sales and money against the plan and the calendar) ----------
REP.hero = d => {
  const T = agTotals(d), fc = d.forecast, pace = agPace(d), f = UI.fmt0, end = fc.period_end || d.upload.period_to;
  const g = (title, now, plan, more, dayDelta, word) => {
    const p = plan > 0 ? now / plan : null, cls = p === null ? '' : p >= 1 ? 'done' : pace !== null && p < pace * 0.6 ? 'low' : '';
    const tag = p === null ? '' : `<span class="pct-tag ${p >= 1 ? 'ok' : pace !== null && p < pace * 0.6 ? 'lag' : pace !== null && p < pace * 0.9 ? 'mid' : ''}">${Math.round(p * 100)}%</span>`;
    return `<div class="gauge2"><div class="gt"><span>${title}</span>${tag}</div><div class="gv">$${f(now)}${plan ? ` <span>из $${f(plan)}</span>` : ''}</div>
      <div class="oilbar" title="${p === null ? 'План не задан' : Math.round(p * 100) + '% плана'}"><i class="${cls}" style="width:${p === null ? 0 : Math.min(p, 1) * 100}%"></i>${pace !== null && p !== null ? `<b style="left:calc(${Math.min(pace, 1) * 100}% - 1.5px)" title="По графику: ${Math.round(pace * 100)}%"></b>` : ''}</div>
      <div class="gs"><span>${dayDelta ? `за день <b>+$${f(dayDelta)}</b>` : 'за день —'}</span><span>${plan ? (now < plan ? `осталось ${word} <b>$${f(plan - now)}</b>` : '<b>план закрыт ✓</b>') : 'план не задан'}</span>${more ? `<span>с ожиданиями <b>$${f(now + more)}</b></span>` : ''}</div></div>`;
  };
  return `<section class="hero" aria-label="Итоги периода">
    <div class="hp"><h3>Период плана ${UI.dm(d.upload.period_from)} — ${UI.dm(end)}</h3>
      ${fc.projectable ? `<div class="big">${fc.days_left}<small>${UI.plural(fc.days_left, 'день', 'дня', 'дней')} до конца</small></div>
      <div><div class="track"><i style="width:${Math.round(pace * 100)}%"></i></div><div class="track-l"><span>${UI.dm(d.upload.period_from)}</span><span>прошло ${Math.round(pace * 100)}%</span><span>${UI.dm(end)}</span></div></div>` : `<div class="big">${UI.dm(d.upload.taken_at)}</div>`}
      <div style="font-size:12px;color:#8ea4b5">Данные на ${UI.dateRu(d.upload.taken_at)}. Белая метка на полосах — где команда должна быть по графику.</div></div>
    <div class="gauges">${g('🛒 Продажи', T.sold, T.plan, T.more_sale || 0, T.d_sold, 'продать')}${g('💰 Сбор денег', T.paid, T.pool, T.more_pool || 0, T.d_paid, 'собрать')}</div>
  </section>`;
};

// ---------- Отчёт дня ----------
EXT_PAGES.rday = async el => {
  const d = await REP.load(), body = REP.shell(el, 'rday', d, '<button class="btn gray" id="rCopy">Скопировать текст</button><button class="btn gray" id="rPrint">Печать / PDF</button><button class="btn" id="rSend">Отправить в Telegram</button>');
  if (d.empty) return REP.empty(body);
  const T = agTotals(d), fc = d.forecast, pace = agPace(d), f = UI.fmt0, col = agColors(d);
  const call = d.clients.filter(c => c.debt > 0).sort((a, b) => b.score - a.score).slice(0, 12);
  const od = d.tasks.filter(t => t.status === 'overdue'), open = d.tasks.filter(t => t.status === 'work');
  const lowN = d.low ? (d.low.counts.out || 0) + (d.low.counts.low || 0) + (d.low.counts.blocked || 0) : 0;
  body.innerHTML = `${REP.hero(d)}<div class="kpis">
    ${UI.tile('Долг клиентов', '$' + f(T.debt), { sub: `должников ${T.debtors}`, delta: UI.delta(T.d_debt, { inverse: true }), tone: 'warn' })}
    ${UI.tile('АКБ / ОКБ', `${T.akb} / ${T.okb}`, { sub: `активны ${UI.pct(T.akb, T.okb) ?? 0}%` })}
    ${(() => { const pc = PREV.compare(d); if (!pc) return ''; return pc.missing ? UI.tile(`К прошлому периоду`, '—', { sub: `загрузите баланс прошлого периода (с ${UI.dateRu(pc.prevFrom)}) — появится сравнение на ${pc.n}-й день` }) : UI.tile(`К прошлому периоду, ${pc.n}-й день`, `$${f(T.sold)}`, { sub: `тогда продано $${f(pc.total.sold)} ${PREV.chip(T.sold, pc.total.sold)}<br>собрано $${f(T.paid)} / тогда $${f(pc.total.paid)} ${PREV.chip(T.paid, pc.total.paid)}`, hint: `Сравнение с периодом от ${UI.dateRu(pc.prevFrom)}: загрузка на ${UI.dateRu(pc.prevDate)} (${pc.prevN}-й день)` }); })()}
    ${T.pool ? UI.tile('Сбор к ' + UI.dm(fc.period_end || d.upload.period_to), '$' + f(T.paid + (T.more_pool || 0)), { sub: `собрано ${f(T.paid)} + ещё соберётся ${f(T.more_pool || 0)} · ${UI.pct(T.paid + (T.more_pool || 0), T.pool)}% пула`, tone: T.paid + (T.more_pool || 0) >= T.pool ? 'good' : 'warn' }) : ''}
    ${T.proj_sold ? UI.tile('Прогноз продаж', '≈ $' + f(T.proj_sold), { sub: T.plan ? `${UI.pct(T.proj_sold, T.plan)}% плана при текущем темпе` : '', tone: T.plan && T.proj_sold < T.plan * 0.9 ? 'warn' : 'good' }) : ''}
  </div>
  <div class="grid">
    ${UI.panel('Агенты: план и факт', `<div class="scroll" style="max-height:none"><table class="plan2"><thead>
      <tr><th rowspan="2">Агент</th><th colspan="5" class="grp">🛒 Продажи</th><th colspan="6" class="grp">💰 Сбор денег</th><th rowspan="2" class="n">Долг клиентов</th><th rowspan="2" class="n">Задания</th></tr>
      <tr><th class="n">План</th><th class="n">Продано</th><th class="n">%</th><th class="n">Осталось</th><th class="n">Нужно / день</th><th class="n">Пул</th><th class="n">Собрано</th><th class="n">%</th><th class="n">Осталось</th><th class="n">Ещё соберёт</th><th class="n">Итого к ${UI.dm(fc.period_end || d.upload.period_to)}</th></tr></thead><tbody>${d.agents.map(a => {
      const ps = UI.pct(a.sold, a.plan), pp = UI.pct(a.paid, a.pool), tone = p => p === null ? '' : p >= 100 ? 'good' : pace !== null && p < pace * 60 ? 'crit' : pace !== null && p < pace * 90 ? 'warn' : 'info';
      const myOd = od.filter(t => t.agent === a.agent).length, myOpen = open.filter(t => t.agent === a.agent).length, mp = a.more_pool || 0, tot = a.paid + mp, pt = UI.pct(tot, a.pool);
      return `<tr><td><i class="dot" style="background:${col(a.agent)};margin:0 8px 0 0"></i><a class="clink" data-agent="${esc(a.agent)}">${esc(a.agent)}</a></td>
        <td class="n">${a.plan ? f(a.plan) : '<span class="mut">—</span>'}</td><td class="n"><b>${f(a.sold)}</b>${a.d_sold ? `<br><small class="pos">+${f(a.d_sold)} за день</small>` : ''}</td><td class="n">${ps === null ? '—' : UI.pill(tone(ps), ps + '%')}</td><td class="n">${a.plan ? f(Math.max(0, a.plan - a.sold)) : '—'}</td><td class="n">${a.need_sell_day ? f(a.need_sell_day) : '—'}</td>
        <td class="n">${a.pool ? f(a.pool) : '<span class="mut">—</span>'}</td><td class="n"><b>${f(a.paid)}</b>${a.d_paid ? `<br><small class="pos">+${f(a.d_paid)} за день</small>` : ''}</td><td class="n">${pp === null ? '—' : UI.pill(tone(pp), pp + '%')}</td><td class="n">${a.pool ? f(Math.max(0, a.pool - a.paid)) : '—'}${a.need_collect_day ? `<br><small>${f(a.need_collect_day)}/день</small>` : ''}</td><td class="n">${mp ? f(mp) : '<span class="mut">—</span>'}</td><td class="n"><b>${f(tot)}</b>${pt !== null ? `<br>${UI.pill(pt >= 100 ? 'good' : pt >= 90 ? 'info' : 'warn', pt + '% пула')}` : ''}</td>
        <td class="n">${f(a.debt)}<br><small>${a.debtors} кл.</small></td><td class="n">${myOd ? UI.pill('crit', myOd + ' просроч.') : ''}${myOpen ? ' ' + UI.pill('info', myOpen + ' в работе') : ''}${!myOd && !myOpen ? '<span class="mut">—</span>' : ''}</td></tr>`;
    }).join('')}</tbody><tfoot><tr><td><b>Итого</b></td><td class="n"><b>${f(T.plan)}</b></td><td class="n"><b>${f(T.sold)}</b></td><td class="n"><b>${UI.pct(T.sold, T.plan) ?? '—'}${T.plan ? '%' : ''}</b></td><td class="n"><b>${f(Math.max(0, T.plan - T.sold))}</b></td><td></td><td class="n"><b>${f(T.pool)}</b></td><td class="n"><b>${f(T.paid)}</b></td><td class="n"><b>${UI.pct(T.paid, T.pool) ?? '—'}${T.pool ? '%' : ''}</b></td><td class="n"><b>${f(Math.max(0, T.pool - T.paid))}</b></td><td class="n"><b>${f(T.more_pool || 0)}</b></td><td class="n"><b>${f(T.paid + (T.more_pool || 0))}</b>${T.pool ? `<br><small>${UI.pct(T.paid + (T.more_pool || 0), T.pool)}% пула</small>` : ''}</td><td class="n"><b>${f(T.debt)}</b></td><td></td></tr></tfoot></table></div>
      <p class="mut" style="margin:10px 0 0">«Осталось» — сколько не хватает до плана. «Ещё соберёт» — ваши ожидания по клиентам до конца периода (вводятся в «Агенты → Клиенты и долги»), «Итого» = собрано + ещё соберёт.${pace !== null ? ` Цвет процента: зелёный — план выполнен, синий — по графику (прошло ${Math.round(pace * 100)}% периода), жёлтый — отстаёт, красный — сильно отстаёт.` : ''}</p>`, { cls: 'w12' })}
    ${(() => { const sg = SIG.compute(d); return sg.length ? UI.panel(`🚨 Сигналы (${sg.length})`, `<ul class="insights">${sg.slice(0, 6).map(SIG.item).join('')}</ul>${sg.length > 6 ? `<p style="margin:8px 0 0"><a href="#/signals">Все сигналы (${sg.length}) →</a></p>` : ''}`, { cls: 'w12', sub: 'Самое срочное — нажмите на клиента или агента, чтобы открыть карточку' }) : ''; })()}
    ${UI.panel('Что важно сегодня', `<ul class="insights">${agInsights(d).map(([k, i, t]) => `<li class="${k}"><span aria-hidden="true">${i}</span><span>${t}</span></li>`).join('')}${lowN ? `<li class="warn"><span aria-hidden="true">📦</span><span>На складе <b>${lowN}</b> товаров закончились или на исходе — <a href="#/whlow">посмотреть</a>.</span></li>` : ''}</ul>`, { cls: 'w5' })}
    ${UI.panel('Кому звонить сегодня', call.length ? `<div class="scroll"><table><thead><tr><th>Клиент</th><th>Агент</th><th class="n">Долг</th><th class="n">Последняя оплата</th></tr></thead><tbody>${call.map(c => `<tr><td><a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${c.phone ? `<br><small><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></small>` : ''}</td><td>${esc(c.agent)}</td><td class="n">${f(c.debt)}</td><td class="n">${REP.pay(c)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Должников нет</div>', { cls: 'w7', sub: 'Крупный долг и давно не платили — в начале списка' })}
  </div>`;
  const text = REP.teamText(d);
  $('#rCopy', el).onclick = async () => { const plain = text.replace(/<[^>]+>/g, ''); try { await navigator.clipboard.writeText(plain); toast('Текст отчёта скопирован'); } catch { prompt('Скопируйте:', plain); } };
  $('#rPrint', el).onclick = REP.print;
  $('#rSend', el).onclick = () => { location.hash = '#/tg'; };
};

// ---------- Дебиторка ----------
let repDebt = { agent: '', bucket: '' };
EXT_PAGES.rdebt = async el => {
  const d = await REP.load(), body = REP.shell(el, 'rdebt', d, '<button class="btn gray" id="rCsv">⬇ Excel (CSV)</button><button class="btn gray" id="rPrint">Печать / PDF</button>');
  if (d.empty) return REP.empty(body);
  const S = repDebt, f = UI.fmt0, debtors = d.clients.filter(c => c.debt > 0);
  const sumB = (list, b) => list.filter(c => c.bucket === b).reduce((s, c) => s + c.debt, 0);
  const total = debtors.reduce((s, c) => s + c.debt, 0), old = sumB(debtors, 'b60') + sumB(debtors, 'b99'), never = debtors.filter(c => !c.lastPay).reduce((s, c) => s + c.debt, 0);
  const agents = d.agents.map(a => a.agent);
  const list = debtors.filter(c => (!S.agent || c.agent === S.agent) && (!S.bucket || c.bucket === S.bucket)).sort((a, b) => b.score - a.score);
  // overpayments (client paid ahead) are the other side of the balance
  const ahead = d.clients.filter(c => c.b1 > 0).reduce((s, c) => s + c.b1, 0);
  body.innerHTML = `<div class="kpis">
    ${UI.tile('Долг клиентов', '$' + f(total), { sub: `${debtors.length} должников`, tone: 'warn' })}
    ${UI.tile('Просрочено больше 30 дней', '$' + f(sumB(debtors, 'b60') + sumB(debtors, 'b99')), { sub: `${UI.pct(old, total) ?? 0}% всего долга`, tone: old ? 'bad' : '' })}
    ${UI.tile('Нет ни одной оплаты', '$' + f(never), { sub: `${debtors.filter(c => !c.lastPay).length} должников не платили с ${UI.dateRu(d.hist.since)} (начало загрузок)` })}
    ${UI.tile('Собрано за период', '$' + f(agTotals(d).paid), { sub: `переплаты клиентов: $${f(ahead)}` })}
  </div>
  ${(() => { const T = agTotals(d), mp = T.more_pool || 0, left = Math.max(0, T.pool - T.paid), gap = Math.max(0, T.pool - T.paid - mp), end = d.forecast.period_end || d.upload.period_to;
    return T.pool ? `<div class="kpis">
    ${UI.tile('План сбора (пул)', '$' + f(T.pool), { sub: `собрано ${f(T.paid)} · ${UI.pct(T.paid, T.pool)}%` })}
    ${UI.tile('Осталось собрать по плану', '$' + f(left), { sub: d.forecast.projectable ? `до ${UI.dateRu(end)}, ≈ $${f(left / Math.max(d.forecast.days_left, 1))} в день` : '', tone: left ? 'warn' : 'good' })}
    ${UI.tile('Ещё соберётся (ожидание)', '$' + f(mp), { sub: `итого к ${UI.dm(end)}: $${f(T.paid + mp)} · ${UI.pct(T.paid + mp, T.pool)}% пула` })}
    ${UI.tile('Не хватает до плана', '$' + f(gap), { sub: gap ? 'даже с учётом ожиданий — нужны новые оплаты' : 'план закрывается с учётом ожиданий', tone: gap ? 'bad' : 'good' })}
  </div>` : ''; })()}
  <div class="grid">
    ${UI.panel('План сбора по агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th class="n">Пул</th><th class="n">Собрано</th><th class="n">%</th><th class="n">Осталось собрать</th><th class="n">Ещё соберёт</th><th class="n">Итого к ${UI.dm(d.forecast.period_end || d.upload.period_to)}</th><th class="n">Не хватает</th><th class="n">Долг клиентов</th></tr></thead><tbody>${d.agents.map(a => { const mp = a.more_pool || 0, tot = a.paid + mp, gap = Math.max(0, a.pool - tot); return `<tr><td><a class="clink" data-agent="${esc(a.agent)}">${esc(a.agent)}</a></td><td class="n">${a.pool ? f(a.pool) : '—'}</td><td class="n"><b>${f(a.paid)}</b></td><td class="n">${a.pool ? UI.pct(a.paid, a.pool) + '%' : '—'}</td><td class="n">${a.pool ? f(Math.max(0, a.pool - a.paid)) : '—'}</td><td class="n">${mp ? f(mp) : '—'}</td><td class="n"><b>${f(tot)}</b>${a.pool ? `<br><small>${UI.pct(tot, a.pool)}%</small>` : ''}</td><td class="n">${a.pool ? (gap ? `<b class="neg">${f(gap)}</b>` : UI.pill('good', 'закрыт', '✓')) : '—'}</td><td class="n">${f(a.debt)}</td></tr>`; }).join('')}</tbody></table></div>`, { cls: 'w12', sub: 'Сколько ещё нужно собрать до конца периода и сколько закроется с учётом ваших ожиданий' })}
    ${UI.panel('Возраст долга по агентам', CH.stack100(d.agents.filter(a => a.debt > 0).map(a => ({ label: `${a.agent} · $${f(a.debt)}`, segs: REP.BUCKETS.map(([k, n, color]) => ({ name: n, value: sumB(debtors.filter(c => c.agent === a.agent), k), color })) }))), { cls: 'w7', sub: 'Сколько дней прошло с последней оплаты клиента' })}
    ${UI.panel('Весь долг по сроку', CH.hbars(REP.BUCKETS.map(([k, n, color]) => ({ label: n, value: sumB(debtors, k), color, sub: `${debtors.filter(c => c.bucket === k).length} кл.` })), { fmt: UI.fmt0 }), { cls: 'w5' })}
    ${UI.panel('Должники', `<div class="bar">${REP.agentFilter(d, S.agent)}<select id="rB" aria-label="Срок"><option value="">Любой срок</option>${REP.BUCKETS.map(([k, n]) => `<option value="${k}" ${k === S.bucket ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="mut">${list.length} клиентов · $${f(list.reduce((s, c) => s + c.debt, 0))}</span></div>
      <div class="scroll"><table><thead><tr><th>Клиент</th><th>Агент</th><th class="n">Долг</th><th class="n">Последняя оплата</th><th class="n">Последняя покупка</th><th class="n">Продано / оплачено за период</th><th class="n">Пул / ещё соберёт</th><th>Заметка</th></tr></thead><tbody>${list.slice(0, 400).map(c => `<tr><td><a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${c.phone ? `<br><small><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></small>` : ''}</td><td>${esc(c.agent)}</td><td class="n"><b>${f(c.debt)}</b></td><td class="n">${REP.pay(c)}</td><td class="n">${REP.buy(c)}</td><td class="n">${f(c.sold)} / ${f(c.paid)}</td><td class="n">${c.pool ? f(c.pool) : '—'} / ${c.more_pool ? f(c.more_pool) : '—'}${c.pool ? `<br><small>осталось ${f(Math.max(0, c.pool - c.paid))}</small>` : ''}</td><td><small>${esc(c.note || '')}</small></td></tr>`).join('')}</tbody></table></div>
      <p class="mut" style="margin:10px 0 0">«Последняя оплата» — дата загрузки, в которой у клиента выросла сумма оплат. Загружайте выгрузку каждый день — даты будут точными. Самые срочные (большой долг и давно не платил) — вверху.</p>`, { cls: 'w12' })}
  </div>`;
  $('#repAg', body).onchange = e => { S.agent = e.target.value; EXT_PAGES.rdebt(el); };
  $('#rB', body).onchange = e => { S.bucket = e.target.value; EXT_PAGES.rdebt(el); };
  $('#rPrint', el).onclick = REP.print;
  $('#rCsv', el).onclick = () => UI.csv(`дебиторка-${d.upload.taken_at}.csv`, [['Клиент', 'Агент', 'Телефон', 'Долг $', 'Последняя оплата', 'Дней без оплаты', 'Последняя покупка', 'Срок долга', 'Заметка'], ...list.map(c => [c.name, c.agent, c.phone || '', Math.round(c.debt), c.lastPay ? UI.dateRu(c.lastPay) : 'не платил', c.payDays ?? '', c.lastBuy ? UI.dateRu(c.lastBuy) : '', REP.BUCKETS.find(b => b[0] === c.bucket)?.[1] || '', c.note || ''])]);
};

// ---------- Спящие клиенты ----------
let repSleep = { agent: '', days: 30, view: 'sleep' };
EXT_PAGES.rsleep = async el => {
  const d = await REP.load(), body = REP.shell(el, 'rsleep', d, '<button class="btn gray" id="rCsv">⬇ Excel (CSV)</button>');
  if (d.empty) return REP.empty(body);
  const S = repSleep, f = UI.fmt0;
  const sleeping = d.clients.filter(c => c.lastBuy && c.buyDays > S.days), never = d.clients.filter(c => !c.lastBuy), lost = d.clients.filter(c => c.lost);
  const pool = S.view === 'lost' ? lost : S.view === 'never' ? never : sleeping;
  const list = pool.filter(c => !S.agent || c.agent === S.agent).sort((a, b) => (b.buyDays ?? 0) - (a.buyDays ?? 0) || b.debt - a.debt);
  const byAgent = d.agents.map(a => ({ a: a.agent, s: sleeping.filter(c => c.agent === a.agent).length, l: lost.filter(c => c.agent === a.agent).length, n: never.filter(c => c.agent === a.agent).length, okb: a.okb, akb: a.akb }));
  body.innerHTML = `<div class="kpis">
    ${UI.tile(`Не покупали больше ${S.days} дн.`, f(sleeping.length), { sub: `из ${d.clients.length} клиентов`, tone: sleeping.length ? 'warn' : '' })}
    ${UI.tile('Выпали из АКБ', f(lost.length), { sub: d.prevMonth ? `были активны в прошлом периоде (${d.prevMonth.label}), сейчас нет` : 'появится, когда будет выгрузка прошлого месяца', tone: lost.length ? 'bad' : '' })}
    ${UI.tile('Ни одной покупки', f(never.length), { sub: d.hist.since ? `с ${UI.dateRu(d.hist.since)}` : '' })}
    ${UI.tile('АКБ', `${agTotals(d).akb} / ${agTotals(d).okb}`, { sub: 'активные / все клиенты' })}
  </div>
  <div class="grid">
    ${d.hist.since && REP.days(d.hist.since, REP.today()) < S.days ? `<p class="mut w12" style="margin:0">История загрузок начинается с ${UI.dateRu(d.hist.since)} — это меньше ${S.days} дней, поэтому «давно не покупали» пока считается только с этой даты. Загрузите выгрузки за прошлые месяцы, чтобы видеть картину полностью.</p>` : ''}
    ${UI.panel('По агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th class="n">АКБ / ОКБ</th><th class="n">Спят > ${S.days} дн.</th><th class="n">Выпали из АКБ</th><th class="n">Без покупок</th></tr></thead><tbody>${byAgent.map(x => `<tr><td>${esc(x.a)}</td><td class="n">${x.akb} / ${x.okb}</td><td class="n">${x.s ? UI.pill('warn', String(x.s)) : '0'}</td><td class="n">${x.l ? UI.pill('crit', String(x.l)) : '0'}</td><td class="n">${x.n}</td></tr>`).join('')}</tbody></table></div>`, { cls: 'w12' })}
    ${UI.panel('Клиенты', `<div class="bar"><select id="rV" aria-label="Список"><option value="sleep" ${S.view === 'sleep' ? 'selected' : ''}>Давно не покупали</option><option value="lost" ${S.view === 'lost' ? 'selected' : ''}>Выпали из АКБ</option><option value="never" ${S.view === 'never' ? 'selected' : ''}>Ни одной покупки</option></select>
      ${S.view === 'sleep' ? `<select id="rD" aria-label="Дней">${[14, 30, 45, 60, 90].map(n => `<option value="${n}" ${n === S.days ? 'selected' : ''}>больше ${n} дней</option>`).join('')}</select>` : ''}${REP.agentFilter(d, S.agent)}
      <span class="spacer"></span><button class="btn needs-edit" id="rTask" disabled>Дать задание агентам по выбранным</button></div>
      <div class="scroll"><table><thead><tr><th><input type="checkbox" id="rAll" aria-label="Выбрать все"></th><th>Клиент</th><th>Агент</th><th class="n">Последняя покупка</th><th class="n">Последняя оплата</th><th class="n">Долг</th><th>Заметка</th></tr></thead><tbody>${list.slice(0, 400).map((c, i) => `<tr><td><input type="checkbox" data-i="${i}" aria-label="Выбрать"></td><td><a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${c.phone ? `<br><small><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></small>` : ''}</td><td>${esc(c.agent)}</td><td class="n">${REP.buy(c)}</td><td class="n">${REP.pay(c)}</td><td class="n">${c.debt ? f(c.debt) : '—'}</td><td><small>${esc(c.note || '')}</small></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Таких клиентов нет 👍</td></tr>'}</tbody></table></div>`, { cls: 'w12' })}
  </div>`;
  const re = () => EXT_PAGES.rsleep(el);
  $('#rV', body).onchange = e => { S.view = e.target.value; re(); };
  const rd = $('#rD', body); if (rd) rd.onchange = e => { S.days = +e.target.value; re(); };
  $('#repAg', body).onchange = e => { S.agent = e.target.value; re(); };
  const boxes = () => [...body.querySelectorAll('input[data-i]')], btn = $('#rTask', body);
  const upd = () => { const n = boxes().filter(b => b.checked).length; btn.disabled = !n; btn.textContent = n ? `Дать задание по ${n} кл.` : 'Дать задание агентам по выбранным'; };
  boxes().forEach(b => b.onchange = upd);
  $('#rAll', body).onchange = e => { boxes().forEach(b => b.checked = e.target.checked); upd(); };
  btn.onclick = async () => {
    const chosen = boxes().filter(b => b.checked).map(b => list[+b.dataset.i]);
    const due = new Date(Date.now() + 7 * 864e5), dueS = UI.localDate(due);
    const text = prompt(`Задание для ${chosen.length} клиентов (срок ${UI.dateRu(dueS)}):`, S.view === 'never' ? 'Сделать первую продажу' : 'Вернуть клиента: визит и заказ');
    if (text === null) return;
    for (const c of chosen) await CRMLocal.request('POST', '/api/ag/tasks', { client: c.name, kind: 'Продажа', text, target: 0, due: dueS });
    await CRMLocal.flush(); toast(`Создано заданий: ${chosen.length}`); re();
  };
  $('#rCsv', el).onclick = () => UI.csv(`спящие-клиенты-${d.upload.taken_at}.csv`, [['Клиент', 'Агент', 'Телефон', 'Последняя покупка', 'Дней без покупок', 'Последняя оплата', 'Долг $'], ...list.map(c => [c.name, c.agent, c.phone || '', c.lastBuy ? UI.dateRu(c.lastBuy) : 'нет', c.lastBuy ? c.buyDays : '', c.lastPay ? UI.dateRu(c.lastPay) : 'нет', Math.round(c.debt)])]);
};

// ---------- Динамика по месяцам ----------
let repDyn = { agent: '' };
EXT_PAGES.rdyn = async el => {
  const d = await REP.load(), body = REP.shell(el, 'rdyn', d);
  if (d.empty) return REP.empty(body);
  const S = repDyn, f = UI.fmt0, M = d.hist.months.slice(-12), pick = m => (S.agent ? m.agents[S.agent] || { sold: 0, paid: 0, ret: 0, debt: 0, akb: 0, okb: 0 } : m.total);
  if (M.length < 2) {
    body.innerHTML = UI.empty('Нужны данные хотя бы за два месяца', `Сейчас загружен только ${M[0] ? M[0].label.toLowerCase() : 'один период'}. Загрузите в «Агенты → Загрузки» выгрузку «Баланс клиентов» за прошлые месяцы (период с 1-го по последнее число месяца) — и здесь появится сравнение месяц к месяцу.`);
    return;
  }
  const cur = pick(M.at(-1)), prev = pick(M.at(-2)), dp = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
  const chip = (a, b, inv) => { const p = dp(a, b); return p === null ? '' : UI.delta(p, { unit: '%', inverse: inv, title: `К периоду ${M.at(-2).label}` }); };
  const agents = [...new Set(M.flatMap(m => Object.keys(m.agents)))].sort((a, b) => a.localeCompare(b));
  const partial = M.at(-1).to < PLAN.end(M.at(-1).from);
  body.innerHTML = `<div class="bar">${`<select id="repAg" aria-label="Агент"><option value="">Вся команда</option>${agents.map(n => `<option ${n === S.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`}${partial ? `<span class="mut">Период ${M.at(-1).label} ещё не закончился (данные по ${UI.dateRu(M.at(-1).to)}) — сравнивайте с осторожностью.</span>` : ''}</div>
  <div class="kpis">
    ${UI.tile('Продано · ' + M.at(-1).label, '$' + f(cur.sold), { sub: `${M.at(-2).label}: $${f(prev.sold)}`, delta: chip(cur.sold, prev.sold) })}
    ${UI.tile('Собрано', '$' + f(cur.paid), { sub: `было $${f(prev.paid)}`, delta: chip(cur.paid, prev.paid) })}
    ${UI.tile('Долг на конец', '$' + f(cur.debt), { sub: `было $${f(prev.debt)}`, delta: chip(cur.debt, prev.debt, true) })}
    ${UI.tile('АКБ', `${cur.akb}`, { sub: `было ${prev.akb} · ОКБ ${cur.okb}`, delta: chip(cur.akb, prev.akb) })}
  </div>
  <div class="grid">
    ${UI.panel('Продажи и сбор по месяцам', CH.columns(M.map(m => ({ label: m.from.endsWith('-01') ? m.label.slice(0, 3) + ' ' + m.from.slice(2, 4) : UI.dm(m.from), values: [pick(m).sold, pick(m).paid] })), [{ name: 'Продано', color: 'var(--c1)' }, { name: 'Собрано', color: 'var(--c3)' }], { fmt: UI.fmt0 }), { cls: 'w7' })}
    ${UI.panel('Долг клиентов на конец месяца', CH.columns(M.map(m => ({ label: m.from.endsWith('-01') ? m.label.slice(0, 3) + ' ' + m.from.slice(2, 4) : UI.dm(m.from), values: [pick(m).debt] })), [{ name: 'Долг', color: 'var(--c2)' }], { fmt: UI.fmt0 }), { cls: 'w5' })}
    ${UI.panel('Продажи агентов по месяцам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th>${M.map(m => `<th class="n">${m.label}</th>`).join('')}<th class="n">Изменение</th></tr></thead><tbody>${agents.map(a => { const v = M.map(m => m.agents[a]?.sold || 0); return `<tr><td>${esc(a)}</td>${v.map(x => `<td class="n">${f(x)}</td>`).join('')}<td class="n">${UI.delta(dp(v.at(-1), v.at(-2)), { unit: '%' }) || '—'}</td></tr>`; }).join('')}</tbody></table></div>`, { cls: 'w12', sub: 'Продано за месяц (по последней загрузке каждого месяца)' })}
    ${UI.panel('Сбор денег агентов по месяцам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th>${M.map(m => `<th class="n">${m.label}</th>`).join('')}<th class="n">Изменение</th></tr></thead><tbody>${agents.map(a => { const v = M.map(m => m.agents[a]?.paid || 0); return `<tr><td>${esc(a)}</td>${v.map(x => `<td class="n">${f(x)}</td>`).join('')}<td class="n">${UI.delta(dp(v.at(-1), v.at(-2)), { unit: '%' }) || '—'}</td></tr>`; }).join('')}</tbody></table></div>`, { cls: 'w12' })}
  </div>`;
  $('#repAg', body).onchange = e => { S.agent = e.target.value; EXT_PAGES.rdyn(el); };
};

// ---------- По дням / неделям / месяцам: what was sold and collected each day (the difference between daily uploads) ----------
REP.daily = S => {
  const ups = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
  const last = new Map(); for (const u of ups) last.set(u.period_from + '|' + u.taken_at, u); // one (the latest) upload per day and period
  const byPer = new Map(); for (const u of last.values()) (byPer.get(u.period_from) || byPer.set(u.period_from, []).get(u.period_from)).push(u);
  const days = new Map();
  for (const list of byPer.values()) {
    list.sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1));
    let prev = null;
    for (const u of list) {
      const was = new Map(prev ? prev.rows.map(r => [r.client, r]) : []), day = (days.get(u.taken_at) || days.set(u.taken_at, { date: u.taken_at, sold: 0, paid: 0, ret: 0, agents: {}, first: !prev }).get(u.taken_at));
      for (const r of u.rows) {
        const p = was.get(r.client) || { sold: 0, paid: 0, ret: 0 }, agent = r.agent || S.ag.clients[r.client]?.agent || 'Без агента';
        const ds = r.sold - p.sold, dp = r.paid - p.paid, dr = r.ret - p.ret, a = (day.agents[agent] ||= { sold: 0, paid: 0, ret: 0 });
        day.sold += ds; day.paid += dp; day.ret += dr; a.sold += ds; a.paid += dp; a.ret += dr;
      }
      if (!prev) day.from = u.period_from;
      prev = u;
    }
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
};
REP.weekStart = d => { const x = new Date(d + 'T12:00:00'), wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return UI.localDate(x.getTime()); };
let repDays = { by: 'day', agent: '' };
EXT_PAGES.rdays = async el => {
  const d = await REP.load(), body = REP.shell(el, 'rdays', d, '<button class="btn gray" id="rCsv">⬇ Excel (CSV)</button>');
  if (d.empty) return REP.empty(body);
  const S = repDays, f = UI.fmt0, days = REP.daily(CRMLocal.engine.getState());
  const agents = [...new Set(days.flatMap(x => Object.keys(x.agents)))].sort((a, b) => a.localeCompare(b));
  const val = (x, k) => (S.agent ? x.agents[S.agent]?.[k] || 0 : x[k]);
  const key = x => (S.by === 'day' ? x.date : S.by === 'week' ? REP.weekStart(x.date) : x.date.slice(0, 7));
  const label = k => (S.by === 'day' ? UI.dateRu(k) : S.by === 'week' ? `${UI.dm(k)}–${UI.dm(UI.localDate(Date.parse(k + 'T12:00:00') + 6 * 864e5))}` : REP.month(k + '-01'));
  const groups = new Map();
  for (const x of days) { const k = key(x), g = groups.get(k) || groups.set(k, { k, sold: 0, paid: 0, ret: 0, n: 0, first: false, agents: {} }).get(k); g.sold += val(x, 'sold'); g.paid += val(x, 'paid'); g.ret += val(x, 'ret'); g.n++; if (x.first) g.first = true; for (const [a, v] of Object.entries(x.agents)) { const t = (g.agents[a] ||= { sold: 0, paid: 0 }); t.sold += v.sold; t.paid += v.paid; } }
  const G = [...groups.values()];
  const firstNote = days.length && days[0].first ? `Первая загрузка (${UI.dateRu(days[0].date)}) содержит всё, что было с ${UI.dateRu(days[0].from)} — поэтому этот день большой. Дальше каждый день — только прирост.` : '';
  body.innerHTML = `<div class="bar"><select id="dBy" aria-label="Шаг"><option value="day" ${S.by === 'day' ? 'selected' : ''}>По дням</option><option value="week" ${S.by === 'week' ? 'selected' : ''}>По неделям (пн–вс)</option><option value="month" ${S.by === 'month' ? 'selected' : ''}>По календарным месяцам</option></select>
      <select id="repAg" aria-label="Агент"><option value="">Вся команда</option>${agents.map(n => `<option ${n === S.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <span class="mut">Загружено дней: ${days.length}${days.length ? ` · с ${UI.dateRu(days[0].date)} по ${UI.dateRu(days.at(-1).date)}` : ''}</span></div>
    ${days.length < 2 ? `<p class="mut">Пока загружен ${days.length} день. Загружайте баланс каждый день (можно несколько раз — сохранится последний за день), и здесь появится, сколько продано и собрано в каждый день, неделю и месяц.</p>` : ''}
    <div class="grid">
      ${UI.panel(`Продано и собрано ${S.by === 'day' ? 'по дням' : S.by === 'week' ? 'по неделям' : 'по месяцам'}`, CH.columns(G.slice(-31).map(g => ({ label: S.by === 'day' ? UI.dm(g.k) : S.by === 'week' ? UI.dm(g.k) : REP.MONTHS[+g.k.slice(5, 7) - 1].slice(0, 3), values: [Math.max(0, g.sold), Math.max(0, g.paid)] })), [{ name: 'Продано', color: 'var(--c1)' }, { name: 'Собрано', color: 'var(--c3)' }], { fmt: UI.fmt0 }), { cls: 'w12', sub: firstNote })}
      ${UI.panel('Таблица', `<div class="scroll"><table><thead><tr><th>${S.by === 'day' ? 'День' : S.by === 'week' ? 'Неделя' : 'Месяц'}</th><th class="n">Продано</th><th class="n">Возвраты</th><th class="n">Собрано денег</th>${S.agent ? '' : agents.map(a => `<th class="n">${esc(a.split(' ')[0])}<br><small>прод. / сбор</small></th>`).join('')}</tr></thead><tbody>${G.slice().reverse().map(g => `<tr><td>${label(g.k)}${g.first ? ' <small class="mut">(с начала периода)</small>' : ''}${S.by !== 'day' ? `<br><small class="mut">загрузок за дни: ${g.n}</small>` : ''}</td><td class="n"><b>${f(g.sold)}</b></td><td class="n">${f(g.ret)}</td><td class="n"><b>${f(g.paid)}</b></td>${S.agent ? '' : agents.map(a => `<td class="n">${f(g.agents[a]?.sold || 0)}<br><small>${f(g.agents[a]?.paid || 0)}</small></td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td><b>Всего</b></td><td class="n"><b>${f(G.reduce((a, g) => a + g.sold, 0))}</b></td><td class="n">${f(G.reduce((a, g) => a + g.ret, 0))}</td><td class="n"><b>${f(G.reduce((a, g) => a + g.paid, 0))}</b></td>${S.agent ? '' : agents.map(() => '<td></td>').join('')}</tr></tfoot></table></div>`, { cls: 'w12', sub: 'Сколько продано и собрано именно за этот день / неделю / месяц — разница между ежедневными загрузками' })}
    </div>`;
  $('#dBy', body).onchange = e => { S.by = e.target.value; EXT_PAGES.rdays(el); };
  $('#repAg', body).onchange = e => { S.agent = e.target.value; EXT_PAGES.rdays(el); };
  $('#rCsv', el).onclick = () => UI.csv(`продажи-и-сбор-${S.by}.csv`, [['Период', 'Продано', 'Возвраты', 'Собрано', ...agents.flatMap(a => [a + ' продано', a + ' собрано'])], ...G.map(g => [label(g.k), Math.round(g.sold), Math.round(g.ret), Math.round(g.paid), ...agents.flatMap(a => [Math.round(g.agents[a]?.sold || 0), Math.round(g.agents[a]?.paid || 0)])])]);
};
