// Должники по агентам (Деньги → 🧾 Должники по агентам): every debt in three baskets that count from the end of its term —
// 🟢 до 30 дней (in the term), 🟠 31–60 (overdue up to 30 days: take the money this week), 🔴 61+ (return the goods or take the money now).
// For an ordinary 30-day order that is the age of the goods: up to 30 / 31–60 / 61+ days since they were taken; an order given for
// 60 days (set on the order here, or for the whole client / contract in «Рассрочка и договоры») moves by its term.
// Agents → their debtors (when the goods were taken, the last payment, the baskets, what to do) → each debtor's unpaid orders.
// The counting is done by the Google auto-loader (autolinko.gs instCalc_) every 5 minutes into inst-state.json — the same numbers
// the agents get every morning in Telegram and you get in the Excel report. An order's own term is kept in ext.inst.orders.
window.EXT_PAGES = window.EXT_PAGES || {};

const DEBT = {
  b: '', agent: '', q: '', open: new Set(), openC: new Set(),
  BK: { r: ['🔴', '61+ дней', 'var(--st-crit,#cc3a2f)'], o: ['🟠', '31–60 дней', 'var(--st-serious,#e08a1e)'], g: ['🟢', 'до 30 дней', 'var(--good,#3fbf73)'] },
  todo: c => (c.r > 0.5 ? (c.age > 120 ? 'Стоп-отгрузка. Руководитель лично: погасить сейчас или вернуть товар' : 'Срочно: вернуть товар или забрать деньги') : c.o > 0.5 ? 'Забрать деньги на этой неделе' : c.late > 0.5 ? 'Напомнить о просроченной части' : c.today > 0.5 ? 'Сегодня срок части' : 'В сроке'),
  terms: [30, 45, 60, 75, 90],
};

