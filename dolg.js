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
      return { name: r.client, agent: r.agent || c.agent || 'Без агента', phone: c.phone || '', landmark: c.landmark || '', plan, sold: r.sold || 0, pool, paid: r.paid || 0, b1: debtNow.has(r.client) ? debtNow.get(r.client) : r.b1 || 0, owe, week: w, now: n };
    });
    const agents = new Map();
    for (const c of clients) {
      const a = agents.get(c.agent) || { agent: c.agent, plan: 0, sold: 0, pool: 0, paid: 0, owe: 0, debtors: 0, week: 0, now: 0 };
      a.plan += c.plan; a.sold += c.sold; a.pool += c.pool; a.paid += c.paid; a.owe += c.owe; a.week += c.week; a.now += c.now; if (c.owe > 0.5) a.debtors++;
      agents.set(c.agent, a);
    }
    const stage = !closed ? 'open' : today <= wEnd ? 'week' : 'done';
    return { from, end, closed, fin, nFrom, wEnd, weekUp, nowUp, stage, hasPlans: !!PP, clients, agents: [...agents.values()].filter(a => a.pool > 0 || a.plan > 0).sort((a, b) => b.owe - a.owe) };
  },

  // text for one agent (Telegram / copy)
  text(D, agent) {
    const f = UI.fmt0, a = D.agents.find(x => x.agent === agent); if (!a) return '';
    const list = D.clients.filter(c => c.agent === agent && c.owe > 0.5).sort((x, y) => (y.owe - y.week) - (x.owe - x.week));
    const L = [`<b>${esc(agent)}</b> — долги за период ${UI.dm(D.from)}–${UI.dm(D.end)}`,
      `План продаж: $${f(a.plan)} · продано $${f(a.sold)}${a.plan ? ` (${UI.pct(a.sold, a.plan)}%)` : ''}`,
      `План сбора: $${f(a.pool)} · собрано $${f(a.paid)}${a.pool ? ` (${UI.pct(a.paid, a.pool)}%)` : ''}`,
      `Не собрано у клиентов: <b>$${f(a.owe)}</b>${D.closed ? ` · собрано с ${UI.dm(D.nFrom)}: $${f(D.stage === 'done' ? a.week : a.now)}` : ''}`,
      D.closed ? `Собрать до ${UI.dateRu(D.wEnd)}:` : 'Кто недоплатил:'];
    list.forEach((c, i) => { const left = c.owe - (D.stage === 'done' ? c.week : c.now); L.push(`${i + 1}. ${esc(c.name)} — ${left <= 0.5 ? '✅ собрано' : `<b>$${f(left)}</b>${left < c.owe - 0.5 ? ` (из $${f(c.owe)})` : ''}`}`); });
    return L.join('\n');
  },
};

