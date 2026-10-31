// Сверка складов (Склад → Сверка складов): every morning the store keeper of each warehouse counts all goods in his cabinet (me.html,
// Telegram Mini App) without seeing the LINKO numbers. The auto-loader keeps LINKO «Всего» at the moment he presses «Начать сверку»,
// compares on «Отправить», messages the supervisor and saves the count to inbox/; this module pulls it (via ATK.pull → INBOX_HANDLERS)
// and shows only the discrepancies: shortage / surplus in units and in $ (cost from the stock uploads). «Пересчитать» sends chosen
// items back to the store keeper. Store keepers get their cabinet as agents/tg/<telegram id>.json (role 'store'); stores.json lists
// them for the auto-loader's reminder after the deadline.
// Every discrepancy gets a decision when the count is accepted: «fix» (an accounting error, corrected in LINKO), «found» (found / mixed up),
// «charge» (a shortage charged to the store keeper — CRM counts the amount at unit cost), «recount» (sent back). Stored per count as sub.dec.
// Stored in the synced state: ext.wcount = { deadline: '10:00', remind: '09:00', stores: { [telegram id]: { name, wh, on, tgAt } }, subs: [ … ] }.
window.EXT_PAGES = window.EXT_PAGES || {};
window.INBOX_HANDLERS = window.INBOX_HANDLERS || {};

