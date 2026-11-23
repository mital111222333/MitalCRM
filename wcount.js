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
  DEC: { fix: '✓ Ошибка учёта — исправлю в LINKO', found: '🔎 Найдено / пересорт', known: '📌 Постоянная разница — учитывать дальше', dmg: '🗑 Брак — спишу в LINKO', charge: '💸 Недостача — удержать с завсклада', recount: '↻ Пересчитать' },
  // goods no longer counted (brands / words in the name, e.g. MATTEX): left out of the store keeper's list, the comparison (autolinko.gs
  // storeStock_) and the warehouse pages (wh.js whApi). ext.whSkip; not set yet — MATTEX.
  skipList() { const x = CRMLocal.ext(); return Array.isArray(x.whSkip) ? x.whSkip : ['MATTEX']; },
  skipped(i) { const L = WC.skipList().map(s => String(s).trim().toUpperCase()).filter(Boolean), t = (String(i.brand || '') + ' ' + String(i.name || '')).toUpperCase(); return L.some(s => t.includes(s)); },
  // known permanent differences per warehouse (ext.wcount.known[wh][art] = { d: fact − LINKO, name, at }): a count with exactly this
  // difference counts as matching — here and in the auto-loader (the store keeper's file carries known: { art: d })
  known(wh) { const c = WC.cfg(); c.known ||= {}; return c.known[wh] || {}; },
  // cost of one unit: the newest stock upload of the warehouse (by article), else LINKO «Прибыль по товарам» (cost of sales ÷ units sold, by name)
  costs(wh) {
    const S = CRMLocal.engine.getState(), u = (S.wh.uploads || []).filter(x => x.warehouse === wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0], byArt = new Map(), byName = new Map();
    for (const r of u?.rows || []) if (r.cost > 0) byArt.set(String(r.art), r.cost);
    try { for (const p of (typeof LX !== 'undefined' ? LX.d('prods') : [])) { const n = LX.n(p.actual_sales_count) || LX.n(p.sales_count), c = LX.n(p.sales_net_cost); if (n > 0 && c > 0) byName.set(LX.norm(p.name), c / n); } } catch { /* no LINKO data */ }
    return { get: (art, name) => byArt.get(String(art)) || (typeof LX !== 'undefined' ? byName.get(LX.norm(name)) : 0) || 0 };
  },
  view(sub) {
    const cost = WC.costs(sub.warehouse), K = WC.known(sub.warehouse);
    // k: the known difference used for this count (the auto-loader writes it; older counts — today's setting). dd — the difference beyond it
    const rows = sub.items.map(i => { const k = 'k' in i ? Number(i.k) || 0 : Number(K[i.art]?.d) || 0, d = i.fact - i.linko; return { ...i, k, d, dd: d - k, moved: i.fact !== i.linko + k && i.fact === i.now + k, cost: cost.get(i.art, i.name) }; });
    const diff = rows.filter(i => i.dd !== 0 && !i.moved);
    const short = diff.filter(i => i.dd < 0), plus = diff.filter(i => i.dd > 0);
    const charged = Object.entries(sub.dec || {}).filter(([, d]) => d.k === 'charge').reduce((t, [, d]) => t + (Number(d.sum) || 0), 0);
    return { rows, diff, moved: rows.filter(i => i.moved), known: rows.filter(i => i.k && !i.dd), short, plus, shortSum: short.reduce((s, i) => s + -i.dd * i.cost, 0), plusSum: plus.reduce((s, i) => s + i.dd * i.cost, 0), charged };
  },

  // the store keeper's rating: per day the last full count (a recount is already merged into it); month = this calendar month.
  // rank — place among all store keepers by the share of clean days this month (then fewer late ones)
  stats(who) {
    const c = WC.cfg(), dl = c.deadline || '10:00', m0 = UI.localDate(Date.now()).slice(0, 7), by = new Map();
    for (const s of c.subs) if (!s.partial) { if (!by.has(s.who)) by.set(s.who, new Map()); by.get(s.who).set(s.day, s); }
    const calc = w => {
      const rows = [...(by.get(w) || new Map()).values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(s => { const v = WC.view(s); return { d: s.day, ok: !v.diff.length, n: v.diff.length, late: WC.hm(s.at) > dl, ch: Math.round(v.charged * 100) / 100 }; });
      let streak = 0; for (let k = rows.length - 1; k >= 0 && rows[k].ok; k--) streak++;
      let best = 0, run = 0; for (const r of rows) { run = r.ok ? run + 1 : 0; best = Math.max(best, run); }
      const mon = rows.filter(r => r.d.startsWith(m0));
      return { days: rows.slice(-30), streak, best, month: { cnt: mon.length, clean: mon.filter(r => r.ok).length, onTime: mon.filter(r => !r.late).length, charged: Math.round(mon.reduce((t, r) => t + r.ch, 0) * 100) / 100 } };
    };
    const all = [...by.keys()].map(w => ({ w, m: calc(w).month })).filter(x => x.m.cnt).sort((a, b) => b.m.clean / b.m.cnt - a.m.clean / a.m.cnt || (a.m.cnt - a.m.onTime) - (b.m.cnt - b.m.onTime));
    const me = calc(who), k = all.findIndex(x => x.w === who);
    return { ...me, rank: k >= 0 ? k + 1 : null, of: all.length, deadline: dl };
  },
  // «что заканчивается» on this warehouse (names and a status only — the count stays blind): from the warehouse low-stock report
  // (WC._low, fetched before publishing); «from» — another warehouse that has plenty
  lowFor(wh) {
    const L = WC._low; if (!L || !Array.isArray(L.items)) return null;
    const S = CRMLocal.engine.getState(), ever = new Map();
    for (const u of S.wh.uploads || []) if (u.warehouse === wh) for (const r of u.rows || []) ever.set(String(r.art), Math.max(ever.get(String(r.art)) || 0, Number(r.total) || 0));
    const out = [];
    for (const i of L.items) {
      if (WC.skipped(i)) continue;
      const cell = (i.cells || []).find(x => x.wh === wh), tot = cell ? Number(cell.total) || 0 : 0, av = cell ? Number(cell.available) || 0 : 0;
      const st = tot <= 0 ? ((ever.get(String(i.art)) || 0) > 0 ? 'out' : null) : av <= 0 ? 'blocked' : av <= (Number(i.min) || 0) ? 'low' : null;
      if (st) out.push({ art: String(i.art), name: i.name, s: st, ...(i.move_from && i.move_from.wh !== wh ? { from: i.move_from.wh } : {}) });
    }
    const o = { out: 0, blocked: 1, low: 2 }; out.sort((a, b) => o[a.s] - o[b.s] || String(a.name).localeCompare(String(b.name)));
    return { at: L.window?.to || null, items: out.slice(0, 150) };
  },
  async prep() { try { WC._low = await CRMLocal.request('GET', '/api/wh/low'); } catch { WC._low = null; } },
  // after a new count arrives: refresh the store keepers' files (rating) a little later, once
  later() { clearTimeout(WC._lt); WC._lt = setTimeout(() => { WC.publish().catch(() => {}); WC.publishSb().catch(() => {}); }, 15000); },
  MOVE: { in: '📥 Приход', out: '📤 Отгрузка', ret: '↩ Возврат', dmg: '🗑 Брак' },
  // брак the store keeper wrote off on this warehouse in the 7 days before a count: { art: [{ qty, at, why }] } — shown next to a shortage
  dmgFor(wh, beforeIso) { const t = Date.parse(beforeIso), out = {}; for (const m of WC.cfg().moves || []) { if (m.type !== 'dmg' || m.warehouse !== wh) continue; const at = Date.parse(m.at); if (!(at <= t + 36e5 && at > t - 7 * 864e5)) continue; for (const i of m.items || []) if (i.art) (out[i.art] ||= []).push({ qty: i.qty, at: m.at, why: m.party }); } return out; },

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
    c.subs.push({ id: Date.parse(m.at) + '-' + m.who, who: m.who, name: m.name, warehouse: m.warehouse, day, start_at: m.start_at, at: m.at, partial: !!m.partial, short: !!m.short, again: !!m.again, total_items: m.total_items || 0, items: m.items, photo: m.photo || '', comment: m.comment || '', status: m.result === 'recount' ? 'recount' : 'new', recount: m.result === 'recount' ? (m.recount || []) : [], ...(m.result ? { result: m.result, round: m.round || 1 } : {}) });
    c.subs = c.subs.slice(-400);
    return true;
  },

  // the store keeper's file: the product list of his warehouse (names only: the count is blind) and the count settings
  file(who, name, wh, bot) {
    const c = WC.cfg(), last = c.subs.filter(x => x.who === who).at(-1), recount = last && last.status === 'recount' ? last.recount : [];
    const S = CRMLocal.engine.getState(), up = (S.wh.uploads || []).filter(u => u.warehouse === wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0];
    const items = (up?.rows || []).filter(r => !WC.skipped(r)).map(r => ({ art: String(r.art), name: r.name, brand: r.brand || '' }));
    const K = WC.known(wh), known = {}; for (const a in K) if (Number(K[a].d)) known[a] = Number(K[a].d);
    return { v: 1, role: 'store', who, name, warehouse: wh, skip: WC.skipList(), known, again: c.again?.[who] || null, stats: WC.stats(who), low: WC.lowFor(wh), branch: WC.branchOf(wh), deadline: c.deadline || '10:00', boss: AC.boss() || null, bot: bot || null, chat: typeof CHAT !== 'undefined' && CHAT.url ? CHAT.url() : null, at: new Date().toISOString(), recount: recount.map(a => ({ art: a, name: last.items.find(i => i.art === a)?.name || a })), items,
      mode: c.mode || 'full', fullDay: Number(c.fullDay || 1), extra: Number(c.extra ?? 8), packs: c.packs || {} };
  },
  // store keepers with their own CRM login (Пользователи → role «Завсклад», «Имя в LINKO» = his warehouse): the same file as
  // agents/sb/<account id>.json for the auto-loader (it checks the login with the MITAL database), and a small row in agent_cabinets
  // that tells his page where the auto-loader is. who = 'sb_<id>' keeps his counts apart from the Telegram store keepers.
  async publishSb({ force = false } = {}) {
    const sb = window.AUTH?.sb, me = window.AUTH?.profile, cl = typeof AC !== 'undefined' ? AC.cloud() : null, web = typeof AC !== 'undefined' ? AC.web() : '';
    if (!sb || !me || ['agent', 'store'].includes(me.role) || window.CLOUD?.gate?.() || !cl || !web || WC._busySb) return 0;
    WC._busySb = true;
    try {
      await WC.prep();
      const { data, error } = await sb.from('profiles').select('id, full_name, linko_name, is_active').eq('role', 'store');
      if (error) throw error;
      let n = 0; WC._lastSb ||= {};
      for (const p of (data || []).filter(x => x.is_active && x.linko_name)) {
        const file = WC.file('sb_' + p.id, p.full_name, p.linko_name, ''), key = JSON.stringify({ ...file, at: '' });
        if (!force && WC._lastSb[p.id] === key) continue;
        await AC.gh(cl, 'PUT', 'agents/sb/' + p.id + '.json', { message: 'CRM: кабинет склада (логин)', content: AC.b64(JSON.stringify(file)) });
        const { error: e2 } = await sb.from('agent_cabinets').upsert({ agent_id: p.id, data: { v: 1, role: 'store', name: p.full_name, warehouse: p.linko_name, gas: web, items: file.items.length, at: file.at }, updated_at: new Date().toISOString(), updated_by: me.id });
        if (e2) throw e2;
        WC._lastSb[p.id] = key; n++;
      }
      return n;
    } finally { WC._busySb = false; }
  },
  // the store keepers' cabinets + stores.json for the reminder
  async publish() {
    const c = WC.cfg(), cl = typeof AC !== 'undefined' ? AC.cloud() : null; if (!cl) return 0;
    await WC.prep();
    const on = Object.entries(c.stores).filter(([, s]) => s.on && s.wh);
    const bot = CRMLocal.ext().tg?.token ? await AC.bot() : '';
    WC._lastTg ||= {};
    for (const [who, s] of on) {
      const file = WC.file(who, s.name, s.wh, bot), key = JSON.stringify({ ...file, at: '' });
      if (WC._lastTg[who] === key) continue; // nothing changed since the last publish in this session
      await AC.gh(cl, 'PUT', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада', content: AC.b64(JSON.stringify(file)) });
      WC._lastTg[who] = key;
    }
    const sj = JSON.stringify({ deadline: c.deadline || '10:00', remind: c.remind || '09:00', app: AC.web() ? AC.miniUrl() : '', list: on.map(([who, s]) => ({ who, name: s.name, warehouse: s.wh })) });
    if (WC._lastSj !== sj) { await AC.gh(cl, 'PUT', 'stores.json', { message: 'CRM: склады и срок сверки', content: AC.b64(sj) }); WC._lastSj = sj; }
    return on.length;
  },
  async connect(who) {
    const s = WC.cfg().stores[who], url = AC.miniUrl();
    await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: AC.panelBtn() });
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: `<b>Кабинет склада ${esc(s.wh)}</b>\nКаждое утро до ${esc(WC.cfg().deadline || '10:00')} пересчитайте товары и отправьте сверку — прямо здесь, в Telegram.`, reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } });
  },
  async notify(who, html) {
    const url = AC.web() ? AC.miniUrl() : '';
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: html, ...(url ? { reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } } : {}) });
  },
};
INBOX_HANDLERS.count = m => { const r = WC.apply(m); WC.later(); return r; };
// приход / отгрузка / возврат from a store keeper's cabinet (autolinko.gs moveAct_): kept as ext.wcount.moves (last 300)
INBOX_HANDLERS.whmove = m => {
  const c = WC.cfg(); c.moves ||= []; if (c.moves.some(x => x.id === m.id)) return true;
  c.moves.push({ id: m.id, at: m.at, who: m.who, name: m.name, warehouse: m.warehouse, type: m.type, party: m.party || '', items: m.items || [], comment: m.comment || '', photo: m.photo || '', linko_at: m.linko_at || null });
  c.moves = c.moves.slice(-300); return true;
};

