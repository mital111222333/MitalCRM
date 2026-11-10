// Client card (click any client name): debt, plan, day-by-day history, tasks, notes and promises to pay,
// one-tap call / message to the agent / new task. Notes live in the synced state (ext.notes) and are seen by the AI.
window.EXT_PAGES = window.EXT_PAGES || {};

const NOTES = {
  all: () => (CRMLocal.ext().notes ||= {}),
  of: name => (NOTES.all()[name] || []).slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')),
  add(name, n) { (NOTES.all()[name] ||= []).push({ at: new Date().toISOString(), ...n }); CRMLocal.touch(); },
  del(name, at) { const a = NOTES.all()[name] || []; NOTES.all()[name] = a.filter(x => x.at !== at); CRMLocal.touch(); },
  // promises to pay with their state: kept (a payment came after the note), overdue, today, future
  promises(d) {
    const t0 = REP.today(), byName = new Map(d.clients.map(c => [c.name, c])), out = [];
    for (const [name, list] of Object.entries(NOTES.all())) for (const n of list) {
      if (!n.promise) continue;
      const c = byName.get(name), made = (n.at || '').slice(0, 10);
      const kept = !!(c && c.lastPay && c.lastPay > made); // a payment arrived after the promise was written down
      out.push({ client: name, agent: c?.agent || '', debt: c?.debt || 0, date: n.promise, sum: n.sum || 0, text: n.text || '', at: n.at, status: kept ? 'kept' : n.promise < t0 ? 'overdue' : n.promise === t0 ? 'today' : 'future' });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};

const CARD = {
  // one point per day (the latest upload of the day): balance and what was sold / paid that day
  history(S, name) {
    const ups = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const byDay = new Map(); for (const u of ups) byDay.set(u.period_from + '|' + u.taken_at, u);
    const pts = [], prevPer = new Map();
    for (const u of [...byDay.values()].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1))) {
      const r = u.rows.find(x => x.client === name); if (!r) continue;
      const p = prevPer.get(u.period_from);
      pts.push({ date: u.taken_at, b1: r.b1, sold: r.sold, paid: r.paid, ds: p ? r.sold - p.sold : r.sold, dp: p ? r.paid - p.paid : r.paid, first: !p });
      prevPer.set(u.period_from, r);
    }
    return pts;
  },

  // ---------- заказы клиента и договорённые сроки оплаты ----------
  // Откуда срок: «договорённость» — график, который вы записали на заказе (кнопка «📅 Срок», как в «Накладных»);
  // если не записан — стандартный график клиента (свой / договор / общий из «Рассрочки»). Что оплачено — считается от долга клиента:
  // оплаты закрывают самые старые заказы, долг лежит на самых новых (так же считает автозагрузка для напоминаний агентам).
  showPaid: false, tab: '',
  r2: v => Math.round((v || 0) * 100) / 100,
  addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
  diffDays: (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5),
  async load(name, c) {
    const ctx = { name, k: typeof LX !== 'undefined' ? LX.norm(name) : name, debt: Math.max(0, c.debt || 0), orders: [] };
    if (typeof LX === 'undefined' || !LX.has()) return ctx;
    const same = x => LX.norm(x) === ctx.k, map = new Map();
    for (const o of LX.model().ords) {
      if (!same(o.client) || /cancel|reject|отмен|отклон/i.test(String(o.status))) continue;
      const s = CARD.r2(o.sum - o.ret); if (s > 0.005) map.set(String(o.id), { id: String(o.id), d: o.date, s });
    }
    // заказы старше периода, на которых ещё лежит долг, — из расчёта автозагрузки (75 дней)
    try {
      if (typeof INST !== 'undefined' && INST.cfg().on && INST.cloud()) {
        const st = await INST.state(), sc = (st?.clients || []).find(x => same(x.name));
        for (const o of sc?.orders || []) if (!map.has(String(o.id))) map.set(String(o.id), { id: String(o.id), d: o.d, s: o.s });
      }
    } catch { /* без расчёта автозагрузки показываем заказы периода */ }
    ctx.orders = [...map.values()].sort((a, b) => (a.d === b.d ? Number(a.id) - Number(b.id) : a.d < b.d ? -1 : 1));
    return ctx;
  },
  calc(ctx) {
    const today = UI.localDate(Date.now()), r2 = CARD.r2;
    const ic = typeof INST !== 'undefined' ? INST.cfg() : { days: 30, parts: 4, clients: {}, contracts: [], orders: {} };
    const own = Object.entries(ic.clients || {}).find(([n]) => LX.norm(n) === ctx.k)?.[1] || {};
    const ct = (ic.contracts || []).find(x => (x.accounts || []).some(a => LX.norm(a) === ctx.k));
    const days = Number(own.days || ct?.days || ic.days) || 30, nParts = Math.max(1, Number(own.parts || ct?.parts || ic.parts) || 4), weekly = 7 * (nParts - 1) < days;
    const list = ctx.orders.map(o => ({ ...o }));
    let rest = ctx.debt;
    for (let i = list.length - 1; i >= 0; i--) { const o = list[i]; o.left = r2(Math.min(o.s, rest)); rest = Math.max(0, rest - o.left); o.paid = r2(o.s - o.left); }
    for (const o of list) {
      const x = (ic.orders || {})[o.id] || {};
      let parts, src = 'std';
      if (Array.isArray(x.plan) && x.plan.length) { parts = x.plan.map(p => ({ d: p.d, s: Number(p.s) || 0 })).sort((a, b) => (a.d < b.d ? -1 : 1)); src = 'agreed'; }
      else if (Number(x.days) > 0) { parts = [{ d: CARD.addDays(o.d, Number(x.days)), s: o.s }]; src = 'agreed'; }
      else parts = Array.from({ length: nParts }, (_, i) => ({ d: CARD.addDays(o.d, i + 1 === nParts ? days : weekly ? 7 * (i + 1) : Math.round(days * (i + 1) / nParts)), s: r2(o.s / nParts) }));
      const tot = parts.reduce((a, p) => a + p.s, 0);
      if (Math.abs(tot - o.s) > 0.01) { const last = parts[parts.length - 1]; last.s = r2(Math.max(0, o.s - (tot - last.s))); }
      let cum = 0;
      for (const p of parts) { cum += p.s; p.unpaid = r2(Math.min(p.s, Math.max(0, cum - o.paid))); p.st = p.unpaid < 0.01 ? 'paid' : p.d < today ? 'late' : p.d === today ? 'today' : 'wait'; }
      o.parts = parts; o.src = src; o.cond = x.cond || ''; o.spec = !!x.spec;
      o.late = r2(parts.filter(p => p.st === 'late').reduce((a, p) => a + p.unpaid, 0));
      o.today = r2(parts.filter(p => p.st === 'today').reduce((a, p) => a + p.unpaid, 0));
      const fl = parts.find(p => p.st === 'late'); o.lateDays = fl ? CARD.diffDays(fl.d, today) : 0;
      o.next = parts.find(p => p.st === 'today' || p.st === 'wait') || null;
      o.state = o.left < 0.01 ? 'paid' : o.late > 0.005 ? 'late' : o.today > 0.005 ? 'today' : 'wait';
    }
    const open = list.filter(o => o.state !== 'paid').sort((a, b) => ({ late: 0, today: 1, wait: 2 }[a.state] - { late: 0, today: 1, wait: 2 }[b.state]) || ((a.next?.d || a.parts[0].d) < (b.next?.d || b.parts[0].d) ? -1 : 1) || (a.d < b.d ? -1 : 1));
    const done = list.filter(o => o.state === 'paid').sort((a, b) => (a.d < b.d ? 1 : -1));
    const nx = open.map(o => o.next).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))[0] || null;
    return { list, open, done, old: r2(rest), late: r2(open.reduce((a, o) => a + o.late, 0)), today: r2(open.reduce((a, o) => a + o.today, 0)), nlate: open.filter(o => o.state === 'late').length, next: nx,
      T: { days, nParts, own: !!(own.days || own.parts), contract: !!ct, ex: !!own.ex }, byId: Object.fromEntries(list.map(o => [o.id, o])) };
  },
  partPill(p) {
    const f = UI.fmt0, part = p.unpaid > 0.005 && p.unpaid < p.s - 0.005 ? ` (ещё $${f(p.unpaid)})` : '';
    const k = { paid: ['good', ' ✓'], late: ['crit', ` · просрочена ${CARD.diffDays(p.d, UI.localDate(Date.now()))} дн.`], today: ['warn', ' · сегодня'], wait: ['', ''] }[p.st];
    return `<span class="pill ${k[0]}">${UI.dm(p.d)}.${p.d.slice(2, 4)} · $${f(p.s)}${part}${k[1]}</span>`;
  },
  csvOrders(name, ORD) {
    const rows = [['Заказ', 'Дата', 'Сумма', 'Оплачено', 'Осталось', 'Статус', 'Срок', 'Откуда срок', 'Части (дата · сумма · статус)']];
    for (const o of [...ORD.open, ...ORD.done]) rows.push([o.id, o.d, o.s, o.paid, o.left, { paid: 'оплачен', late: 'просрочен', today: 'срок сегодня', wait: 'ждём' }[o.state], o.next ? o.next.d : o.parts[o.parts.length - 1].d, o.src === 'agreed' ? 'договорённость' : 'стандарт', o.parts.map(p => `${p.d} ${p.s} ${p.st}`).join('; ')]);
    UI.csv('заказы-' + name, rows);
  },
  // «📅 Срок» на заказе: то же окно, что в «Накладных» — записанная договорённость попадает в напоминания агентам
  termDialog(o, name, c, after) {
    if (typeof INVO === 'undefined' || typeof INST === 'undefined') return toast('Раздел «Накладные» не загружен — откройте его один раз');
    if (!EXT_PAGES.invo.__card) { const orig = EXT_PAGES.invo; const w = function (el) { if (el && el._cardSink) return el._cardSink(); return orig.apply(this, arguments); }; w.__card = true; EXT_PAGES.invo = w; }
    const sink = document.createElement('div'); sink._cardSink = after;
    INVO.dialog({ id: o.id, d: o.d, client: name, agent: c.agent || '', s: o.s, disc: 0, bonusItems: [], auto: false, x: INST.cfg().orders[o.id] || {} }, sink);
  },

  async open(name) {
    const d = await REP.load(); if (d.empty) return;
    const c = d.clients.find(x => x.name === name); if (!c) return toast('Клиент не найден в последней загрузке');
    const S = CRMLocal.engine.getState(), pts = CARD.history(S, name), f = UI.fmt0, end = d.forecast.period_end || d.upload.period_to;
    const tasks = d.tasks.filter(t => t.client === name), conf = (CRMLocal.ext().tg || {}), agentChat = conf.token && conf.chats?.[c.agent];
    const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
    const m = modal(`<div class="card-head"><div><h3 style="margin:0">${esc(c.name)}</h3>
        <div class="mut">${[c.type, c.landmark, c.zone].filter(Boolean).map(esc).join(' · ')}</div>
        <div style="margin-top:4px">Агент: <a class="clink" data-agent="${esc(c.agent)}">${esc(c.agent)}</a> · ${c.active ? UI.pill('good', 'АКБ', '✓') : UI.pill('muted', 'неактивен')}</div></div>
        <button class="btn gray sm" id="cX" aria-label="Закрыть">✕</button></div>
      <div class="bar" style="margin:12px 0">${(() => { const ph = c.phone || (typeof LX !== 'undefined' ? LX.phone(name) : ''); return ph ? `<a class="btn" href="tel:${esc(ph)}">📞 ${esc(ph)}</a>` : ''; })()}${agentChat ? '<button class="btn gray" id="cTg">✈ Написать агенту</button>' : ''}<button class="btn gray" id="cTask">+ Задание агенту</button><button class="btn gray" id="cNote">📝 Заметка / обещание</button></div>
      <div class="kpis kpis-sm">
        ${UI.tile('Долг', '$' + f(c.debt), { sub: c.lastPay ? `последняя оплата ${UI.dateRu(c.lastPay)}` : `нет оплат с ${UI.dm(d.hist.since)}`, tone: c.debt ? 'warn' : '' })}
        ${UI.tile('Продано за период', '$' + f(c.sold), { sub: c.plan ? `план ${f(c.plan)} · ${pct(c.sold, c.plan)}` : 'план не задан' })}
        ${UI.tile('Оплачено за период', '$' + f(c.paid), { sub: c.pool ? `пул ${f(c.pool)} · ${pct(c.paid, c.pool)}` : 'пул не задан' })}
        ${UI.tile('Соберётся к ' + UI.dm(end), '$' + f(c.paid + (c.more_pool || 0)), { sub: `ещё соберёт ${f(c.more_pool || 0)}${c.pool ? ' · ' + pct(c.paid + (c.more_pool || 0), c.pool) + ' пула' : ''}` })}
      </div>
      <div id="cBody"></div>`);
    m.el.classList.add('wide');
    let ctx = await CARD.load(name, c), ORD = CARD.calc(ctx);
    const noteDialog = (pre = '', sum = 0) => {
      const f2 = modal(`<h3>Заметка: ${esc(name)}</h3><div class="form"><label style="grid-column:1/-1">Что было (итог звонка, договорённость)<textarea id="nT" rows="3" style="font:inherit;padding:8px;border:1px solid var(--line-2);border-radius:8px">${esc(pre)}</textarea></label>
        <label>Обещал оплатить (дата)<input type="date" id="nD"></label><label>Сумма, $<input type="number" min="0" id="nS" value="${sum ? Math.round(sum) : ''}"></label></div>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="nX">Отмена</button><button class="btn" id="nOk">Сохранить</button></div>`);
      $('#nX', f2.el).onclick = f2.close;
      $('#nOk', f2.el).onclick = () => { const text = $('#nT', f2.el).value.trim(), promise = $('#nD', f2.el).value, s = +$('#nS', f2.el).value || 0; if (!text && !promise) return toast('Напишите заметку или дату обещания'); NOTES.add(name, { text, ...(promise ? { promise, sum: s } : {}) }); f2.close(); draw(); toast('Заметка сохранена'); };
    };
    const ordTab = () => {
      if (!ORD.list.length && !ORD.old) return `<p class="mut">${typeof LX !== 'undefined' && LX.has() ? 'Заказов клиента в загруженных данных LINKO нет.' : 'Данные LINKO не загружены — нажмите «🔄 Обновить» вверху.'}</p>`;
      const money = v => '$' + f(v), shown = CARD.showPaid ? [...ORD.open, ...ORD.done] : ORD.open;
      const tiles = `<div class="kpis kpis-sm">
        ${UI.tile('Просрочено', money(ORD.late), { sub: ORD.nlate ? `${ORD.nlate} заказ(ов)` : 'просрочек нет', tone: ORD.late > 0.005 ? 'bad' : 'good' })}
        ${UI.tile('Срок сегодня', money(ORD.today), { tone: ORD.today > 0.005 ? 'warn' : '' })}
        ${UI.tile('Ближайший срок', ORD.next ? UI.dm(ORD.next.d) : '—', { sub: ORD.next ? `$${f(ORD.next.unpaid)} по заказу` : 'нет ближайших' })}
        ${ORD.old > 0.5 ? UI.tile('Долг прошлых периодов', money(ORD.old), { sub: 'заказы старше известных — срок неизвестен', tone: 'bad' }) : ''}</div>`;
      const stPill = o => (o.state === 'paid' ? UI.pill('good', 'оплачен', '✓') : o.state === 'late' ? UI.pill('crit', `просрочен ${o.lateDays} дн.`) : o.state === 'today' ? UI.pill('warn', 'срок сегодня') : UI.pill('info', `до ${UI.dm(o.next ? o.next.d : o.parts[o.parts.length - 1].d)}`));
      const rows = shown.map(o => `<tr${o.state === 'late' ? ' style="background:rgba(220,60,60,.08)"' : ''}>
        <td><b>№${esc(o.id)}</b><br><small class="mut">${UI.dateRu(o.d)}</small></td>
        <td class="n">${f(o.s)}</td><td class="n">${o.paid > 0.005 ? f(o.paid) : '—'}</td><td class="n ${o.state === 'late' ? 'neg' : ''}"><b>${o.left > 0.005 ? f(o.left) : '—'}</b></td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap">${o.parts.map(CARD.partPill).join('')}</div>
          <small class="mut">${o.src === 'agreed' ? '🤝 по договорённости' : `стандарт: ${o.parts.length} ч. за ${ORD.T.days} дн.${ORD.T.own ? ' (свой график клиента)' : ORD.T.contract ? ' (договор)' : ''}`}${o.cond ? ' · ' + esc(o.cond) : ''}${o.spec ? ' · спец.' : ''}</small></td>
        <td>${stPill(o)}</td>
        <td style="white-space:nowrap">${o.state !== 'paid' ? `<button class="btn gray sm" data-prom="${esc(o.id)}" type="button" title="Записать обещание клиента по этому заказу">📝</button> ` : ''}<button class="btn gray sm" data-term="${esc(o.id)}" type="button" title="Записать или изменить срок оплаты по этому заказу">📅 Срок</button></td></tr>`).join('');
      const oldRow = ORD.old > 0.5 ? `<tr><td colspan="7" class="neg">Долг прошлых периодов: <b>${money(ORD.old)}</b> — заказы старше ${ORD.list.length ? 'известных' : ''} (больше 75 дней), срок оплаты не известен. Считается просроченным.</td></tr>` : '';
      return `${tiles}
        <div class="bar" style="margin:10px 0 6px"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="cShowPaid" ${CARD.showPaid ? 'checked' : ''}> показывать оплаченные заказы (${ORD.done.length})</label><span class="spacer"></span><button class="btn gray sm" id="cOrdCsv" type="button">⬇ Excel</button></div>
        ${rows || oldRow ? `<div class="tscroll" style="max-height:380px"><table><thead><tr><th>Заказ</th><th class="n">Сумма $</th><th class="n">Оплачено</th><th class="n">Осталось</th><th>Когда должен оплатить</th><th>Статус</th><th></th></tr></thead><tbody>${rows}${oldRow}</tbody></table></div>` : '<p class="pos"><b>✓ Все заказы оплачены</b></p>'}
        <p class="mut" style="margin-top:6px"><small>«📅 Срок» — записать, как договорились по заказу (дата, части, «сразу», 2 недели, 1 месяц…): запись сохранится в «Накладных» и попадёт в напоминания агенту. Без записи действует стандартный график клиента. Что оплачено — считается от долга: оплаты закрывают самые старые заказы.</small></p>`;
    };
    const payTab = () => {
      if (typeof LX === 'undefined' || !LX.has()) return '<p class="mut">Данные LINKO не загружены — нажмите «🔄 Обновить» вверху.</p>';
      const pays = LX.model().payments.filter(p => LX.norm(p.client) === ctx.k).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
      if (!pays.length) return '<p class="mut">Оплат за период нет.</p>';
      const tot = pays.reduce((a, p) => a + p.amount, 0);
      return `<p style="margin:0 0 8px">Оплачено за период: <b class="pos">$${f(tot)}</b> · ${pays.length} оплат${c.lastPay ? ` · последняя ${UI.dateRu(c.lastPay)}` : ''}</p>
        <div class="tscroll" style="max-height:380px"><table><thead><tr><th>Дата</th><th>Время</th><th class="n">Сумма $</th><th>Как</th><th>Принял</th></tr></thead><tbody>${pays.map(p => `<tr><td>${UI.dateRu(p.date)}</td><td>${esc(p.time || '')}</td><td class="n"><b class="pos">${f(p.amount)}</b></td><td>${p.bal ? 'карта / банк <small class="mut">(по балансу)</small>' : esc(p.ptype || p.type || '—')}</td><td>${esc(p.courier || p.by || p.agent || '')}</td></tr>`).join('')}</tbody></table></div>`;
    };
    const draw = () => {
      const notes = NOTES.of(name), prom = NOTES.promises(d).filter(p => p.client === name);
      const P = pts.slice(-30);
      const daysTab = () => `        <h4 class="ch">По дням</h4>${P.length > 1 ? CH.columns(P.map(p => ({ label: UI.dm(p.date), values: [Math.max(0, p.ds), Math.max(0, p.dp)] })), [{ name: 'Купил', color: 'var(--c1)' }, { name: 'Оплатил', color: 'var(--c3)' }], { fmt: UI.fmt0, height: 200 }) : '<p class="mut">История появится после нескольких дней загрузок.</p>'}
        ${P.length ? `<div class="tscroll" style="max-height:220px"><table><thead><tr><th>День</th><th class="n">Купил</th><th class="n">Оплатил</th><th class="n">Баланс на конец дня</th></tr></thead><tbody>${P.slice().reverse().map(p => `<tr><td>${UI.dateRu(p.date)}${p.first ? ' <small class="mut">(с начала периода)</small>' : ''}</td><td class="n">${p.ds ? f(p.ds) : '—'}</td><td class="n">${p.dp ? `<b class="pos">${f(p.dp)}</b>` : '—'}</td><td class="n ${p.b1 <= -0.5 ? 'neg' : ''}">${Math.abs(p.b1) < 0.5 ? '0' : f(p.b1)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      const buyTab = () => `${typeof LX !== 'undefined' ? LX.card(name) : ''}`;
      const notesTab = () => `        <h4 class="ch">Заметки и обещания</h4>
        ${notes.length ? `<ul class="notes">${notes.map(n => { const pr = prom.find(p => p.at === n.at); return `<li><div><small class="mut">${new Date(n.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small> ${n.promise ? UI.pill(pr?.status === 'kept' ? 'good' : pr?.status === 'overdue' ? 'crit' : pr?.status === 'today' ? 'warn' : 'info', `обещал оплатить ${UI.dm(n.promise)}${n.sum ? ' $' + f(n.sum) : ''}${pr?.status === 'kept' ? ' · оплатил' : pr?.status === 'overdue' ? ' · просрочено' : ''}`) : ''}<div>${esc(n.text || '')}</div></div><button class="btn gray sm" data-ndel="${esc(n.at)}" aria-label="Удалить заметку">✕</button></li>`; }).join('')}</ul>` : '<p class="mut">Заметок нет. Запишите итог звонка или обещание оплатить — ИИ и сигналы будут это учитывать.</p>'}
        <h4 class="ch">Задания</h4>
        ${tasks.length ? `<ul class="notes">${tasks.map(t => `<li><div>${UI.pill(t.status === 'done' ? 'good' : t.status === 'overdue' ? 'crit' : 'info', t.status === 'done' ? 'выполнено' : t.status === 'overdue' ? 'просрочено' : 'в работе')} <b>${esc(t.kind)}</b>${t.target ? ' $' + f(t.target) : ''}${t.due ? ` до ${UI.dateRu(t.due)}` : ''}${t.fact ? ` · сделано $${f(t.fact)}` : ''}<div>${esc(t.text || '')}</div></div></li>`).join('')}</ul>` : '<p class="mut">Заданий по клиенту нет.</p>'}`;
      const tabs = [['ord', `📦 Заказы и сроки${ORD.nlate ? ` <span class="pill crit">${ORD.nlate}</span>` : ''}`], ['pay', '💵 Оплаты'], ['days', '📈 По дням'], ['buy', '🛒 Покупки'], ['notes', '📝 Заметки и задания']];
      if (!CARD.tab || !tabs.some(t => t[0] === CARD.tab)) CARD.tab = 'ord';
      const body = { ord: ordTab, pay: payTab, days: daysTab, buy: buyTab, notes: notesTab }[CARD.tab]();
      $('#cBody', m.el).innerHTML = `<nav class="tabs" style="margin:14px 0 12px">${tabs.map(([k, t]) => `<a href="#" data-ctab="${k}" class="${CARD.tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>${body}`;
      m.el.querySelectorAll('[data-ctab]').forEach(a => a.onclick = e => { e.preventDefault(); CARD.tab = a.dataset.ctab; draw(); });
      const sp = $('#cShowPaid', m.el); if (sp) sp.onchange = () => { CARD.showPaid = sp.checked; draw(); };
      const cv = $('#cOrdCsv', m.el); if (cv) cv.onclick = () => CARD.csvOrders(name, ORD);
      const refresh = () => { ORD = CARD.calc(ctx); draw(); };
      m.el.querySelectorAll('[data-term]').forEach(b => b.onclick = () => CARD.termDialog(ORD.byId[b.dataset.term], name, c, refresh));
      m.el.querySelectorAll('[data-prom]').forEach(b => b.onclick = () => { const o = ORD.byId[b.dataset.prom]; noteDialog(`По заказу №${o.id} от ${UI.dm(o.d)}: `, o.left); });
      m.el.querySelectorAll('[data-ndel]').forEach(b => b.onclick = () => { if (confirm('Удалить заметку?')) { NOTES.del(name, b.dataset.ndel); draw(); } });
    };
    draw();
    $('#cX', m.el).onclick = m.close;
    m.el.addEventListener('click', e => { if (e.target.closest('[data-agent]')) m.close(); });
    $('#cNote', m.el).onclick = () => noteDialog();
    $('#cTask', m.el).onclick = () => {
      const kinds = d.kinds || ['Сбор оплаты', 'Продажа', 'Погашение долга', 'Другое'];
      const f2 = modal(`<h3>Задание агенту ${esc(c.agent)}</h3><p class="mut" style="margin-top:0">Клиент: ${esc(name)} · долг $${f(c.debt)}</p><div class="form">
        <label>Тип<select id="tK">${kinds.map(k => `<option>${esc(k)}</option>`).join('')}</select></label><label>Цель, $<input type="number" min="0" id="tT" value="${c.debt ? Math.round(Math.min(c.debt, 1000)) : ''}"></label>
        <label>Срок<input type="date" id="tD" value="${UI.localDate(Date.now() + 3 * 864e5)}"></label><label style="grid-column:1/-1">Что сделать<input id="tX" value="${c.debt ? 'Собрать оплату по долгу' : 'Взять заказ'}"></label></div>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="tCx">Отмена</button><button class="btn" id="tOk">Создать</button></div>`);
      $('#tCx', f2.el).onclick = f2.close;
      $('#tOk', f2.el).onclick = async () => { const r = await CRMLocal.request('POST', '/api/ag/tasks', { client: name, kind: $('#tK', f2.el).value, target: +$('#tT', f2.el).value || 0, due: $('#tD', f2.el).value, text: $('#tX', f2.el).value }); if (r.error) return toast(r.error); await CRMLocal.flush(); f2.close(); m.close(); toast('Задание создано'); CARD.open(name); };
    };
    const tg = $('#cTg', m.el);
    if (tg) tg.onclick = () => {
      const def = `По клиенту ${name}: долг $${f(c.debt)}${c.lastPay ? `, последняя оплата ${UI.dateRu(c.lastPay)}` : ', оплат не было'}${c.pool ? `, план сбора $${f(c.pool)} (собрано ${pct(c.paid, c.pool)})` : ''}. ${ORD.nlate ? `\nПросрочено по заказам: ${ORD.open.filter(o => o.state === 'late').map(o => `№${o.id} от ${UI.dm(o.d)} — $${f(o.late)} (срок был ${UI.dm(o.parts.find(p => p.st === 'late').d)})`).join('; ')}.` : ''} Свяжитесь с клиентом и сообщите результат.`;
      const f2 = modal(`<h3>Сообщение агенту ${esc(c.agent)}</h3><textarea id="gT" rows="5" style="width:100%;font:inherit;padding:8px;border:1px solid var(--line-2);border-radius:8px">${esc(def)}</textarea>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="gX">Отмена</button><button class="btn" id="gOk">✈ Отправить</button></div>`);
      $('#gX', f2.el).onclick = f2.close;
      $('#gOk', f2.el).onclick = async () => { try { await TG.send(conf.chats[c.agent].id, esc($('#gT', f2.el).value)); f2.close(); toast('Отправлено агенту'); } catch (e) { toast(e.message); } };
    };
  },
};

// any client / agent name marked with data-client / data-agent opens its card / page
document.addEventListener('click', e => {
  const a = e.target.closest('[data-client],[data-agent]'); if (!a || e.target.closest('input,select,textarea')) return;
  e.preventDefault();
  if (a.dataset.client) CARD.open(a.dataset.client);
  else { AGP.agent = a.dataset.agent; if (location.hash === '#/agent') route(); else location.hash = '#/agent'; }
});
// windows close with Esc and when you go to another section
addEventListener('hashchange', () => document.querySelectorAll('.modal-bg').forEach(m => m.remove()));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const all = document.querySelectorAll('.modal-bg'); if (all.length) all[all.length - 1].remove(); } });
