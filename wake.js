// Возврат спящих (Агенты → Возврат спящих): sleeping clients handed to agents («Спящие клиенты» → «Дать задание») and whether
// they bought again within the window (14 days by default). A purchase counts when LINKO has an order of the client after the
// moment it was handed out, or a «Баланс клиентов» snapshot taken on a later day shows its sales growing.
// Stored in the synced state: ext.wake = { days: 14, list: [{ client, agent, at: ISO time, buyDays, debt }] }.
window.EXT_PAGES = window.EXT_PAGES || {};

const WK = {
  view: 'all', agent: '',
  cfg() { const x = CRMLocal.ext(); return (x.wake ||= { days: 14, list: [] }); },
  // called by «Спящие клиенты» when tasks are given: one record per client (a client handed out again starts over)
  give(clients) {
    const c = WK.cfg(), at = new Date().toISOString();
    for (const k of clients) {
      c.list = c.list.filter(x => !(x.client === k.name && WK.status(x).st !== 'back'));
      c.list.push({ client: k.name, agent: k.agent || 'Без агента', at, buyDays: k.buyDays ?? null, debt: Math.round(k.debt || 0) });
    }
    CRMLocal.touch();
  },
  // first purchase after the hand-out: LINKO orders (exact time), else the balance snapshots (by day)
  firstBuy(rec) {
    const t = Date.parse(rec.at), day = UI.localDate(t);
    let best = null;
    try {
      if (LX.has()) for (const o of LX.model().ords) {
        if (o.client !== rec.client || !(o.sum > 0)) continue;
        const ts = Date.parse(o.date + 'T' + (o.time || '00:00') + ':00');
        if (ts > t && (!best || o.date < best.date)) best = { date: o.date, sum: o.sum, src: 'заказ LINKO' };
      }
    } catch { /* no LINKO data */ }
    const ups = (CRMLocal.engine.getState().ag.uploads || []).slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const prev = new Map();
    for (const u of ups) for (const r of u.rows || []) {
      if (r.client !== rec.client) continue;
      const p = prev.get(u.period_from) ?? 0;
      if (u.taken_at > day && r.sold > p + 0.005 && (!best || u.taken_at < best.date)) best = { date: u.taken_at, sum: r.sold - p, src: 'баланс' };
      prev.set(u.period_from, r.sold);
    }
    return best;
  },
  status(rec) {
    const days = Number(WK.cfg().days) || 14, end = UI.localDate(Date.parse(rec.at) + days * 864e5), buy = WK.firstBuy(rec);
    if (buy && buy.date <= end) return { st: 'back', buy, end };
    return { st: UI.localDate(Date.now()) > end ? 'fail' : 'wait', buy: null, end, late: buy };
  },
};

