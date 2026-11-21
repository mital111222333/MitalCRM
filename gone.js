// Ушедшие клиенты (Продажи → Рост продаж → Ушедшие клиенты): who used to pay and stopped, from the payments of every plan period.
// A period = the latest «Баланс клиентов» snapshot of that period (the LINKO history uploaded for past months counts the same way).
//  • «Ушли»: paid in at least 2 periods, then nothing in the last K closed periods (K = 1, 2 or 3, chosen on the page)
//    and nothing in the current period so far.
//  • «Под угрозой»: a regular payer (2+ periods) who paid the period before last, but not in the last closed one and not yet now.
// «Платил в месяц» = the average of the periods with a payment — what the company loses every month without this client.
window.EXT_PAGES = window.EXT_PAGES || {};

const GONE = {
  f: { k: 2, view: 'gone', agent: '' },
  MIN: 2, // paying periods that make a client «worked with us»
  // uploads → one snapshot per period, oldest first (the last one is the current period)
  periods(uploads) {
    const byP = new Map();
    for (const u of uploads || []) { const c = byP.get(u.period_from); if (!c || u.taken_at > c.taken_at || (u.taken_at === c.taken_at && u.id > c.id)) byP.set(u.period_from, u); }
    return [...byP.values()].sort((a, b) => (a.period_from < b.period_from ? -1 : 1));
  },
  // pure: uploads + client cards → every client's payments by period and the lists
  calc(uploads, clients, k = 2) {
    const P = GONE.periods(uploads), n = P.length, cur = n - 1, rows = new Map();
    P.forEach((u, i) => {
      for (const r of u.rows) {
        const x = rows.get(r.client) || { name: r.client, pays: new Array(n).fill(0), lastAgent: '', b1: null, b1At: -1 };
        x.pays[i] += r.paid || 0;
        if (r.agent) x.lastAgent = r.agent;
        if (i >= x.b1At) { x.b1 = r.b1 ?? null; x.b1At = i; }
        rows.set(r.client, x);
      }
    });
    const out = [];
    for (const x of rows.values()) {
      const paid = x.pays.map(v => v > 0.005), idx = paid.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
      const active = idx.length, last = active ? idx[active - 1] : -1, sum = idx.reduce((s, i) => s + x.pays[i], 0);
      const quiet = last < 0 ? n : cur - last; // periods since the last payment, the current one counted
      const card = (clients && clients[x.name]) || {};
      out.push({
        name: x.name, agent: card.agent || x.lastAgent || 'Без агента', phone: card.phone || '', pays: x.pays, paid, active, last,
        lastLabel: last >= 0 ? P[last].period_from : null, avg: active ? sum / active : 0, total: sum,
        debt: x.b1 !== null && x.b1 < 0 ? -x.b1 : 0, inCurrent: x.b1At === cur,
        gone: n > k && active >= GONE.MIN && !paid[cur] && quiet > k,
        risk: n > 2 && active >= GONE.MIN && !paid[cur] && quiet === 2,
      });
    }
    return { P, rows: out, enough: n > k + GONE.MIN };
  },
};

