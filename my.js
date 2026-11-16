// «Мой день» (Сегодня → Мой день; it also carries the former «Отчёт дня»: period KPIs, signals, agents' plan/fact table) and «Очередь сбора» (Деньги → Дебиторка → Очередь сбора).
// Мой день: the one morning screen — who promised to pay today, who broke a promise, who to push today, which agent is behind
// the pace, what is running out. Everything comes from data the CRM already has (REP.load, REMIND.lists, INST.state).
// Очередь сбора: per agent, the debtors in the order they should be pushed today. Priority = overdue money first (61+ days ×3,
// 31–60 ×2, in term ×0.3 when the auto-loader counts baskets; otherwise debt × days without payment), a broken promise ×1.5.
// The result of every contact is written down in one tap: ext.collect = { [client]: [{ at, d, r, s?, pd?, note? }] }
// r: paid | promise | refuse | noanswer. A promise also goes to the payment schedule (ext.payPlan) — so the morning Telegram
// reminder (remind.js) and the client card see it — and to the client notes.
window.EXT_PAGES = window.EXT_PAGES || {};

const MY = {
  agent: '', showAll: new Set(), hideDone: true,
  RES: { paid: ['✅', 'Оплатил'], promise: ['🤝', 'Обещал'], refuse: ['❌', 'Отказ'], noanswer: ['📵', 'Недозвон'] },
  all: () => (CRMLocal.ext().collect ||= {}),
  last: name => (MY.all()[name] || []).at(-1) || null,
  log(name, rec) { MY._c = null; const a = (MY.all()[name] ||= []); a.push({ at: new Date().toISOString(), d: REP.today(), ...rec }); if (a.length > 30) a.splice(0, a.length - 30); CRMLocal.touch(); },
  m: v => '$' + UI.fmt0(Math.round(v || 0)),
  // one calculation shared by the pages, the agents' cabinets and the day plan (60 s)
  async fresh() { const D = await MY.data(); MY._c = D.empty ? null : { t: Date.now(), D }; return D; },
  async cached() { return MY._c && Date.now() - MY._c.t < 60000 ? MY._c.D : MY.fresh(); },
  whyText: c => (c.broke ? `сорвал обещание ${UI.dm(c.broke.d)}` : c.due ? `обещал сегодня $${UI.fmt0(c.due.s)}` : c.r > 0.5 ? `просрочка 61+ дн. $${UI.fmt0(Math.round(c.r))}` : c.o > 0.5 ? `просрочка 31–60 дн. $${UI.fmt0(Math.round(c.o))}` : c.days >= 30 ? `${c.days} дн. без оплаты` : ''),
  // the agent's queue for his cabinet (agentcab.js → me.js «Сбор»)
  async queueFor(agent, n = 30) {
    const D = await MY.cached(); if (D.empty) return [];
    return D.rows.filter(c => c.agent === agent).slice(0, n).map(c => ({ name: c.name, debt: Math.round(c.debt), why: MY.whyText(c), phone: c.phone || '', last: c.last ? { d: c.last.d, r: c.last.r, ...(c.last.pd ? { pd: c.last.pd } : {}), ...(c.last.s ? { s: c.last.s } : {}) } : null }));
  },
  // a mark made by the agent in his cabinet (inbox/, act «collect») — the same record as the supervisor's own mark
  apply(m) {
    if (!m.client || !MY.RES[m.r]) return false;
    const s = Number(m.s) || 0, pd = /^\d{4}-\d{2}-\d{2}$/.test(m.pd || '') ? m.pd : '', note = String(m.note || '');
    MY.log(m.client, { at: m.at, d: m.day || String(m.at).slice(0, 10), r: m.r, by: m.agent, ...(s ? { s } : {}), ...(pd ? { pd } : {}), ...(note ? { note } : {}) });
    if (m.r === 'promise' && pd && s) { const list = PAYPLAN.of(m.client).filter(x => x.d !== pd); list.push({ d: pd, s }); PAYPLAN.set(m.client, list); }
    if (typeof NOTES !== 'undefined') NOTES.add(m.client, { text: `${m.agent}: ${MY.RES[m.r][1].toLowerCase()}${m.r === 'promise' ? ` заплатить ${UI.dm(pd)} — $${UI.fmt0(s)}` : s ? ` $${UI.fmt0(s)}` : ''}${note ? '. ' + note : ''} (кабинет агента)` });
    return true;
  },

  // one list of debtors with everything needed to rank them
  async data() {
    const d = await REP.load(); if (d.empty) return { d, empty: true };
    const t0 = REP.today();
    let inst = null;
    try { if (typeof INST !== 'undefined' && INST.cloud() && INST.cfg().on) inst = await INST.state(); } catch { /* baskets are optional */ }
    const bk = new Map((inst?.clients || []).map(c => [c.name, c]));
    let L = { today: [], tomorrow: [], late: [] };
    try { L = REMIND.lists(t0); } catch { /* no promises yet */ }
    const broke = new Map(L.late.map(x => [x.client, x])), due = new Map(L.today.map(x => [x.client, x]));
    const rows = d.clients.filter(c => c.debt > 0.5).map(c => {
      const b = bk.get(c.name), r = b ? (b.r ?? b.late ?? 0) : 0, o = b?.o ?? 0, g = b ? (b.g ?? Math.max(0, c.debt - r - o)) : 0;
      const days = c.payDays ?? 0, base = b ? r * 3 + o * 2 + g * 0.3 : c.debt * (1 + Math.min(days, 90) / 30) / 2;
      const last = MY.last(c.name), doneToday = last && last.d === t0;
      return { name: c.name, agent: c.agent || 'Без агента', debt: c.debt, r, o, over: r + o, hasB: !!b, days, lastPay: c.lastPay, phone: b?.phone || c.phone || (typeof LX !== 'undefined' && LX.phone ? LX.phone(c.name) : '') || '',
        broke: broke.get(c.name) || null, due: due.get(c.name) || null, last, doneToday, score: base * (broke.has(c.name) ? 1.5 : 1) * (due.has(c.name) ? 1.3 : 1) };
    }).sort((a, b) => b.score - a.score);
    return { d, rows, L, hasB: bk.size > 0, t0 };
  },
  why(c) {
    if (c.broke) return `<span class="pill crit">сорвал обещание ${UI.dm(c.broke.d)}</span>`;
    if (c.due) return `<span class="pill warn">обещал сегодня ${MY.m(c.due.s)}</span>`;
    if (c.r > 0.5) return `<span class="pill crit">просрочка 61+ дн. ${MY.m(c.r)}</span>`;
    if (c.o > 0.5) return `<span class="pill serious">просрочка 31–60 дн. ${MY.m(c.o)}</span>`;
    if (!c.hasB && c.days >= 30) return `<span class="pill serious">${c.days} дн. без оплаты</span>`;
    return `<span class="pill muted">${c.days ? c.days + ' дн. без оплаты' : 'в сроке'}</span>`;
  },
  lastTag(c) { const l = c.last; if (!l) return ''; const [i, t] = MY.RES[l.r] || ['', l.r]; return `<span class="mut" style="font-size:12px">${i} ${t}${l.r === 'promise' && l.pd ? ` до ${UI.dm(l.pd)}${l.s ? ' ' + MY.m(l.s) : ''}` : ''} · ${l.d === REP.today() ? 'сегодня' : UI.dm(l.d)}${l.by ? ' · отметил ' + esc(l.by) : ''}${l.note ? ' · ' + esc(l.note) : ''}</span>`; },
  row(c, i) {
    return `<div class="cq${c.doneToday ? ' done' : ''}" data-cq="${esc(c.name)}"><div class="cq-n">${i + 1}</div>
      <div class="cq-m"><div class="cq-t"><a href="#" data-client="${esc(c.name)}"><b>${esc(c.name)}</b></a><b class="cq-d">${MY.m(c.debt)}</b></div>
        <div class="cq-s">${MY.why(c)}${c.phone ? `<a class="pill info" href="tel:${esc(c.phone)}" style="text-decoration:none">📞 ${esc(c.phone)}</a>` : ''}${MY.lastTag(c)}</div>
        <div class="cq-b">${Object.entries(MY.RES).map(([k, [ic, t]]) => `<button class="btn gray sm${c.doneToday && c.last.r === k ? ' on' : ''}" data-cqr="${k}" type="button">${ic} ${t}</button>`).join('')}</div></div></div>`;
  },
  // «Обещал»: date + sum; the other results take an optional short note
  ask(c, kind, done) {
    const prom = kind === 'promise', tm = REMIND.plus(REP.today(), 1);
    const m = modal(`<h3>${MY.RES[kind][0]} ${MY.RES[kind][1]}: ${esc(c.name)}</h3><p class="mut" style="margin:0 0 12px">Долг ${MY.m(c.debt)}${c.over > 0.5 ? ` · просрочено ${MY.m(c.over)}` : ''}</p>
      <div class="form">${prom ? `<label>Когда заплатит<input type="date" id="cqD" value="${tm}" min="${REP.today()}"></label><label>Сколько, $<input type="number" id="cqS" min="0" step="1" value="${Math.round(c.over > 0.5 ? c.over : c.debt)}"></label>` : kind === 'paid' ? `<label>Сколько заплатил, $ (если знаете)<input type="number" id="cqS" min="0" step="1"></label>` : ''}
        <label style="grid-column:1/-1">Заметка<input id="cqN" placeholder="${prom ? 'с кем говорили, что сказал' : kind === 'refuse' ? 'причина отказа' : 'необязательно'}"></label></div>
      <div class="bar"><span class="spacer"></span><button class="btn gray" id="cqX" type="button">Отмена</button><button class="btn" id="cqOk" type="button">Сохранить</button></div>`);
    $('#cqX', m.el).onclick = m.close;
    $('#cqOk', m.el).onclick = () => {
      const note = $('#cqN', m.el).value.trim(), s = +($('#cqS', m.el)?.value || 0) || 0, pd = $('#cqD', m.el)?.value || '';
      if (prom && (!pd || s <= 0)) { toast('Укажите дату и сумму обещания'); return; }
      MY.log(c.name, { r: kind, ...(s ? { s } : {}), ...(prom ? { pd } : {}), ...(note ? { note } : {}) });
      if (prom) { const list = PAYPLAN.of(c.name).filter(x => x.d !== pd); list.push({ d: pd, s }); PAYPLAN.set(c.name, list); }
      if (typeof NOTES !== 'undefined') NOTES.add(c.name, { text: `${MY.RES[kind][1]}${prom ? ` заплатить ${UI.dm(pd)} — $${UI.fmt0(s)}` : s ? ` $${UI.fmt0(s)}` : ''}${note ? '. ' + note : ''} (очередь сбора)` });
      m.close(); toast('Записано'); done();
    };
  },
  bind(el, rows, redraw) {
    el.querySelectorAll('[data-cqr]').forEach(b => b.onclick = () => {
      const c = rows.find(x => x.name === b.closest('[data-cq]').dataset.cq); if (!c) return;
      if (b.dataset.cqr === 'noanswer') { MY.log(c.name, { r: 'noanswer' }); redraw(); } else MY.ask(c, b.dataset.cqr, redraw);
    });
  },
  // the agent's queue as a Telegram message
  text(agent, list, need) {
    const top = list.filter(c => !c.doneToday).slice(0, 12);
    return [`💰 <b>Очередь сбора — ${UI.dateRu(REP.today())}</b>`, esc(agent), need > 0 ? `Сегодня собрать: <b>$${UI.fmt0(Math.round(need))}</b>` : '', '',
      ...top.map((c, i) => `${i + 1}. ${esc(c.name)} — <b>$${UI.fmt0(Math.round(c.debt))}</b>${c.broke ? ' · ⚠️ сорвал обещание' : c.due ? ` · обещал сегодня $${UI.fmt0(c.due.s)}` : c.over > 0.5 ? ` · просрочено $${UI.fmt0(Math.round(c.over))}` : c.days >= 30 ? ` · ${c.days} дн. без оплаты` : ''}`),
      '', 'Вечером отпишитесь по каждому: оплатил / обещал (дата и сумма) / отказ.'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  },
};

(window.INBOX_HANDLERS ||= {}).collect = m => MY.apply(m);

(() => {
  const css = document.createElement('style');
  css.textContent = `.cq{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}.cq:last-child{border-bottom:0}
.cq.done{opacity:.55}.cq-n{font-weight:700;color:var(--muted);text-align:center;padding-top:2px}.cq-m{min-width:0}
.cq-t{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.cq-t a{color:var(--text);text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis}.cq-d{white-space:nowrap;font-size:16px}
.cq-s{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 8px}.cq-b{display:flex;gap:6px;flex-wrap:wrap}
.cq-b .btn.on,.cq-b .btn.on:hover{background:var(--tint,#0a84ff)!important;color:#fff!important}
.my-ag{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:11px 0;border-bottom:1px solid var(--line);align-items:center}.my-ag:last-child{border-bottom:0}
.my-ag .lbbar{grid-column:1/-1;margin:2px 0}.my-ag small{grid-column:1/-1}
.my-li{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);align-items:baseline}.my-li:last-child{border-bottom:0}.my-li a{color:var(--text);text-decoration:none}
.my-li span.mut{font-size:12px}`;
  document.head.appendChild(css);
})();

// ---------- Мой день ----------
EXT_PAGES.my = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>Мой день</h2><div class="sub">Загружаю…</div></div></div>';
  const D = await MY.fresh(); if (!el.isConnected) return;
  if (D.empty) { el.innerHTML = `<div class="page-head"><div><h2>Мой день</h2></div></div>${UI.empty('Данных пока нет', 'Как только придёт выгрузка LINKO «Баланс клиентов», здесь появится план на день: кого дожимать, кто обещал заплатить, кто из агентов отстаёт.', '<a class="btn" href="#/up">Загрузить данные</a>')}`; return; }
  const { d, rows, L, t0 } = D, m = MY.m, sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const agents = d.agents.filter(a => a.agent !== 'Без агента'), pace = agPace(d);
  const needC = sum(agents, 'need_collect_day'), needS = sum(agents, 'need_sell_day');
  const over = rows.filter(c => c.over > 0.5), stale = rows.filter(c => c.days >= 30);
  const todo = rows.filter(c => !c.doneToday).slice(0, 10), doneN = rows.filter(c => c.doneToday).length;
  const li = (x, right, sub = '') => `<div class="my-li"><span><a href="#" data-client="${esc(x.client || x.name)}"><b>${esc(x.client || x.name)}</b></a> <span class="mut">${esc(x.agent)}${sub}</span></span><b style="white-space:nowrap">${right}</b></div>`;
  const tone = p => (p === null ? 'none' : p >= 1 ? 'good' : pace === null ? 'ok' : p >= pace * 0.9 ? 'ok' : p >= pace * 0.6 ? 'warn' : 'crit');
  const COL = { good: '#30d158', ok: '#0a84ff', warn: '#ff9f0a', crit: '#ff453a', none: '#b4b9c0' };
  const agRow = a => {
    const ps = a.plan > 0 ? a.sold / a.plan : null, pm = a.pool > 0 ? a.paid / a.pool : null, worst = [tone(ps), tone(pm)].includes('crit') ? 'crit' : [tone(ps), tone(pm)].includes('warn') ? 'warn' : 'ok';
    const bar = (p, t) => `<div class="lbbar" title="${t}"><i style="width:${p === null ? 0 : Math.min(p, 1) * 100}%;background:${COL[tone(p)]}"></i>${pace !== null && p !== null ? `<b style="left:${Math.min(pace, 1) * 100}%"></b>` : ''}</div>`;
    return `<div class="my-ag"><a href="#" data-agent="${esc(a.agent)}" style="color:var(--text);text-decoration:none"><b>${esc(a.agent)}</b></a><span class="pill ${worst === 'crit' ? 'crit' : worst === 'warn' ? 'warn' : 'good'}">${worst === 'crit' ? 'сильно отстаёт' : worst === 'warn' ? 'отстаёт' : 'по графику'}</span>
      <small>🛒 продажи ${ps === null ? 'план не задан' : Math.round(ps * 100) + '%'}${a.need_sell_day > 0 ? ` · сегодня продать <b>${m(a.need_sell_day)}</b>` : ''}</small>${bar(ps, 'Продажи')}
      <small>💰 сбор ${pm === null ? 'план не задан' : Math.round(pm * 100) + '%'}${a.need_collect_day > 0 ? ` · сегодня собрать <b>${m(a.need_collect_day)}</b>` : ''}</small>${bar(pm, 'Сбор')}</div>`;
  };
  let abc = []; try { abc = ABC.calc(d).rows.filter(c => c.down && c.cls !== 'C').sort((a, b) => b.lost - a.lost).slice(0, 5); } catch { /* optional */ }
  const R = REP.day(d);
  const low = (d.low?.items || []).filter(i => i.status && i.status !== 'ok').slice(0, 6);
  el.innerHTML = `<div class="page-head"><div><h2>Мой день</h2><div class="sub">${UI.dateRu(t0)} · данные LINKO на ${UI.dateRu(d.upload.taken_at)}</div></div>
      <div class="actions no-print">${REP.dayTools}<a class="btn gray" href="#/dayplan">План агентов</a><a class="btn" href="#/collect">Очередь сбора</a></div></div>
    ${REP.hero(d)}
    <div class="kpis">
      ${UI.tile('Сегодня собрать', m(needC), { sub: needC > 0 ? 'чтобы закрыть план сбора к концу периода' : 'план сбора закрыт или не задан' })}
      ${UI.tile('Обещали заплатить сегодня', L.today.length ? m(sum(L.today, 's')) : '—', { sub: L.today.length ? `${L.today.length} ${UI.plural(L.today.length, 'клиент', 'клиента', 'клиентов')}` : 'обещаний на сегодня нет', tone: L.today.length ? 'good' : '' })}
      ${UI.tile('Сорвали обещание', L.late.length ? m(sum(L.late, 's')) : '—', { sub: L.late.length ? `${L.late.length} ${UI.plural(L.late.length, 'клиент', 'клиента', 'клиентов')} за 7 дней` : 'все обещания выполнены', tone: L.late.length ? 'bad' : '' })}
      ${D.hasB ? UI.tile('Просрочено (31+ дней)', m(sum(over, 'over')), { sub: `${over.length} ${UI.plural(over.length, 'клиент', 'клиента', 'клиентов')}`, tone: over.length ? 'warn' : '' })
        : UI.tile('30+ дней без оплаты', m(sum(stale, 'debt')), { sub: `${stale.length} ${UI.plural(stale.length, 'клиент', 'клиента', 'клиентов')} с долгом`, tone: stale.length ? 'warn' : '' })}
      ${UI.tile('Сегодня продать', m(needS), { sub: needS > 0 ? 'чтобы закрыть план продаж' : 'план продаж закрыт или не задан' })}
      ${R.kpis}
    </div>
    <div class="grid">
      ${UI.panel(`Дожать сегодня — топ-${todo.length}`, todo.length ? `<div id="myQ">${todo.map(MY.row).join('')}</div><div class="bar" style="margin:12px 0 0"><span class="mut">Отработано сегодня: ${doneN} из ${rows.length}</span><span class="spacer"></span><a class="btn gray sm" href="#/collect">Вся очередь по агентам →</a></div>` : '<div class="empty">Все должники на сегодня отработаны 👏</div>', { cls: 'w7', sub: 'Сначала просрочка и сорванные обещания. Отметьте результат одним нажатием.' })}
      <div class="w5" style="display:grid;gap:14px;align-content:start;min-width:0">
        ${UI.panel('Агенты: кто отстаёт', agents.length ? agents.slice().sort((a, b) => (a.pool > 0 ? a.paid / a.pool : 9) - (b.pool > 0 ? b.paid / b.pool : 9)).map(agRow).join('') : '<div class="empty">Агентов пока нет</div>', { cls: '', sub: pace !== null ? `Белая метка — где нужно быть по графику (${Math.round(pace * 100)}% периода)` : '' })}
        ${L.today.length ? UI.panel('Обещали заплатить сегодня', L.today.map(x => li(x, m(x.s), x.paid ? ' · ✅ уже платил' : '')).join(''), { cls: '' }) : ''}
        ${L.late.length ? UI.panel('⚠️ Сорвали обещание', L.late.map(x => li(x, m(x.s), ` · обещал ${UI.dm(x.d)}`)).join(''), { cls: '', sub: 'Позвоните лично — после вашего звонка платят чаще' }) : ''}
        ${L.tomorrow.length ? UI.panel('Завтра обещали', L.tomorrow.map(x => li(x, m(x.s))).join(''), { cls: '', sub: 'Агент напоминает клиенту сегодня' }) : ''}
        ${abc.length ? UI.panel('Ключевые клиенты просели', abc.map(c => li(c, '−' + m(c.lost), ` · класс ${c.cls} · обычно ${m(c.avg)} за период`)).join('') + '<div class="bar" style="margin:10px 0 0"><span class="spacer"></span><a class="btn gray sm" href="#/abc">ABC клиентов →</a></div>', { cls: '', sub: 'Покупают заметно меньше обычного — поручите агенту визит' }) : ''}
        ${low.length ? UI.panel('Склад: заканчивается', low.map(i => `<div class="my-li"><span>${esc(i.name || i.product || '')}${i.warehouse ? ` <span class="mut">${esc(i.warehouse)}</span>` : ''}</span><b class="${i.available <= 0 ? 'neg' : ''}">${i.available <= 0 ? 'нет' : UI.fmt0(i.available)}${i.days_left != null && i.available > 0 ? ` · ${Math.round(i.days_left)} дн.` : ''}</b></div>`).join('') + '<div class="bar" style="margin:10px 0 0"><span class="spacer"></span><a class="btn gray sm" href="#/whlow">Весь список →</a></div>', { cls: '' }) : ''}
      </div>
      ${R.signals}
      ${R.signals.trim() ? R.insights : R.insights.replace("cls: 'w5'", "cls: 'w12'")}
      ${R.table}
    </div>`;
  REP.bindDayTools(el, d);
  MY.bind(el, rows, () => EXT_PAGES.my(el));
};

