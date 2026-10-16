// Долги прошлого периода: after the plan period closes (on the 16th) — which agent did not reach the sales plan and the
// collection plan (Пул), and exactly which clients still owe how much of their Пул. During the first week of the new period
// the page follows how much of that list is collected; after the 7th day it shows the result (итоги).
// Everything comes from the client balance snapshots (ag.uploads) and the per-client plans of each period (ext.clientPlans).
window.EXT_PAGES = window.EXT_PAGES || {};

const DOLG = {
  agent: '', period: '', show: 'left',
  WEEK: 7,
  next(day) { return UI.localDate(Date.parse(day + 'T12:00:00') + 864e5); },
  plus(day, n) { return UI.localDate(Date.parse(day + 'T12:00:00') + n * 864e5); },
  // last balance snapshot of a plan period, optionally not later than a day
  lastUp(from, upTo = '9999-12-31') {
    return (CRMLocal.engine.getState().ag.uploads || []).filter(u => u.period_from === from && u.taken_at <= upTo)
      .sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0] || null;
  },
  // plan periods that have balance data, newest first
  periods() { return [...new Set((CRMLocal.engine.getState().ag.uploads || []).map(u => u.period_from))].sort().reverse(); },

  build(from) {
    const S = CRMLocal.engine.getState(), x = CRMLocal.ext(), today = UI.localDate(Date.now());
    const end = PLAN.end(from), closed = end < today, fin = DOLG.lastUp(from);
    if (!fin) return null;
    const PP = (x.clientPlans || {})[from] || null;
    const nFrom = DOLG.next(end), wEnd = DOLG.plus(nFrom, DOLG.WEEK - 1);
    const weekUp = closed ? DOLG.lastUp(nFrom, wEnd) : null, nowUp = closed ? DOLG.lastUp(nFrom) : null;
    const paidIn = up => new Map((up?.rows || []).map(r => [r.client, r.paid || 0]));
    const wk = paidIn(weekUp), now = paidIn(nowUp);
    const latest = (S.ag.uploads || []).slice().sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0], debtNow = new Map((latest?.rows || []).map(r => [r.client, r.b1 || 0]));
    const clients = fin.rows.map(r => {
      const c = S.ag.clients[r.client] || {}, pp = PP ? PP[r.client] : null;
      const plan = pp ? pp.plan || 0 : (from === PLAN.from(today) ? c.plan || 0 : 0), pool = pp ? pp.pool || 0 : (from === PLAN.from(today) ? c.pool || 0 : 0);
      const owe = Math.max(0, pool - (r.paid || 0)), w = Math.min(owe, wk.get(r.client) || 0), n = Math.min(owe, now.get(r.client) || 0);
      return { name: r.client, agent: r.agent || c.agent || 'Без агента', phone: c.phone || '', landmark: c.landmark || '', plan, sold: r.sold || 0, pool, paid: r.paid || 0, b1: debtNow.has(r.client) ? debtNow.get(r.client) : latest ? null : r.b1 || 0, owe, week: w, now: n, debtEnd: (r.b1 || 0) < 0 ? -r.b1 : 0, pool0: pp && pp.pool0 != null ? pp.pool0 : null };
    });
    const agents = new Map();
    for (const c of clients) {
      const a = agents.get(c.agent) || { agent: c.agent, plan: 0, sold: 0, pool: 0, paid: 0, owe: 0, debtors: 0, week: 0, now: 0 };
      a.plan += c.plan; a.sold += c.sold; a.pool += c.pool; a.paid += c.paid; a.owe += c.owe; a.week += c.week; a.now += c.now; if (c.owe > 0.005) a.debtors++;
      agents.set(c.agent, a);
    }
    const stage = !closed ? 'open' : today <= wEnd ? 'week' : 'done';
    return { from, end, closed, fin, nFrom, wEnd, weekUp, nowUp, stage, hasPlans: !!PP, clients, agents: [...agents.values()].filter(a => a.pool > 0 || a.plan > 0).sort((a, b) => b.owe - a.owe) };
  },

  // text for one agent (Telegram / copy)
  text(D, agent) {
    const f = UI.fmt0, a = D.agents.find(x => x.agent === agent); if (!a) return '';
    const list = D.clients.filter(c => c.agent === agent && c.owe > 0.005).sort((x, y) => (y.owe - y.week) - (x.owe - x.week));
    const L = [`<b>${esc(agent)}</b> — долги за период ${UI.dm(D.from)}–${UI.dm(D.end)}`,
      `План продаж: $${f(a.plan)} · продано $${f(a.sold)}${a.plan ? ` (${UI.pct(a.sold, a.plan)}%)` : ''}`,
      `План сбора: $${f(a.pool)} · собрано $${f(a.paid)}${a.pool ? ` (${UI.pct(a.paid, a.pool)}%)` : ''}`,
      `Не собрано у клиентов: <b>$${f(a.owe)}</b>${D.closed ? ` · собрано с ${UI.dm(D.nFrom)}: $${f(D.stage === 'done' ? a.week : a.now)}` : ''}`,
      D.closed ? `Собрать до ${UI.dateRu(D.wEnd)}:` : 'Кто недоплатил:'];
    list.forEach((c, i) => { const left = c.owe - (D.stage === 'done' ? c.week : c.now); L.push(`${i + 1}. ${esc(c.name)} — ${left <= 0.005 ? '✅ собрано' : `<b>$${f(left)}</b>${left < c.owe - 0.005 ? ` (из $${f(c.owe)})` : ''}`}`); });
    return L.join('\n');
  },
};