// ---------- the page: four tabs — «Сверка» (today's warehouses + the chosen count with decisions), «История», «Приход / отгрузка», «Настройки» ----------
WC.SHORT = { fix: '✓ Ошибка учёта', found: '🔎 Пересорт', known: '📌 Постоянная', dmg: '🗑 Брак', charge: '💸 Удержать' };
WC.TONE = { fix: 'good', found: 'good', known: '', dmg: 'warn', charge: 'bad' };
// state of one count: [tone, text]
WC.state = (s, v) => s.status === 'recount' ? ['warn', '↻ ждём пересчёт'] : s.result === 'final' && s.status !== 'ok' ? ['bad', '🔒 зафиксировано — нужны решения'] : !v.diff.length ? ['good', '✓ сходится'] : s.status === 'ok' ? ['good', '✓ принято'] : ['bad', 'ждёт решения'];
WC.tab = WC.tab || 'now'; WC.f = WC.f || 'diff'; WC.q = WC.q || ''; WC.draft = WC.draft || {};

EXT_PAGES.wcount = async el => {
  await CRMLocal.ready;
  WC._dmg = {};
  const c = WC.cfg(), f = UI.fmt0, t0 = UI.localDate(Date.now()), $$ = v => '$' + f(v), dl = c.deadline || '10:00', late = new Date().toTimeString().slice(0, 5) >= dl;
  let whs = []; try { whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* none */ }
  const tg = CRMLocal.ext().tg || {}, chats = { ...(tg.seen || {}) }; for (const v of Object.values(tg.chats || {})) if (v?.id) chats[v.id] = v;
  const stores = Object.entries(c.stores);
  if (!WC._pub && stores.length) { WC._pub = true; WC.publish().catch(() => { WC._pub = false; }); }
  // every store keeper: the Telegram ones from the settings + those with a CRM login who sent counts in the last 2 weeks
  const keepers = stores.map(([who, s]) => ({ who, name: s.name, wh: s.wh }));
  const since = UI.localDate(Date.now() - 14 * 864e5);
  for (const s of c.subs) if (s.day >= since && !keepers.some(k => k.who === s.who)) keepers.push({ who: s.who, name: s.name, wh: s.warehouse });
  const todayOf = who => c.subs.filter(s => s.who === who && s.day === t0 && !s.partial).at(-1);
  const waiting = c.subs.filter(s => s.day >= since && !s.partial && s.status !== 'ok' && s.status !== 'recount' && WC.view(s).diff.length);
  // which count is open: the chosen one, else the first of today that needs a decision, else the newest
  if (!WC.sel || !c.subs.some(s => s.id === WC.sel)) WC.sel = (waiting.filter(s => s.day === t0)[0] || c.subs.filter(s => s.day === t0).at(-1) || c.subs.at(-1))?.id || null;
  const sub = c.subs.find(s => s.id === WC.sel), V = sub ? WC.view(sub) : null;
  const movesNew = (c.moves || []).filter(x => !x.ok).length;
  const re = () => EXT_PAGES.wcount(el), save = async () => { CRMLocal.touch(); try { await WC.publish(); } catch (e) { toast(e.message); } try { await WC.publishSb(); } catch (e) { toast(e.message); } };
  const setKnown = (wh, art, d, name) => { c.known ||= {}; c.known[wh] ||= {}; if (d === null) { delete c.known[wh][art]; if (!Object.keys(c.known[wh]).length) delete c.known[wh]; } else c.known[wh][art] = { d, name: String(name || art).slice(0, 120), at: new Date().toISOString() }; };
  const sign = v => (v > 0 ? '+' : '') + f(v);

  // ---------- tab «Сверка» ----------
  const cards = () => keepers.length ? `<div class="wk-cards">${keepers.map(k => {
    const t = todayOf(k.who), v = t ? WC.view(t) : null, st = t ? WC.state(t, v) : null, tone = !t ? (late ? 'bad' : 'warn') : st[0];
    const val = !t ? (late ? '✕ не прислана' : 'ждём до ' + esc(dl)) : v.diff.length ? `${v.diff.length} расх.` : '✓ сходится';
    return `<button type="button" class="wk-card ${tone}${t && t.id === WC.sel ? ' on' : ''}" ${t ? `data-open="${esc(t.id)}"` : 'disabled'}>
      <span class="t">${esc(k.wh)}</span><span class="v">${val}</span>
      <span class="s">${esc(k.name)}${t ? ` · в ${WC.hm(t.at)}${WC.hm(t.at) > dl ? ' <span class="wk-neg">поздно</span>' : ''}` : ''}</span>
      ${t ? `<span class="s">${v.shortSum ? `<span class="wk-neg">−${$$(v.shortSum)}</span> ` : ''}${v.plusSum ? `<span class="wk-pos">+${$$(v.plusSum)}</span> · ` : ''}${esc(st[1])}${c.again?.[k.who] && c.again[k.who] > t.at ? ' · 🔁 просим ещё раз' : ''}</span>` : ''}
    </button>`; }).join('')}</div>` : UI.empty('Завскладов нет', 'Добавьте завсклада во вкладке «Настройки» и подключите ему кабинет склада в Telegram.', '<button class="btn" data-tab="set">Открыть настройки</button>');

  const decidable = () => sub && sub.status !== 'recount' && V.diff.length;
  const draft = () => (WC.draft[sub.id] ||= JSON.parse(JSON.stringify(sub.dec || {})));
  const isDone = (i, d) => !!d && !!d.k && (d.k !== 'charge' || Number(d.sum) > 0);
  const item = i => {
    const dm = (WC._dmg[sub.id] ||= WC.dmgFor(sub.warehouse, sub.at)), dmi = dm[i.art] || [], d = decidable() ? draft()[i.art] : (sub.dec || {})[i.art];
    const auto = i.dd < 0 && i.cost ? Math.round(-i.dd * i.cost * 100) / 100 : '';
    const opts = Object.keys(WC.SHORT).filter(k => (k !== 'charge' && k !== 'dmg') || i.dd < 0);
    return `<div class="wk-item ${decidable() ? (isDone(i, d) ? 'done' : 'need') : ''}" data-it="${esc(i.art)}">
      <div class="h"><div><div class="nm">${esc(i.name)}</div><small>${esc(i.art)} · в LINKO <b>${f(i.linko)}</b> → посчитал <b>${f(i.fact)}</b>${i.k ? ` · 📌 обычно ${sign(i.k)}` : ''}</small>
        ${dmi.length ? `<div class="meta wk-neg">🗑 брак за неделю: ${dmi.map(x => f(x.qty) + ' шт ' + UI.dm(UI.localDate(Date.parse(x.at))) + (x.why ? ' (' + esc(x.why) + ')' : '')).join(', ')}</div>` : ''}</div>
        <div class="num ${i.dd < 0 ? 'wk-neg' : 'wk-pos'}"><b>${sign(i.dd)} шт</b><br><small>${i.cost ? (i.dd < 0 ? '−' : '+') + $$(Math.abs(i.dd) * i.cost) : 'цена ?'}</small></div></div>
      ${decidable() ? `<div class="row2" role="group" aria-label="Решение">${opts.map(k => `<button type="button" class="wk-chip ${WC.TONE[k]}${d?.k === k ? ' on' : ''}" data-dk="${k}" title="${esc(WC.DEC[k])}">${WC.SHORT[k]}</button>`).join('')}
        ${i.dd < 0 ? `<label class="wk-sum" ${d?.k === 'charge' ? '' : 'hidden'}>сумма, $ <input type="number" min="0" step="0.01" inputmode="decimal" data-sum value="${d?.k === 'charge' ? esc(d.sum ?? auto) : auto}"></label>` : ''}</div>`
        : d?.k ? `<div class="row2"><span class="wk-chip on ${WC.TONE[d.k] || ''}">${WC.SHORT[d.k] || d.k}${d.k === 'charge' ? ' · ' + $$(d.sum) : ''}</span></div>` : ''}
    </div>`;
  };
  const detail = () => {
    if (!sub) return UI.empty('Сверок ещё нет', 'Как только завсклад отправит сверку из своего кабинета, она появится здесь.');
    const st = WC.state(sub, V), q = WC.q.trim().toLowerCase(), hitQ = i => !q || String(i.name).toLowerCase().includes(q) || String(i.art).toLowerCase().includes(q);
    const by = { diff: V.diff, short: V.short, plus: V.plus }[WC.f] || V.diff;
    const list = by.filter(hitQ).sort((a, b) => a.dd * (a.cost || 1) - b.dd * (b.cost || 1));
    const all = V.rows.filter(hitQ).sort((a, b) => (a.dd === 0) - (b.dd === 0) || String(a.name).localeCompare(String(b.name)));
    const mine = c.subs.filter(s => s.who === sub.who && !s.partial), isLast = mine.at(-1)?.id === sub.id;
    let streak = 0; for (let k = mine.length - 1; k >= 0 && WC.view(mine[k]).diff.length; k--) streak++;
    const asked = c.again?.[sub.who] && c.again[sub.who] > sub.at;
    return UI.panel(`${esc(sub.warehouse)} · ${UI.dateRu(sub.day)}, ${WC.hm(sub.at)}`, `
      <div class="wk-head"><span class="mut">${esc(sub.name)} · ${sub.short ? `короткая сверка (${f(sub.items.length)} из ${f(sub.total_items)})` : sub.again ? '🔁 повторная' : 'полная сверка'}${sub.round === 2 ? ' · 2-я попытка' : ''}</span>${UI.pill(st[0] === 'bad' ? 'crit' : st[0], st[1])}
        <span class="spacer"></span><label class="mut" style="display:flex;gap:6px;align-items:center">Другая сверка <select id="wcSel">${c.subs.slice().reverse().slice(0, 60).map(s => `<option value="${esc(s.id)}" ${s.id === sub.id ? 'selected' : ''}>${UI.dm(s.day)} · ${esc(s.warehouse)}${s.partial ? ' (пересчёт)' : s.again ? ' (повторная)' : ''}</option>`).join('')}</select></label></div>
      <div class="wk-stats"><div class="wk-stat"><b>${f(sub.items.length)}</b><small>посчитано позиций</small></div><div class="wk-stat ${V.diff.length ? 'neg' : 'pos'}"><b>${V.diff.length ? f(V.diff.length) : '✓ 0'}</b><small>расхождений</small></div>
        <div class="wk-stat ${V.shortSum ? 'neg' : ''}"><b>${V.shortSum ? '−' + $$(V.shortSum) : '$0'}</b><small>недостача (${f(V.short.length)})</small></div><div class="wk-stat ${V.plusSum ? 'pos' : ''}"><b>${V.plusSum ? '+' + $$(V.plusSum) : '$0'}</b><small>излишек (${f(V.plus.length)})</small></div></div>
      ${sub.status === 'recount' ? `<div class="wk-banner warn">↻ <b>Завскладу отправлены названия ${f(sub.recount.length)} поз. на пересчёт</b> (без цифр). Решения выберете после второй попытки.</div>` : sub.result === 'final' && sub.status !== 'ok' ? '<div class="wk-banner bad">🔒 <b>Пересчёт не сошёлся — расхождение зафиксировано.</b> Выберите решение по каждой позиции.</div>' : sub.result === 'ok' && sub.round === 2 ? '<div class="wk-banner good">✅ <b>После пересчёта всё сошлось.</b></div>' : ''}
      ${!sub.start_at ? '<div class="wk-banner info">⚠ Начало сверки не зафиксировано — сравнение с остатком LINKO на момент отправки.</div>' : ''}
      ${sub.comment ? `<div class="wk-banner info">💬 ${esc(sub.comment)}</div>` : ''}${sub.photo ? `<p><a href="#" data-ph="${esc(sub.photo)}">📷 Фото со склада</a></p>` : ''}
      ${V.charged ? `<div class="wk-banner bad">💸 Удержание с завсклада по этой сверке: <b>${$$(V.charged)}</b></div>` : ''}
      <div class="wk-tools">${[['diff', 'Расхождения', V.diff.length], ['short', 'Недостача', V.short.length], ['plus', 'Излишек', V.plus.length], ['all', 'Весь список', V.rows.length]].map(([k, t, n]) => `<button type="button" class="wk-chip${WC.f === k ? ' on' : ''}" data-f="${k}">${t} <span class="wk-badge soft">${f(n)}</span></button>`).join('')}
        <input type="search" id="wcQ" placeholder="🔍 Товар или артикул" value="${esc(WC.q)}" aria-label="Найти товар">${decidable() && WC.f !== 'all' ? '<button type="button" class="wk-chip needs-edit" id="wcAllFix" title="Всем позициям, где решение ещё не выбрано">✓ Всем без решения — ошибка учёта</button>' : ''}</div>
      ${WC.f === 'all' ? (all.length ? LX.table(['Товар', '#LINKO', '#Факт', '#Разница', 'Итог'], all.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td class="n">${f(i.linko)}</td><td class="n"><b>${f(i.fact)}</b></td><td class="n ${i.d < 0 ? 'neg' : i.d > 0 ? 'pos' : ''}">${i.d ? sign(i.d) : '0'}</td><td>${i.moved ? 'ℹ отгрузили во время сверки' : !i.dd ? (i.k ? `<span class="pos">📌 как обычно (${sign(i.k)})</span>` : '<span class="pos">✓</span>') : `<span class="neg">${i.dd < 0 ? 'недостача' : 'излишек'} ${f(Math.abs(i.dd))}</span>`}</td></tr>`), { max: '520px' }) : '<p class="mut">Ничего не найдено.</p>')
        : list.length ? `<div class="wk-list">${list.map(item).join('')}</div>`
        : V.diff.length ? '<p class="mut">Ничего не найдено.</p>' : `<div class="wk-empty"><b>✓ Всё сходится с LINKO</b>недостача 0 · излишек 0${V.known.length ? `<br>📌 учтены постоянные разницы: ${V.known.length} поз.` : ''}</div>`}
      ${V.moved.length && WC.f !== 'all' ? `<details style="margin-top:8px"><summary class="mut">Сошлось после отгрузки во время сверки (${V.moved.length})</summary><ul>${V.moved.map(i => `<li>${esc(i.name)}: на начало ${f(i.linko)}, после отгрузки ${f(i.now)}, факт ${f(i.fact)}</li>`).join('')}</ul></details>` : ''}
      ${isLast && V.diff.length && sub.status !== 'recount' ? `<div class="wk-banner ${streak >= 2 ? 'warn' : 'info'}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="flex:1 1 200px">${streak >= 2 ? `⚠ <b>${streak} сверки подряд с расхождением.</b> ` : ''}${asked ? `🔁 Повторная сверка запрошена в ${WC.hm(c.again[sub.who])} — ждём.` : 'Сомневаетесь в цифрах? Попросите пересчитать весь склад заново.'}</span><button class="btn gray sm" id="wcAgain">🔁 ${asked ? 'Напомнить ещё раз' : 'Сверить ещё раз'}</button></div>` : ''}
      ${sub.status === 'recount' ? '' : `<div class="wk-foot needs-edit">${decidable() ? `<div class="prog"><span id="wcProg"></span><div class="bar2"><i id="wcBar"></i></div></div>` : '<span class="spacer"></span>'}<button class="btn" id="wcOk" type="button">${sub.status === 'ok' ? '✓ Сохранить решения' : V.diff.length ? '✓ Принять сверку' : '✓ Принять — всё сходится'}</button></div>`}`,
      { cls: 'w12' }) + (decidable() ? '<details class="mut" style="margin:-4px 4px 12px"><summary>Что значат решения?</summary><p>«✓ Ошибка учёта» — исправите в LINKO · «🔎 Пересорт» — нашлось или перепутали · «📌 Постоянная» — дальше такая разница считается нормой · «🗑 Брак» — спишете в LINKO · «💸 Удержать» — недостача с завсклада по себестоимости (сумму можно поправить). Разница = факт − LINKO.</p></details>' : '');
  };

  // ---------- tab «История» ----------
  const days = [...new Set(c.subs.map(s => s.day))].sort().reverse().slice(0, 14);
  const history = () => {
    if (!c.subs.length) return UI.empty('Истории пока нет', 'Здесь будут все сверки по дням.');
    const freq = new Map(); for (const s of c.subs.filter(x => days.includes(x.day))) for (const i of WC.view(s).diff) { const k = s.warehouse + '|' + i.art, e = freq.get(k) || freq.set(k, { wh: s.warehouse, art: i.art, name: i.name, n: 0, ds: {} }).get(k); e.n++; e.ds[i.d] = (e.ds[i.d] || 0) + 1; }
    const often = [...freq.values()].filter(e => e.n >= 2).map(e => { const [d, n] = Object.entries(e.ds).sort((a, b) => b[1] - a[1])[0]; return { ...e, mode: Number(d), modeN: n }; }).sort((a, b) => b.n - a.n);
    const hist = c.subs.filter(s => !WC.hw || s.warehouse === WC.hw).slice().reverse();
    const whos = [...new Set(c.subs.filter(x => x.day.startsWith(t0.slice(0, 7))).map(x => x.who))];
    const R = whos.map(w => ({ w, s: WC.stats(w), sub: c.subs.filter(x => x.who === w).at(-1) })).sort((a, b) => (a.s.rank || 99) - (b.s.rank || 99));
    const ch = []; for (const x of c.subs) for (const [art, d] of Object.entries(x.dec || {})) if (d.k === 'charge' && Number(d.sum) > 0) { const it = x.items.find(i => i.art === art); ch.push({ m: x.day.slice(0, 7), day: x.day, who: x.name, wh: x.warehouse, name: it?.name || art, d: (it?.fact ?? 0) - (it?.linko ?? 0), sum: Number(d.sum) }); }
    const months = [...new Set(ch.map(x => x.m))].sort().reverse().slice(0, 3), people = [...new Set(ch.map(x => x.who + ' · ' + x.wh))];
    return `<div class="grid">
      ${UI.panel('Последние 14 дней', `<div class="tscroll"><table class="wk-mx"><thead><tr><th>День</th>${keepers.map(k => `<th class="n">${esc(k.wh)}</th>`).join('')}</tr></thead><tbody>${days.map(d => `<tr><td>${UI.dateRu(d)}</td>${keepers.map(k => { const s = c.subs.filter(x => x.who === k.who && x.day === d && !x.partial).at(-1); if (!s) return '<td class="n neg" style="cursor:default">нет</td>'; const v = WC.view(s); return `<td class="n ${v.diff.length ? 'neg' : 'pos'}" data-hs="${esc(s.id)}" title="Открыть сверку">${v.diff.length ? v.diff.length + ' расх.' : '✓'} <small class="mut">${WC.hm(s.at)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`, { cls: 'w12', sub: 'Нажмите на клетку — откроется эта сверка' })}
      ${R.length ? UI.panel('🏆 Рейтинг завскладов — этот месяц', LX.table(['Место', 'Завсклад', 'Склад', '#Сверок', '#Без расхождений', '#Вовремя', '#Чисто подряд', '#Удержания'], R.map(x => `<tr><td><b>${x.s.rank === 1 ? '🥇' : x.s.rank === 2 ? '🥈' : x.s.rank === 3 ? '🥉' : x.s.rank || '—'}</b></td><td>${esc(x.sub?.name || x.w)}</td><td>${esc(x.sub?.warehouse || '')}</td><td class="n">${f(x.s.month.cnt)}</td><td class="n ${x.s.month.clean === x.s.month.cnt ? 'pos' : ''}"><b>${f(x.s.month.clean)}</b> <small class="mut">${x.s.month.cnt ? Math.round(x.s.month.clean / x.s.month.cnt * 100) + '%' : ''}</small></td><td class="n">${f(x.s.month.onTime)}</td><td class="n">${f(x.s.streak)} <small class="mut">лучший ${f(x.s.best)}</small></td><td class="n">${x.s.month.charged ? $$(x.s.month.charged) : '—'}</td></tr>`)), { cls: 'w12', sub: `Каждый завсклад видит свою строку в кабинете. Вовремя — до ${esc(dl)}.` }) : ''}
      ${often.length ? UI.panel('Расходятся постоянно', LX.table(['Склад', 'Товар', '#Раз за 14 дней', '#Чаще всего', ''], often.slice(0, 20).map(e => `<tr><td>${esc(e.wh)}</td><td>${esc(e.name)}</td><td class="n"><b>${e.n}</b></td><td class="n ${e.mode < 0 ? 'neg' : 'pos'}">${sign(e.mode)} <small class="mut">×${e.modeN}</small></td><td>${e.modeN >= 2 ? `<button class="btn gray sm needs-edit" data-kn="${esc(e.wh + '|' + e.art)}" data-kd="${e.mode}" data-knm="${esc(e.name)}">📌 Учитывать</button>` : ''}</td></tr>`)), { cls: 'w12', sub: 'Товар расходится раз за разом на одно и то же число? «📌 Учитывать» — дальше эта разница считается нормой' }) : ''}
      ${UI.panel('Все сверки', `<div class="wk-tools"><label class="mut">Склад <select id="wcHw"><option value="">все</option>${[...new Set(c.subs.map(s => s.warehouse))].sort().map(w => `<option ${w === WC.hw ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label><span class="mut">всего: ${f(hist.length)} · нажмите строку, чтобы открыть</span></div>
        ${LX.table(['Когда', 'Склад', 'Завсклад', 'Вид', '#Позиций', '#Расх.', '#Недостача', '#Излишек', 'Итог'], hist.slice(0, WC.hn || 30).map(s => { const v = WC.view(s), st = WC.state(s, v); return `<tr class="row" data-hs="${esc(s.id)}" style="cursor:pointer"><td>${UI.dateRu(s.day)} <small class="mut">${WC.hm(s.at)}</small></td><td>${esc(s.warehouse)}</td><td>${esc(s.name)}</td><td>${s.partial ? 'пересчёт' : s.again ? '🔁 повторная' : s.short ? 'короткая' : 'полная'}${s.round === 2 ? ' · 2-я' : ''}</td><td class="n">${f(s.items.length)}</td><td class="n ${v.diff.length ? 'neg' : 'pos'}"><b>${v.diff.length || '✓'}</b></td><td class="n">${v.shortSum ? '−' + $$(v.shortSum) : '0'}</td><td class="n">${v.plusSum ? '+' + $$(v.plusSum) : '0'}</td><td>${UI.pill(st[0] === 'bad' ? 'crit' : st[0], st[1])}${v.charged ? ` 💸 ${$$(v.charged)}` : ''}</td></tr>`; }), { max: '460px' })}
        ${hist.length > (WC.hn || 30) ? '<div class="bar"><span class="spacer"></span><button class="btn gray sm" id="wcMore">Показать ещё</button></div>' : ''}`, { cls: 'w12' })}
      ${ch.length ? UI.panel('💸 Удержания с завскладов', `<div class="tscroll"><table><thead><tr><th>Завсклад</th>${months.map(m => `<th class="n">${m.slice(5, 7)}.${m.slice(0, 4)}</th>`).join('')}</tr></thead><tbody>${people.map(p => `<tr><td>${esc(p)}</td>${months.map(m => { const t = ch.filter(x => x.who + ' · ' + x.wh === p && x.m === m).reduce((a, x) => a + x.sum, 0); return `<td class="n">${t ? '<b>' + $$(t) + '</b>' : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <details><summary class="mut">Все удержания (${ch.length})</summary>${LX.table(['День', 'Завсклад', 'Товар', '#Недостача', '#Сумма'], ch.slice().reverse().map(x => `<tr><td>${UI.dateRu(x.day)}</td><td>${esc(x.who)}</td><td>${esc(x.name)}</td><td class="n">${f(x.d)}</td><td class="n">${$$(x.sum)}</td></tr>`), { max: '320px' })}</details>`, { cls: 'w12', sub: 'По месяцам, из решений «Удержать»' }) : ''}
    </div>`;
  };

  // ---------- tab «Приход / отгрузка» ----------
  const moves = () => { const M = (c.moves || []).slice().reverse(); if (!M.length) return UI.empty('Пока пусто', 'Когда завсклад отметит приход, отгрузку, возврат или брак в своём кабинете, это появится здесь.');
    const show = M.filter(x => WC.mv === 'all' || !x.ok);
    return `<div class="wk-tools"><button type="button" class="wk-chip${WC.mv !== 'all' ? ' on' : ''}" data-mv="new">Не проверено <span class="wk-badge soft">${movesNew}</span></button><button type="button" class="wk-chip${WC.mv === 'all' ? ' on' : ''}" data-mv="all">Все <span class="wk-badge soft">${M.length}</span></button></div>
      ${show.length ? `<div class="wk-list">${show.slice(0, 80).map(x => `<div class="wk-item ${x.ok ? 'done' : 'need'}"><div class="h"><div><div class="nm">${WC.MOVE[x.type] || esc(x.type)}${x.party ? ' · ' + esc(x.party) : ''}</div><small>${esc(x.warehouse)} · ${esc(x.name)} · ${UI.dateRu(UI.localDate(Date.parse(x.at)))} ${WC.hm(x.at)}</small></div>
        <div class="num">${x.ok ? '<span class="wk-pos">✓ проверено</span>' : `<button class="btn sm needs-edit" data-mok="${esc(x.id)}">✓ Проверено</button>`}</div></div>
        <div class="txt">${x.items.slice(0, 15).map(i => `${esc(i.name)}: <b>${f(i.qty)}</b>${i.linko !== null && i.linko !== undefined ? ` <small class="mut">(в LINKO было ${f(i.linko)})</small>` : ''}`).join('<br>')}${x.items.length > 15 ? `<br><small class="mut">…и ещё ${x.items.length - 15}</small>` : ''}</div>
        ${x.comment ? `<div class="rep">💬 ${esc(x.comment)}</div>` : ''}${x.photo ? `<div class="row2"><a href="#" data-ph="${esc(x.photo)}">📷 накладная</a></div>` : ''}</div>`).join('')}</div>` : '<div class="wk-empty"><b>✓ Всё проверено</b></div>'}
      <p class="mut" style="margin-top:10px">«В LINKO было» — остаток в LINKO в ту минуту: если приход уже проведён, он там учтён. Сверьте с накладной и отметьте «Проверено».</p>`; };

  // ---------- tab «Настройки» ----------
  const settings = () => { const knownAll = Object.entries(c.known || {}).flatMap(([wh, m]) => Object.entries(m || {}).map(([art, k]) => ({ wh, art, ...k })));
    return `<div class="grid">
    ${UI.panel('Завсклады', `<div class="wk-tools"><label class="mut">Сверка до <input id="wcDl" type="time" value="${esc(dl)}" style="width:110px"></label><label class="mut">Напомнить в <input id="wcRm" type="time" value="${esc(c.remind || '09:00')}" style="width:110px"></label></div>
      <p class="mut" style="margin-top:0">Утром бот напомнит каждому завскладу (кто уже отправил — не получит); после срока напомнит ещё раз и сообщит вам, кто не прислал. По воскресеньям — нет.</p>
      ${stores.length ? `<div class="wk-list">${stores.map(([who, s]) => `<div class="wk-item"><div class="h"><div><div class="nm">${esc(s.name)} — ${esc(s.wh)}</div><small>Telegram: ${esc(chats[who]?.name || who)}${s.tgAt ? ` · кабинет с ${UI.dateRu(s.tgAt.slice(0, 10))}` : ' · кабинет не подключён'}</small></div></div>
        <div class="row2"><button class="btn sm" data-tgc="${esc(who)}">📦 ${s.tgAt ? 'Подключить заново' : 'Подключить в Telegram'}</button><button class="btn gray sm danger" data-rm="${esc(who)}">Убрать</button></div></div>`).join('')}</div>` : '<p class="mut">Завскладов пока нет.</p>'}
      <h4 style="margin:16px 0 8px">Добавить завсклада</h4>
      <div class="form"><label>Имя<input id="wcN" maxlength="60" placeholder="например: Ахмад"></label><label>Склад<select id="wcW">${whs.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
      <label>Его Telegram<select id="wcT"><option value="">— выберите —</option>${Object.values(chats).filter(ch => !c.stores[ch.id]).map(ch => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('')}</select><small class="mut">Нет в списке? Пусть нажмёт «Старт» в боте, затем «Обновить список» в «Telegram агентам».</small></label></div>
      <div class="bar"><span class="spacer"></span><button class="btn" id="wcAdd">Добавить завсклада</button></div>`, { cls: 'w12' })}
    ${UI.panel('Как считать', `<div class="wk-tools"><label class="mut">Каждый день <select id="wcMode"><option value="full" ${c.mode !== 'short' ? 'selected' : ''}>полная сверка — все товары</option><option value="short" ${c.mode === 'short' ? 'selected' : ''}>короткая — что двигалось + случайные</option></select></label>
        <label class="mut">Полная — в <select id="wcFull" ${c.mode === 'short' ? '' : 'disabled'}>${WC.DOW.slice(1).map((d, k) => `<option value="${k + 1}" ${Number(c.fullDay || 1) === k + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="mut">Случайных <input id="wcEx" type="number" min="0" max="50" value="${esc(c.extra ?? 8)}" style="width:70px" ${c.mode === 'short' ? '' : 'disabled'}></label></div>
      <p class="mut">Короткая: в обычный день завсклад считает только товары, у которых со вчерашней сверки менялся остаток в LINKO, товары с расхождением в прошлый раз и несколько случайных — он не знает заранее, какие попадут. Раз в неделю — полная. Если двигалось больше 70 % товаров — тоже полная.</p>
      <div class="wk-tools"><label class="mut" style="flex:1 1 260px">Не считать (бренды или слова в названии, через запятую) <input id="wcSkip" maxlength="200" value="${esc(WC.skipList().join(', '))}" placeholder="например: MATTEX" style="width:100%"></label></div>
      ${(() => { const S = CRMLocal.engine.getState(), seen = new Map(); for (const [, st] of stores) { const up = (S.wh.uploads || []).filter(u => u.warehouse === st.wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]; for (const r of up?.rows || []) if (!seen.has(String(r.art))) seen.set(String(r.art), { art: String(r.art), name: r.name, brand: r.brand || '' }); }
        const L = [...seen.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)), P = c.packs || {};
        return L.length ? `<details><summary><b>📦 Штук в коробке</b> <span class="mut">(${Object.keys(P).length ? 'исправлено ' + Object.keys(P).length : 'всё по названию'})</span></summary>
          <p class="mut">По названию: 4–5 л — 4 шт, Mitanol 4 л — 5 шт, 1–1,5 л — 12 шт, 20/208 л — поштучно, ECO FILTER — по коду. Пусто — как по названию.</p>
          ${LX.table(['Товар', '#По названию', '#Своё'], L.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td class="n">${WC.packAuto(i)}</td><td class="n"><input type="number" min="1" max="500" data-pk="${esc(i.art)}" value="${P[i.art] || ''}" placeholder="—" style="width:70px"></td></tr>`), { max: '420px' })}</details>` : ''; })()}`, { cls: 'w12' })}
    ${knownAll.length ? UI.panel('📌 Постоянные разницы', LX.table(['Склад', 'Товар', '#Разница', 'С какого дня', ''], knownAll.map(k => `<tr><td>${esc(k.wh)}</td><td>${esc(k.name || k.art)}<br><small class="mut">${esc(k.art)}</small></td><td class="n ${k.d < 0 ? 'neg' : 'pos'}"><b>${sign(k.d)}</b></td><td>${k.at ? UI.dateRu(k.at.slice(0, 10)) : '—'}</td><td><button class="btn gray sm needs-edit" data-unk="${esc(k.wh + '|' + k.art)}">Больше не учитывать</button></td></tr>`)), { cls: 'w12', sub: 'Такая разница считается «сходится». Исправили причину в LINKO — уберите.' }) : ''}
    </div>`; };

  const tabs = [['now', 'Сверка', waiting.length, true], ['hist', 'История', 0], ['moves', 'Приход', movesNew, true], ['set', 'Настройки', 0]];
  el.innerHTML = `<div class="page-head"><div><h2>Сверка складов</h2><div class="sub">Завсклады до ${esc(dl)} пересчитывают склад вслепую в Telegram. Здесь — расхождения с LINKO и ваши решения.</div></div>
    <div class="actions"><button class="btn gray" id="wcPull">🔄 Проверить</button></div></div>
    <div class="wk-seg" role="tablist">${tabs.map(([k, t, n, hot]) => `<button type="button" role="tab" data-tab="${k}" class="${WC.tab === k ? 'on' : ''}" aria-selected="${WC.tab === k}">${t}${n ? ` <span class="wk-badge${hot ? '' : ' soft'}">${n}</span>` : ''}</button>`).join('')}</div>
    ${WC.tab === 'now' ? cards() + detail() : WC.tab === 'hist' ? history() : WC.tab === 'moves' ? moves() : settings()}`;

  // ---------- events ----------
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { WC.tab = b.dataset.tab; re(); });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { WC.sel = b.dataset.open; WC.f = 'diff'; WC.q = ''; re(); });
  el.querySelectorAll('[data-hs]').forEach(tr => tr.onclick = () => { WC.sel = tr.dataset.hs; WC.tab = 'now'; WC.f = 'diff'; WC.q = ''; re(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { WC.f = b.dataset.f; re(); });
  el.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { WC.mv = b.dataset.mv; re(); });
  { const q = $('#wcQ', el); if (q) { if (WC._qf) { WC._qf = false; q.focus(); q.setSelectionRange(q.value.length, q.value.length); } q.oninput = () => { clearTimeout(WC._qt); WC._qt = setTimeout(() => { WC.q = q.value; WC._qf = true; re(); }, 300); }; } }
  { const s1 = $('#wcSel', el); if (s1) s1.onchange = e => { WC.sel = e.target.value; WC.f = 'diff'; re(); }; }
  { const h = $('#wcHw', el); if (h) h.onchange = e => { WC.hw = e.target.value || null; WC.hn = 30; re(); }; }
  { const m = $('#wcMore', el); if (m) m.onclick = () => { WC.hn = (WC.hn || 30) + 50; re(); }; }
  $('#wcPull', el).onclick = async () => { try { const n = await ATK.pull(); toast(n ? `Новое: ${n}` : 'Новых сверок нет'); re(); } catch (e) { toast(e.message); } };
  el.querySelectorAll('[data-ph]').forEach(a => a.onclick = async e => { e.preventDefault(); try { const url = await ATK.photo(a.dataset.ph); const m = modal(`<img src="${url}" alt="Фото со склада" style="max-width:100%;border-radius:8px"><div class="bar"><span class="spacer"></span><button class="btn gray" id="phX">Закрыть</button></div>`); $('#phX', m.el).onclick = () => { URL.revokeObjectURL(url); m.close(); }; } catch (err) { toast(err.message); } });

  // decisions: chips change the draft in place (no redraw), the progress bar follows
  const prog = () => {
    const p = $('#wcProg', el); if (!p || !decidable()) return;
    const D = draft(), n = V.diff.filter(i => isDone(i, D[i.art])).length;
    p.innerHTML = n === V.diff.length ? `<b class="wk-pos">✓ Решено всё: ${n} из ${V.diff.length}</b>` : `Решено <b>${n}</b> из ${V.diff.length}`;
    $('#wcBar', el).style.width = Math.round(n / V.diff.length * 100) + '%';
    const all = $('#wcAllFix', el); if (all) all.hidden = n === V.diff.length;
  };
  if (decidable()) {
    el.querySelectorAll('[data-it]').forEach(card => {
      const art = card.dataset.it, it = V.diff.find(i => i.art === art); if (!it) return;
      const sumW = card.querySelector('.wk-sum'), sumI = card.querySelector('[data-sum]');
      const paint = () => { const d = draft()[art]; card.querySelectorAll('[data-dk]').forEach(b => b.classList.toggle('on', d?.k === b.dataset.dk)); if (sumW) sumW.hidden = d?.k !== 'charge'; card.classList.toggle('done', isDone(it, d)); card.classList.toggle('need', !isDone(it, d)); prog(); };
      card.querySelectorAll('[data-dk]').forEach(b => b.onclick = () => { const D = draft(), k = b.dataset.dk; if (D[art]?.k === k) delete D[art]; else D[art] = k === 'charge' ? { k, sum: Number(sumI?.value) || 0 } : { k }; paint(); if (k === 'charge' && sumI && D[art]) sumI.focus(); });
      if (sumI) sumI.oninput = () => { const D = draft(); if (D[art]?.k === 'charge') D[art].sum = Math.round(Number(sumI.value) * 100) / 100 || 0; paint(); };
    });
    prog();
    const all = $('#wcAllFix', el); if (all) all.onclick = () => { const D = draft(); for (const i of V.diff) if (!isDone(i, D[i.art])) D[i.art] = { k: 'fix' }; re(); };
  }
  { const ok = $('#wcOk', el); if (ok) ok.onclick = async () => {
    const dec = {}, D = sub.status === 'recount' ? {} : draft();
    for (const i of V.diff) { const d = D[i.art]; if (d?.k) dec[i.art] = d.k === 'charge' ? { k: 'charge', sum: Math.round(Number(d.sum) * 100) / 100 } : { k: d.k }; }
    const missing = V.diff.filter(i => !dec[i.art]), noSum = V.diff.filter(i => dec[i.art]?.k === 'charge' && !(dec[i.art].sum > 0));
    if (missing.length) { toast(`Выберите решение ещё для ${missing.length} поз.`); const first = el.querySelector(`[data-it="${CSS.escape(missing[0].art)}"]`); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (noSum.length) return toast('Укажите сумму удержания');
    const name = a => sub.items.find(i => i.art === a)?.name || a, charge = Object.keys(dec).filter(a => dec[a].k === 'charge');
    for (const a of Object.keys(dec).filter(a => dec[a].k === 'known')) { const it = sub.items.find(i => i.art === a); if (it) setKnown(sub.warehouse, a, it.fact - it.linko, it.name); }
    ok.disabled = true;
    sub.dec = dec; sub.recount = []; sub.status = 'ok'; sub.decidedAt = new Date().toISOString(); delete WC.draft[sub.id]; await save();
    const total = charge.reduce((t, a) => t + dec[a].sum, 0);
    try { await WC.notify(sub.who, `✓ Сверка ${esc(sub.warehouse)} за ${UI.dateRu(sub.day)} принята${charge.length ? `\n💸 Удержание за недостачу: <b>$${UI.fmt0(total)}</b>\n${charge.map(a => '• ' + esc(name(a)) + ' — $' + UI.fmt0(dec[a].sum)).join('\n')}` : ''}`); } catch { /* Telegram not reachable */ }
    toast('Сверка принята' + (total ? ` · удержание $${UI.fmt0(total)}` : ''));
    // the next count that waits for a decision opens by itself
    const next = c.subs.find(s => s.day >= since && !s.partial && s.id !== sub.id && s.status !== 'ok' && s.status !== 'recount' && WC.view(s).diff.length); if (next) WC.sel = next.id;
    re();
  }; }
  { const ag = $('#wcAgain', el); if (ag) ag.onclick = async () => {
    const tgo = !String(sub.who).startsWith('sb_');
    if (!confirm(`Попросить ${sub.name} провести сверку склада ${sub.warehouse} ещё раз — полностью, все товары?${tgo ? '\nЕму придёт сообщение в Telegram.' : '\nВ его кабинете появится просьба пересчитать (Telegram у него не подключён — лучше ещё и позвоните).'}`)) return;
    ag.disabled = true; c.again ||= {}; c.again[sub.who] = new Date().toISOString(); await save();
    if (tgo) { try { await WC.notify(sub.who, `🔁 <b>Повторная сверка склада ${esc(sub.warehouse)}</b>\nРуководитель просит пересчитать склад ещё раз — <b>полностью, все товары</b>. Считайте внимательно: коробки и штуки, отложенное под заказы тоже.\nОткройте кабинет склада → «Начать сверку».`); } catch (e) { toast('Telegram: ' + e.message); } }
    toast('🔁 Завскладу отправлена просьба сверить ещё раз'); re();
  }; }
  el.querySelectorAll('[data-mok]').forEach(b => b.onclick = () => { const x = (c.moves || []).find(m => m.id === b.dataset.mok); if (!x) return; x.ok = new Date().toISOString(); CRMLocal.touch(); re(); });
  el.querySelectorAll('[data-kn]').forEach(b => b.onclick = async () => { const [wh, art] = b.dataset.kn.split('|'), d = Number(b.dataset.kd); if (!confirm(`${b.dataset.knm}: дальше разница ${sign(d)} на складе ${wh} будет считаться нормой. Учитывать?`)) return; setKnown(wh, art, d, b.dataset.knm); await save(); toast('📌 Учитывается: ' + b.dataset.knm); re(); });
  el.querySelectorAll('[data-unk]').forEach(b => b.onclick = async () => { const [wh, art] = b.dataset.unk.split('|'); setKnown(wh, art, null); await save(); toast('Больше не учитывается'); re(); });
  { const sk = $('#wcSkip', el); if (sk) sk.onchange = async () => { const L = [...new Set(sk.value.split(',').map(x => x.trim()).filter(Boolean))].slice(0, 20); CRMLocal.ext().whSkip = L; await save(); toast(L.length ? 'Не считаем: ' + L.join(', ') : 'Считаем все товары'); re(); }; }
  { const m = $('#wcMode', el); if (m) m.onchange = async e => { c.mode = e.target.value; c.fullDay ||= 1; await save(); toast(c.mode === 'short' ? 'Короткая сверка, полная — ' + WC.DOW[c.fullDay] : 'Каждый день — полная сверка'); re(); }; }
  { const m = $('#wcFull', el); if (m) m.onchange = async e => { c.fullDay = Number(e.target.value); await save(); toast('Полная сверка — ' + WC.DOW[c.fullDay]); }; }
  { const m = $('#wcEx', el); if (m) m.onchange = async e => { const v = Math.max(0, Math.min(50, Math.round(Number(e.target.value)) || 0)); e.target.value = v; c.extra = v; await save(); }; }
  el.querySelectorAll('[data-pk]').forEach(inp => inp.onchange = async () => { c.packs ||= {}; const v = Math.round(Number(inp.value)); if (v >= 1) c.packs[inp.dataset.pk] = v; else { delete c.packs[inp.dataset.pk]; inp.value = ''; } await save(); toast('Штук в коробке сохранено'); });
  { const m = $('#wcRm', el); if (m) m.onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value) || e.target.value >= dl) { e.target.value = c.remind || '09:00'; return toast('Напоминание — раньше срока сверки'); } c.remind = e.target.value; await save(); toast('Напоминание в ' + c.remind); }; }
  { const m = $('#wcDl', el); if (m) m.onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value)) { e.target.value = dl; return toast('Время ЧЧ:ММ'); } c.deadline = e.target.value; await save(); toast('Срок сверки: ' + c.deadline); }; }
  { const m = $('#wcAdd', el); if (m) m.onclick = async () => {
    const name = $('#wcN', el).value.trim(), wh = $('#wcW', el).value, who = $('#wcT', el).value;
    if (!name || !wh || !who) return toast('Заполните имя, склад и Telegram');
    if (!WC.branchOf(wh)) toast(`Внимание: для склада ${wh} нет связи со складом LINKO — сверка начнёт сравнивать, когда автозагрузка его узнает`);
    c.stores[who] = { name: name.slice(0, 60), wh, on: true, tgAt: '' }; await save(); re();
  }; }
  el.querySelectorAll('[data-tgc]').forEach(b => b.onclick = async () => { const who = b.dataset.tgc; try { if (WC._lastTg) delete WC._lastTg[who]; WC._lastSj = null; await WC.publish(); await WC.connect(who); c.stores[who].tgAt = new Date().toISOString(); CRMLocal.touch(); toast('Готово: завскладу отправлена кнопка «Открыть кабинет склада»'); re(); } catch (e) { toast(e.message); } });
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const who = b.dataset.rm; if (!confirm(`Убрать ${c.stores[who].name} из завскладов? Кабинет склада у него закроется.`)) return;
    delete c.stores[who]; if (WC._lastTg) delete WC._lastTg[who];
    try { const cl = AC.cloud(); if (cl) await AC.gh(cl, 'DELETE', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада закрыт' }); await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: AC.panelBtn() }); } catch { /* already closed */ }
    await save(); re();
  });
};