EXT_PAGES.gone = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>Ушедшие клиенты</h2><div class="sub">Загружаю…</div></div></div>';
  await CRMLocal.ready; if (!el.isConnected) return;
  const S = CRMLocal.engine.getState(), F = GONE.f, m = v => '$' + UI.fmt0(Math.round(v || 0));
  if (!S.ag.uploads.length) { el.innerHTML = `<div class="page-head"><div><h2>Ушедшие клиенты</h2></div></div>${UI.empty('Данных пока нет', 'Список строится из выгрузок LINKO «Баланс клиентов» по месяцам.', '<a class="btn" href="#/up">Загрузить данные</a>')}`; return; }
  const R = GONE.calc(S.ag.uploads, S.ag.clients, F.k), P = R.P, cur = P.length - 1;
  const gone = R.rows.filter(r => r.gone), risk = R.rows.filter(r => r.risk && !r.gone);
  const pool = F.view === 'risk' ? risk : gone;
  const list = pool.filter(r => !F.agent || r.agent === F.agent).sort((a, b) => b.avg - a.avg || b.debt - a.debt);
  const agents = [...new Set([...gone, ...risk].map(r => r.agent))].sort((a, b) => a.localeCompare(b));
  const byAgent = agents.map(a => { const g = gone.filter(r => r.agent === a), k = risk.filter(r => r.agent === a); return { a, g: g.length, gl: g.reduce((s, r) => s + r.avg, 0), k: k.length, kl: k.reduce((s, r) => s + r.avg, 0), debt: g.reduce((s, r) => s + r.debt, 0) }; }).sort((x, y) => y.gl - x.gl);
  const lab = from => PLAN.label(from), short = from => REP.MONTHS[+from.slice(5, 7) - 1].slice(0, 3);
  const show = P.slice(-12), off = P.length - show.length; // the timeline shows the last 12 periods
  const dots = r => `<span class="gn-dots">${show.map((u, j) => { const i = off + j, v = r.pays[i]; return `<i class="${v > 0.005 ? 'on' : ''}${i === cur ? ' cur' : ''}" title="${esc(lab(u.period_from))}: ${v > 0.005 ? 'оплата ' + m(v) : 'нет оплат'}"></i>`; }).join('')}</span>`;
  const gDebt = gone.reduce((s, r) => s + r.debt, 0), gDebtN = gone.filter(r => r.debt > 0.5).length;
  el.innerHTML = `<style>.gn-dots{display:inline-flex;gap:3px;vertical-align:middle}.gn-dots i{width:11px;height:11px;border-radius:3px;background:var(--line-2);display:inline-block}.gn-dots i.on{background:var(--c3)}.gn-dots i.cur{outline:1.5px solid var(--muted);outline-offset:1px}.gn-head{display:inline-flex;gap:3px;font-weight:400}.gn-head span{width:11px;font-size:9px;text-align:center;color:var(--muted);overflow:hidden}</style>
    <div class="page-head"><div><h2>Ушедшие клиенты</h2><div class="sub">По оплатам за ${P.length} ${UI.plural(P.length, 'период', 'периода', 'периодов')}: ${esc(lab(P[0].period_from))} — ${esc(lab(P[cur].period_from))} (текущий) · «работал с нами» = платил хотя бы в ${GONE.MIN} периодах</div></div>
      <div class="actions no-print"><button class="btn gray" id="gnCsv">⬇ Excel (CSV)</button></div></div>
    ${R.enough ? '' : `<p class="mut">История пока короткая (${P.length} ${UI.plural(P.length, 'период', 'периода', 'периодов')}). Загрузите прошлые месяцы в «Загрузить вручную → 📚 История из LINKO» — тогда список станет полным.</p>`}
    <div class="kpis">
      ${UI.tile('Ушли', `${gone.length} ${UI.plural(gone.length, 'клиент', 'клиента', 'клиентов')}`, { sub: `платили раньше, а последние ${F.k} ${UI.plural(F.k, 'период', 'периода', 'периодов')} и сейчас — ни одной оплаты`, tone: gone.length ? 'bad' : '' })}
      ${UI.tile('Потеря в месяц', m(gone.reduce((s, r) => s + r.avg, 0)), { sub: 'столько они платили в среднем за месяц, когда работали', tone: gone.length ? 'bad' : '' })}
      ${UI.tile('Ушли с долгом', m(gDebt), { sub: `${gDebtN} ${UI.plural(gDebtN, 'клиент', 'клиента', 'клиентов')} — долг надо собрать`, tone: gDebt > 0.5 ? 'warn' : '' })}
      ${UI.tile('Под угрозой', `${risk.length}`, { sub: `платили позапрошлый период, а в ${esc(lab(P[Math.max(0, cur - 1)].period_from))} и сейчас — нет. Ещё можно вернуть`, tone: risk.length ? 'warn' : '' })}
    </div>
    <div class="grid">
      ${UI.panel('По агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th class="n">Ушли</th><th class="n">Потеря в месяц</th><th class="n">Их долг</th><th class="n">Под угрозой</th><th class="n">Риск в месяц</th></tr></thead><tbody>
        ${byAgent.map(x => `<tr class="row"><td><a href="#" data-gag="${esc(x.a)}" style="color:var(--text)">${esc(x.a)}</a></td><td class="n">${x.g || '—'}</td><td class="n ${x.gl ? 'neg' : ''}">${x.gl ? m(x.gl) : '—'}</td><td class="n">${x.debt > 0.5 ? m(x.debt) : '—'}</td><td class="n">${x.k || '—'}</td><td class="n">${x.kl ? m(x.kl) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="mut">Нет ушедших клиентов</td></tr>'}</tbody></table></div>`, { cls: 'w12' })}
      ${UI.panel('Клиенты', `<div class="bar"><div class="dp-seg"><button type="button" data-gv="gone" class="${F.view === 'gone' ? 'on' : ''}">Ушли (${gone.length})</button><button type="button" data-gv="risk" class="${F.view === 'risk' ? 'on' : ''}">Под угрозой (${risk.length})</button></div>
        ${F.view === 'gone' ? `<select id="gnK" aria-label="Без оплат">${[1, 2, 3].map(k => `<option value="${k}" ${k === F.k ? 'selected' : ''}>без оплат ${k} ${UI.plural(k, 'период', 'периода', 'периодов')} и больше</option>`).join('')}</select>` : ''}
        <select id="gnAg" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === F.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <span class="spacer"></span><button class="btn needs-edit" id="gnTask" disabled>Дать задание агентам по выбранным</button></div>
        <div class="scroll"><table><thead><tr><th><input type="checkbox" id="gnAll" aria-label="Выбрать все"></th><th>Клиент</th><th>Агент</th><th>Оплаты по месяцам<br><span class="gn-head">${show.map(u => `<span>${short(u.period_from)}</span>`).join('')}</span></th><th class="n">Платил периодов</th><th class="n">Платил в месяц</th><th class="n">Всего оплатил</th><th class="n">Последняя оплата</th><th class="n">Долг</th></tr></thead><tbody>
        ${list.slice(0, 500).map((r, i) => `<tr class="row"><td><input type="checkbox" data-i="${i}" aria-label="Выбрать ${esc(r.name)}"></td><td><a href="#" data-client="${esc(r.name)}" style="color:var(--text);text-decoration:none"><b>${esc(r.name)}</b></a>${r.inCurrent ? '' : ' <span class="pill muted" title="Клиента нет в текущей выгрузке LINKO">нет в LINKO сейчас</span>'}</td><td>${esc(r.agent)}</td><td>${dots(r)}</td>
          <td class="n">${r.active}</td><td class="n"><b>${m(r.avg)}</b></td><td class="n">${m(r.total)}</td><td class="n">${r.lastLabel ? esc(lab(r.lastLabel)) : '—'}</td><td class="n ${r.debt > 0.5 ? 'neg' : ''}">${r.debt > 0.5 ? m(r.debt) : '—'}</td></tr>`).join('') || `<tr><td colspan="9" class="mut">${F.view === 'risk' ? 'Никто из постоянных клиентов не пропустил оплату' : 'Ушедших клиентов нет'}</td></tr>`}
        </tbody></table></div>${list.length > 500 ? `<p class="mut">Показаны первые 500 из ${list.length} — остальные в Excel (CSV).</p>` : ''}`, { cls: 'w12', sub: 'Зелёный квадрат — в этом периоде была оплата, серый — не было, обведённый — текущий период. Сверху — самые крупные потери' })}
    </div>`;
  const re = () => EXT_PAGES.gone(el);
  el.querySelectorAll('[data-gv]').forEach(b => b.onclick = () => { F.view = b.dataset.gv; re(); });
  el.querySelectorAll('[data-gag]').forEach(a => a.onclick = e => { e.preventDefault(); F.agent = a.dataset.gag; re(); });
  const k = $('#gnK', el); if (k) k.onchange = e => { F.k = +e.target.value; re(); };
  $('#gnAg', el).onchange = e => { F.agent = e.target.value; re(); };
  const boxes = () => [...el.querySelectorAll('input[data-i]')], btn = $('#gnTask', el);
  const upd = () => { const c = boxes().filter(b => b.checked).length; btn.disabled = !c; btn.textContent = c ? `Дать задание по ${c} кл.` : 'Дать задание агентам по выбранным'; };
  boxes().forEach(b => b.onchange = upd);
  $('#gnAll', el).onchange = e => { boxes().forEach(b => b.checked = e.target.checked); upd(); };
  btn.onclick = async () => {
    const chosen = boxes().filter(b => b.checked).map(b => list[+b.dataset.i]), dueS = UI.localDate(Date.now() + 7 * 864e5);
    const text = prompt(`Задание для ${chosen.length} клиентов (срок ${UI.dateRu(dueS)}):`, 'Вернуть клиента: визит, узнать причину, получить оплату и заказ');
    if (text === null) return;
    for (const c of chosen) await CRMLocal.request('POST', '/api/ag/tasks', { client: c.name, kind: 'Продажа', text, target: 0, due: dueS });
    if (typeof WK !== 'undefined') WK.give(chosen.map(c => ({ ...c, buyDays: null }))); // «Возврат спящих» follows whether they come back
    await CRMLocal.flush(); toast(`Создано заданий: ${chosen.length} · результат — в «Рост продаж → Возврат спящих»`); re();
  };
  $('#gnCsv', el).onclick = () => UI.csv(`ушедшие-клиенты-${P[cur].taken_at}.csv`, [['Клиент', 'Агент', 'Телефон', 'Платил периодов', 'Платил в месяц $', 'Всего оплатил $', 'Последняя оплата', 'Долг $', ...P.map(u => lab(u.period_from))],
    ...list.map(r => [r.name, r.agent, r.phone, r.active, Math.round(r.avg), Math.round(r.total), r.lastLabel ? lab(r.lastLabel) : '', Math.round(r.debt), ...r.pays.map(v => Math.round(v * 100) / 100)])]);
};