EXT_PAGES.debtprev = async el => {
  await CRMLocal.ready; if (typeof LX !== 'undefined') await LX.load();
  const f = UI.fmt0, today = UI.localDate(Date.now()), pers = DOLG.periods();
  // default: the last closed period (the one to collect now); before any period has closed — the current one
  if (!DOLG.period || !pers.includes(DOLG.period)) DOLG.period = pers.find(p => PLAN.end(p) < today) || pers[0] || '';
  const head = `<div class="page-head"><div><h2>Долги прошлого периода</h2><div class="sub">Недобор по плану продаж и сбора — и кто из клиентов сколько недоплатил</div></div>
    <div class="actions no-print"><button class="btn gray" id="dCsv">⬇ Excel (CSV)</button><button class="btn gray" id="dPrint">Печать / PDF</button></div></div><div id="dBody"></div>`;
  el.innerHTML = head; const body = $('#dBody', el);
  const D = DOLG.period ? DOLG.build(DOLG.period) : null;
  if (!D) { body.innerHTML = UI.empty('Данных пока нет', 'Нужен баланс клиентов из LINKO за период плана (он загружается автоматически).'); return; }
  const A = D.agents.filter(a => !DOLG.agent || a.agent === DOLG.agent), T = A.reduce((s, a) => { for (const k of ['plan', 'sold', 'pool', 'paid', 'owe', 'week', 'now', 'debtors']) s[k] = (s[k] || 0) + a[k]; return s; }, {});
  const got = c => (D.stage === 'done' ? c.week : c.now), left = c => Math.max(0, c.owe - got(c));
  const list = D.clients.filter(c => c.owe > 0.005 && (!DOLG.agent || c.agent === DOLG.agent))
    .filter(c => DOLG.show === 'all' || (DOLG.show === 'left' ? left(c) > 0.005 : left(c) <= 0.005))
    .sort((a, b) => a.agent.localeCompare(b.agent) || left(b) - left(a) || b.owe - a.owe);
  const gotT = D.stage === 'done' ? T.week : T.now, daysLeft = Math.max(0, Math.round((Date.parse(D.wEnd) - Date.parse(today)) / 864e5) + 1);
  const stageTxt = D.stage === 'open' ? UI.pill('info', `период ещё идёт — до ${UI.dateRu(D.end)}`) : D.stage === 'week' ? UI.pill('warn', `первая неделя: сбор до ${UI.dateRu(D.wEnd)} · осталось ${daysLeft} дн.`) : UI.pill('good', `итоги первой недели (${UI.dm(D.nFrom)}–${UI.dm(D.wEnd)})`);
  const chats = (window.TG && TG.conf().chats) || {};
  body.innerHTML = `<div class="bar"><select id="dPer" aria-label="Период">${DOLG.periods().map(p => `<option value="${p}" ${p === D.from ? 'selected' : ''}>${PLAN.label(p)}${PLAN.end(p) >= today ? ' (идёт)' : ''}</option>`).join('')}</select>
      <select id="dAg" aria-label="Агент"><option value="">Все агенты</option>${D.agents.map(a => `<option ${a.agent === DOLG.agent ? 'selected' : ''}>${esc(a.agent)}</option>`).join('')}</select> ${stageTxt}</div>
    ${!D.hasPlans && D.from !== PLAN.from(today) ? `<p class="mut">На этот период не загружен файл плана (План/Пул по клиентам), поэтому недобор посчитать нельзя.</p>` : ''}
    <div class="kpis">
      ${UI.tile('План продаж', '$' + f(T.plan || 0), { sub: `продано $${f(T.sold || 0)} · ${UI.pct(T.sold, T.plan) ?? 0}% · не хватило $${f(Math.max(0, (T.plan || 0) - (T.sold || 0)))}` })}
      ${UI.tile('План сбора (пул)', '$' + f(T.pool || 0), { sub: `собрано $${f(T.paid || 0)} · ${UI.pct(T.paid, T.pool) ?? 0}%` })}
      ${UI.tile('Недоплатили клиенты', '$' + f(T.owe || 0), { sub: `${T.debtors || 0} клиентов`, tone: T.owe ? 'warn' : 'good' })}
      ${D.closed ? UI.tile(D.stage === 'done' ? 'Собрано за 1-ю неделю' : `Собрано с ${UI.dm(D.nFrom)}`, '$' + f(gotT), { sub: `${UI.pct(gotT, T.owe) ?? 0}% · осталось $${f(Math.max(0, (T.owe || 0) - gotT))}`, tone: T.owe && gotT >= T.owe - 0.005 ? 'good' : '' }) : UI.tile('Сбор начнётся', UI.dm(D.nFrom), { sub: `первая неделя: ${UI.dm(D.nFrom)}–${UI.dm(D.wEnd)}` })}
    </div>
    <div class="grid">
    ${UI.panel('По агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th class="n">План продаж</th><th class="n">Продано</th><th class="n">%</th><th class="n">План сбора</th><th class="n">Собрано</th><th class="n">%</th><th class="n">Недоплатили</th><th class="n">Клиентов</th>${D.closed ? `<th class="n">Собрано с ${UI.dm(D.nFrom)}</th><th class="n">Осталось</th>` : ''}<th></th></tr></thead><tbody>
      ${A.map(a => { const g = D.stage === 'done' ? a.week : a.now; return `<tr><td><a href="#" data-ag="${esc(a.agent)}">${esc(a.agent)}</a></td><td class="n">${f(a.plan)}</td><td class="n">${f(a.sold)}</td><td class="n">${a.plan ? UI.pill(a.sold >= a.plan ? 'good' : 'warn', (UI.pct(a.sold, a.plan) ?? 0) + '%') : '—'}</td><td class="n">${f(a.pool)}</td><td class="n">${f(a.paid)}</td><td class="n">${a.pool ? UI.pill(a.paid >= a.pool ? 'good' : 'warn', (UI.pct(a.paid, a.pool) ?? 0) + '%') : '—'}</td><td class="n"><b>${f(a.owe)}</b></td><td class="n">${a.debtors}</td>${D.closed ? `<td class="n pos">${f(g)}</td><td class="n"><b>${f(Math.max(0, a.owe - g))}</b>${a.owe ? ` <small class="mut">${UI.pct(g, a.owe) ?? 0}%</small>` : ''}</td>` : ''}<td class="no-print">${chats[a.agent] ? `<button class="btn gray" data-tg="${esc(a.agent)}" title="Отправить агенту его список в Telegram">✈ Агенту</button>` : `<button class="btn gray" data-cp="${esc(a.agent)}" title="Скопировать список для агента">📋</button>`}</td></tr>`; }).join('')}
      </tbody></table></div><p class="mut" style="margin:10px 0 0">«Недоплатили» — сумма по клиентам, которые оплатили меньше своего Пула. Она может быть больше, чем «план сбора − собрано»: клиенты, которые заплатили сверх Пула, долг других не закрывают.</p>`, { cls: 'w12' })}
    ${UI.panel(`Кто недоплатил (${list.length})`, `<div class="bar no-print"><select id="dShow" aria-label="Показать"><option value="left" ${DOLG.show === 'left' ? 'selected' : ''}>Ещё не собрано</option><option value="done" ${DOLG.show === 'done' ? 'selected' : ''}>Уже собрано</option><option value="all" ${DOLG.show === 'all' ? 'selected' : ''}>Все</option></select><span id="dgInfo" class="mut"></span><span class="spacer"></span><button class="btn gray sm" id="dgReset" style="display:none">✕ Снять все фильтры</button></div>
      ${list.length ? `<div class="xg-wrap" id="dgW" style="height:auto;max-height:calc(100vh - 160px)"></div>
      <p class="mut no-print" style="margin:8px 0 0;font-size:12px">Нажмите на название столбца — фильтр и сортировка, как в Excel. Нажмите на ячейку <b>Пул, Осталось собрать, Ещё оплатит, Заметка</b> — правка прямо в таблице (<b>Enter</b> — сохранить и вниз, <b>Tab</b> — вправо, <b>Esc</b> — отмена). Если поменять «Осталось собрать», Пул клиента за прошлый период пересчитается сам (оплатил + собрано с 16-го + осталось); изменённый Пул отмечен «было …». Нажмите на имя клиента — откроется его карточка. «Посл. заказ» и «Сумма заказов» — за прошлый период; если заказов несколько, нажмите на ячейку — откроется список всех заказов с датами и суммами. «Ещё оплатит» и «Заметка» — те же, что в Деньги → Аналитика.</p>` : `<p class="mut">${DOLG.show === 'left' ? 'Все долги по Пулу собраны 👍' : 'Пусто.'}</p>`}`, { cls: 'w12', sub: D.closed ? `«Собрано с ${UI.dm(D.nFrom)}» — оплаты клиента в новом периоде (по балансу LINKO), не больше его недоплаты.${D.stage === 'done' ? ` Итоги — по данным на ${UI.dateRu(D.weekUp?.taken_at || D.wEnd)}.` : ''}` : `Предварительно: период закроется ${UI.dateRu(D.end)}, 16-го список станет окончательным.` })}
    </div>`;
  const re = () => EXT_PAGES.debtprev(el);
  $('#dPer', body).onchange = e => { DOLG.period = e.target.value; re(); };
  $('#dAg', body).onchange = e => { DOLG.agent = e.target.value; re(); };
  $('#dShow', body).onchange = e => { DOLG.show = e.target.value; re(); };
  if (list.length) DOLG.grid($('#dgW', body), body, D, list, got, left, re);
  body.querySelectorAll('[data-ag]').forEach(a => a.onclick = e => { e.preventDefault(); DOLG.agent = a.dataset.ag; re(); });
  body.querySelectorAll('[data-cp]').forEach(b => b.onclick = async () => { const t = DOLG.text(D, b.dataset.cp).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); try { await navigator.clipboard.writeText(t); toast('Список скопирован — вставьте агенту'); } catch { prompt('Скопируйте текст', t); } });
  body.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { const n = b.dataset.tg; if (!confirm(`Отправить ${n} его список должников в Telegram?`)) return; try { await TG.send(TG.conf().chats[n].id, DOLG.text(D, n)); toast('Отправлено'); } catch (e) { toast(e.message); } });
  $('#dPrint', el).onclick = () => print();
  const ORD = DOLG.orders(D);
  $('#dCsv', el).onclick = () => UI.csv('долги-' + D.from, [['Клиент', 'Агент', 'План продаж', 'Продано', 'Пул', 'Оплатил за период', 'Недоплатил', 'Собрано с ' + D.nFrom, 'Осталось собрать', 'Долг сейчас', 'Заказы за период (дата - сумма)', 'Сумма заказов', 'Ещё оплатит (дата - сумма)', 'Заметка', 'Телефон'],
    ...D.clients.filter(c => c.owe > 0.005 && (!DOLG.agent || c.agent === DOLG.agent)).map(c => [c.name, c.agent, c.plan, c.sold, c.pool, c.paid, Math.round(c.owe * 100) / 100, Math.round(got(c) * 100) / 100, Math.round(left(c) * 100) / 100, c.b1 < 0 ? -c.b1 : 0, (ORD.get(c.name) || []).map(x => UI.dm(x.d) + ' - ' + Math.round(x.s) + '$').join(', '), Math.round((ORD.get(c.name) || []).reduce((a, x) => a + x.s, 0)), PAYPLAN.of(c.name).map(x => UI.dm(x.d) + ' - ' + Math.round(x.s) + '$').join(', '), CRMLocal.engine.getState().ag.clients[c.name]?.note || '', c.phone])]);
};

// ---------- «Кто недоплатил» as an Excel-like grid (same look and filters as Деньги → Аналитика) ----------
DOLG.f = {}; DOLG.sort = { k: '', dir: -1 }; DOLG.sel = ''; DOLG.keep = null;
// Пул of a client in a plan period: the current period goes through the normal client edit (it also updates the client),
// a closed period is changed in its saved plan; the first uploaded value is kept as pool0 («было»)
DOLG.savePool = async (D, c, v) => {
  const x = CRMLocal.ext(), cur = D.from === PLAN.from(UI.localDate(Date.now()));
  const PP0 = (x.clientPlans || {})[D.from], e0 = PP0 && PP0[c.name], first = e0 && e0.pool0 != null ? e0.pool0 : c.pool;
  if (cur && CRMLocal.engine.getState().ag.clients[c.name]) {
    const r = await api('/api/ag/client', { method: 'POST', body: { name: c.name, pool: v } }); if (r.error) { toast(r.error); return false; }
  } else {
    x.clientPlans ||= {}; const PP = (x.clientPlans[D.from] ||= {}); (PP[c.name] ||= { plan: c.plan || 0, pool: 0 }).pool = v;
  }
  const e = (CRMLocal.ext().clientPlans || {})[D.from]?.[c.name];
  if (e) { if (Math.abs(first - v) < 0.005) delete e.pool0; else e.pool0 = first; }
  CRMLocal.touch(); return true;
};
DOLG.saveNote = async (name, note) => {
  const r = await api('/api/ag/client', { method: 'POST', body: { name, note } }); if (r.error) { toast(r.error); return false; } return true;
};

DOLG.grid = (wrap, body, D, list, got, left, re) => {
  injectGridCss();
  const f = UI.fmt0, S = DOLG, EMPTY = '(Пустые)', t0 = UI.localDate(Date.now()), St = CRMLocal.engine.getState();
  const note = c => St.ag.clients[c.name]?.note || '';
  const ORD = DOLG.orders(D), ordOf = c => ORD.get(c.name) || [];
    const sum0 = c => PAYPLAN.of(c.name).reduce((a, x) => a + x.s, 0);
  const debtNow = c => (c.b1 == null ? null : c.b1 < 0 ? -c.b1 : 0);
  const kNum = (col, fmt = f) => c => { const v = col.v(c); return v === null ? [[EMPTY, -Infinity]] : [[fmt(v), v]]; };
  const kText = col => c => { const v = String(col.v(c) ?? '').trim(); return v ? [[v, v.toLowerCase()]] : [[EMPTY, '']]; };
  const COLS = [
    { k: 'name', t: 'Клиент', kind: 'text', v: c => c.name, cell: c => `<a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${c.landmark ? `<br><small class="mut">${esc(c.landmark)}</small>` : ''}` },
    { k: 'agent', t: 'Агент', kind: 'text', v: c => c.agent, cell: c => `<a class="clink" data-agent="${esc(c.agent)}">${esc(c.agent)}</a>` },
    { k: 'pool', t: 'Пул', kind: 'num', v: c => c.pool || 0, tot: true, edit: 'pool', cell: c => `${f(c.pool)}${c.pool0 != null ? `<br><small class="mut" title="Пул из файла плана">было ${f(c.pool0)}</small>` : ''}` },
    { k: 'paid', t: 'Оплатил за период', kind: 'num', v: c => c.paid || 0, tot: true, cell: c => f(c.paid) },
    { k: 'owe', t: 'Недоплатил', kind: 'num', v: c => c.owe, tot: true, cell: c => `<b>${f(c.owe)}</b>` },
    ...(D.closed ? [
      { k: 'got', t: `Собрано с ${UI.dm(D.nFrom)}`, kind: 'num', v: c => got(c), tot: true, cell: c => (got(c) ? `<span class="pos">${f(got(c))}</span>` : '<span class="ph">—</span>') },
      { k: 'left', t: 'Осталось собрать', kind: 'num', v: c => left(c), tot: true, edit: 'left', cell: c => (left(c) > 0.005 ? `<b class="neg">${f(left(c))}</b>` : UI.pill('good', 'собрано', '✓')) },
    ] : []),
    { k: 'debt', t: 'Долг сейчас', kind: 'num', v: debtNow, tot: true, cell: c => { const v = debtNow(c); return v == null ? '<span class="ph">нет данных</span>' : v ? `<b>${f(v)}</b>` : UI.pill('good', '0', '✓'); } },
    { k: 'ord', t: 'Посл. заказ', kind: 'num', v: c => (ordOf(c).length ? REP.days(ordOf(c).at(-1).d, t0) : null), kfmt: v => `${v} дн. назад`, pop: true,
      cell: c => { const o = ordOf(c); if (!o.length) return '<span class="neg" title="За период заказов не было">нет</span>'; const l = o.at(-1), n = REP.days(l.d, t0); return `${UI.dm(l.d)}<small class="mut"> · ${n} дн.</small>`; } },
    { k: 'ordSum', t: 'Сумма заказов', kind: 'num', v: c => (ordOf(c).length ? ordOf(c).reduce((a, x) => a + x.s, 0) : null), tot: true, pop: true,
      cell: c => { const o = ordOf(c); if (!o.length) return '<span class="ph">—</span>'; const t = o.reduce((a, x) => a + x.s, 0); return o.length === 1 ? f(t) : `<b>${f(t)}</b><br><small class="mut">${o.length} ${UI.plural(o.length, 'заказ', 'заказа', 'заказов')} · посл. $${f(o.at(-1).s)}</small>`; } },
    { k: 'tot', t: 'Ещё оплатит', kind: 'num', v: c => sum0(c) || null, vt: c => sum0(c), tot: true, edit: 'pay',
      cell: c => { const pl = PAYPLAN.of(c.name); return pl.length ? pl.map(x => `<div>$${f(x.s)}</div>`).join('') + (pl.length > 1 ? `<b>Σ $${f(sum0(c))}</b>` : '') : '<span class="ph">＋</span>'; } },
    { k: 'note', t: 'Заметка', kind: 'text', v: note, edit: 'note', cell: c => (note(c) ? `<small>${esc(note(c))}</small>` : '<span class="ph">＋</span>') },
  ];
  for (const col of COLS) if (!col.keys) col.keys = col.kind === 'num' ? kNum(col, col.kfmt || f) : kText(col);
  const EDIT = COLS.filter(c => c.edit);

  // ----- filters (Excel autofilter: ticked values and/or a condition) -----
  const parseN = x => { const n = Number(String(x ?? '').replace(/[\s']/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const TXT_OPS = [['eq', 'Равно'], ['ne', 'Не равно'], ['sw', 'Начинается с'], ['has', 'Содержит'], ['nhas', 'Не содержит']];
  const NUM_OPS = [['eq', 'Равно'], ['gt', 'Больше'], ['ge', 'Больше или равно'], ['lt', 'Меньше'], ['le', 'Меньше или равно'], ['bw', 'Между'], ['empty', 'Пусто'], ['nonempty', 'Не пусто']];
  for (const k of Object.keys(S.f)) if (!COLS.some(c => c.k === k)) delete S.f[k];
  const passCond = (col, c, cd) => {
    if (col.kind !== 'num') { const v = String(col.v(c) ?? '').toLowerCase(), a = String(cd.a ?? '').toLowerCase(); return { eq: v === a, ne: v !== a, sw: v.startsWith(a), has: v.includes(a), nhas: !v.includes(a) }[cd.op] ?? true; }
    const v = col.v(c), a = parseN(cd.a), b = parseN(cd.b);
    if (cd.op === 'empty') return v === null; if (cd.op === 'nonempty') return v !== null; if (v === null) return false;
    return { eq: Math.abs(v - a) < 0.005, gt: v > a, ge: v >= a, lt: v < a, le: v <= a, bw: v >= Math.min(a, b) && v <= Math.max(a, b) }[cd.op] ?? true;
  };
  const compile = () => COLS.map(col => { const st = S.f[col.k]; return st ? { col, sel: st.sel ? new Set(st.sel) : null, cond: st.cond || null } : null; }).filter(Boolean);
  const rowPass = (c, flt, skip) => flt.every(x => x.col.k === skip || ((!x.sel || x.col.keys(c).some(([k]) => x.sel.has(k))) && (!x.cond || passCond(x.col, c, x.cond))));
  const view = () => {
    const flt = compile(), rows = list.filter(c => rowPass(c, flt)), sc = COLS.find(x => x.k === S.sort.k);
    if (sc) { const val = c => (sc.sv ? sc.sv(c) : sc.v(c)); rows.sort((a, b) => { const x = val(a), y = val(b); if (x === y) return 0; if (x === null) return 1; if (y === null) return -1; return (typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y) * S.sort.dir; }); }
    return rows;
  };

  wrap.innerHTML = `<table class="xg"><thead><tr><th class="rn" style="cursor:default">№</th>${COLS.map((col, i) => `<th class="${i === 0 ? 'c1' : ''} ${col.kind === 'num' ? 'n' : ''}" data-k="${col.k}" title="Нажмите — фильтр и сортировка"><div class="th"><span class="tt">${col.t}<span class="si"></span></span><i class="fb">▾</i></div></th>`).join('')}</tr></thead>
    <tbody></tbody><tfoot><tr><td class="rn"></td>${COLS.map((col, i) => `<td class="${i === 0 ? 'c1' : ''} ${col.kind === 'num' ? 'n' : ''}" data-t="${col.k}"></td>`).join('')}</tr></tfoot></table>`;
  const tb = $('tbody', wrap);
  let cur = [];
  const draw = () => {
    cur = view();
    tb.innerHTML = cur.map((c, i) => `<tr data-n="${esc(c.name)}" class="${S.sel === c.name ? 'sel' : ''}"><td class="rn">${i + 1}</td>${COLS.map((col, j) => `<td data-k="${col.k}" class="${j === 0 ? 'c1' : ''} ${col.kind === 'num' ? 'n' : ''} ${col.edit ? 'ed' : ''}">${col.cell ? col.cell(c) : esc(String(col.v(c) ?? ''))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${COLS.length + 1}" class="mut" style="padding:18px;text-align:center">По фильтрам никого нет</td></tr>`;
    for (const col of COLS) $(`[data-t="${col.k}"]`, wrap).textContent = col.tot ? f(cur.reduce((a, c) => a + ((col.vt ? col.vt(c) : col.v(c)) || 0), 0)) : '';
    $('tfoot td:nth-child(2)', wrap).textContent = `Итого · ${cur.length}`;
    wrap.querySelectorAll('thead th[data-k]').forEach(th => { const k = th.dataset.k; th.classList.toggle('fa', !!S.f[k]); th.querySelector('.si').textContent = S.sort.k === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''; });
    $('#dgInfo', body).textContent = `Показано ${cur.length} из ${list.length} · недоплатили $${f(cur.reduce((a, c) => a + c.owe, 0))}${D.closed ? ` · осталось собрать $${f(cur.reduce((a, c) => a + left(c), 0))}` : ''} · долг сейчас $${f(cur.reduce((a, c) => a + (debtNow(c) || 0), 0))} · обещали $${f(cur.reduce((a, c) => a + sum0(c), 0))}`;
    $('#dgReset', body).style.display = Object.keys(S.f).length ? '' : 'none';
  };
  const setF = (k, patch) => { const st = { sel: null, cond: null, ...(S.f[k] || {}), ...patch }; if (!st.sel && !st.cond) delete S.f[k]; else S.f[k] = st; draw(); };
  const condDialog = (col, op) => {
    const ops = col.kind === 'num' ? NUM_OPS : TXT_OPS, old = S.f[col.k]?.cond || {};
    const m = modal(`<h3 style="margin:0 0 6px">Пользовательский автофильтр</h3><p class="mut" style="margin:0 0 10px">Столбец: <b>${esc(col.t)}</b></p>
      <div style="display:grid;gap:8px"><select id="coP">${ops.map(([o, n]) => `<option value="${o}" ${o === op ? 'selected' : ''}>${n}</option>`).join('')}</select><input id="coA" placeholder="значение" value="${esc(old.op === op ? old.a ?? '' : '')}"><input id="coB" placeholder="и" value="${esc(old.op === op ? old.b ?? '' : '')}"></div>
      <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="coX">Отмена</button><button class="btn" id="coOk">OK</button></div>`);
    const sync = () => { const o = $('#coP', m.el).value; $('#coA', m.el).style.display = o === 'empty' || o === 'nonempty' ? 'none' : ''; $('#coB', m.el).style.display = o === 'bw' ? '' : 'none'; };
    $('#coP', m.el).onchange = sync; sync(); $('#coA', m.el).focus(); $('#coX', m.el).onclick = () => m.close();
    const ok = () => { const o = $('#coP', m.el).value, a = $('#coA', m.el).value.trim(), b2 = $('#coB', m.el).value.trim(); if (!['empty', 'nonempty'].includes(o) && a === '') return toast('Впишите значение'); if (col.kind === 'num' && !['empty', 'nonempty'].includes(o) && (Number.isNaN(parseN(a)) || (o === 'bw' && Number.isNaN(parseN(b2))))) return toast('Для числа впишите цифры'); m.close(); setF(col.k, { cond: { op: o, a, b: b2 } }); };
    $('#coOk', m.el).onclick = ok; m.el.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  };
  const openFilter = th => {
    const col = COLS.find(x => x.k === th.dataset.k), st = S.f[col.k] || {}, num = col.kind === 'num';
    const mp = new Map(); for (const c of list.filter(c => rowPass(c, compile(), col.k))) for (const [k, sv] of col.keys(c)) { const o = mp.get(k) || { sv, n: 0 }; o.n++; mp.set(k, o); }
    const keys = [...mp.entries()].sort((x, y) => (typeof x[1].sv === 'string' ? x[1].sv.localeCompare(y[1].sv, 'ru') : x[1].sv === y[1].sv ? 0 : x[1].sv < y[1].sv ? -1 : 1));
    const chosen = new Set(st.sel || keys.map(([k]) => k)), pop = document.createElement('div'); pop.className = 'xf-pop';
    pop.innerHTML = `<div class="xi" data-a="asc">${num ? 'Сортировка по возрастанию' : 'Сортировка от А до Я'}</div><div class="xi" data-a="desc">${num ? 'Сортировка по убыванию' : 'Сортировка от Я до А'}</div><div class="xs"></div>
      <div class="xi ${S.f[col.k] ? '' : 'dis'}" data-a="clear">Снять фильтр с «${esc(col.t)}»</div><div class="xs"></div>
      <div class="xi" data-a="cond">${num ? 'Числовые фильтры' : 'Текстовые фильтры'}<span>▸</span></div><div id="xsub" hidden>${(num ? NUM_OPS : TXT_OPS).map(([o, n]) => `<div class="xi sub" data-op="${o}">${n}${['empty', 'nonempty'].includes(o) ? '' : '…'}</div>`).join('')}</div><div class="xs"></div>
      <input class="xq" placeholder="Поиск" autocomplete="off"><div class="xl"><label><input type="checkbox" data-all> (Выделить все)</label>${keys.map(([k, o], i) => `<label data-s="${esc(k.toLowerCase())}"><input type="checkbox" data-i="${i}"> <span>${esc(k)}</span><small>${o.n}</small></label>`).join('')}</div>
      <div class="xb"><button class="btn sm" data-a="ok">OK</button><button class="btn gray sm" data-a="cancel">Отмена</button></div>`;
    xgOpen(pop, th); pop.dataset.for = col.k;
    const boxes = [...pop.querySelectorAll('input[data-i]')], all = pop.querySelector('input[data-all]'), q = pop.querySelector('.xq'), okb = pop.querySelector('[data-a=ok]');
    const vis = () => boxes.filter(b => b.closest('label').style.display !== 'none');
    const refresh = () => { const v = vis(); all.checked = v.length > 0 && v.every(b => b.checked); all.indeterminate = !all.checked && v.some(b => b.checked); okb.disabled = !boxes.some(b => b.checked); };
    boxes.forEach((b, i) => { b.checked = chosen.has(keys[i][0]); b.onchange = refresh; });
    all.onchange = () => { vis().forEach(b => { b.checked = all.checked; }); refresh(); };
    q.oninput = () => { const w = q.value.trim().toLowerCase(); pop.querySelectorAll('label[data-s]').forEach(l => { l.style.display = !w || l.dataset.s.includes(w) ? '' : 'none'; }); refresh(); };
    refresh(); q.focus();
    pop.onclick = e => {
      const it = e.target.closest('[data-a],[data-op]'); if (!it) return;
      if (it.dataset.op) { xgClose(); if (['empty', 'nonempty'].includes(it.dataset.op)) setF(col.k, { cond: { op: it.dataset.op } }); else condDialog(col, it.dataset.op); return; }
      const a = it.dataset.a;
      if (a === 'asc' || a === 'desc') { xgClose(); S.sort = { k: col.k, dir: a === 'asc' ? 1 : -1 }; draw(); }
      else if (a === 'clear') { xgClose(); delete S.f[col.k]; draw(); }
      else if (a === 'cond') pop.querySelector('#xsub').hidden = !pop.querySelector('#xsub').hidden;
      else if (a === 'cancel') xgClose();
      else if (a === 'ok') { const pick = keys.filter((_, i) => boxes[i].checked).map(([k]) => k); xgClose(); setF(col.k, { sel: pick.length === keys.length ? null : pick }); }
    };
  };
  wrap.querySelector('thead').onclick = e => { const th = e.target.closest('th[data-k]'); if (!th) return; if (XPOP && XPOP.dataset.for === th.dataset.k) return xgClose(); openFilter(th); };
  $('#dgReset', body).onclick = () => { S.f = {}; draw(); };

  // ----- editing right in the table -----
  const target = (c, col, how) => { // next cell after Enter (down) / Tab (right)
    if (how === 'down') { const i = cur.indexOf(c); return cur[i + 1] ? { name: cur[i + 1].name, k: col.k } : null; }
    const j = EDIT.indexOf(col); return EDIT[j + 1] ? { name: c.name, k: EDIT[j + 1].k } : null;
  };
  const reload = next => { S.keep = { t: wrap.scrollTop, l: wrap.scrollLeft, next }; re(); };
  const startEdit = (td, c, col) => {
    if (col.edit === 'pay') return PAYPLAN.pop(c.name, td, () => draw());
    const num = col.edit === 'pool' || col.edit === 'left', old = col.edit === 'pool' ? c.pool || 0 : col.edit === 'left' ? Math.round(left(c) * 100) / 100 : note(c), inp = document.createElement('input');
    inp.value = old || ''; if (num) { inp.className = 'num'; inp.inputMode = 'decimal'; } else inp.maxLength = 500;
    td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = async (commit, how) => {
      if (done) return; done = true;
      if (!commit) return draw();
      let v = inp.value;
      if (num) { v = String(v).trim() === '' ? 0 : parseN(v); if (!(v >= 0)) { toast('Число не меньше 0'); return draw(); } }
      else v = String(v).trim();
      const next = how ? target(c, col, how) : null;
      if (num ? Math.abs(v - old) < 0.005 : v === old) { if (next) { draw(); clickCell(next); } else draw(); return; }
      // «Осталось собрать» is what is left of the client's Пул: Пул = оплатил за период + уже собрано с 16-го + осталось
      if (col.edit === 'left') { const np = Math.round(((c.paid || 0) + got(c) + v) * 100) / 100; if (!(await DOLG.savePool(D, c, np))) return draw(); toast(`${c.name}: осталось собрать ${f(old)} → ${f(v)} · Пул ${f(c.pool)} → ${f(np)}`); return reload(next); }
      if (col.edit === 'pool') { if (!(await DOLG.savePool(D, c, v))) return draw(); toast(`Пул ${c.name}: ${f(old)} → ${f(v)}`); return reload(next); }
      if (!(await DOLG.saveNote(c.name, v))) return draw();
      draw(); if (next) clickCell(next);
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true, 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, 'right'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    inp.onblur = () => finish(true, null);
  };
  const clickCell = nx => { const tr = [...tb.rows].find(r => r.dataset.n === nx.name), td = tr && tr.querySelector(`td[data-k="${nx.k}"]`); if (td) { td.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); td.click(); } };
  tb.onclick = e => {
    const tr = e.target.closest('tr'); if (!tr || !tr.dataset.n) return;
    const td = e.target.closest('td.ed');
    if (td && !td.querySelector('input') && !e.target.closest('a')) { const c = cur.find(x => x.name === tr.dataset.n), col = COLS.find(x => x.k === td.dataset.k); if (c && col) { tb.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); S.sel = c.name; startEdit(td, c, col); return; } }
    if (e.target.closest('a,button,input,select')) return;
    const tdo = e.target.closest('td[data-k=ord],td[data-k=ordSum]'), co = tdo && cur.find(x => x.name === tr.dataset.n);
    if (co && ordOf(co).length) { DOLG.ordPop(co.name, ordOf(co), tdo, D); return; }
    const was = tr.classList.contains('sel'); tb.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); S.sel = was ? '' : tr.dataset.n; if (!was) tr.classList.add('sel');
  };
  draw();
  if (S.keep) { const k = S.keep; S.keep = null; wrap.scrollTop = k.t; wrap.scrollLeft = k.l; if (k.next) clickCell(k.next); }
};