EXT_PAGES.wake = async el => {
  await CRMLocal.ready; await LX.load();
  const c = WK.cfg(), f = UI.fmt0, t0 = UI.localDate(Date.now());
  const R = c.list.map(r => ({ ...r, ...WK.status(r) }));
  const agents = [...new Set(R.map(r => r.agent))].sort((a, b) => a.localeCompare(b));
  const by = agents.map(a => {
    const m = R.filter(r => r.agent === a), back = m.filter(r => r.st === 'back'), done = m.filter(r => r.st !== 'wait');
    return { agent: a, given: m.length, back: back.length, wait: m.length - done.length, fail: m.filter(r => r.st === 'fail').length, rate: done.length ? back.length / done.length : null, sum: back.reduce((s, r) => s + (r.buy.sum || 0), 0) };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.back - a.back);
  const ST = { back: ['good', '✓ вернулся'], wait: ['info', 'ждём'], fail: ['crit', 'не вернулся'] };
  const list = R.filter(r => (WK.view === 'all' || r.st === WK.view) && (!WK.agent || r.agent === WK.agent)).sort((a, b) => (a.st === 'wait') - (b.st === 'wait') || b.at.localeCompare(a.at));
  const back = R.filter(r => r.st === 'back'), closed = R.filter(r => r.st !== 'wait');
  el.innerHTML = `<div class="page-head"><div><h2>Возврат спящих</h2><div class="sub">Клиенты, которых дали агентам вернуть (<a href="#/rsleep">Отчёты → Спящие клиенты</a> → «Дать задание»). Вернулся — купил в течение ${Number(c.days) || 14} дней после выдачи.</div></div></div>
    ${R.length ? `<div class="kpis">${UI.tile('Выдано агентам', f(R.length), { sub: 'спящих клиентов' })}
    ${UI.tile('Вернулись', f(back.length), { sub: closed.length ? `${UI.pct(back.length, closed.length)}% из завершённых` : 'пока никто', tone: back.length ? 'good' : '' })}
    ${UI.tile('Купили на', '$' + f(back.reduce((s, r) => s + (r.buy.sum || 0), 0)), { sub: 'первая покупка после возврата' })}
    ${UI.tile('Ещё ждём', f(R.filter(r => r.st === 'wait').length), { sub: 'срок не вышел' })}</div>
    <div class="bar"><label class="mut">Срок на возврат, дней <input id="wkDays" type="number" min="3" max="60" value="${Number(c.days) || 14}" style="width:60px"></label></div>
    <div class="grid">
    ${UI.panel('Агенты: кто лучше возвращает', LX.table(['Агент', '#Выдано', '#Вернулись', '#Не вернулись', '#Ждём', '#Результат', '#Купили на'], by.map(a => `<tr><td>${LX.ag(a.agent)}</td><td class="n">${f(a.given)}</td><td class="n"><b>${f(a.back)}</b></td><td class="n">${f(a.fail)}</td><td class="n">${f(a.wait)}</td><td class="n">${a.rate === null ? '—' : Math.round(a.rate * 100) + '%'}</td><td class="n">$${f(a.sum)}</td></tr>`)), { cls: 'w12', sub: '«Результат» — доля вернувшихся среди тех, по кому срок уже вышел или кто уже купил' })}
    ${UI.panel('Клиенты', `<div class="bar"><select id="wkV" aria-label="Статус">${[['all', 'Все'], ['wait', 'Ждём'], ['back', 'Вернулись'], ['fail', 'Не вернулись']].map(([k, n]) => `<option value="${k}" ${WK.view === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="wkA" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === WK.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><span class="spacer"></span><button class="btn gray needs-edit" id="wkClr">Убрать завершённые</button></div>
      ${LX.table(['Клиент', 'Агент', 'Выдан', '#Спал, дн.', '#Долг', 'Срок до', 'Статус', 'Покупка'], list.map(r => `<tr><td>${LX.cl(r.client)}</td><td>${LX.ag(r.agent)}</td><td>${UI.dateRu(UI.localDate(Date.parse(r.at)))}</td><td class="n">${r.buyDays ?? '—'}</td><td class="n">$${f(r.debt)}</td><td>${UI.dateRu(r.end)}${r.st === 'wait' ? ` <small class="mut">· ${Math.max(0, Math.round((Date.parse(r.end) - Date.parse(t0)) / 864e5))} дн.</small>` : ''}</td><td>${UI.pill(ST[r.st][0], ST[r.st][1])}</td><td>${r.buy ? `${UI.dateRu(r.buy.date)} · $${f(r.buy.sum)} <small class="mut">(${r.buy.src})</small>` : r.late ? `<small class="mut">купил позже срока: ${UI.dateRu(r.late.date)}</small>` : ''}</td></tr>`), { max: '560px' })}`, { cls: 'w12' })}
    </div>` : UI.empty('Пока никого не выдали', 'Откройте <a href="#/rsleep">Отчёты → Спящие клиенты</a>, отметьте клиентов и нажмите «Дать задание» — они появятся здесь, и CRM сама отметит, кто вернулся.')}`;
  if (!R.length) return;
  $('#wkDays', el).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 3 && v <= 60)) { e.target.value = Number(c.days) || 14; return toast('Срок: от 3 до 60 дней'); } c.days = v; CRMLocal.touch(); EXT_PAGES.wake(el); };
  $('#wkV', el).onchange = e => { WK.view = e.target.value; EXT_PAGES.wake(el); };
  $('#wkA', el).onchange = e => { WK.agent = e.target.value; EXT_PAGES.wake(el); };
  $('#wkClr', el).onclick = () => { const n = R.filter(r => r.st !== 'wait').length; if (!n) return toast('Завершённых нет'); if (!confirm(`Убрать из списка ${n} завершённых (вернулись и не вернулись)? Итоги по агентам тоже обнулятся.`)) return; c.list = c.list.filter(r => WK.status(r).st === 'wait'); CRMLocal.touch(); EXT_PAGES.wake(el); };
};