// ---------- Очередь сбора ----------
EXT_PAGES.collect = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>Очередь сбора</h2><div class="sub">Загружаю…</div></div></div>';
  const D = await MY.fresh(); if (!el.isConnected) return;
  if (D.empty) { el.innerHTML = `<div class="page-head"><div><h2>Очередь сбора</h2></div></div>${UI.empty('Данных пока нет', 'Очередь строится из выгрузки LINKO «Баланс клиентов».', '<a class="btn" href="#/up">Загрузить данные</a>')}`; return; }
  const { d, rows } = D, m = MY.m, by = {};
  for (const c of rows) (by[c.agent] ||= []).push(c);
  const need = Object.fromEntries(d.agents.map(a => [a.agent, a.need_collect_day || 0]));
  const names = Object.keys(by).sort((a, b) => by[b].reduce((s, c) => s + c.score, 0) - by[a].reduce((s, c) => s + c.score, 0));
  if (MY.agent && !by[MY.agent]) MY.agent = '';
  const tg = CRMLocal.ext().tg || {}, canTg = !!(tg.token && tg.chats);
  const today = rows.filter(c => c.doneToday), cnt = k => today.filter(c => c.last.r === k).length;
  const sec = a => {
    const all = by[a], list = all.filter(c => !(MY.hideDone && c.doneToday)), n = MY.showAll.has(a) ? list.length : 15, done = all.filter(c => c.doneToday).length;
    return UI.panel(esc(a), (list.length ? list.slice(0, n).map(MY.row).join('') : '<div class="empty">Все отработаны сегодня 👏</div>') +
      `<div class="bar" style="margin:12px 0 0">${list.length > n ? `<button class="btn gray sm" data-cqall="${esc(a)}" type="button">Показать всех (${list.length})</button>` : ''}<span class="spacer"></span>${canTg && tg.chats[a]?.id ? `<button class="btn gray sm" data-cqtg="${esc(a)}" type="button">Отправить агенту в Telegram</button>` : ''}</div>`,
      { sub: `${all.length} ${UI.plural(all.length, 'должник', 'должника', 'должников')} · долг ${m(all.reduce((s, c) => s + c.debt, 0))}${need[a] > 0 ? ` · сегодня собрать <b>${m(need[a])}</b>` : ''} · отработано ${done}` });
  };
  el.innerHTML = `<div class="page-head"><div><h2>Очередь сбора</h2><div class="sub">Кого дожимать сегодня, по приоритету: ${D.hasB ? 'просрочка 61+ дней, затем 31–60, сорванные обещания' : 'сумма долга × дни без оплаты, сорванные обещания'}</div></div>
      <div class="actions">${canTg ? '<button class="btn" id="cqTgAll" type="button">Отправить всем агентам</button>' : ''}</div></div>
    <div class="kpis">${UI.tile('Должников в очереди', UI.fmt0(rows.length), { sub: 'долг ' + m(rows.reduce((s, c) => s + c.debt, 0)) })}
      ${UI.tile('Отработано сегодня', `${today.length}`, { sub: `из ${rows.length}`, tone: today.length ? 'good' : '' })}
      ${UI.tile('✅ Оплатили', String(cnt('paid')))}${UI.tile('🤝 Обещали', String(cnt('promise')), { sub: m(today.filter(c => c.last.r === 'promise').reduce((s, c) => s + (c.last.s || 0), 0)) })}
      ${UI.tile('❌ Отказ / 📵', `${cnt('refuse')} / ${cnt('noanswer')}`, { tone: cnt('refuse') ? 'bad' : '' })}</div>
    <div class="bar"><select id="cqAg" aria-label="Агент"><option value="">Все агенты</option>${names.map(a => `<option ${a === MY.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="cqHide" ${MY.hideDone ? 'checked' : ''}> Скрыть отработанных сегодня</label></div>
    <div class="grid">${names.filter(a => !MY.agent || a === MY.agent).map(sec).join('')}</div>`;
  const redraw = () => EXT_PAGES.collect(el);
  $('#cqAg', el).onchange = e => { MY.agent = e.target.value; redraw(); };
  $('#cqHide', el).onchange = e => { MY.hideDone = e.target.checked; redraw(); };
  el.querySelectorAll('[data-cqall]').forEach(b => b.onclick = () => { MY.showAll.add(b.dataset.cqall); redraw(); });
  const send = async a => TG.send(tg.chats[a].id, MY.text(a, by[a], need[a] || 0));
  el.querySelectorAll('[data-cqtg]').forEach(b => b.onclick = async () => { b.disabled = true; try { await send(b.dataset.cqtg); toast('Отправлено: ' + b.dataset.cqtg); } catch (e) { toast(e.message); } b.disabled = false; });
  const allBtn = $('#cqTgAll', el);
  if (allBtn) allBtn.onclick = async () => { allBtn.disabled = true; let ok = 0; const errs = []; for (const a of names) if (tg.chats[a]?.id) { try { await send(a); ok++; } catch (e) { errs.push(`${a}: ${e.message}`); } } toast(errs.length ? `Отправлено ${ok}, ошибки: ${errs.join('; ')}` : `Очередь отправлена ${ok} ${UI.plural(ok, 'агенту', 'агентам', 'агентам')}`); allBtn.disabled = false; };
  MY.bind(el, rows, redraw);
};