const WC = {
  sel: null,
  cfg() { const x = CRMLocal.ext(); const c = (x.wcount ||= { deadline: '10:00', stores: {}, subs: [] }); c.stores ||= {}; c.subs ||= []; return c; },
  day: iso => UI.localDate(Date.parse(iso)),
  hm: iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  branchOf(wh) { const B = CRMLocal.ext().linkoBranch || {}; return Object.keys(B).find(b => B[b] === wh) || null; },
  // pieces in one box, from the product name — the same rule as packOf in me.js (change both together); c.packs overrides by article
  FP: { 'OF-00202': 60, 'OF-00201': 60, 'OF-00205': 60, 'OF-00208': 50, 'OF-00301': 18, 'OF-00211': 40, 'OF-00221': 40, 'AF-00511': 60, 'AF-00512': 40 },
  packAuto(i) {
    const n = String(i.name || '').toUpperCase(), b = String(i.brand || '').toUpperCase();
    for (const k in WC.FP) if (n.includes(k)) return WC.FP[k];
    const m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:LTR|LT|ЛИТРА|ЛИТР|Л|L)(?![A-ZА-ЯЁ])/), L = m ? Number(m[1].replace(',', '.')) : 0;
    if (!L || L >= 20) return 1;
    if (L <= 1.5) return 12;
    if (L === 4 && /MITANOL|МИТАНОЛ/.test(n + ' ' + b)) return 5;
    if (L === 4 || L === 5) return 4;
    return 1;
  },
  DOW: ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  DEC: { fix: '✓ Ошибка учёта — исправлю в LINKO', found: '🔎 Найдено / пересорт', charge: '💸 Недостача — удержать с завсклада', recount: '↻ Пересчитать' },
  // cost of one unit: the newest stock upload of the warehouse (by article), else LINKO «Прибыль по товарам» (cost of sales ÷ units sold, by name)
  costs(wh) {
    const S = CRMLocal.engine.getState(), u = (S.wh.uploads || []).filter(x => x.warehouse === wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0], byArt = new Map(), byName = new Map();
    for (const r of u?.rows || []) if (r.cost > 0) byArt.set(String(r.art), r.cost);
    try { for (const p of (typeof LX !== 'undefined' ? LX.d('prods') : [])) { const n = LX.n(p.actual_sales_count) || LX.n(p.sales_count), c = LX.n(p.sales_net_cost); if (n > 0 && c > 0) byName.set(LX.norm(p.name), c / n); } } catch { /* no LINKO data */ }
    return { get: (art, name) => byArt.get(String(art)) || (typeof LX !== 'undefined' ? byName.get(LX.norm(name)) : 0) || 0 };
  },
  view(sub) {
    const cost = WC.costs(sub.warehouse);
    const rows = sub.items.map(i => ({ ...i, d: i.fact - i.linko, moved: i.fact !== i.linko && i.fact === i.now, cost: cost.get(i.art, i.name) }));
    const diff = rows.filter(i => i.fact !== i.linko && !i.moved);
    const short = diff.filter(i => i.d < 0), plus = diff.filter(i => i.d > 0);
    const charged = Object.entries(sub.dec || {}).filter(([, d]) => d.k === 'charge').reduce((t, [, d]) => t + (Number(d.sum) || 0), 0);
    return { rows, diff, moved: rows.filter(i => i.moved), short, plus, shortSum: short.reduce((s, i) => s + -i.d * i.cost, 0), plusSum: plus.reduce((s, i) => s + i.d * i.cost, 0), charged };
  },

  // a count from inbox/: a full count is a new record; a recount updates the items of that warehouse's last count of the day
  apply(m) {
    const c = WC.cfg(), day = WC.day(m.at);
    // m.result (auto-loader): 'recount' — names sent back to the store keeper; 'ok' — matched; 'final' — the recount did not match, closed
    if (m.partial) {
      const last = c.subs.filter(s => s.who === m.who && s.day === day && !s.partial).at(-1);
      if (last) {
        for (const it of m.items) { const i = last.items.findIndex(x => x.art === it.art); if (i >= 0) last.items[i] = it; else last.items.push(it); }
        last.status = 'new'; last.recount = []; last.recountAt = m.at; if (m.result) { last.result = m.result; last.round = 2; } return true;
      }
    }
    c.subs.push({ id: Date.parse(m.at) + '-' + m.who, who: m.who, name: m.name, warehouse: m.warehouse, day, start_at: m.start_at, at: m.at, partial: !!m.partial, short: !!m.short, total_items: m.total_items || 0, items: m.items, photo: m.photo || '', comment: m.comment || '', status: m.result === 'recount' ? 'recount' : 'new', recount: m.result === 'recount' ? (m.recount || []) : [], ...(m.result ? { result: m.result, round: m.round || 1 } : {}) });
    c.subs = c.subs.slice(-400);
    return true;
  },

  // the store keepers' cabinets + stores.json for the reminder
  async publish() {
    const c = WC.cfg(), cl = typeof AC !== 'undefined' ? AC.cloud() : null; if (!cl) return 0;
    const on = Object.entries(c.stores).filter(([, s]) => s.on && s.wh);
    const bot = CRMLocal.ext().tg?.token ? await AC.bot() : '';
    for (const [who, s] of on) {
      const last = c.subs.filter(x => x.who === who).at(-1), recount = last && last.status === 'recount' ? last.recount : [];
      const S = CRMLocal.engine.getState(), up = (S.wh.uploads || []).filter(u => u.warehouse === s.wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0];
      const items = (up?.rows || []).map(r => ({ art: String(r.art), name: r.name, brand: r.brand || '' })); // names only: the count is blind
      const file = { v: 1, role: 'store', who, name: s.name, warehouse: s.wh, branch: WC.branchOf(s.wh), deadline: c.deadline || '10:00', boss: AC.boss() || null, bot: bot || null, chat: typeof CHAT !== 'undefined' && CHAT.url ? CHAT.url() : null, at: new Date().toISOString(), recount: recount.map(a => ({ art: a, name: last.items.find(i => i.art === a)?.name || a })), items,
        mode: c.mode || 'full', fullDay: Number(c.fullDay || 1), extra: Number(c.extra ?? 8), packs: c.packs || {} };
      await AC.gh(cl, 'PUT', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада', content: AC.b64(JSON.stringify(file)) });
    }
    await AC.gh(cl, 'PUT', 'stores.json', { message: 'CRM: склады и срок сверки', content: AC.b64(JSON.stringify({ deadline: c.deadline || '10:00', remind: c.remind || '09:00', app: AC.web() ? AC.miniUrl() : '', list: on.map(([who, s]) => ({ who, name: s.name, warehouse: s.wh })) })) });
    return on.length;
  },
  async connect(who) {
    const s = WC.cfg().stores[who], url = AC.miniUrl();
    await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: { type: 'web_app', text: 'Кабинет склада', web_app: { url } } });
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: `<b>Кабинет склада ${esc(s.wh)}</b>\nКаждое утро до ${esc(WC.cfg().deadline || '10:00')} пересчитайте товары и отправьте сверку — прямо здесь, в Telegram.`, reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } });
  },
  async notify(who, html) {
    const url = AC.web() ? AC.miniUrl() : '';
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: html, ...(url ? { reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } } : {}) });
  },
};
INBOX_HANDLERS.count = m => WC.apply(m);