// orders of each client in the plan period: [{d, s}] oldest first.
// Exact orders from LINKO when the loaded LINKO data covers that period, otherwise from the balance snapshots:
// growth of «Продано» between two snapshots of the period = what the client ordered that day.
DOLG.orders = D => {
  const out = new Map(), add = (n, d, s) => { const a = out.get(n) || []; const x = a.find(y => y.d === d); if (x) x.s += s; else a.push({ d, s }); out.set(n, a); };
  let lx = [];
  try { if (typeof LX !== 'undefined' && LX.has()) lx = LX.model().ords.filter(o => o.date >= D.from && o.date <= D.end && o.client && !/cancel|отмен/i.test(String(o.status))); } catch { lx = []; }
  if (lx.length) for (const o of lx) add(o.client, o.date, o.fact || o.sum);
  else {
    const ups = (CRMLocal.engine.getState().ag.uploads || []).filter(u => u.period_from === D.from)
      .sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    let prev = new Map();
    for (const u of ups) {
      for (const r of u.rows || []) { const g = (r.sold || 0) - (prev.get(r.client) || 0); if (g > 0.005) add(r.client, u.taken_at, g); }
      prev = new Map((u.rows || []).map(r => [r.client, r.sold || 0]));
    }
  }
  for (const a of out.values()) { a.sort((x, y) => x.d.localeCompare(y.d)); for (const x of a) x.s = Math.round(x.s * 100) / 100; }
  return out;
};
DOLG.ordPop = (name, list, anchor, D) => {
  const f = UI.fmt0, t0 = UI.localDate(Date.now()), tot = list.reduce((a, x) => a + x.s, 0), pop = document.createElement('div');
  pop.className = 'xf-pop'; pop.style.width = '260px';
  pop.innerHTML = `<div class="xp"><b style="font-size:12px">${esc(name)}</b><div class="mut" style="font-size:11px;margin:2px 0 6px">Заказы за ${UI.dm(D.from)}–${UI.dm(D.end)}</div>
    <table style="width:100%;font-size:12px;box-shadow:none;border:0">${list.map(x => `<tr><td>${UI.dm(x.d)} <small class="mut">· ${REP.days(x.d, t0)} дн.</small></td><td class="n" style="text-align:right">$${f(x.s)}</td></tr>`).join('')}
    <tr><td><b>Итого · ${list.length}</b></td><td style="text-align:right"><b>$${f(tot)}</b></td></tr></table></div>`;
  xgOpen(pop, anchor);
};
