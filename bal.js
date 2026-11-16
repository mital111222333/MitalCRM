// Баланс сейчас (Деньги → Дебиторка → ⚡ Баланс сейчас): the client balance of the plan period exactly as LINKO shows it on
// «Статистика → Клиенты», taken straight from LINKO every 30 seconds by live.js (LIVE.bal), plus a feed of what moved
// since the page was opened: who paid, bought or returned and when. Nothing here is saved or synced — the official
// balance (debts, credit stop, reports) still comes from the 5-minute auto-loader.
window.EXT_PAGES = window.EXT_PAGES || {};

const LBAL = {
  cur: 'USD', q: '', agent: '', only: '', sort: 'b1',
  F: { sold: 'купил', ret: 'вернул', paid: 'оплатил', oin: 'прочий приход', oout: 'прочий расход' },
  money(v, cur) { const s = UI.fmt0(Math.abs(v)); return (v < 0 ? '−' : '') + (cur === 'USD' ? '$' + s : s + ' ' + (cur === 'SUM' ? 'сум' : cur)); },
  hm: v => new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};

EXT_PAGES.lbal = async el => {
  await CRMLocal.ready;
  const L = window.LIVE, B = L?.bal(), m = LBAL.money;
  el.innerHTML = `<div class="page-head"><div><h2>⚡ Баланс клиентов — сейчас</h2><div class="sub">Прямо из LINKO («Статистика → Клиенты»), каждые 30 секунд, пока страница открыта</div></div></div><div id="lbBody"></div>`;
  const body = $('#lbBody', el);
  if (!L || !L.key()) { body.innerHTML = UI.empty('Нет ключа LINKO на этом устройстве', 'Компьютер: откройте LINKO, войдите и нажмите закладку «⚡ В MITAL CRM» (её можно взять на странице <a href="#/up">Загрузить вручную</a>). Телефон: откройте ссылку или QR-код из <a href="#/cloud">Синхронизация и настройки</a>.'); return; }
  if (!B) {
    body.innerHTML = L.balErr() ? UI.empty('LINKO не отдал баланс', esc(L.balErr())) : '<p class="mut">Беру баланс из LINKO…</p>';
    if (!L.balErr()) L.tick();
    return;
  }

  const S = CRMLocal.engine.getState(), agentOf = n => S.ag.clients?.[n]?.agent || 'Без агента';
  // a currency in which every client has only zeros (LINKO sends SUM for everyone) gets no tab
  const curs = [...new Set(B.rows.flatMap(r => Object.entries(r.cur).filter(([, v]) => Object.values(v).some(x => Math.abs(x) >= 0.005)).map(([c]) => c)))].sort((a, b) => (a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b)));
  if (!curs.includes(LBAL.cur)) LBAL.cur = curs[0] || 'USD';
  const C = LBAL.cur, feed = L.feed().filter(f => f.cur === C), hot = new Map();
  for (const f of feed) if (!hot.has(f.name)) hot.set(f.name, f.at);
  const zero = { b0: 0, sold: 0, ret: 0, paid: 0, oin: 0, oout: 0, b1: 0 };
  const all = B.rows.map(r => ({ ...r, agent: agentOf(r.name), v: r.cur[C] || zero }));
  const agents = [...new Set(all.map(r => r.agent))].sort((a, b) => a.localeCompare(b));
  const fit = r => (!LBAL.agent || r.agent === LBAL.agent) && (!LBAL.q || LX.norm(r.name + ' ' + r.no).includes(LX.norm(LBAL.q)))
    && (LBAL.only === 'debt' ? r.v.b1 <= -0.5 : LBAL.only === 'moved' ? hot.has(r.name) : LBAL.only === 'active' ? Math.abs(r.v.sold) + Math.abs(r.v.paid) >= 0.5 : true);
  const SORTS = { b1: (a, b) => a.v.b1 - b.v.b1, paid: (a, b) => b.v.paid - a.v.paid, sold: (a, b) => Math.abs(b.v.sold) - Math.abs(a.v.sold), name: (a, b) => a.name.localeCompare(b.name), hot: (a, b) => (hot.get(b.name) || '').localeCompare(hot.get(a.name) || '') || a.v.b1 - b.v.b1 };
  const list = all.filter(fit).sort(SORTS[LBAL.sort] || SORTS.b1);
  const sum = k => list.reduce((a, r) => a + r.v[k], 0), debt = list.filter(r => r.v.b1 <= -0.5);
  const age = Math.max(0, Math.round((Date.now() - Date.parse(B.at)) / 1000));

  const feedRow = f => `<tr><td>${LBAL.hm(f.at)}</td><td>${LX.cl(f.name)} <small class="mut">№${esc(f.no)}</small></td>
    <td>${Object.entries(f.d).map(([k, v]) => `<span class="${k === 'paid' ? 'pos' : ''}">${LBAL.F[k]} <b>${m(Math.abs(v), f.cur)}</b></span>`).join(' · ')}</td>
    <td class="n">${m(f.was, f.cur)} → <b class="${f.b1 <= -0.5 ? 'neg' : ''}">${m(f.b1, f.cur)}</b></td></tr>`;

  body.innerHTML = `<p class="mut">Период ${UI.dateRu(B.from)} — ${UI.dateRu(B.to)} · проверено ${LBAL.hm(B.at)} (${age < 60 ? age + ' с назад' : Math.round(age / 60) + ' мин назад'})${L.balErr() ? ` · <span class="neg">последняя проверка не удалась: ${esc(L.balErr())}</span>` : ''}</p>
    <div class="kpis">
      ${UI.tile('Долг клиентов', m(-debt.reduce((a, r) => a + r.v.b1, 0), C), { sub: `${debt.length} кл. с долгом`, tone: debt.length ? 'warn' : 'good' })}
      ${UI.tile('Продано за период', m(Math.abs(sum('sold')), C), { sub: `возвраты ${m(Math.abs(sum('ret')), C)}` })}
      ${UI.tile('Оплачено за период', m(sum('paid'), C), { tone: 'good' })}
      ${UI.tile('Изменилось с открытия', String(hot.size), { sub: feed.length ? `последнее в ${LBAL.hm(feed[0].at)}` : 'пока ничего нового' })}</div>
    ${feed.length ? UI.panel('Только что в LINKO', LX.table(['Время', 'Клиент', 'Что произошло', '#Баланс'], feed.slice(0, 50).map(feedRow), { max: '260px' })) : ''}
    <div class="bar" style="flex-wrap:wrap">
      ${curs.length > 1 ? `<nav class="tabs">${curs.map(c => `<a href="#" data-lbcur="${esc(c)}" class="${c === C ? 'on' : ''}">${c === 'SUM' ? 'Сум' : esc(c)}</a>`).join('')}</nav>` : ''}
      <select id="lbOnly" aria-label="Показать">${[['', 'Все клиенты'], ['debt', 'С долгом'], ['active', 'Брали или платили'], ['moved', 'Изменились сейчас']].map(([v, n]) => `<option value="${v}" ${LBAL.only === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="lbAg" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === LBAL.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select id="lbSort" aria-label="Сортировка">${[['b1', 'Сначала большой долг'], ['hot', 'Сначала изменившиеся'], ['paid', 'Больше оплатили'], ['sold', 'Больше купили'], ['name', 'По имени']].map(([v, n]) => `<option value="${v}" ${LBAL.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input id="lbQ" placeholder="Клиент или №" value="${esc(LBAL.q)}" style="min-width:160px">
      <span class="spacer" style="flex:1"></span><span class="mut">${list.length} из ${all.length}</span><button class="btn gray sm" id="lbXls" type="button">⬇ Excel</button></div>
    ${list.length ? LX.table(['№', 'Клиент', 'Агент', '#На начало', '#Продано', '#Возврат', '#Оплачено', '#Прочие +', '#Прочие −', '#Баланс сейчас'], list.slice(0, 600).map(r => { const v = r.v, h = hot.has(r.name);
      return `<tr${h ? ' style="background:color-mix(in srgb, var(--good,#3fbf73) 10%, transparent)"' : ''}><td>${esc(r.no)}</td><td>${LX.cl(r.name)}${h ? ` <small class="pos">● ${LBAL.hm(hot.get(r.name)).slice(0, 5)}</small>` : ''}</td><td>${esc(r.agent)}</td>
        <td class="n">${m(v.b0, C)}</td><td class="n">${v.sold ? m(Math.abs(v.sold), C) : '—'}</td><td class="n">${v.ret ? m(Math.abs(v.ret), C) : '—'}</td><td class="n">${v.paid ? `<span class="pos">${m(v.paid, C)}</span>` : '—'}</td>
        <td class="n">${v.oin ? m(v.oin, C) : '—'}</td><td class="n">${v.oout ? m(Math.abs(v.oout), C) : '—'}</td><td class="n"><b class="${v.b1 <= -0.5 ? 'neg' : ''}">${Math.abs(v.b1) < 0.5 ? '0' : m(v.b1, C)}</b></td></tr>`; }), { max: '70vh' })
      : UI.empty('Никого не найдено', 'Измените фильтр.')}
    <p class="mut">Это те же цифры, что в LINKO на странице «Статистика → Клиенты» за период плана. Минус в балансе — клиент должен. Долги, кредитный стоп и отчёты по-прежнему считаются по официальной выгрузке раз в 5 минут; эта страница — чтобы видеть оплаты и покупки сразу.</p>`;

  const redraw = () => EXT_PAGES.lbal(el);
  body.querySelectorAll('[data-lbcur]').forEach(a => a.onclick = e => { e.preventDefault(); LBAL.cur = a.dataset.lbcur; redraw(); });
  $('#lbOnly', body).onchange = e => { LBAL.only = e.target.value; redraw(); };
  $('#lbAg', body).onchange = e => { LBAL.agent = e.target.value; redraw(); };
  $('#lbSort', body).onchange = e => { LBAL.sort = e.target.value; redraw(); };
  $('#lbQ', body).onchange = e => { LBAL.q = e.target.value.trim(); redraw(); };
  $('#lbXls', body).onclick = () => UI.csv('баланс-сейчас-' + B.to, [['№', 'Клиент', 'Агент', 'Валюта', 'На начало', 'Продано', 'Возврат', 'Оплачено', 'Прочие приходы', 'Прочие расходы', 'Баланс сейчас'],
    ...list.map(r => [r.no, r.name, r.agent, C, r.v.b0, r.v.sold, r.v.ret, r.v.paid, r.v.oin, r.v.oout, r.v.b1])]);
};