EXT_PAGES.wcount = async el => {
  await CRMLocal.ready;
  const c = WC.cfg(), f = UI.fmt0, t0 = UI.localDate(Date.now()), $$ = v => '$' + f(v), late = new Date().toTimeString().slice(0, 5) >= (c.deadline || '10:00');
  let whs = []; try { whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* none */ }
  const tg = CRMLocal.ext().tg || {}, chats = { ...(tg.seen || {}) }; for (const v of Object.values(tg.chats || {})) if (v?.id) chats[v.id] = v;
  const stores = Object.entries(c.stores);
  // once per session: refresh the store keepers' cabinets and stores.json (reminder time, button address) without waiting for a change
  if (!WC._pub && stores.length) { WC._pub = true; WC.publish().catch(() => { WC._pub = false; }); }
  const todayOf = who => c.subs.filter(s => s.who === who && s.day === t0 && !s.partial).at(-1);
  if (!WC.sel || !c.subs.some(s => s.id === WC.sel)) WC.sel = (c.subs.filter(s => s.day === t0).at(-1) || c.subs.at(-1))?.id || null;
  const sub = c.subs.find(s => s.id === WC.sel), V = sub ? WC.view(sub) : null;
  const days = [...new Set(c.subs.map(s => s.day))].sort().reverse().slice(0, 14);
  const freq = new Map(); for (const s of c.subs.filter(x => days.includes(x.day))) for (const i of WC.view(s).diff) { const k = s.warehouse + '|' + i.art, e = freq.get(k) || freq.set(k, { wh: s.warehouse, name: i.name, n: 0, sum: 0 }).get(k); e.n++; e.sum += i.d; }
  const often = [...freq.values()].filter(e => e.n >= 2).sort((a, b) => b.n - a.n);
  const tiles = stores.length ? stores.map(([who, s]) => { const t = todayOf(who), v = t ? WC.view(t) : null; return UI.tile(esc(s.wh), t ? (v.diff.length ? `${v.diff.length} расх.` : '✓ сходится') : '✕ нет', { sub: t ? `сегодня в ${WC.hm(t.at)} · ${esc(s.name)}${t.status === 'recount' ? ' · ждём пересчёт' : t.result === 'final' ? ' · 🔒 зафиксировано' : t.status === 'ok' ? ' · принято' : t.result === 'ok' && t.round === 2 ? ' · сошлось после пересчёта' : ''}` : `сегодня не прислана · ${esc(s.name)}`, tone: !t ? (late ? 'bad' : 'warn') : v.diff.length ? 'warn' : 'good' }); }).join('') : UI.tile('Завскладов нет', '—', { sub: 'добавьте ниже' });
  el.innerHTML = `<div class="page-head"><div><h2>Сверка складов</h2><div class="sub">Завсклады каждое утро до ${esc(c.deadline || '10:00')} пересчитывают ${c.mode === 'short' ? 'товары (короткая сверка, полная — ' + WC.DOW[c.fullDay || 1] + ')' : 'все товары'} в своём кабинете в Telegram — вслепую, не видя цифр LINKO. Здесь — только расхождения с «Всего» в LINKO на момент начала сверки.</div></div>
    <div class="actions"><button class="btn gray" id="wcPull">Проверить сверки</button></div></div>
    <div class="kpis">${tiles}</div>
    ${sub ? UI.panel(`${esc(sub.warehouse)} · ${UI.dateRu(sub.day)} ${WC.hm(sub.at)} · ${esc(sub.name)}`, `
      <div class="bar"><label class="mut">Сверка <select id="wcSel">${c.subs.slice().reverse().slice(0, 60).map(s => `<option value="${esc(s.id)}" ${s.id === sub.id ? 'selected' : ''}>${UI.dateRu(s.day)} · ${esc(s.warehouse)}${s.partial ? ' (пересчёт)' : ''}</option>`).join('')}</select></label>
        <span class="mut">${sub.short ? `<b>короткая сверка</b> (${f(sub.items.length)} из ${f(sub.total_items)}) · ` : ''}посчитано позиций: ${f(sub.items.length)} · расхождений: <b>${f(V.diff.length)}</b> · недостача ${$$(V.shortSum)} · излишек ${$$(V.plusSum)}${sub.start_at ? '' : ' · ⚠ начало сверки не зафиксировано — сравнение с остатком на момент отправки'}</span></div>
      ${sub.status === 'recount' ? `<p class="mut">↻ <b>Завскладу автоматически отправлены названия ${f(sub.recount.length)} поз. на пересчёт</b> (без цифр). Ждём вторую попытку — решения выберете после неё.</p>` : sub.result === 'final' ? '<p class="neg"><b>🔒 Пересчёт не сошёлся — расхождение зафиксировано окончательно.</b> Завсклад получил список названий, больше в этот день он сверку не отправляет.</p>' : sub.result === 'ok' && sub.round === 2 ? '<p class="pos"><b>✅ После пересчёта всё сошлось</b> — завсклад получил «склад в порядке».</p>' : ''}
      ${sub.comment ? `<p>💬 ${esc(sub.comment)}</p>` : ''}${sub.photo ? `<p><a href="#" data-ph="${esc(sub.photo)}">📷 фото со склада</a></p>` : ''}
      ${V.diff.length ? LX.table(['Товар', '#По LINKO', '#Факт', '#Разница', '#В $', 'Решение'], V.diff.sort((a, b) => a.d * (a.cost || 1) - b.d * (b.cost || 1)).map(i => { const d = (sub.dec || {})[i.art] || {}, auto = i.d < 0 && i.cost ? Math.round(-i.d * i.cost * 100) / 100 : ''; return `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td class="n">${f(i.linko)}</td><td class="n"><b>${f(i.fact)}</b></td><td class="n ${i.d < 0 ? 'neg' : 'pos'}"><b>${i.d > 0 ? '+' : ''}${f(i.d)}</b></td><td class="n">${i.cost ? (i.d < 0 ? '−' : '+') + $$(Math.abs(i.d) * i.cost) : '—'}</td><td><select data-dec="${esc(i.art)}" aria-label="Решение"><option value="">— выберите —</option>${Object.entries(WC.DEC).filter(([k]) => k !== 'recount' && (k !== 'charge' || i.d < 0)).map(([k, t]) => `<option value="${k}" ${d.k === k ? 'selected' : ''}>${t}</option>`).join('')}</select>${i.d < 0 ? `<label class="mut" data-sumw="${esc(i.art)}" style="display:${d.k === 'charge' ? 'flex' : 'none'};gap:6px;align-items:center;margin-top:4px">сумма, $ <input type="number" min="0" step="0.01" data-sum="${esc(i.art)}" value="${d.k === 'charge' ? d.sum : auto}" placeholder="${auto ? '' : 'укажите'}" style="width:90px"></label>` : ''}</td></tr>`; })) : '<p class="pos"><b>✓ Всё сходится с LINKO</b></p>'}
      ${V.charged ? `<p><b>💸 Удержание с завсклада по этой сверке: ${$$(V.charged)}</b></p>` : ''}
      ${V.moved.length ? `<details><summary class="mut">Сошлось с LINKO после отгрузки во время сверки (${V.moved.length})</summary><ul>${V.moved.map(i => `<li>${esc(i.name)}: на начало ${f(i.linko)}, после отгрузки ${f(i.now)}, факт ${f(i.fact)}</li>`).join('')}</ul></details>` : ''}
      ${sub.status === 'recount' ? '' : `<div class="bar needs-edit" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="wcOk">${sub.status === 'ok' ? '✓ Сохранить решения' : V.diff.length ? '✓ Принять с решениями' : '✓ Принять сверку'}</button></div>`}`, { cls: 'w12', sub: 'Пересчёт идёт автоматически: при расхождении завсклад получает только названия товаров (без цифр) и пересчитывает их один раз; если снова не сошлось — расхождение фиксируется. По каждому итоговому расхождению выберите решение; «Удержать» — сумма по себестоимости (можно поправить). «Разница» = факт − LINKO: минус — недостача, плюс — излишек.' }) : UI.empty('Сверок ещё нет', 'Добавьте завскладов ниже и подключите им кабинет склада в Telegram.')}
    <div class="grid">
    ${days.length ? UI.panel('По дням', `<div class="tscroll"><table><thead><tr><th>День</th>${stores.map(([, s]) => `<th class="n">${esc(s.wh)}</th>`).join('')}</tr></thead><tbody>${days.map(d => `<tr><td>${UI.dateRu(d)}</td>${stores.map(([who]) => { const s = c.subs.filter(x => x.who === who && x.day === d && !x.partial).at(-1); if (!s) return '<td class="n neg">нет</td>'; const v = WC.view(s); return `<td class="n ${v.diff.length ? 'neg' : 'pos'}">${v.diff.length ? v.diff.length + ' расх.' : '✓'} <small class="mut">${WC.hm(s.at)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`, { cls: 'w7', sub: 'Последние 14 дней: расхождения и время отправки' }) : ''}
    ${often.length ? UI.panel('Расходятся постоянно', LX.table(['Склад', 'Товар', '#Раз за 14 дней', '#Сумма разниц'], often.slice(0, 20).map(e => `<tr><td>${esc(e.wh)}</td><td>${esc(e.name)}</td><td class="n"><b>${e.n}</b></td><td class="n ${e.sum < 0 ? 'neg' : 'pos'}">${e.sum > 0 ? '+' : ''}${f(e.sum)}</td></tr>`)), { cls: 'w5', sub: 'Повторяющаяся недостача одного товара — повод разобраться' }) : ''}
    ${(() => { const ch = []; for (const x of c.subs) for (const [art, d] of Object.entries(x.dec || {})) if (d.k === 'charge' && Number(d.sum) > 0) ch.push({ m: x.day.slice(0, 7), day: x.day, who: x.name, wh: x.warehouse, name: x.items.find(i => i.art === art)?.name || art, d: (x.items.find(i => i.art === art)?.fact ?? 0) - (x.items.find(i => i.art === art)?.linko ?? 0), sum: Number(d.sum) });
      if (!ch.length) return ''; const months = [...new Set(ch.map(x => x.m))].sort().reverse().slice(0, 3), people = [...new Set(ch.map(x => x.who + ' · ' + x.wh))];
      return UI.panel('💸 Удержания с завскладов', `<div class="tscroll"><table><thead><tr><th>Завсклад</th>${months.map(m => `<th class="n">${m.slice(5, 7)}.${m.slice(0, 4)}</th>`).join('')}</tr></thead><tbody>${people.map(p => `<tr><td>${esc(p)}</td>${months.map(m => { const t = ch.filter(x => x.who + ' · ' + x.wh === p && x.m === m).reduce((a, x) => a + x.sum, 0); return `<td class="n">${t ? '<b>' + $$(t) + '</b>' : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <details><summary class="mut">Все удержания (${ch.length})</summary>${LX.table(['День', 'Завсклад', 'Товар', '#Недостача', '#Сумма'], ch.slice().reverse().map(x => `<tr><td>${UI.dateRu(x.day)}</td><td>${esc(x.who)}</td><td>${esc(x.name)}</td><td class="n">${f(x.d)}</td><td class="n">${$$(x.sum)}</td></tr>`), { max: '320px' })}</details>`, { cls: 'w12', sub: 'Суммы из решений «Недостача — удержать с завсклада», по месяцам' }); })()}
    ${UI.panel('Как считать', `<div class="bar"><label class="mut">Каждый день <select id="wcMode"><option value="full" ${c.mode !== 'short' ? 'selected' : ''}>полная сверка — все товары</option><option value="short" ${c.mode === 'short' ? 'selected' : ''}>короткая — что двигалось + случайные</option></select></label>
        <label class="mut">Полная — в <select id="wcFull" ${c.mode === 'short' ? '' : 'disabled'}>${WC.DOW.slice(1).map((d, k) => `<option value="${k + 1}" ${Number(c.fullDay || 1) === k + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="mut">Случайных <input id="wcEx" type="number" min="0" max="50" value="${esc(c.extra ?? 8)}" style="width:70px" ${c.mode === 'short' ? '' : 'disabled'}></label></div>
      <p class="mut">Короткая: в обычный день завсклад считает только товары, у которых со вчерашней сверки менялся остаток в LINKO (продажа, приход, перемещение), товары с расхождением в прошлый раз и несколько случайных — он не знает заранее, какие попадут. Раз в неделю — полная. Если двигалось больше 70 % товаров, в этот день тоже полная.</p>
      ${(() => { const S = CRMLocal.engine.getState(), seen = new Map(); for (const [, st] of stores) { const up = (S.wh.uploads || []).filter(u => u.warehouse === st.wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]; for (const r of up?.rows || []) if (!seen.has(String(r.art))) seen.set(String(r.art), { art: String(r.art), name: r.name, brand: r.brand || '' }); }
        const L = [...seen.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)), P = c.packs || {};
        return L.length ? `<details><summary><b>📦 Штук в коробке</b> <span class="mut">— приложение умножает коробки на это число. Проверьте; где не так — исправьте (${Object.keys(P).length ? 'исправлено ' + Object.keys(P).length : 'пока всё по названию'})</span></summary>
          <p class="mut">Определяется по названию: 4–5 л — 4 шт, Mitanol 4 л — 5 шт, 1–1,5 л — 12 шт, 20/208 л — поштучно (1), ECO FILTER — по коду. Пусто — как по названию.</p>
          ${LX.table(['Товар', '#По названию', '#Своё'], L.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td class="n">${WC.packAuto(i)}</td><td class="n"><input type="number" min="1" max="500" data-pk="${esc(i.art)}" value="${P[i.art] || ''}" placeholder="—" style="width:70px"></td></tr>`), { max: '420px' })}</details>` : '<p class="mut">Штук в коробке: появится, когда будут остатки складов.</p>'; })()}`, { cls: 'w12', sub: 'Полная или короткая ежедневная сверка, коробки' })}
    ${UI.panel('Завсклады', `<div class="bar"><label class="mut">Сверка до <input id="wcDl" type="time" value="${esc(c.deadline || '10:00')}" style="width:110px"></label><label class="mut">Напомнить в <input id="wcRm" type="time" value="${esc(c.remind || '09:00')}" style="width:110px"></label><span class="mut">— утром бот напомнит каждому завскладу провести сверку (кто уже отправил — не получит); после срока напомнит ещё раз и сообщит вам, кто не прислал. По воскресеньям — нет.</span></div>
      ${stores.length ? LX.table(['Завсклад', 'Склад', 'Telegram', ''], stores.map(([who, s]) => `<tr><td>${esc(s.name)}</td><td>${esc(s.wh)}</td><td>${esc(chats[who]?.name || who)}${s.tgAt ? `<br><small class="mut">кабинет с ${UI.dateRu(s.tgAt.slice(0, 10))}</small>` : ''}</td><td><button class="btn sm" data-tgc="${esc(who)}">📦 ${s.tgAt ? 'Подключить заново' : 'Подключить в Telegram'}</button> <button class="btn gray sm" data-rm="${esc(who)}">Убрать</button></td></tr>`)) : '<p class="mut">Завскладов пока нет.</p>'}
      <div class="form" style="margin-top:10px"><label>Имя<input id="wcN" maxlength="60" placeholder="например: Ахмад"></label><label>Склад<select id="wcW">${whs.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
      <label>Его Telegram<select id="wcT"><option value="">— выберите —</option>${Object.values(chats).filter(ch => !c.stores[ch.id]).map(ch => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('')}</select><small class="mut">Нет в списке? Пусть нажмёт «Старт» в боте, затем «Обновить список» в «Telegram агентам».</small></label></div>
      <div class="bar"><span class="spacer"></span><button class="btn" id="wcAdd">Добавить завсклада</button></div>`, { cls: 'w12' })}
    </div>`;
  const re = () => EXT_PAGES.wcount(el), save = async () => { CRMLocal.touch(); try { await WC.publish(); } catch (e) { toast(e.message); } };
  $('#wcPull', el).onclick = async () => { try { const n = await ATK.pull(); toast(n ? `Новое: ${n}` : 'Новых сверок нет'); re(); } catch (e) { toast(e.message); } };
  const s1 = $('#wcSel', el); if (s1) s1.onchange = e => { WC.sel = e.target.value; re(); };
  el.querySelectorAll('[data-dec]').forEach(sel => sel.onchange = () => { const w = el.querySelector(`[data-sumw="${CSS.escape(sel.dataset.dec)}"]`); if (w) w.style.display = sel.value === 'charge' ? 'flex' : 'none'; });
  const ok = $('#wcOk', el); if (ok) ok.onclick = async () => {
    const dec = {}, missing = [], noSum = [];
    for (const sel of el.querySelectorAll('[data-dec]')) {
      const art = sel.dataset.dec; if (!sel.value) { missing.push(art); continue; }
      const d = { k: sel.value };
      if (sel.value === 'charge') { const v = Number(el.querySelector(`[data-sum="${CSS.escape(art)}"]`)?.value); if (!(v > 0)) { noSum.push(art); continue; } d.sum = Math.round(v * 100) / 100; }
      dec[art] = d;
    }
    if (missing.length) return toast(`Выберите решение ещё для ${missing.length} поз.`);
    if (noSum.length) return toast('Укажите сумму удержания');
    const name = a => sub.items.find(i => i.art === a)?.name || a, rec = Object.keys(dec).filter(a => dec[a].k === 'recount'), charge = Object.keys(dec).filter(a => dec[a].k === 'charge');
    sub.dec = dec; sub.recount = rec; sub.status = rec.length ? 'recount' : 'ok'; sub.decidedAt = new Date().toISOString(); await save();
    const total = charge.reduce((t, a) => t + dec[a].sum, 0);
    try {
      if (rec.length) await WC.notify(sub.who, `↻ <b>Пересчитайте ${rec.length} поз.</b> на складе ${esc(sub.warehouse)}:\n${rec.map(a => '• ' + esc(name(a))).join('\n')}`);
      else await WC.notify(sub.who, `✓ Сверка ${esc(sub.warehouse)} за ${UI.dateRu(sub.day)} принята${charge.length ? `\n💸 Удержание за недостачу: <b>$${UI.fmt0(total)}</b>\n${charge.map(a => '• ' + esc(name(a)) + ' — $' + UI.fmt0(dec[a].sum)).join('\n')}` : ''}`);
    } catch { /* Telegram not reachable */ }
    toast(rec.length ? `Отправлено на пересчёт: ${rec.length} поз.` : 'Сверка принята' + (total ? ` · удержание $${UI.fmt0(total)}` : '')); re();
  };
  $('#wcMode', el).onchange = async e => { c.mode = e.target.value; c.fullDay ||= 1; await save(); toast(c.mode === 'short' ? 'Короткая сверка, полная — ' + WC.DOW[c.fullDay] : 'Каждый день — полная сверка'); re(); };
  $('#wcFull', el).onchange = async e => { c.fullDay = Number(e.target.value); await save(); toast('Полная сверка — ' + WC.DOW[c.fullDay]); };
  $('#wcEx', el).onchange = async e => { const v = Math.max(0, Math.min(50, Math.round(Number(e.target.value)) || 0)); e.target.value = v; c.extra = v; await save(); };
  el.querySelectorAll('[data-pk]').forEach(inp => inp.onchange = async () => { c.packs ||= {}; const v = Math.round(Number(inp.value)); if (v >= 1) c.packs[inp.dataset.pk] = v; else { delete c.packs[inp.dataset.pk]; inp.value = ''; } await save(); toast('Штук в коробке сохранено'); });
  $('#wcRm', el).onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value) || e.target.value >= (c.deadline || '10:00')) { e.target.value = c.remind || '09:00'; return toast('Напоминание — раньше срока сверки'); } c.remind = e.target.value; await save(); toast('Напоминание в ' + c.remind); };
  $('#wcDl', el).onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value)) { e.target.value = c.deadline || '10:00'; return toast('Время ЧЧ:ММ'); } c.deadline = e.target.value; await save(); toast('Срок сверки: ' + c.deadline); };
  $('#wcAdd', el).onclick = async () => {
    const name = $('#wcN', el).value.trim(), wh = $('#wcW', el).value, who = $('#wcT', el).value;
    if (!name || !wh || !who) return toast('Заполните имя, склад и Telegram');
    if (!WC.branchOf(wh)) toast(`Внимание: для склада ${wh} нет связи со складом LINKO — сверка начнёт сравнивать, когда автозагрузка его узнает`);
    c.stores[who] = { name: name.slice(0, 60), wh, on: true, tgAt: '' }; await save(); re();
  };
  el.querySelectorAll('[data-tgc]').forEach(b => b.onclick = async () => { const who = b.dataset.tgc; try { await WC.publish(); await WC.connect(who); c.stores[who].tgAt = new Date().toISOString(); CRMLocal.touch(); toast('Готово: у завсклада в боте кнопка «Кабинет склада»'); re(); } catch (e) { toast(e.message); } });
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const who = b.dataset.rm; if (!confirm(`Убрать ${c.stores[who].name} из завскладов? Кабинет склада у него закроется.`)) return;
    delete c.stores[who];
    try { const cl = AC.cloud(); if (cl) await AC.gh(cl, 'DELETE', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада закрыт' }); await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: { type: 'default' } }); } catch { /* already closed */ }
    await save(); re();
  });
  el.querySelectorAll('[data-ph]').forEach(a => a.onclick = async e => { e.preventDefault(); try { const url = await ATK.photo(a.dataset.ph); const m = modal(`<img src="${url}" alt="Фото со склада" style="max-width:100%;border-radius:8px"><div class="bar"><span class="spacer"></span><button class="btn gray" id="phX">Закрыть</button></div>`); $('#phX', m.el).onclick = () => { URL.revokeObjectURL(url); m.close(); }; } catch (err) { toast(err.message); } });
};