EXT_PAGES.debt = async el => {
  await CRMLocal.ready;
  el.innerHTML = `<div class="page-head"><div><h2>🧾 Должники по агентам</h2><div class="sub">Три корзины: 🟢 до 30 дней · 🟠 31–60 · 🔴 61+ — считаются от конца срока заказа (обычно 30 дней; заказ на 2 месяца — от 60-го дня)</div></div></div><div id="dbBody"><p class="mut">Загружаю…</p></div>`;
  const body = $('#dbBody', el), ic = INST.cfg();
  if (!INST.cloud()) { body.innerHTML = UI.empty('Нужна синхронизация', 'Долги по заказам считает скрипт автозагрузки — включите <a href="#/cloud">Синхронизация и настройки</a>.'); return; }
  if (!ic.on) { body.innerHTML = UI.empty('Включите рассрочку', 'Корзины считаются вместе с рассрочкой по заказам: <a href="#/inst">Деньги → Рассрочка и договоры → ⚙ Настройки</a> → «Включить» → «Сохранить». Через 5 минут здесь появятся все должники.'); return; }
  const st = await INST.state(); if (!el.isConnected) return;
  if (!st) { body.innerHTML = UI.empty('Ещё не посчитано', 'Скрипт автозагрузки считает должников каждые 5 минут. Если прошло больше 10 минут — скопируйте скрипт заново: <a href="#/cloud">Синхронизация и настройки</a>.'); return; }
  const fresh = !(st.clients || []).length || 'g' in st.clients[0]; // the old script has no baskets yet
  const all = (st.clients || []).map(c => ({ ...c, g: c.g ?? 0, o: c.o ?? 0, r: c.r ?? c.late ?? 0, age: c.age ?? 0 })), m = INST.money;
  const sum = (l, k) => l.reduce((a, c) => a + (c[k] || 0), 0), cnt = (l, k) => l.filter(c => c[k] > 0.5).length;
  const old120 = all.filter(c => c.r > 0.5 && c.age > 120);
  // agents with their baskets, the most red first
  const by = {}; for (const c of all) (by[c.agent] ||= []).push(c);
  const agents = Object.entries(by).map(([a, l]) => ({ a, l, debt: sum(l, 'debt'), r: sum(l, 'r'), o: sum(l, 'o'), g: sum(l, 'g'), rn: cnt(l, 'r'), on: cnt(l, 'o') })).sort((x, y) => y.r - x.r || y.o - x.o || y.debt - x.debt);
  const fit = c => (!DEBT.b || c[DEBT.b] > 0.5) && (!DEBT.q || LX.norm(c.name).includes(LX.norm(DEBT.q)));
  const bar = (r, o, g) => { const t = r + o + g || 1; return `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line,#ddd);min-width:120px">${[['r', r], ['o', o], ['g', g]].map(([k, v]) => v > 0 ? `<div style="width:${v / t * 100}%;background:${DEBT.BK[k][2]}"></div>` : '').join('')}</div>`; };
  const tg = CRMLocal.ext().tg || {};
  const orderRows = c => `<tr><td colspan="9" style="background:var(--card-2,#f5f8fa)"><table style="width:100%"><thead><tr><th>№ заказа</th><th>Дата</th><th class="n">Сумма</th><th class="n">Осталось</th><th class="n">Дней</th><th>Срок</th><th>Корзина</th></tr></thead><tbody>
      ${c.orders.map(o => { const b = o.b || (o.late > 0.5 ? 'r' : 'g'), own = ic.orders[o.id]?.days; return `<tr><td>№${esc(o.id)}</td><td>${UI.dateRu(o.d)}</td><td class="n">${m(o.s)}</td><td class="n"><b>${m(o.left)}</b></td><td class="n">${o.age ?? '—'}</td>
        <td><select data-dbterm="${esc(o.id)}" style="padding:2px 4px;font-size:12px" title="Срок этого заказа"><option value="">${c.days} дн. (как у клиента)</option>${DEBT.terms.filter(t => t !== c.days).map(t => `<option value="${t}" ${own === t ? 'selected' : ''}>${t} дн.</option>`).join('')}${own && !DEBT.terms.includes(own) ? `<option value="${own}" selected>${own} дн.</option>` : ''}</select></td>
        <td style="color:${DEBT.BK[b][2]};font-weight:700">${DEBT.BK[b][0]} ${DEBT.BK[b][1]}</td></tr>`; }).join('')}
      ${c.old > 0.5 ? `<tr><td colspan="3" class="neg">Долг старше 180 дней (заказы раньше)</td><td class="n neg"><b>${m(c.old)}</b></td><td class="n">180+</td><td></td><td style="color:${DEBT.BK.r[2]};font-weight:700">🔴 61+ дней</td></tr>` : ''}</tbody></table>
      <div class="bar" style="margin-top:6px"><button class="btn gray sm" data-dbown="${esc(c.name)}" type="button">Срок для всех заказов клиента…</button><span class="mut">Сейчас: ${c.days} дн., ${c.parts} ч.${c.type === 'contract' ? ' · по договору' : ''}</span></div></td></tr>`;
  const clientRow = c => { const open = DEBT.openC.has(c.name), hot = c.r > 0.5;
    return `<tr data-dbc="${esc(c.name)}" style="cursor:pointer${hot ? ';background:color-mix(in srgb, var(--st-crit,#cc3a2f) 7%, transparent)' : ''}"><td>${open ? '▾' : '▸'} <b>${esc(c.name)}</b>${INST.typeTag(c)}${c.phone ? `<div class="mut" style="font-size:12px">☎ ${esc(c.phone)}</div>` : ''}</td>
      <td class="n"><b>${m(c.debt)}</b></td><td class="n" style="color:${DEBT.BK.r[2]};font-weight:700">${c.r > 0.5 ? m(c.r) : '—'}</td><td class="n" style="color:${DEBT.BK.o[2]};font-weight:600">${c.o > 0.5 ? m(c.o) : '—'}</td><td class="n">${c.g > 0.5 ? m(c.g) : '—'}</td>
      <td>${c.since ? UI.dateRu(c.since) : '<span class="neg">больше 180 дн. назад</span>'}<div class="mut" style="font-size:12px">${c.since ? c.age + ' дн. назад' : ''}</div></td>
      <td>${c.lastPay ? UI.dateRu(c.lastPay) : '<span class="mut">в периоде не платил</span>'}</td><td>${c.days} дн.${c.type === 'contract' ? '<div class="mut" style="font-size:12px">договор</div>' : ''}</td>
      <td style="${hot ? 'color:var(--st-crit,#cc3a2f);font-weight:700' : ''}">${esc(DEBT.todo(c))}</td></tr>` + (open ? orderRows(c) : ''); };
  const clientTable = l => `<div class="tscroll"><table><thead><tr><th>Клиент</th><th class="n">Долг</th><th class="n">🔴 61+</th><th class="n">🟠 31–60</th><th class="n">🟢 до 30</th><th>Товар брал</th><th>Последняя оплата</th><th>Срок</th><th>Что делать</th></tr></thead><tbody>${l.map(clientRow).join('')}</tbody></table></div>`;

  body.innerHTML = `${fresh ? '' : '<p class="neg"><b>Скрипт Google старый</b> — корзины ещё не считаются. Скопируйте его заново: <a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт» → вставить → setup.</p>'}
    <div class="kpis">
      ${UI.tile('🔴 61+ дней', m(sum(all, 'r')), { sub: `${cnt(all, 'r')} кл. · из них старше 120 дн.: ${old120.length} — вернуть товар или забрать деньги`, tone: sum(all, 'r') ? 'bad' : 'good' })}
      ${UI.tile('🟠 31–60 дней', m(sum(all, 'o')), { sub: `${cnt(all, 'o')} кл. — забрать деньги на этой неделе`, tone: sum(all, 'o') ? 'warn' : 'good' })}
      ${UI.tile('🟢 До 30 дней', m(sum(all, 'g')), { sub: `${cnt(all, 'g')} кл. — в сроке, сегодня срок частей ${m(sum(all, 'today'))}` })}
      ${UI.tile('Долг всего', m(sum(all, 'debt')), { sub: `${all.length} кл. · расчёт ${new Date(st.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` })}</div>
    <div class="bar" style="flex-wrap:wrap"><nav class="tabs">${[['', 'Все'], ['r', '🔴 61+'], ['o', '🟠 31–60'], ['g', '🟢 до 30']].map(([k, t]) => `<a href="#" data-dbb="${k}" class="${DEBT.b === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
      <select id="dbAg"><option value="">Все агенты</option>${agents.map(x => `<option ${x.a === DEBT.agent ? 'selected' : ''}>${esc(x.a)}</option>`).join('')}</select>
      <input id="dbQ" placeholder="Найти клиента" value="${esc(DEBT.q)}" style="min-width:180px">
      <span class="spacer" style="flex:1"></span><button class="btn gray sm" id="dbXls" type="button">⬇ Excel</button></div>
    ${agents.filter(x => !DEBT.agent || x.a === DEBT.agent).map(x => { const l = x.l.filter(fit).sort((a, b) => b.r - a.r || b.o - a.o || b.debt - a.debt), open = DEBT.agent === x.a || DEBT.open.has(x.a) || !!DEBT.q;
      if (!l.length) return '';
      return `<section class="panel w12" style="margin-bottom:12px"><div data-dba="${esc(x.a)}" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;cursor:pointer">
        <h4 style="margin:0;min-width:200px">${open ? '▾' : '▸'} ${esc(x.a)}</h4><div style="flex:1;min-width:160px">${bar(x.r, x.o, x.g)}</div>
        <span style="color:${DEBT.BK.r[2]};font-weight:700">🔴 ${m(x.r)} <small>(${x.rn})</small></span><span style="color:${DEBT.BK.o[2]};font-weight:600">🟠 ${m(x.o)} <small>(${x.on})</small></span><span>🟢 ${m(x.g)}</span><span class="mut">долг ${m(x.debt)} · ${x.l.length} кл.</span>
        ${tg.token && tg.chats?.[x.a]?.id && st.texts?.agents?.[x.a] ? `<button class="btn gray sm" data-dbsend="${esc(x.a)}" type="button">✈ Отправить агенту</button>` : ''}</div>
        ${open ? clientTable(l) : ''}</section>`; }).join('') || UI.empty('Должников нет', DEBT.b ? 'В этой корзине никого.' : '')}
    <p class="mut">Корзина считается от конца срока каждого заказа: обычный заказ на 30 дней — 🟢 первые 30 дней, 🟠 с 31-го по 60-й, 🔴 с 61-го. Заказ, выданный на 60 дней, — 🟢 до 60-го дня, 🟠 61–90, 🔴 с 91-го: срок ставится у заказа (раскройте клиента) или для всех заказов клиента. Оплаты закрывают самые старые заказы. Долг, который старше известных заказов (180 дней), — всегда 🔴. Каждое утро агенту приходит этот же список в Telegram: сначала 🔴, потом 🟠, потом 🟢 с частями на сегодня.</p>`;

  const redraw = () => EXT_PAGES.debt(el);
  body.querySelectorAll('[data-dbb]').forEach(a => a.onclick = e => { e.preventDefault(); DEBT.b = a.dataset.dbb; redraw(); });
  $('#dbAg', body).onchange = e => { DEBT.agent = e.target.value; redraw(); };
  $('#dbQ', body).onchange = e => { DEBT.q = e.target.value.trim(); redraw(); };
  body.querySelectorAll('[data-dba]').forEach(h => h.onclick = e => { if (e.target.closest('button')) return; const a = h.dataset.dba; if (DEBT.open.has(a)) DEBT.open.delete(a); else DEBT.open.add(a); redraw(); });
  body.querySelectorAll('[data-dbc]').forEach(r => r.onclick = () => { const n = r.dataset.dbc; if (DEBT.openC.has(n)) DEBT.openC.delete(n); else DEBT.openC.add(n); redraw(); });
  body.querySelectorAll('[data-dbterm]').forEach(s => { s.onclick = e => e.stopPropagation(); s.onchange = () => { const id = s.dataset.dbterm, v = Number(s.value); const x = { ...(ic.orders[id] || {}) }; delete x.plan; if (v) x.days = v; else delete x.days; if (Object.keys(x).length) ic.orders[id] = x; else delete ic.orders[id]; INST.changed(v ? `Заказ №${id}: срок ${v} дн. — пересчёт за 5 минут` : `Заказ №${id}: срок как у клиента`); }; });
  body.querySelectorAll('[data-dbown]').forEach(b => b.onclick = e => { e.stopPropagation(); INST.ownDialog(b.dataset.dbown); });
  body.querySelectorAll('[data-dbsend]').forEach(b => b.onclick = async e => { e.stopPropagation(); b.disabled = true; try { await TG.send(tg.chats[b.dataset.dbsend].id, esc(st.texts.agents[b.dataset.dbsend])); toast('Список отправлен: ' + b.dataset.dbsend); } catch (er) { toast(er.message); } finally { b.disabled = false; } });
  $('#dbXls', body).onclick = () => UI.csv('должники-по-срокам', [['Агент', 'Клиент', 'Телефон', 'Долг', '61+ дней', '31–60 дней', 'до 30 дней', 'Товар брал', 'Дней', 'Последняя оплата', 'Срок, дн.', 'Что делать'],
    ...all.filter(fit).filter(c => !DEBT.agent || c.agent === DEBT.agent).sort((a, b) => a.agent.localeCompare(b.agent) || b.r - a.r || b.o - a.o).map(c => [c.agent, c.name, c.phone || '', Math.round(c.debt), Math.round(c.r), Math.round(c.o), Math.round(c.g), c.since ? UI.dateRu(c.since) : 'больше 180 дн.', c.age, c.lastPay ? UI.dateRu(c.lastPay) : '', c.days, DEBT.todo(c)])]);
};