EXT_PAGES.debtprev = async el => {
  await CRMLocal.ready; if (window.LX) await LX.load();
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
  const list = D.clients.filter(c => c.owe > 0.5 && (!DOLG.agent || c.agent === DOLG.agent))
    .filter(c => DOLG.show === 'all' || (DOLG.show === 'left' ? left(c) > 0.5 : left(c) <= 0.5))
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
      ${D.closed ? UI.tile(D.stage === 'done' ? 'Собрано за 1-ю неделю' : `Собрано с ${UI.dm(D.nFrom)}`, '$' + f(gotT), { sub: `${UI.pct(gotT, T.owe) ?? 0}% · осталось $${f(Math.max(0, (T.owe || 0) - gotT))}`, tone: T.owe && gotT >= T.owe - 0.5 ? 'good' : '' }) : UI.tile('Сбор начнётся', UI.dm(D.nFrom), { sub: `первая неделя: ${UI.dm(D.nFrom)}–${UI.dm(D.wEnd)}` })}
    </div>
    <div class="grid">
    ${UI.panel('По агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th class="n">План продаж</th><th class="n">Продано</th><th class="n">%</th><th class="n">План сбора</th><th class="n">Собрано</th><th class="n">%</th><th class="n">Недоплатили</th><th class="n">Клиентов</th>${D.closed ? `<th class="n">Собрано с ${UI.dm(D.nFrom)}</th><th class="n">Осталось</th>` : ''}<th></th></tr></thead><tbody>
      ${A.map(a => { const g = D.stage === 'done' ? a.week : a.now; return `<tr><td><a href="#" data-ag="${esc(a.agent)}">${esc(a.agent)}</a></td><td class="n">${f(a.plan)}</td><td class="n">${f(a.sold)}</td><td class="n">${a.plan ? UI.pill(a.sold >= a.plan ? 'good' : 'warn', (UI.pct(a.sold, a.plan) ?? 0) + '%') : '—'}</td><td class="n">${f(a.pool)}</td><td class="n">${f(a.paid)}</td><td class="n">${a.pool ? UI.pill(a.paid >= a.pool ? 'good' : 'warn', (UI.pct(a.paid, a.pool) ?? 0) + '%') : '—'}</td><td class="n"><b>${f(a.owe)}</b></td><td class="n">${a.debtors}</td>${D.closed ? `<td class="n pos">${f(g)}</td><td class="n"><b>${f(Math.max(0, a.owe - g))}</b>${a.owe ? ` <small class="mut">${UI.pct(g, a.owe) ?? 0}%</small>` : ''}</td>` : ''}<td class="no-print">${chats[a.agent] ? `<button class="btn gray" data-tg="${esc(a.agent)}" title="Отправить агенту его список в Telegram">✈ Агенту</button>` : `<button class="btn gray" data-cp="${esc(a.agent)}" title="Скопировать список для агента">📋</button>`}</td></tr>`; }).join('')}
      </tbody></table></div><p class="mut" style="margin:10px 0 0">«Недоплатили» — сумма по клиентам, которые оплатили меньше своего Пула. Она может быть больше, чем «план сбора − собрано»: клиенты, которые заплатили сверх Пула, долг других не закрывают.</p>`, { cls: 'w12' })}
    ${UI.panel(`Кто недоплатил (${list.length})`, `<div class="bar no-print"><select id="dShow" aria-label="Показать"><option value="left" ${DOLG.show === 'left' ? 'selected' : ''}>Ещё не собрано</option><option value="done" ${DOLG.show === 'done' ? 'selected' : ''}>Уже собрано</option><option value="all" ${DOLG.show === 'all' ? 'selected' : ''}>Все</option></select></div>
      ${list.length ? `<div class="scroll" style="max-height:640px"><table><thead><tr><th>Клиент</th><th>Агент</th><th class="n">Пул</th><th class="n">Оплатил за период</th><th class="n">Недоплатил</th>${D.closed ? `<th class="n">Собрано с ${UI.dm(D.nFrom)}</th><th class="n">Осталось собрать</th>` : ''}<th class="n">Долг сейчас</th><th>Телефон</th></tr></thead><tbody>
      ${list.map(c => `<tr><td>${window.LX ? LX.cl(c.name) : esc(c.name)}${c.landmark ? `<br><small class="mut">${esc(c.landmark)}</small>` : ''}</td><td>${esc(c.agent)}</td><td class="n">${f(c.pool)}</td><td class="n">${f(c.paid)}</td><td class="n"><b>${f(c.owe)}</b></td>${D.closed ? `<td class="n pos">${got(c) ? f(got(c)) : '<span class="mut">—</span>'}</td><td class="n">${left(c) > 0.5 ? `<b class="neg">${f(left(c))}</b>` : UI.pill('good', 'собрано')}</td>` : ''}<td class="n">${c.b1 < 0 ? f(-c.b1) : '—'}</td><td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="mut">${DOLG.show === 'left' ? 'Все долги по Пулу собраны 👍' : 'Пусто.'}</p>`}`, { cls: 'w12', sub: D.closed ? `«Собрано с ${UI.dm(D.nFrom)}» — оплаты клиента в новом периоде (по балансу LINKO), не больше его недоплаты.${D.stage === 'done' ? ` Итоги — по данным на ${UI.dateRu(D.weekUp?.taken_at || D.wEnd)}.` : ''}` : `Предварительно: период закроется ${UI.dateRu(D.end)}, 16-го список станет окончательным.` })}
    </div>`;
  const re = () => EXT_PAGES.debtprev(el);
  $('#dPer', body).onchange = e => { DOLG.period = e.target.value; re(); };
  $('#dAg', body).onchange = e => { DOLG.agent = e.target.value; re(); };
  $('#dShow', body).onchange = e => { DOLG.show = e.target.value; re(); };
  body.querySelectorAll('[data-ag]').forEach(a => a.onclick = e => { e.preventDefault(); DOLG.agent = a.dataset.ag; re(); });
  body.querySelectorAll('[data-cp]').forEach(b => b.onclick = async () => { const t = DOLG.text(D, b.dataset.cp).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); try { await navigator.clipboard.writeText(t); toast('Список скопирован — вставьте агенту'); } catch { prompt('Скопируйте текст', t); } });
  body.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { const n = b.dataset.tg; if (!confirm(`Отправить ${n} его список должников в Telegram?`)) return; try { await TG.send(TG.conf().chats[n].id, DOLG.text(D, n)); toast('Отправлено'); } catch (e) { toast(e.message); } });
  $('#dPrint', el).onclick = () => print();
  $('#dCsv', el).onclick = () => UI.csv('долги-' + D.from, [['Клиент', 'Агент', 'План продаж', 'Продано', 'Пул', 'Оплатил за период', 'Недоплатил', 'Собрано с ' + D.nFrom, 'Осталось собрать', 'Долг сейчас', 'Телефон'],
    ...D.clients.filter(c => c.owe > 0.5 && (!DOLG.agent || c.agent === DOLG.agent)).map(c => [c.name, c.agent, c.plan, c.sold, c.pool, c.paid, Math.round(c.owe * 100) / 100, Math.round(got(c) * 100) / 100, Math.round(left(c) * 100) / 100, c.b1 < 0 ? -c.b1 : 0, c.phone])]);
};
