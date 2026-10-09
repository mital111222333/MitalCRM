// Склад → Заявка в Ташкент: how fast each item leaves the regional warehouses (from the daily stock uploads),
// how many days the stock lasts, and how much to order from the main warehouse in Tashkent to cover N days.
window.EXT_PAGES = window.EXT_PAGES || {};

const WHO = {
  // per warehouse: one snapshot per day, outflow = sum of decreases between neighbouring days
  rates(S, wh, windowDays = 30) {
    const ups = S.wh.uploads.filter(u => u.warehouse === wh).sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const byDay = new Map(); for (const u of ups) byDay.set(u.taken_at, u);
    const snaps = [...byDay.values()]; if (!snaps.length) return { snaps: 0, items: new Map(), last: null };
    const last = snaps.at(-1), from = UI.localDate(Date.parse(last.taken_at + 'T12:00:00') - windowDays * 864e5);
    const win = snaps.filter(u => u.taken_at >= from), span = win.length > 1 ? REP.days(win[0].taken_at, last.taken_at) : 0;
    const out = new Map();
    for (let i = 1; i < win.length; i++) { const prev = new Map(win[i - 1].rows.map(r => [r.art, r.total])); for (const r of win[i].rows) { const p = prev.get(r.art); if (p !== undefined && p > r.total) out.set(r.art, (out.get(r.art) || 0) + (p - r.total)); } }
    const items = new Map(last.rows.map(r => [r.art, { ...r, out: out.get(r.art) || 0, rate: span > 0 ? (out.get(r.art) || 0) / span : null }]));
    return { snaps: win.length, span, items, last };
  },
};

