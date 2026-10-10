// Extra LINKO data (orders, products, payments, returns, debt by age, buying frequency, agents' working day,
// refusals, LINKO stock recommendation, profit by product). The list of LINKO sections lives in linko-jobs.json:
// both the bookmark and the Google auto-loader take it from there, so new data needs no new bookmark or script.
// Everything is kept in the synced state (ext.lx) and shown on the pages below and in the client card.
window.EXT_PAGES = window.EXT_PAGES || {};

const LX = {
  jobs: [],
  ready: null,
  load() { return (LX.ready ||= fetch('linko-jobs.json', { cache: 'no-cache' }).then(r => r.json()).then(j => (LX.jobs = Array.isArray(j) ? j : [])).catch(() => [])); },
  fill(path, from, to) { return path.replace(/\{from\}/g, from).replace(/\{to\}/g, to); },
  // the same picking as in the auto-loader script: dotted paths, kept flat ("user.first_name")
  get(o, k) { if (o == null) return undefined; if (Object.prototype.hasOwnProperty.call(o, k)) return o[k]; return k.split('.').reduce((v, p) => (v == null ? undefined : v[p]), o); },
  pick(row, keys) { if (!keys || !keys.length || row == null || typeof row !== 'object') return row; const o = {}; for (const k of keys) { const v = LX.get(row, k); if (v !== undefined && v !== null && v !== '') o[k] = v; } return o; },
  st() { return CRMLocal.ext().lx || null; },
  d(id) { return (LX.st()?.d || {})[id] || []; },
  has() { const s = LX.st(); return !!(s && s.d && Object.keys(s.d).length); },
  // bookmark: one message per section; auto-loader: one file with all sections
  put(id, rows, meta = {}) {
    const x = CRMLocal.ext(), job = LX.jobs.find(j => j.id === id);
    const cur = x.lx && x.lx.from === meta.from ? x.lx : { d: {}, errors: {} };
    if (!(meta.error && !(rows || []).length && cur.d[id])) cur.d[id] = (rows || []).map(r => LX.pick(r, job?.pick)); // a failed section keeps the previous data
    if (meta.error) cur.errors[id] = meta.error; else delete cur.errors[id];
    x.lx = { ...cur, at: meta.at || new Date().toISOString(), from: meta.from, to: meta.to, src: meta.src || 'bookmark' };
    LX.cache = null; CRMLocal.touch();
  },
  importSnap(snap) {
    if (!snap || !snap.data) return false;
    const x = CRMLocal.ext();
    const prev = x.lx && x.lx.from === snap.from ? x.lx.d || {} : {};
    const fastAt = x.lx && x.lx.from === snap.from ? x.lx.fastAt : undefined;
    x.lx = { at: snap.at, from: snap.from, to: snap.to, src: 'auto', errors: snap.errors || {}, d: {}, fastAt };
    for (const id of Object.keys(prev)) if (!snap.data[id]) x.lx.d[id] = prev[id]; // a section that failed this time, or comes in its own 5-minute file (payments), keeps its data
    for (const [id, rows] of Object.entries(snap.data)) { const job = LX.jobs.find(j => j.id === id); x.lx.d[id] = (rows || []).map(r => LX.pick(r, job?.pick)); }
    LX.cache = null; CRMLocal.touch(); return true;
  },

  // payments every 5 minutes (linko-fast.json): only these sections are replaced
  importFast(snap) {
    if (!snap || !snap.data) return false;
    const x = CRMLocal.ext();
    if (!x.lx || x.lx.from !== snap.from) x.lx = { at: snap.at, from: snap.from, to: snap.to, src: 'auto', errors: {}, d: {} };
    for (const [id, rows] of Object.entries(snap.data)) { const job = LX.jobs.find(j => j.id === id); x.lx.d[id] = (rows || []).map(r => LX.pick(r, job?.pick)); delete x.lx.errors?.[id]; }
    x.lx.fastAt = snap.at; LX.cache = null; CRMLocal.touch(); return true;
  },
  // when the payments were last taken from LINKO
  payAt() { const s = LX.st(); return s ? s.fastAt || s.at : null; },
  ordAt() { const s = LX.st(), fast = LX.jobs.find(j => j.id === 'orders')?.every; return s ? (fast && s.fastAt) || s.at : null; },

  // ---------- helpers ----------
  n: v => Number(v) || 0,
  day: v => String(v || '').slice(0, 10),
  person(o, p) { return [LX.get(o, p + '.first_name'), LX.get(o, p + '.second_name')].filter(Boolean).join(' ').trim(); },
  norm: s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9ʻ' ]+/gi, ' ').split(/\s+/).filter(Boolean).sort().join(' '),
  // LINKO user → the agent name used in the CRM (from the balance file), matching by the set of words
  agentName(raw) {
    if (!raw) return '';
    const S = CRMLocal.engine.getState();
    if (!LX._ag) { LX._ag = new Map(); for (const c of Object.values(S.ag.clients || {})) if (c.agent) LX._ag.set(LX.norm(c.agent), c.agent); }
    const k = LX.norm(raw); if (LX._ag.has(k)) return LX._ag.get(k);
    const words = k.split(' '); for (const [nk, name] of LX._ag) { const w2 = nk.split(' '); if (words.every(w => w2.includes(w)) || w2.every(w => words.includes(w))) return name; }
    return raw;
  },
  clientAgent(name, raw) { const S = CRMLocal.engine.getState(); return S.ag.clients?.[name]?.agent || LX.agentName(raw) || 'Без агента'; },
  // which currency the CRM shows: the most used one in the rows (dollars at MITAL)
  curOf(rows) { const c = {}; for (const r of rows) { const k = r['currency.name'] || ''; c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; },
  sym(cur) { return !cur || /usd|\$|долл/i.test(cur) ? '$' : cur + ' '; },
  u(cur) { return !cur || /usd|\$|долл/i.test(cur) ? ' $' : ' ' + cur; },
  money(v, cur) { return LX.sym(cur) + UI.fmt0(v); },
  ORDER_ST: { new: 'новый', requested: 'запрошен', request: 'запрошен', unconfirmed: 'не подтверждён', confirmed: 'подтверждён', accepted: 'принят', ready: 'готов к отгрузке', given: 'отгружен', delivering: 'в пути', on_way: 'в пути', delivered: 'доставлен', finished: 'завершён', done: 'завершён', cancelled: 'отменён', canceled: 'отменён', rejected: 'отклонён', returned: 'возвращён', draft: 'черновик' },
  st2: s => LX.ORDER_ST[String(s).toLowerCase()] || String(s ?? '—'),
  closed: s => /deliver|finish|done|cancel|reject|return|отмен|достав|заверш/i.test(String(s)),
  PAY_T: { cash: 'наличные', bank: 'перечисление', card: 'карта / перечисление', transfer: 'перевод', terminal: 'терминал', click: 'Click', payme: 'Payme' },
  pt: s => LX.PAY_T[String(s).toLowerCase()] || String(s || '—'),

  // brand of a product: from the warehouse files (by name or article), otherwise the first word of the name
  brandOf(name, art) {
    if (!LX._br) {
      LX._br = { byName: new Map(), byArt: new Map() };
      for (const u of CRMLocal.engine.getState().wh.uploads || []) for (const r of u.rows || []) if (r.brand) { LX._br.byName.set(LX.norm(r.name), r.brand); if (r.art) LX._br.byArt.set(String(r.art), r.brand); }
    }
    return (art && LX._br.byArt.get(String(art))) || LX._br.byName.get(LX.norm(name)) || String(name || '').trim().split(/\s+/)[0] || '—';
  },

  // ---------- everything the pages need, computed once per data version ----------
  model() {
    const key = (LX.st()?.at || '') + '|' + (LX.st()?.fastAt || '') + '|' + (CRMLocal.engine.getState().ag.uploads || []).length + '|' + (CRMLocal.engine.getState().wh.uploads || []).length;
    if (LX.cache && LX.cacheKey === key) return LX.cache;
    LX._ag = null; LX._br = null; LX.cacheKey = key;
    const orders = LX.d('orders'), items = LX.d('items'), pays = LX.d('pays'), rets = LX.d('returns');
    const cur = LX.curOf(orders.length ? orders : items), inCur = r => !r['currency.name'] || r['currency.name'] === cur;
    const ordById = new Map(orders.map(o => [o.id, o]));
    const lines = items.filter(inCur).map(i => {
      const o = ordById.get(i.order_id) || {}, client = o['client.name'] || '', qty = LX.n(i.amount), ret = LX.n(i.return_amount), price = LX.n(i.price);
      return { order: i.order_id, date: LX.day(i.order_created_date || o.created_date), product: i.product_name || '—', art: i['product.vendor_code'] || i['product.code'] || '', brand: LX.brandOf(i.product_name, i['product.vendor_code'] || i['product.code']),
        qty, ret, sum: i.is_bonus ? 0 : (qty - ret) * price, bonus: !!i.is_bonus, client, agent: client ? LX.clientAgent(client, LX.person(o, 'user')) : LX.agentName(LX.person(o, 'user')) || 'Без агента' };
    });
    const payCur = LX.curOf(pays) || cur;
    // a payment counts when it is in the main currency (any dollar spelling counts as dollars, e.g. a card payment in "USD karta"),
    // is not a return and is positive; everything else is kept with the reason so the page can show what was left out
    const sameCur = c => !c || c === payCur || (LX.sym(c) === '$' && LX.sym(payCur) === '$');
    const why = p => !sameCur(p['currency.name']) ? 'другая валюта: ' + p['currency.name'] : p.order_return || /return|возврат/i.test(String(p.type)) ? 'возврат' : !(LX.n(p.amount) > 0) ? 'сумма ' + (p.amount ?? 'пусто') : '';
    const skipped = pays.filter(p => why(p)).map(p => ({ date: LX.day(p.created_date || p.accepted_time), time: String(p.created_date || p.accepted_time || '').slice(11, 16), ts: Date.parse(p.created_date || p.accepted_time) || 0, amount: LX.n(p.amount), real: LX.n(p.real_amount), cur: p['currency.name'] || '', type: p.type, ptype: p.payment_type, client: p['client.name'] || '', by: LX.person(p, 'user'), why: why(p) }));
    const payments = pays.filter(p => !why(p))
      .map(p => ({ date: LX.day(p.created_date || p.accepted_time), time: String(p.created_date || p.accepted_time || '').slice(11, 16), ts: Date.parse(p.created_date || p.accepted_time) || 0, amount: LX.n(p.amount), type: p.type, ptype: p.payment_type, cur: p['currency.name'] || '', client: p['client.name'] || '', agent: p['client.name'] ? LX.clientAgent(p['client.name'], LX.person(p, 'user')) : LX.agentName(LX.person(p, 'user')) || 'Без агента', by: LX.person(p, 'user'), courier: LX.person(p, 'delivery_man') }));
    // Card / bank payments: LINKO keeps them out of the transactions list, but the client balance (its «Оплачено») counts them.
    // Between two balance snapshots, per client: growth of «Оплачено» − transactions created in that same time window = paid by card / bank.
    // The window is the snapshots' own times, so a payment entered in the evening after the last snapshot is not taken for a card payment the next day.
    const ups = (CRMLocal.engine.getState().ag.uploads || []).slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const at = u => Date.parse(u.snap_at || u.uploaded_at || (u.taken_at + 'T23:59:59')) || 0;
    const firstTx = payments.map(p => p.date).sort()[0] || '';
    const byClient = new Map(); for (const p of payments) { if (!byClient.has(p.client)) byClient.set(p.client, []); byClient.get(p.client).push(p); }
    for (const u of ups) {
      if (firstTx && u.taken_at < firstTx) continue;
      const prev = ups.filter(x => x.period_from === u.period_from && x.taken_at < u.taken_at).pop();
      if (!prev && u.taken_at !== u.period_from) continue; // no snapshot of the day before: can't tell what was paid that day
      const t1 = prev ? at(prev) : Date.parse(u.period_from + 'T00:00:00'), t2 = at(u);
      const before = new Map((prev?.rows || []).map(r => [r.client, r.paid || 0]));
      for (const r of u.rows || []) {
        const grew = (r.paid || 0) - (before.get(r.client) || 0); if (grew <= 0.5) continue;
        const tx = (byClient.get(r.client) || []).filter(p => p.ts > t1 && p.ts <= t2).reduce((a, p) => a + p.amount, 0);
        const extra = grew - tx;
        if (extra > 0.5) payments.push({ date: u.taken_at, time: '', ts: t2, amount: Math.round(extra * 1000) / 1000, type: 'по балансу', ptype: 'card', cur: '', client: r.client, agent: LX.clientAgent(r.client, ''), by: '', courier: '', bal: true });
      }
    }
    const ords = orders.filter(inCur).map(o => ({ id: o.id, date: LX.day(o.created_date), time: String(o.created_date || '').slice(11, 16), status: o.status, ptype: o.payment_type, sum: LX.n(o.total_price), fact: LX.n(o.fact_price), ret: LX.n(o.total_return_price), paid: !!o.is_paid, deliver: LX.day(o.date_delivery), client: o['client.name'] || '', address: o['market.address'] || '', agent: o['client.name'] ? LX.clientAgent(o['client.name'], LX.person(o, 'user')) : LX.agentName(LX.person(o, 'user')) || 'Без агента' }));
    const returns = rets.filter(r => !r['currency.name'] || r['currency.name'] === (LX.curOf(rets) || cur)).map(r => ({ date: LX.day(r.created_date), status: r.status, sum: LX.n(r.total_price), client: r['client.name'] || '', agent: r['client.name'] ? LX.clientAgent(r['client.name'], LX.person(r, 'responsible_agent')) : LX.agentName(LX.person(r, 'responsible_agent')) || 'Без агента', reason: [r.reason, r.comment].filter(Boolean).join(' · ') }));
    return (LX.cache = { cur, payCur, lines, payments, skipped, ords, returns });
  },
  agentsOf(rows) { return [...new Set(rows.map(r => r.agent).filter(Boolean))].sort((a, b) => a.localeCompare(b)); },
  sumBy(rows, key, val = r => r.sum) { const m = new Map(); for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key]; m.set(k, (m.get(k) || 0) + val(r)); } return [...m.entries()].sort((a, b) => b[1] - a[1]); },

  // ---------- page frame ----------
  TABS: [['lxbrand', 'Бренды и товары'], ['lxcross', 'Кому что предложить'], ['lxpay', 'Оплаты по дням'], ['lxday', 'Заказы по дням'], ['lxord', 'Заказы и возвраты'], ['lxage', 'Просрочка долга'], ['lxwork', 'Работа агентов'], ['lxprof', 'Прибыль'], ['lxrec', 'Рекомендация склада']],
  agent: '',
  async shell(el, tab, tools = '') {
    await CRMLocal.ready; await LX.load();
    const s = LX.st(), t = v => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<div class="page-head"><div><h2>Данные LINKO</h2><div class="sub">${s ? `Обновлено <b>${t(s.at)}</b> · период ${UI.dateRu(s.from)} — ${UI.dateRu(s.to)}${s.src === 'auto' ? ' · автозагрузка' : ' · закладка'}` : 'Ещё не загружены'}</div></div><div class="actions no-print">${tools}</div></div>
      <nav class="tabs no-print" aria-label="Данные LINKO">${LX.TABS.map(([r, n]) => `<a href="#/${r}" class="${r === tab ? 'on' : ''}">${n}</a>`).join('')}</nav><div id="lxBody"></div>`;
    const body = $('#lxBody', el);
    if (!LX.has()) { body.innerHTML = UI.empty('Данных из LINKO ещё нет', 'Они появятся сами после обновления скрипта автозагрузки (<a href="#/cloud">Данные → Синхронизация и настройки</a> → «Скопировать готовый скрипт» → вставить в script.google.com → setup) или сразу после нажатия закладки «⚡ В MITAL CRM» в LINKO.'); return null; }
    const errs = Object.entries(s.errors || {}); if (errs.length) body.insertAdjacentHTML('beforebegin', `<p class="mut">Не получено из LINKO: ${errs.map(([id, e]) => `${esc(LX.jobs.find(j => j.id === id)?.title || id)} (${esc(maskKey(e).slice(0, 60))})`).join(', ')}</p>`);
    return body;
  },
  agentSel(names) { return `<select id="lxAg" aria-label="Агент"><option value="">Все агенты</option>${names.map(n => `<option ${n === LX.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; },
  bindAgent(body, page) { const s = $('#lxAg', body); if (s) s.onchange = e => { LX.agent = e.target.value; route(); }; },
  cl: n => `<a class="clink" data-client="${esc(n)}">${esc(n)}</a>`,
  ag: n => `<a class="clink" data-agent="${esc(n)}">${esc(n)}</a>`,
  table(heads, rows, { max = '', id = '' } = {}) { return `<div class="tscroll"${max ? ` style="max-height:${max}"` : ''}${id ? ` id="${id}"` : ''}><table><thead><tr>${heads.map(h => `<th class="${h.startsWith('#') ? 'n' : ''}">${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; },
  pct: (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—'),
};
LX.load();

// ---------- Бренды и товары ----------
EXT_PAGES.lxbrand = async el => {
  const body = await LX.shell(el, 'lxbrand', '<button class="btn gray" id="lxCsv">⬇ Excel (CSV)</button>'); if (!body) return;
  const M = LX.model(), f = UI.fmt0, $$ = v => LX.money(v, M.cur);
  const L = M.lines.filter(l => !LX.agent || l.agent === LX.agent);
  if (!L.length) { body.innerHTML = LX.agentSel(LX.agentsOf(M.lines)) + UI.empty('Продаж по товарам нет', 'В этом периоде LINKO не отдал строки заказов.'); LX.bindAgent(body); return; }
  const brands = LX.sumBy(L, 'brand'), prods = new Map();
  for (const l of L) { const p = prods.get(l.product) || prods.set(l.product, { name: l.product, brand: l.brand, qty: 0, ret: 0, sum: 0, bonus: 0, clients: new Set() }).get(l.product); if (l.bonus) p.bonus += l.qty; else { p.qty += l.qty; p.ret += l.ret; p.sum += l.sum; } if (l.client) p.clients.add(l.client); }
  const P = [...prods.values()].sort((a, b) => b.sum - a.sum), total = L.reduce((a, l) => a + l.sum, 0), qty = L.reduce((a, l) => a + (l.bonus ? 0 : l.qty - l.ret), 0);
  const agents = LX.agentsOf(L), top = brands.slice(0, 8).map(b => b[0]);
  const ab = agents.map(a => { const m = new Map(LX.sumBy(L.filter(l => l.agent === a), 'brand')); return [a, m]; });
  body.innerHTML = `<div class="bar">${LX.agentSel(LX.agentsOf(M.lines))}</div>
    <div class="kpis">${UI.tile('Продано товаров', $$(total), { sub: `${f(qty)} шт. · без бонусов и возвратов`, hero: true })}${UI.tile('Брендов', String(brands.length))}${UI.tile('Товаров', String(P.length))}${UI.tile('Клиентов купили', String(new Set(L.map(l => l.client).filter(Boolean)).size))}</div>
    <div class="grid">
    ${UI.panel('Доля брендов', CH.donut(brands.map(([label, value]) => ({ label, value })), { unit: LX.u(M.cur), center: 'продано', fmt: f }), { cls: 'w6' })}
    ${UI.panel('Топ-10 товаров', CH.hbars(P.slice(0, 10).map(p => ({ label: p.name, value: p.sum })), { unit: LX.u(M.cur), fmt: f }), { cls: 'w6' })}
    ${LX.agent ? '' : UI.panel('Агенты × бренды', LX.table(['Агент', ...top.map(b => '#' + b), '#Всего'], ab.map(([a, m]) => `<tr><td>${LX.ag(a)}</td>${top.map(b => `<td class="n">${m.get(b) ? f(m.get(b)) : '<span class="mut">—</span>'}</td>`).join('')}<td class="n"><b>${f([...m.values()].reduce((x, y) => x + y, 0))}</b></td></tr>`)), { cls: 'w12', sub: 'Пустая клетка — агент этот бренд в периоде не продавал' })}
    ${UI.panel(`Товары (${P.length})`, LX.table(['Товар', 'Бренд', '#Шт.', '#Возврат', '#Сумма', '#Клиентов', '#Ср. цена', '#Бонус шт.'], P.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.brand)}</td><td class="n">${f(p.qty)}</td><td class="n">${p.ret ? `<span class="neg">${f(p.ret)}</span>` : '—'}</td><td class="n"><b>${f(p.sum)}</b></td><td class="n">${p.clients.size}</td><td class="n">${p.qty - p.ret > 0 ? UI.fmt0(p.sum / (p.qty - p.ret)) : '—'}</td><td class="n">${p.bonus ? f(p.bonus) : '—'}</td></tr>`), { max: '520px' }), { cls: 'w12' })}
    </div>`;
  LX.bindAgent(body);
  $('#lxCsv', el).onclick = () => UI.csv('товары-' + (LX.st().to || ''), [['Товар', 'Бренд', 'Шт', 'Возврат', 'Сумма', 'Клиентов'], ...P.map(p => [p.name, p.brand, p.qty, p.ret, Math.round(p.sum), p.clients.size])]);
};

// ---------- Кому что предложить: brands a client does not take + clients who are late for their usual order ----------
EXT_PAGES.lxcross = async el => {
  const body = await LX.shell(el, 'lxcross'); if (!body) return;
  const M = LX.model(), f = UI.fmt0;
  const freq = LX.d('freq').map(r => ({ name: r.name, agent: LX.clientAgent(r.name, LX.person(r, 'responsible_agent') || (typeof r.responsible_agent === 'string' ? r.responsible_agent : '')), every: LX.n(r.frequency), last: LX.day(r.last_trade_date), days: LX.n(r.not_trade_from_day) }));
  const late = freq.filter(r => r.every > 0 && r.days > r.every && (!LX.agent || r.agent === LX.agent)).sort((a, b) => b.days / b.every - a.days / a.every);
  const L = M.lines.filter(l => l.client && (!LX.agent || l.agent === LX.agent));
  const brands = LX.sumBy(M.lines, 'brand').map(b => b[0]).slice(0, 8);
  const byClient = new Map();
  for (const l of L) { const c = byClient.get(l.client) || byClient.set(l.client, { name: l.client, agent: l.agent, sum: 0, brands: new Set() }).get(l.client); c.sum += l.sum; if (!l.bonus) c.brands.add(l.brand); }
  const C = [...byClient.values()].map(c => ({ ...c, miss: brands.filter(b => !c.brands.has(b)) })).filter(c => c.miss.length).sort((a, b) => b.sum - a.sum);
  const allAgents = [...new Set([...LX.agentsOf(M.lines), ...freq.map(r => r.agent)])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  body.innerHTML = `<div class="bar">${LX.agentSel(allAgents)}</div>
    <div class="grid">
    ${UI.panel(`⏰ Пора заказывать (${late.length})`, late.length ? LX.table(['Клиент', 'Агент', '#Обычно берёт раз в', '#Не брал', 'Последняя покупка', '#Долг'], late.slice(0, 300).map(r => `<tr><td>${LX.cl(r.name)}</td><td>${esc(r.agent)}</td><td class="n">${r.every} дн.</td><td class="n"><b class="${r.days > r.every * 2 ? 'neg' : ''}">${r.days} дн.</b></td><td>${r.last ? UI.dateRu(r.last) : '—'}</td><td class="n">${(() => { const d = LX.debtOf(r.name); return d ? f(d) : '—'; })()}</td></tr>`), { max: '420px' }) : '<p class="mut">Все клиенты берут в своём обычном ритме 👍</p>', { cls: 'w12', sub: 'LINKO знает, как часто клиент обычно покупает. Здесь те, кто уже пропустил свой срок — им стоит позвонить или заехать' })}
    ${UI.panel(`🎯 Что предложить клиенту (${C.length})`, C.length ? LX.table(['Клиент', 'Агент', '#Купил за период', 'Берёт', 'Не берёт — предложить'], C.slice(0, 400).map(c => `<tr><td>${LX.cl(c.name)}</td><td>${esc(c.agent)}</td><td class="n">${f(c.sum)}</td><td>${[...c.brands].map(b => UI.pill('good', b)).join(' ')}</td><td>${c.miss.map(b => UI.pill('warn', b)).join(' ')}</td></tr>`), { max: '560px' }) : '<p class="mut">Все клиенты берут все основные бренды.</p>', { cls: 'w12', sub: `Основные бренды: ${brands.map(esc).join(', ')}. Клиенты сверху покупают больше всех — им проще предложить ещё бренд` })}
    </div>`;
  LX.bindAgent(body);
};
LX.debtOf = name => { try { const S = CRMLocal.engine.getState(), u = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0]; const r = u?.rows.find(x => x.client === name); return r && r.b1 < 0 ? -r.b1 : 0; } catch { return 0; } };

// ---------- Оплаты по дням ----------
EXT_PAGES.lxpay = async el => {
  const body = await LX.shell(el, 'lxpay', '<button class="btn gray" id="lxCsv">⬇ Excel (CSV)</button>'); if (!body) return;
  const M = LX.model(), f = UI.fmt0, $$ = v => LX.money(v, M.payCur), t0 = UI.localDate(Date.now()), y0 = UI.localDate(Date.now() - 864e5);
  const P = M.payments.filter(p => !LX.agent || p.agent === LX.agent);
  const sumD = d => P.filter(p => p.date === d).reduce((a, p) => a + p.amount, 0), wk = UI.localDate(Date.now() - 6 * 864e5);
  const days = [...new Set(P.map(p => p.date))].sort(), agents = LX.agentsOf(P);
  const byDay = days.map(d => ({ d, total: sumD(d), ag: new Map(LX.sumBy(P.filter(p => p.date === d), 'agent', p => p.amount)) }));
  const today = P.filter(p => p.date === t0).sort((a, b) => b.time.localeCompare(a.time));
  body.innerHTML = `<div class="bar">${LX.agentSel(LX.agentsOf(M.payments))}</div>
    <div class="kpis">${UI.tile('Сегодня', $$(sumD(t0)), { sub: `${today.length} оплат · данные на ${LX.payAt() ? new Date(LX.payAt()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}`, hero: true })}${UI.tile('Вчера', $$(sumD(y0)))}${UI.tile('За 7 дней', $$(P.filter(p => p.date >= wk).reduce((a, p) => a + p.amount, 0)))}${UI.tile('За период', $$(P.reduce((a, p) => a + p.amount, 0)), { sub: `${P.length} оплат` })}</div>
    <div class="grid">
    ${UI.panel('Собрано по дням', days.length > 1 ? CH.columns(byDay.slice(-31).map(x => ({ label: UI.dm(x.d), values: [x.total] })), [{ name: 'Оплаты', color: 'var(--c3)' }], { fmt: f, height: 230 }) : '<p class="mut">Мало дней для графика.</p>', { cls: 'w12' })}
    ${UI.panel('По способу оплаты', CH.hbars(LX.sumBy(P, p => LX.pt(p.ptype), p => p.amount).map(([label, value]) => ({ label, value })), { unit: LX.u(M.payCur), fmt: f, share: true }), { cls: 'w6' })}
    ${UI.panel('По агентам за период', CH.hbars(LX.sumBy(P, 'agent', p => p.amount).map(([label, value]) => ({ label, value })), { unit: LX.u(M.payCur), fmt: f }), { cls: 'w6' })}
    ${UI.panel(`Оплаты сегодня (${today.length})`, today.length ? LX.table(['Время', 'Клиент', 'Агент', 'Способ', 'Тип', '#Сумма', 'Принял'], today.map(p => `<tr><td>${p.time ? esc(p.time) : '<span class="mut">—</span>'}</td><td>${LX.cl(p.client)}</td><td>${esc(p.agent)}</td><td>${esc(LX.pt(p.ptype))}</td><td class="mut">${esc(p.type ?? '')}${p.cur && p.cur !== M.payCur ? ' · ' + esc(p.cur) : ''}</td><td class="n"><b class="pos">${f(p.amount)}</b></td><td>${esc(p.courier || p.by)}</td></tr>`), { max: '360px' }) : '<p class="mut">Сегодня оплат ещё нет.</p>', { cls: 'w12', sub: today.some(p => p.bal) ? 'Строки «по балансу» — оплаты картой или перечислением: в «Сборе денег» LINKO их нет, CRM видит их по росту оплат в балансе клиента. Если там окажется наличная оплата, она через полчаса придёт из LINKO обычной строкой и заменит эту' : '' })}
    ${(() => { const sk = M.skipped.filter(p => p.date === t0 && (!LX.agent || LX.agentName(p.by) === LX.agent || !p.by)); return sk.length ? UI.panel(`⚠ Не вошли в сумму сегодня (${sk.length})`, LX.table(['Время', 'Клиент', 'Тип', 'Способ', 'Валюта', '#Сумма', 'Почему'], sk.map(p => `<tr><td>${esc(p.time)}</td><td>${LX.cl(p.client)}</td><td>${esc(p.type)}</td><td>${esc(LX.pt(p.ptype))}</td><td>${esc(p.cur)}</td><td class="n">${f(p.amount)}</td><td>${esc(p.why)}</td></tr>`)), { cls: 'w12', sub: 'Эти операции LINKO есть, но в «Сегодня» не посчитаны. Если какая-то должна считаться — пришлите скриншот этого блока' }) : ''; })()}
    ${UI.panel('Таблица: дни × агенты', LX.table(['День', ...agents.map(a => '#' + a), '#Всего'], byDay.slice().reverse().map(x => `<tr><td>${UI.dateRu(x.d)}</td>${agents.map(a => `<td class="n">${x.ag.get(a) ? f(x.ag.get(a)) : '<span class="mut">—</span>'}</td>`).join('')}<td class="n"><b>${f(x.total)}</b></td></tr>`), { max: '420px' }), { cls: 'w12' })}
    </div>`;
  LX.bindAgent(body);
  $('#lxCsv', el).onclick = () => UI.csv('оплаты-' + t0, [['Дата', 'Время', 'Клиент', 'Агент', 'Способ', 'Сумма'], ...P.map(p => [p.date, p.time, p.client, p.agent, LX.pt(p.ptype), p.amount])]);
};

// ---------- Заказы по дням: who ordered what today ----------
LX.dead = s => /cancel|reject|отмен|отклон/i.test(String(s));
EXT_PAGES.lxday = async el => {
  const body = await LX.shell(el, 'lxday', '<button class="btn gray" id="lxCsv">⬇ Excel (CSV)</button>'); if (!body) return;
  const M = LX.model(), f = UI.fmt0, $$ = v => LX.money(v, M.cur), t0 = UI.localDate(Date.now()), y0 = UI.localDate(Date.now() - 864e5), wk = UI.localDate(Date.now() - 6 * 864e5);
  const all = M.ords.filter(o => !LX.agent || o.agent === LX.agent), O = all.filter(o => !LX.dead(o.status)), dead = all.filter(o => LX.dead(o.status));
  const sum = a => a.reduce((x, o) => x + o.sum, 0), onDay = d => O.filter(o => o.date === d);
  const days = [...new Set(O.map(o => o.date))].sort(), agents = LX.agentsOf(O);
  const today = onDay(t0).sort((a, b) => b.time.localeCompare(a.time)), deadToday = dead.filter(o => o.date === t0);
  const items = new Map(); for (const l of M.lines) { if (!items.has(l.order)) items.set(l.order, []); items.get(l.order).push(l); }
  const what = o => { const L = items.get(o.id) || []; return L.length ? L.map(l => `${esc(l.product)} <span class="mut">×${f(l.qty - l.ret)}${l.bonus ? ' бонус' : ''}</span>`).join('<br>') : '<span class="mut">—</span>'; };
  const brandsToday = LX.sumBy(M.lines.filter(l => l.date === t0 && (!LX.agent || l.agent === LX.agent) && today.some(o => o.id === l.order)), 'brand');
  const clientsToday = new Set(today.map(o => o.client)).size;
  body.innerHTML = `<div class="bar">${LX.agentSel(LX.agentsOf(M.ords))}</div>
    <div class="kpis">${UI.tile('Сегодня', $$(sum(today)), { sub: `${today.length} заказов · ${clientsToday} клиентов · данные на ${LX.ordAt() ? new Date(LX.ordAt()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}`, hero: true })}${UI.tile('Вчера', $$(sum(onDay(y0))), { sub: `${onDay(y0).length} заказов` })}${UI.tile('За 7 дней', $$(sum(O.filter(o => o.date >= wk))), { sub: `${O.filter(o => o.date >= wk).length} заказов` })}${UI.tile('За период', $$(sum(O)), { sub: `${O.length} заказов` })}</div>
    <div class="grid">
    ${UI.panel('Заказано по дням', days.length > 1 ? CH.columns(days.slice(-31).map(d => ({ label: UI.dm(d), values: [sum(onDay(d))] })), [{ name: 'Заказы', color: 'var(--c1)' }], { fmt: f, height: 230 }) : '<p class="mut">Мало дней для графика.</p>', { cls: 'w12' })}
    ${UI.panel('Сегодня по агентам', today.length ? CH.hbars(LX.sumBy(today, 'agent').map(([label, value]) => ({ label: `${label} (${today.filter(o => o.agent === label).length})`, value })), { unit: LX.u(M.cur), fmt: f }) : '<p class="mut">Сегодня заказов ещё нет.</p>', { cls: 'w6' })}
    ${UI.panel('Сегодня по брендам', brandsToday.length ? CH.hbars(brandsToday.map(([label, value]) => ({ label, value })), { unit: LX.u(M.cur), fmt: f, share: true }) : '<p class="mut">Нет товаров в сегодняшних заказах.</p>', { cls: 'w6' })}
    ${UI.panel(`Заказы сегодня (${today.length})`, today.length ? LX.table(['Время', 'Клиент', 'Агент', '#Сумма', 'Статус', 'Товары', 'Доставка', 'Адрес'], today.map(o => `<tr><td>${esc(o.time || '—')}</td><td>${LX.cl(o.client)}</td><td>${esc(o.agent)}</td><td class="n"><b>${f(o.sum)}</b></td><td>${UI.pill(LX.closed(o.status) ? 'good' : 'info', LX.st2(o.status))}</td><td><small>${what(o)}</small></td><td>${o.deliver ? UI.dm(o.deliver) : '—'}</td><td><small>${esc(o.address)}</small></td></tr>`), { max: '520px' }) : '<p class="mut">Сегодня заказов ещё нет.</p>', { cls: 'w12', sub: deadToday.length ? `Отменённые не считаются: ${deadToday.length} на ${$$(sum(deadToday))}` : '' })}
    ${UI.panel('Таблица: дни × агенты', LX.table(['День', ...agents.map(a => '#' + a), '#Всего', '#Заказов'], days.slice().reverse().map(d => { const D = onDay(d), m = new Map(LX.sumBy(D, 'agent')); return `<tr><td>${UI.dateRu(d)}</td>${agents.map(a => `<td class="n">${m.get(a) ? f(m.get(a)) : '<span class="mut">—</span>'}</td>`).join('')}<td class="n"><b>${f(sum(D))}</b></td><td class="n">${D.length}</td></tr>`; }), { max: '420px' }), { cls: 'w12' })}
    </div>`;
  LX.bindAgent(body);
  $('#lxCsv', el).onclick = () => UI.csv('заказы-' + t0, [['Дата', 'Время', 'Клиент', 'Агент', 'Сумма', 'Статус', 'Товары', 'Доставка', 'Адрес'], ...all.map(o => [o.date, o.time, o.client, o.agent, o.sum, LX.st2(o.status), (items.get(o.id) || []).map(l => `${l.product} x${l.qty - l.ret}`).join('; '), o.deliver, o.address])]);
};

// ---------- Заказы и возвраты ----------
EXT_PAGES.lxord = async el => {
  const body = await LX.shell(el, 'lxord'); if (!body) return;
  const M = LX.model(), f = UI.fmt0, $$ = v => LX.money(v, M.cur), st = LX.d('ostats')[0] || {};
  const O = M.ords.filter(o => !LX.agent || o.agent === LX.agent), R = M.returns.filter(r => !LX.agent || r.agent === LX.agent);
  const open = O.filter(o => !LX.closed(o.status)).sort((a, b) => b.date.localeCompare(a.date));
  const retItems = M.lines.filter(l => l.ret > 0 && (!LX.agent || l.agent === LX.agent));
  const retProd = LX.sumBy(retItems, 'product', l => l.ret);
  body.innerHTML = `<div class="bar">${LX.agentSel(LX.agentsOf([...M.ords, ...M.returns]))}</div>
    <div class="kpis">${UI.tile('Заказов за период', String(O.length), { sub: $$(O.reduce((a, o) => a + o.sum, 0)), hero: true })}${UI.tile('Не закрыто', String(open.length), { sub: $$(open.reduce((a, o) => a + o.sum, 0)), tone: open.length ? 'warn' : '' })}${st.unconfirmed_count != null ? UI.tile('Не подтверждено', String(st.unconfirmed_count), { sub: `запрошено ${st.requested_count ?? 0} · готово ${st.ready_count ?? 0}` }) : ''}${UI.tile('Возвраты', String(R.length), { sub: $$(R.reduce((a, r) => a + r.sum, 0)), tone: R.length ? 'warn' : '' })}</div>
    <div class="grid">
    ${UI.panel('Заказы по статусам', CH.hbars(LX.sumBy(O, o => LX.st2(o.status), () => 1).map(([label, value]) => ({ label, value })), { unit: '', fmt: f }), { cls: 'w6' })}
    ${UI.panel('Возвраты по товарам, шт.', retProd.length ? CH.hbars(retProd.slice(0, 10).map(([label, value]) => ({ label, value })), { unit: '', fmt: f, color: 'var(--neg, #c0392b)' }) : '<p class="mut">Возвратов товара нет.</p>', { cls: 'w6' })}
    ${UI.panel(`Незакрытые заказы (${open.length})`, open.length ? LX.table(['Дата', 'Клиент', 'Агент', 'Статус', '#Сумма', 'Доставка', 'Адрес'], open.map(o => `<tr><td>${UI.dateRu(o.date)}</td><td>${LX.cl(o.client)}</td><td>${esc(o.agent)}</td><td>${UI.pill('info', LX.st2(o.status))}</td><td class="n">${f(o.sum)}</td><td>${o.deliver ? UI.dateRu(o.deliver) : '—'}</td><td><small>${esc(o.address)}</small></td></tr>`), { max: '420px' }) : '<p class="mut">Все заказы закрыты.</p>', { cls: 'w12', sub: 'Заказы, которые ещё не доставлены или не завершены' })}
    ${UI.panel(`Возвраты (${R.length})`, R.length ? LX.table(['Дата', 'Клиент', 'Агент', 'Статус', '#Сумма', 'Причина'], R.sort((a, b) => b.date.localeCompare(a.date)).map(r => `<tr><td>${UI.dateRu(r.date)}</td><td>${LX.cl(r.client)}</td><td>${esc(r.agent)}</td><td>${esc(LX.st2(r.status))}</td><td class="n neg">${f(r.sum)}</td><td><small>${esc(r.reason)}</small></td></tr>`), { max: '380px' }) : '<p class="mut">Возвратов нет 👍</p>', { cls: 'w12' })}
    ${UI.panel('Возвраты по агентам', CH.hbars(LX.sumBy(R, 'agent').map(([label, value]) => ({ label, value })), { unit: LX.u(M.cur), fmt: f }), { cls: 'w6' })}
    ${UI.panel('Заказы по агентам', CH.hbars(LX.sumBy(O, 'agent').map(([label, value]) => ({ label, value })), { unit: LX.u(M.cur), fmt: f }), { cls: 'w6' })}
    </div>`;
  LX.bindAgent(body);
};

// ---------- Просрочка долга (LINKO debtors by age) ----------
LX.aging = () => {
  const cfg = (LX.d('debtcfg')[0] || {}).config || {}, p1 = LX.n(cfg.first_debt_period) || 0, p2 = LX.n(cfg.second_debt_period) || 0, p3 = LX.n(cfg.third_debt_period) || 0;
  const labels = p1 && p2 && p3 ? [`до ${p1} дн.`, `${p1}–${p2} дн.`, `${p2}–${p3} дн.`, `больше ${p3} дн.`] : ['1-й срок', '2-й срок', '3-й срок', 'самый старый'];
  const rows = LX.d('debtors').map(r => {
    const cs = Array.isArray(r.currencies) ? r.currencies : [], c = cs.find(x => /usd|\$|долл/i.test(x.name || '')) || cs[0] || {};
    const b = [LX.n(c.debt_first), LX.n(c.debt_second), LX.n(c.debt_third), LX.n(c.debt_fourth)].map(Math.abs);
    const name = r['client.name'] || '';
    return { name, agent: LX.clientAgent(name, LX.person(r, 'client.responsible_agent')), phone: r['client.phone'] || r['market.phone'] || '', address: r['client.address'] || r['market.address'] || '', guide: r['client.guide'] || '', b, total: Math.abs(LX.n(c.debt_total)) || b.reduce((x, y) => x + y, 0), cur: c.name || '' };
  }).filter(r => r.total > 0);
  return { labels, rows };
};
EXT_PAGES.lxage = async el => {
  const body = await LX.shell(el, 'lxage', '<button class="btn gray" id="lxCsv">⬇ Excel (CSV)</button>'); if (!body) return;
  const { labels, rows } = LX.aging(), f = UI.fmt0, R = rows.filter(r => !LX.agent || r.agent === LX.agent);
  const cur = R[0]?.cur || '', $$ = v => LX.money(v, cur), tot = [0, 1, 2, 3].map(i => R.reduce((a, r) => a + r.b[i], 0));
  const old = r => r.b[3] * 1e6 + r.b[2] * 1e3 + r.b[1];
  const agents = LX.agentsOf(R);
  body.innerHTML = `<div class="bar">${LX.agentSel(LX.agentsOf(rows))}</div>
    <div class="kpis">${labels.map((l, i) => UI.tile(l, $$(tot[i]), { tone: i >= 2 && tot[i] ? 'bad' : i === 1 && tot[i] ? 'warn' : '', sub: `${R.filter(r => r.b[i] > 0).length} клиентов` })).join('')}</div>
    <div class="grid">
    ${UI.panel('Агенты: долг по срокам', LX.table(['Агент', ...labels.map(l => '#' + l), '#Всего'], agents.map(a => { const x = R.filter(r => r.agent === a), s = i => x.reduce((y, r) => y + r.b[i], 0); return `<tr><td>${LX.ag(a)}</td>${[0, 1, 2, 3].map(i => `<td class="n ${i >= 2 && s(i) ? 'neg' : ''}">${s(i) ? f(s(i)) : '—'}</td>`).join('')}<td class="n"><b>${f(x.reduce((y, r) => y + r.total, 0))}</b></td></tr>`; })), { cls: 'w12', sub: 'Чем правее, тем старше долг и тем труднее его собрать' })}
    ${UI.panel(`Должники (${R.length}) — сначала самые старые долги`, LX.table(['Клиент', 'Агент', 'Телефон', ...labels.map(l => '#' + l), '#Всего', 'Адрес'], R.sort((a, b) => old(b) - old(a)).map(r => `<tr><td>${LX.cl(r.name)}</td><td>${esc(r.agent)}</td><td>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</td>${r.b.map((v, i) => `<td class="n ${i >= 2 && v ? 'neg' : ''}">${v ? f(v) : '—'}</td>`).join('')}<td class="n"><b>${f(r.total)}</b></td><td><small>${esc([r.address, r.guide].filter(Boolean).join(' · '))}</small></td></tr>`), { max: '600px' }), { cls: 'w12' })}
    </div>`;
  LX.bindAgent(body);
  $('#lxCsv', el).onclick = () => UI.csv('просрочка-' + UI.localDate(Date.now()), [['Клиент', 'Агент', 'Телефон', ...labels, 'Всего', 'Адрес'], ...R.map(r => [r.name, r.agent, r.phone, ...r.b.map(Math.round), Math.round(r.total), r.address])]);
};

// ---------- Работа агентов (working day, visits, refusals) ----------
EXT_PAGES.lxwork = async el => {
  const body = await LX.shell(el, 'lxwork'); if (!body) return;
  const f = UI.fmt0, n = LX.n, M = LX.model();
  const rowsOf = id => LX.d(id).map(r => ({ ...r, agent: LX.agentName([r.first_name, r.second_name].filter(Boolean).join(' ')) })).filter(r => r.agent);
  const T = rowsOf('workday'), P = rowsOf('workper');
  const tbl = (R, today) => R.length ? LX.table(['Агент', '#Продажи план', '#Факт', '#%', '#Заказов', '#АКБ / план', '#Визитов по плану', '#Сделано', '#Без плана', '#Отказов', '#Ср. чек', ...(today ? ['Первый визит', 'Последний', '#Опоздание, мин'] : ['#Прогноз продаж'])],
    R.sort((a, b) => n(b.sales_fact) - n(a.sales_fact)).map(r => { const done = n(r.total_tasks_done_by_market), plan = n(r.total_tasks_by_market), sp = n(r.sales_percent) || (n(r.sales_plan) ? n(r.sales_fact) / n(r.sales_plan) * 100 : 0);
      return `<tr><td>${LX.ag(r.agent)}</td><td class="n">${f(n(r.sales_plan))}</td><td class="n"><b>${f(n(r.sales_fact))}</b></td><td class="n ${sp && sp < 50 ? 'neg' : sp >= 100 ? 'pos' : ''}">${sp ? Math.round(sp) + '%' : '—'}</td><td class="n">${f(n(r.order_count))}</td><td class="n">${f(n(r.akb))} / ${f(n(r.akb_plan))}</td><td class="n">${f(plan)}</td><td class="n ${plan && done / plan < 0.5 ? 'neg' : ''}">${f(done)} <small>(${LX.pct(done, plan)})</small></td><td class="n">${f(n(r.no_plan_count))}</td><td class="n ${n(r.total_rejects) ? 'neg' : ''}">${f(n(r.total_rejects))}</td><td class="n">${f(n(r.avg_check))}</td>${today ? `<td>${esc(String(r['first_done_task_time.date'] || '').slice(11, 16) || '—')}</td><td>${esc(String(typeof r.last_done_task_time === 'object' && r.last_done_task_time ? r.last_done_task_time.date || '' : r.last_done_task_time || '').slice(11, 16) || '—')}</td><td class="n">${r['difference_min.amount'] != null ? f(n(r['difference_min.amount'])) : '—'}</td>` : `<td class="n">${f(n(r.prediction_sales))}</td>`}</tr>`; })) : '<p class="mut">LINKO не отдал данные.</p>';
  const rej = LX.d('rejects').map(r => ({ date: LX.day(r.created_date), time: String(r.created_date || '').slice(11, 16), comment: String(r.comment || 'без причины').trim(), client: r['market.name'] || '', agent: LX.agentName(LX.person(r, 'user')) })).filter(r => !LX.agent || r.agent === LX.agent);
  const t0 = UI.localDate(Date.now()), rejT = rej.filter(r => r.date === t0);
  body.innerHTML = `<div class="bar">${LX.agentSel([...new Set([...T, ...P].map(r => r.agent).concat(rej.map(r => r.agent)))].filter(Boolean).sort((a, b) => a.localeCompare(b)))}</div>
    <div class="grid">
    ${UI.panel('Сегодня', tbl(T.filter(r => !LX.agent || r.agent === LX.agent), true), { cls: 'w12', sub: 'Визиты по маршруту из приложения агентов LINKO: сколько точек по плану, сколько сделано, отказы, время первого и последнего визита' })}
    ${UI.panel('За период плана', tbl(P.filter(r => !LX.agent || r.agent === LX.agent), false), { cls: 'w12' })}
    ${UI.panel('Почему отказывают (за период)', rej.length ? CH.hbars(LX.sumBy(rej, 'comment', () => 1).slice(0, 12).map(([label, value]) => ({ label, value })), { unit: '', fmt: f, share: true }) : '<p class="mut">Отказов нет.</p>', { cls: 'w6' })}
    ${UI.panel(`Отказы сегодня (${rejT.length})`, rejT.length ? LX.table(['Время', 'Клиент', 'Агент', 'Причина'], rejT.map(r => `<tr><td>${esc(r.time)}</td><td>${LX.cl(r.client)}</td><td>${esc(r.agent)}</td><td>${esc(r.comment)}</td></tr>`), { max: '320px' }) : '<p class="mut">Сегодня отказов нет.</p>', { cls: 'w6' })}
    </div>`;
  LX.bindAgent(body);
};

// ---------- Прибыль по товарам (LINKO net cost) ----------
EXT_PAGES.lxprof = async el => {
  const body = await LX.shell(el, 'lxprof'); if (!body) return;
  const f = UI.fmt0, n = LX.n;
  const R = LX.d('prods').map(r => ({ name: r.name, type: r['type.name'] || '', count: n(r.actual_sales_count) || n(r.sales_count), sum: n(r.actual_sales_sum) || n(r.sales_income), profit: n(r.profit_sum), cost: n(r.sales_net_cost), ret: n(r.return_date_sum), disc: n(r.discount_sum), plan: n(r.product_plan), left: n(r.remain_product_plan), brand: LX.brandOf(r.name) })).filter(r => r.sum || r.count);
  if (!R.length) { body.innerHTML = UI.empty('Нет данных о прибыли', 'LINKO не отдал продажи по товарам за этот период.'); return; }
  const sum = R.reduce((a, r) => a + r.sum, 0), prof = R.reduce((a, r) => a + r.profit, 0), m = v => (v.sum ? Math.round(v.profit / v.sum * 100) + '%' : '—');
  const byBrand = new Map(); for (const r of R) { const b = byBrand.get(r.brand) || byBrand.set(r.brand, { name: r.brand, sum: 0, profit: 0 }).get(r.brand); b.sum += r.sum; b.profit += r.profit; }
  body.innerHTML = `<p class="mut" style="margin-top:0">Суммы в основной валюте LINKO, прибыль — по себестоимости из LINKO.</p>
    <div class="kpis">${UI.tile('Продажи', f(sum), { hero: true })}${UI.tile('Прибыль', f(prof), { tone: prof > 0 ? 'good' : 'bad' })}${UI.tile('Наценка в продажах', sum ? Math.round(prof / sum * 100) + '%' : '—')}${UI.tile('Возвраты', f(R.reduce((a, r) => a + r.ret, 0)))}</div>
    <div class="grid">
    ${UI.panel('Прибыль по брендам', LX.table(['Бренд', '#Продажи', '#Прибыль', '#Маржа'], [...byBrand.values()].sort((a, b) => b.profit - a.profit).map(b => `<tr><td>${esc(b.name)}</td><td class="n">${f(b.sum)}</td><td class="n"><b>${f(b.profit)}</b></td><td class="n">${m(b)}</td></tr>`)), { cls: 'w6' })}
    ${UI.panel('Топ-10 по прибыли', CH.hbars(R.slice().sort((a, b) => b.profit - a.profit).slice(0, 10).map(r => ({ label: r.name, value: r.profit })), { unit: '', fmt: f }), { cls: 'w6' })}
    ${UI.panel(`Все товары (${R.length})`, LX.table(['Товар', 'Бренд', 'Категория', '#Продано шт.', '#Продажи', '#Прибыль', '#Маржа', '#Скидки', '#План шт.', '#Осталось по плану'], R.sort((a, b) => b.sum - a.sum).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.brand)}</td><td><small>${esc(r.type)}</small></td><td class="n">${f(r.count)}</td><td class="n">${f(r.sum)}</td><td class="n ${r.profit < 0 ? 'neg' : ''}"><b>${f(r.profit)}</b></td><td class="n">${m(r)}</td><td class="n">${r.disc ? f(r.disc) : '—'}</td><td class="n">${r.plan ? f(r.plan) : '—'}</td><td class="n">${r.plan ? f(r.left) : '—'}</td></tr>`), { max: '560px' }), { cls: 'w12' })}
    </div>`;
};

// ---------- Рекомендация склада (LINKO: how many days the stock lasts, what to order) ----------
EXT_PAGES.lxrec = async el => {
  const body = await LX.shell(el, 'lxrec', '<button class="btn gray" id="lxCsv">⬇ Excel (CSV)</button>'); if (!body) return;
  const f = UI.fmt0, n = LX.n;
  const R = LX.d('recom').map(r => ({ name: r.full_name || r.name, brand: r['brand.name'] || LX.brandOf(r.name), type: r['type.name'] || '', bal: n(r.total_balance), sold: n(r.total_amount), day: n(r.by_day), left: r.remain_days == null ? null : n(r.remain_days), week: n(r.week_recommendations), month: n(r.month_recommendations) })).sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  if (!R.length) { body.innerHTML = UI.empty('Рекомендации нет', 'LINKO не отдал рекомендацию по складу.'); return; }
  const tone = d => (d == null ? '' : d <= 7 ? 'neg' : d <= 14 ? 'warn' : '');
  body.innerHTML = `<div class="kpis">${UI.tile('Закончится за неделю', String(R.filter(r => r.left != null && r.left <= 7).length), { tone: 'bad', sub: 'позиций' })}${UI.tile('За 2 недели', String(R.filter(r => r.left != null && r.left > 7 && r.left <= 14).length), { tone: 'warn', sub: 'позиций' })}${UI.tile('Заказать на месяц', f(R.reduce((a, r) => a + r.month, 0)), { sub: 'шт. по рекомендации LINKO' })}</div>
    ${UI.panel('Что и сколько заказать', LX.table(['Товар', 'Бренд', '#Остаток', '#Продаётся в день', '#Хватит на, дн.', '#Заказать на неделю', '#на месяц'], R.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.brand)}</td><td class="n">${f(r.bal)}</td><td class="n">${r.day ? r.day.toFixed(1) : '—'}</td><td class="n ${tone(r.left)}"><b>${r.left == null ? '—' : f(r.left)}</b></td><td class="n">${r.week ? f(r.week) : '—'}</td><td class="n">${r.month ? f(r.month) : '—'}</td></tr>`), { max: '640px' }), { cls: 'w12', sub: 'Расчёт LINKO по скорости продаж. Сравните с «Склад → Заявка в Ташкент»' })}`;
  $('#lxCsv', el).onclick = () => UI.csv('рекомендация-' + UI.localDate(Date.now()), [['Товар', 'Бренд', 'Остаток', 'В день', 'Хватит на дней', 'На неделю', 'На месяц'], ...R.map(r => [r.name, r.brand, r.bal, r.day, r.left, r.week, r.month])]);
};

// ---------- block for the client card ----------
LX.card = name => {
  if (!LX.has()) return '';
  const M = LX.model(), f = UI.fmt0, $$ = v => LX.money(v, M.cur), k = LX.norm(name), same = x => LX.norm(x) === k;
  const lines = M.lines.filter(l => same(l.client)), ords = M.ords.filter(o => same(o.client)).sort((a, b) => b.date.localeCompare(a.date)), pays = M.payments.filter(p => same(p.client)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const fr = LX.d('freq').find(r => same(r.name)), ag = LX.aging(), debt = ag.rows.find(r => same(r.name));
  const brands = LX.sumBy(M.lines, 'brand').map(b => b[0]).slice(0, 8), took = new Set(lines.filter(l => !l.bonus).map(l => l.brand));
  const prods = LX.sumBy(lines.filter(l => !l.bonus), 'product').slice(0, 8);
  const rets = M.returns.filter(r => same(r.client));
  const parts = [];
  if (debt || fr) parts.push(`<div class="kpis kpis-sm">${fr ? UI.tile('Обычно берёт', fr.frequency ? `раз в ${f(LX.n(fr.frequency))} дн.` : '—', { sub: fr.last_trade_date ? `последний раз ${UI.dateRu(LX.day(fr.last_trade_date))}${LX.n(fr.not_trade_from_day) ? ` · ${f(LX.n(fr.not_trade_from_day))} дн. назад` : ''}` : '', tone: LX.n(fr.frequency) && LX.n(fr.not_trade_from_day) > LX.n(fr.frequency) ? 'warn' : '' }) : ''}
    ${debt ? ag.labels.map((l, i) => UI.tile('Долг ' + l, debt.b[i] ? LX.money(debt.b[i], debt.cur) : '—', { tone: i >= 2 && debt.b[i] ? 'bad' : '' })).join('') : ''}</div>`);
  if (debt && (debt.phone || debt.address)) parts.push(`<p>${debt.phone ? `📞 <a href="tel:${esc(debt.phone)}">${esc(debt.phone)}</a> ` : ''}${debt.address ? `📍 ${esc([debt.address, debt.guide].filter(Boolean).join(' · '))}` : ''}</p>`);
  if (lines.length || brands.length) parts.push(`<p><b>Бренды за период:</b> ${brands.map(b => UI.pill(took.has(b) ? 'good' : 'warn', (took.has(b) ? '✓ ' : '+ ') + b)).join(' ')}<br><small class="mut">✓ берёт · + не берёт — можно предложить</small></p>`);
  if (prods.length) parts.push(`<p><b>Что покупал:</b> ${prods.map(([p, v]) => `${esc(p)} <small class="mut">${$$(v)}</small>`).join(' · ')}</p>`);
  if (ords.length) parts.push(LX.table(['Заказ', 'Статус', '#Сумма', '#Возврат'], ords.slice(0, 8).map(o => `<tr><td>${UI.dateRu(o.date)}</td><td>${esc(LX.st2(o.status))}</td><td class="n">${f(o.sum)}</td><td class="n">${o.ret ? f(o.ret) : '—'}</td></tr>`), { max: '220px' }));
  if (pays.length) parts.push(`<p><b>Оплаты за период:</b> ${pays.slice(0, 10).map(p => `${UI.dm(p.date)} <b class="pos">${LX.money(p.amount, M.payCur)}</b>`).join(' · ')}</p>`);
  if (rets.length) parts.push(`<p><b>Возвраты:</b> ${rets.map(r => `${UI.dm(r.date)} <span class="neg">${$$(r.sum)}</span>${r.reason ? ` <small>(${esc(r.reason)})</small>` : ''}`).join(' · ')}</p>`);
  return parts.length ? `<h4 class="ch">Из LINKO</h4>${parts.join('')}` : '';
};
LX.phone = name => { if (!LX.has()) return ''; const k = LX.norm(name), r = LX.aging().rows.find(x => LX.norm(x.name) === k); return r?.phone || ''; };

// short LINKO summary for the AI assistant
LX.aiText = () => {
  const M = LX.model(), r = Math.round, L = [`ДАННЫЕ LINKO (обновлено ${new Date(LX.st().at).toLocaleString('ru-RU')}):`];
  const br = LX.sumBy(M.lines, 'brand'); if (br.length) L.push('Продажи по брендам за период: ' + br.map(([b, v]) => `${b} ${r(v)}`).join('; '));
  const ab = LX.agentsOf(M.lines).map(a => `${a}: ` + LX.sumBy(M.lines.filter(l => l.agent === a), 'brand').map(([b, v]) => `${b} ${r(v)}`).join(', ')); if (ab.length) L.push('Агенты по брендам: ' + ab.join(' | '));
  const top = LX.sumBy(M.lines, 'product').slice(0, 15); if (top.length) L.push('Топ товаров: ' + top.map(([p, v]) => `${p} ${r(v)}`).join('; '));
  const t0 = UI.localDate(Date.now()), pay = LX.sumBy(M.payments.filter(p => p.date === t0), 'agent', p => p.amount); L.push('Оплаты сегодня по агентам: ' + (pay.length ? pay.map(([a, v]) => `${a} ${r(v)}`).join('; ') : 'нет'));
  const ag = LX.aging(); if (ag.rows.length) { L.push(`Долг по срокам (${ag.labels.join(' / ')}), клиент; агент; суммы:`); for (const x of ag.rows.sort((a, b) => b.total - a.total).slice(0, 60)) L.push([x.name, x.agent, ...x.b.map(r)].join('; ')); }
  const late = LX.d('freq').filter(x => LX.n(x.frequency) && LX.n(x.not_trade_from_day) > LX.n(x.frequency)).slice(0, 60); if (late.length) L.push('Пропустили свой обычный срок заказа (клиент; берёт раз в дн.; не брал дн.): ' + late.map(x => `${x.name} ${x.frequency}/${x.not_trade_from_day}`).join('; '));
  const w = LX.d('workday'); if (w.length) L.push('Работа агентов сегодня (агент; продажи факт/план; визитов сделано/по плану; отказов): ' + w.map(x => `${LX.agentName([x.first_name, x.second_name].filter(Boolean).join(' '))} ${r(LX.n(x.sales_fact))}/${r(LX.n(x.sales_plan))} ${LX.n(x.total_tasks_done_by_market)}/${LX.n(x.total_tasks_by_market)} ${LX.n(x.total_rejects)}`).join('; '));
  const rj = LX.sumBy(LX.d('rejects'), r2 => r2.comment || 'без причины', () => 1).slice(0, 8); if (rj.length) L.push('Причины отказов: ' + rj.map(([c, n]) => `${c} ${n}`).join('; '));
  const open = M.ords.filter(o => !LX.closed(o.status)); L.push(`Незакрытых заказов: ${open.length} на ${r(open.reduce((a, o) => a + o.sum, 0))}; возвратов за период: ${M.returns.length} на ${r(M.returns.reduce((a, x) => a + x.sum, 0))}.`);
  return L.join('\n');
};