let whoState = { target: 14, show: 'need' };
EXT_PAGES.whorder = async el => {
  await CRMLocal.ready;
  const S = CRMLocal.engine.getState(), st = whoState, f = UI.fmt0;
  const list = S.wh.list.slice().sort((a, b) => a.pos - b.pos).map(w => w.name);
  const main = list.find(n => /ташкент/i.test(n)) || list[0], regions = list.filter(n => n !== main);
  const M = WHO.rates(S, main), R = Object.fromEntries(regions.map(w => [w, WHO.rates(S, w)]));
  const rowsOf = w => [...R[w].items.values()].map(i => {
    const daysLeft = i.rate ? i.available / i.rate : null, need = i.rate ? Math.max(0, Math.ceil(i.rate * st.target - i.available)) : 0, inMain = M.items.get(i.art)?.available ?? null;
    return { ...i, daysLeft, need, inMain };
  }).filter(i => st.show === 'all' ? i.total > 0 || i.rate : st.show === 'moving' ? i.rate > 0 : i.need > 0 || (i.available <= 0 && i.out > 0)).sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.need - a.need);
  const conf = CRMLocal.ext().tg || {};
  el.innerHTML = `<div class="page-head"><div><h2>Заявка в Ташкент</h2><div class="sub">Расход считается по ежедневным загрузкам остатков: на сколько уменьшился товар на складе за последние 30 дней</div></div>
    <div class="actions"><button class="btn gray" id="woCsv">⬇ Excel (CSV)</button>${conf.token && (conf.me || conf.lbChat) ? '<button class="btn" id="woTg">✈ Заявку в Telegram</button>' : ''}</div></div>
    <div class="bar"><label class="mut">Запас на <input type="number" id="woT" min="1" max="90" value="${st.target}" style="width:70px"> дней</label>
      <select id="woS"><option value="need" ${st.show === 'need' ? 'selected' : ''}>Только что нужно заказать</option><option value="moving" ${st.show === 'moving' ? 'selected' : ''}>Все продающиеся товары</option><option value="all" ${st.show === 'all' ? 'selected' : ''}>Все товары</option></select>
      <span class="mut">Главный склад: <b>${esc(main || '—')}</b>${M.last ? ` (остатки на ${UI.dateRu(M.last.taken_at)})` : ' — остатки не загружены'}</span></div>
    <div class="grid">${regions.map(w => {
      const r = R[w], rows = r.snaps ? rowsOf(w) : [];
      const body = !r.snaps ? `<p class="mut">Остатки склада не загружены. Загрузите их на странице <a href="#/up">⬆ Загрузить</a>.</p>`
        : r.snaps < 2 || !r.span ? `<p class="mut">Загружен только ${r.snaps} день (${UI.dateRu(r.last.taken_at)}). Расход появится, когда будут остатки хотя бы за 2 разных дня — загружайте остатки каждый день.</p>`
        : rows.length ? `<div class="scroll"><table><thead><tr><th>Товар</th><th class="n">Остаток</th><th class="n">Расход в день</th><th class="n">Хватит, дней</th><th class="n">Заказать</th><th class="n">Есть в ${esc(main)}</th></tr></thead><tbody>${rows.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc([i.art, i.brand].filter(Boolean).join(' · '))}</small></td><td class="n">${f(i.available)}${i.reserved ? `<br><small>резерв ${f(i.reserved)}</small>` : ''}</td><td class="n">${i.rate ? (Math.round(i.rate * 10) / 10).toLocaleString('ru-RU') : '—'}</td><td class="n">${i.daysLeft === null ? '—' : i.daysLeft < 1 ? UI.pill('crit', 'закончился') : i.daysLeft < 7 ? UI.pill('crit', Math.floor(i.daysLeft) + ' дн.') : i.daysLeft < st.target ? UI.pill('warn', Math.floor(i.daysLeft) + ' дн.') : Math.floor(i.daysLeft) + ' дн.'}</td><td class="n"><b>${i.need ? f(i.need) + ' ' + esc(i.unit || 'шт') : '—'}</b></td><td class="n">${i.inMain === null ? '<span class="mut">—</span>' : i.inMain >= i.need ? f(i.inMain) : `<span class="neg">${f(i.inMain)}</span>`}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="mut">Заказывать ничего не нужно — запаса хватает 👍</p>';
      return UI.panel(`📦 ${esc(w)}`, body, { cls: 'w12', sub: r.span ? `Расход за ${r.span} дн. (${r.snaps} загрузок) · запас на ${st.target} дн.` : '' });
    }).join('')}</div>
    <p class="mut">«Заказать» = расход в день × ${st.target} дней − текущий доступный остаток. Приход товара на склад в расход не считается. Красным в колонке «Есть в ${esc(main)}» — на главном складе меньше, чем нужно.</p>`;
  $('#woT', el).onchange = e => { st.target = Math.min(90, Math.max(1, +e.target.value || 14)); EXT_PAGES.whorder(el); };
  $('#woS', el).onchange = e => { st.show = e.target.value; EXT_PAGES.whorder(el); };
  const all = regions.flatMap(w => (R[w].snaps > 1 ? rowsOf(w).filter(i => i.need > 0).map(i => ({ w, ...i })) : []));
  $('#woCsv', el).onclick = () => UI.csv(`заявка-ташкент-${UI.localDate(Date.now())}.csv`, [['Склад', 'Товар', 'Артикул', 'Бренд', 'Остаток', 'Расход в день', 'Хватит дней', 'Заказать', `Есть в ${main}`], ...all.map(i => [i.w, i.name, i.art, i.brand, Math.round(i.available), Math.round((i.rate || 0) * 10) / 10, i.daysLeft === null ? '' : Math.floor(i.daysLeft), i.need, i.inMain ?? ''])]);
  const tg = $('#woTg', el);
  if (tg) tg.onclick = async () => {
    if (!all.length) return toast('Заказывать нечего');
    const text = [`📦 <b>Заявка в ${esc(main)} на ${UI.dateRu(UI.localDate(Date.now()))}</b> (запас на ${st.target} дн.)`, ...regions.map(w => { const l = all.filter(i => i.w === w); return l.length ? `\n<b>${esc(w)}</b>\n` + l.map(i => `• ${esc(i.name)} — <b>${f(i.need)} ${esc(i.unit || 'шт')}</b>${i.daysLeft !== null ? ` (хватит на ${Math.floor(i.daysLeft)} дн.)` : ''}`).join('\n') : ''; })].join('\n');
    const chat = conf.lbChat || conf.me?.id;
    if (!confirm('Отправить заявку в Telegram (в чат, куда отправляется лидерборд, или вам)?')) return;
    try { await TG.send(chat, text); toast('Заявка отправлена'); } catch (e) { toast(e.message); }
  };
};
