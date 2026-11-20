// Доступ агентов (Настройки → Доступ агентов): every agent gets a personal link to his own cabinet (me.html). The supervisor's CRM
// computes each agent's part — his clients and debts, plan / fact, discipline and fines, his place in the leaderboard, the stock of
// his warehouse — and saves it to the PRIVATE data repository as agents/<sha256(code)>.json. The agent's page asks the Google
// auto-loader (doGet ?agent=code), which reads only that one file: the agent never gets the GitHub key or anybody else's data.
// Stored in the synced state: ext.agentAccess = { agents: { [agent]: { on, code, wh, sentAt } }, publishedAt }.
// «Режим офиса» (this device only): the CRM refreshes itself and the cabinets every 15 minutes while it is open.
// Telegram: the same file is also saved as agents/tg/<telegram user id>.json; the button «📱 Открыть мой кабинет» in the bot's message opens me.html (the menu button is «Панель» — the login page)
// as a Telegram Mini App, and the auto-loader serves that file after checking Telegram's signature (no link or code needed).
window.EXT_PAGES = window.EXT_PAGES || {};

const AC = {
  DIR: 'agents/',
  cfg() { const x = CRMLocal.ext(); const c = (x.agentAccess ||= { agents: {} }); c.agents ||= {}; return c; },
  cloud() { const c = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null; return c && c.token && c.owner && c.repo ? c : null; },
  web() { const w = CRMLocal.ext().linkoWeb || {}; return w.url || ''; },
  newCode() { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); },
  miniUrl() { const base = location.origin + location.pathname.replace(/[^/]*$/, ''); return `${base}me.html?u=${encodeURIComponent(AC.web())}`; },
  // «Панель»: the bot's menu button for everyone — the MITAL CRM login page (agents and store keepers land in their cabinet
  // after signing in, the others in the CRM). The page outside GitHub Pages (a local copy) still points the button at the public one.
  panelUrl() { const base = location.protocol === 'https:' ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://mital111222333.github.io/MitalCRM/'; return base + '?tg=1'; },
  panelBtn() { return { type: 'web_app', text: 'Панель', web_app: { url: AC.panelUrl() } }; },
  // once per bot: the default button and every linked agent / store keeper (their chats had «Мой кабинет» / «Кабинет склада»)
  async panelAll() {
    const t = CRMLocal.ext().tg; if (!t?.token || t.panelFor === t.token.split(':')[0]) return 0;
    await TG.call('setChatMenuButton', { menu_button: AC.panelBtn() });
    const chats = new Set([...Object.values(t.chats || {}).map(c => c?.id), ...(typeof WC !== 'undefined' ? Object.keys(WC.cfg().stores) : [])].filter(Boolean).map(String));
    let n = 0;
    for (const id of chats) { try { await TG.call('setChatMenuButton', { chat_id: Number(id), menu_button: AC.panelBtn() }); n++; } catch { /* blocked the bot: gets the default «Панель» */ } }
    t.panelFor = t.token.split(':')[0]; CRMLocal.touch(); return n;
  },
  chatOf(agent) { const t = CRMLocal.ext().tg || {}; return t.token && t.chats?.[agent]?.id ? String(t.chats[agent].id) : ''; },
  // the bot's @username: the agent's chat with the supervisor is the chat with this bot (answered from CRM → Чаты Telegram)
  async bot() { if (AC._bot !== undefined) return AC._bot; try { AC._bot = (await TG.call('getMe')).username || ''; } catch { AC._bot = ''; } return AC._bot; },
  boss() { const m = String(CRMLocal.ext().tg?.me?.name || '').match(/@([A-Za-z0-9_]{4,})/); return m ? m[1] : ''; },
  link(code) { const base = location.origin + location.pathname.replace(/[^/]*$/, ''); return `${base}me.html#k=${encodeURIComponent(code)}&u=${encodeURIComponent(AC.web())}`; },
  office() { try { return localStorage.getItem('crm_office') === '1'; } catch { return false; } },

  // the agent's part of the data: only what he is allowed to see
  async snapshot(agent, d, stock, disc) {
    const a = d.agents.find(x => x.agent === agent) || { sold: 0, plan: 0, paid: 0, pool: 0, debt: 0, akb: 0, okb: 0, debtors: 0 };
    const pct = (x, y) => (y > 0 ? Math.round(x / y * 100) : null);
    const board = d.agents.filter(x => x.agent !== 'Без агента').map(x => ({ agent: x.agent, sold: pct(x.sold, x.plan), paid: pct(x.paid, x.pool), amt: x.sold + x.paid }))
      // no plans yet: by sales and collection — the amounts are only used for the order, they are not sent
      .map(x => ({ ...x, score: (x.sold ?? 0) + (x.paid ?? 0) })).sort((p, q) => q.score - p.score || q.amt - p.amt)
      .map((x, i) => ({ place: i + 1, agent: x.agent, sold: x.sold, paid: x.paid, me: x.agent === agent }));
    const prom = typeof NOTES !== 'undefined' ? NOTES.promises(d).filter(p => p.agent === agent && p.status !== 'kept') : [];
    const promBy = new Map(prom.map(p => [p.client, p]));
    // money to the cent, as in LINKO (the cabinet shows cents; totals are the sums of these very numbers)
    const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
    const clients = d.clients.filter(c => c.agent === agent).map(c => ({ name: c.name, debt: r2(c.debt), sold: r2(c.sold), paid: r2(c.paid), plan: r2(c.plan), pool: r2(c.pool), lastPay: c.lastPay || null, lastBuy: c.lastBuy || null, buyDays: c.buyDays ?? null, phone: c.phone || '', landmark: c.landmark || '', promise: promBy.get(c.name) ? { date: promBy.get(c.name).date, sum: promBy.get(c.name).sum } : null }))
      .sort((x, y) => y.debt - x.debt || x.name.localeCompare(y.name));
    const r = disc?.rows.find(x => x.agent === agent), t0 = UI.localDate(Date.now()), today = disc ? DS.cfg().days[t0]?.[agent] || null : null;
    const days = disc ? disc.days.map(dd => { const x = DS.cfg().days[dd]?.[agent], e = DS.eff(dd, agent, x); return { day: dd, ...(x || {}), st: e.st, auto: e.auto }; }).filter(x => x.first || x.plan || DS.away(x.st) || DS.half(x.st)).map(x => ({ day: x.day, first: x.first || '', late: x.first ? DS.lateFor(x.day, agent, x.first, disc.start) : 0, early: DS.earlyMin(x.day, agent, x), plan: x.plan || 0, done: x.done || 0, st: x.st && x.st !== 'free' ? DS.ST[x.st].t + (x.auto ? ' (авто)' : '') : '', note: DS.cfg().notes[x.day]?.[agent] || '' })) : [];
    // the attendance sheet of this month (the same codes as in the CRM) and the agent's own requests
    const sheet = disc ? (() => { const s = DS.sheet(DS.periodOf(t0)), row = s.rows.find(x => x.agent === agent); return row ? { month: s.month, days: s.days.map((dd, i) => ({ day: dd, code: row.cells[i].code, tone: row.cells[i].tone, tip: row.cells[i].tip })), worked: row.worked, late: row.late, early: row.early, absent: row.absent } : null; })() : null;
    const reqs = disc ? Object.entries(DS.cfg().req).filter(([, q]) => q.agent === agent).map(([id, q]) => ({ id, type: DS.ST[q.type]?.t || q.type, from: q.from, to: q.to, note: q.note || '', st: q.st, at: q.at })).sort((p, q) => String(q.at).localeCompare(String(p.at))).slice(0, 15) : [];
    // statuses of today and the days ahead + the permanent free schedule: the auto-loader (autolinko.gs) does not fine such a day
    const marks = disc ? Object.fromEntries(Object.keys(DS.cfg().abs).filter(dd => dd >= t0 && DS.cfg().abs[dd][agent]).map(dd => [dd, DS.cfg().abs[dd][agent]])) : {}, tSt = disc ? DS.status(t0, agent) : '';
    // the weekly route (Агенты → Маршруты): day 1..6 → zone and clients in the visiting order
    const R = CRMLocal.ext().routes?.[agent], route = R?.days ? Object.fromEntries(Object.entries(R.days).filter(([, v]) => v && (v.clients || []).length).map(([k, v]) => [k, { zone: v.zone || '', clients: (v.clients || []).slice(0, 80) }])) : null;
    const money = await AC.money(agent).catch(e => { console.warn('cabinet: calendar / contracts', e); return null; });
    const wh = AC.cfg().agents[agent]?.wh || '';
    const items = wh && stock ? stock.items.filter(i => i.cells[wh]).map(i => ({ name: i.name, art: i.art, brand: i.brand || '', available: i.cells[wh].available, total: i.cells[wh].total })).sort((x, y) => (x.brand || '').localeCompare(y.brand || '') || x.name.localeCompare(y.name)) : [];
    const whUp = wh && stock ? stock.warehouses.find(w => w.name === wh)?.upload?.taken_at || null : null;
    return {
      // chat: the address of the Telegram chat worker (worker.js), for the chat tab of the cabinet — the agent signs in there with Telegram itself
      chat: typeof CHAT !== 'undefined' && CHAT.url ? CHAT.url() : null,
      v: 1, agent, boss: AC.boss() || null, bot: (CRMLocal.ext().tg?.token ? await AC.bot() : '') || null, at: new Date().toISOString(), data_at: d.upload.taken_at, period: { from: d.upload.period_from, to: d.forecast?.period_end || d.upload.period_to, days_left: d.forecast?.days_left ?? null },
      // debt and debtors from the same client list the agent sees (before: «должников 25» on the tile, 22 in the list)
      kpi: { sold: r2(a.sold), plan: r2(a.plan), paid: r2(a.paid), pool: r2(a.pool), debt: r2(clients.reduce((t, c) => t + (c.debt > 0 ? c.debt : 0), 0)), debtors: clients.filter(c => c.debt > 0).length, akb: a.akb, okb: a.okb },
      queue: typeof MY !== 'undefined' ? await MY.queueFor(agent).catch(() => []) : [], day: { sell: r2(a.need_sell_day), collect: r2(a.need_collect_day) },
      board, clients, tasks: typeof ATK !== 'undefined' ? ATK.forAgent(agent, d) : [], route,
      // the payment calendar (as Деньги → Календарь оплат, only his clients) and his contracts: one-time (spec) and long
      cal: money?.cal || null, contracts: money?.contracts || null,
      // the pay slip of the last closed month (pay.js «Закрыть месяц»)
      pay: CRMLocal.ext().pay?.slips?.[agent] || null,
      disc: disc ? { start: disc.startTxt, rate: disc.rate, today: today || tSt ? { first: today?.first || '', late: today?.first ? DS.lateFor(t0, agent, today.first, disc.start) : 0, st: tSt ? DS.ST[tSt].t : '' } : null, marks, free: !!DS.cfg().free[agent], skip: !!DS.cfg().skip[agent], end: DS.cfg().end || '', autoAbs: DS.cfg().autoAbs || '',
        absent: r?.absent || 0, late: r?.late || 0, minutes: r?.lateMin || 0, fine: r?.fine || 0, early: r?.early || 0, route: r?.route ?? null, days, sheet, reqs, types: DS.REQ.map(k => ({ k, t: DS.ST[k].t })) } : null,
      // branch: the LINKO warehouse number of this warehouse, so the auto-loader can put fresh stock in (autolinko.gs live_)
      stock: wh ? { warehouse: wh, at: whUp, branch: Object.keys(CRMLocal.ext().linkoBranch || {}).find(b => CRMLocal.ext().linkoBranch[b] === wh) || null, items } : null,
    };
  },

  // who must pay and when (CAL.items: spec orders by parts, long contracts by month, promises), and the agent's contracts.
  // Computed once per publish for all agents (AC._money), so 10 agents do not read the instalment state 10 times.
  async money(agent) {
    if (typeof CAL === 'undefined' || typeof INST === 'undefined') return null;
    if (!AC._money || Date.now() - AC._money.t > 60000) AC._money = { t: Date.now(), p: CAL.items() };
    const { list, st } = await AC._money.p, t0 = UI.localDate(Date.now());
    const txt = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const r2 = v => Math.round((Number(v) || 0) * 100) / 100, lo = UI.localDate(Date.now() - 60 * 864e5), hi = UI.localDate(Date.now() + 75 * 864e5);
    const cal = list.filter(x => x.agent === agent && x.d && ((x.d >= lo && x.d <= hi) || x.st === 'late')).sort((a, b) => a.d.localeCompare(b.d))
      .slice(-400).map(x => ({ d: x.d, s: r2(x.s), client: x.client, kind: x.kind, st: x.st, why: txt(x.why) }));
    const cfg = INST.cfg(), mine = n => (INST.agentOfClient(n) || (typeof LX !== 'undefined' ? LX.clientAgent(n) : '')) === agent;
    // one-time contracts: every order on special conditions that still has something to pay (or was made in the last 60 days)
    const once = [];
    for (const c of st?.clients || []) {
      if (c.contract || !((c.agent || '') === agent || (!c.agent && mine(c.name)))) continue;
      for (const o of c.orders || []) {
        const parts = (o.parts || []).map(p => ({ d: p.d, s: r2(p.s), st: p.st === 'paid' ? 'paid' : p.st === 'late' ? 'late' : 'wait' }));
        if (!parts.some(p => p.st !== 'paid') && !(o.d >= lo)) continue;
        const set = cfg.orders?.[o.id] || {};
        once.push({ client: c.name, id: String(o.id), d: o.d, s: r2(o.s), parts, cond: txt(o.cond || set.cond || ''), spec: !!set.spec, own: !!o.own, disc: set.disc ?? null });
      }
    }
    // long contracts: plan per contract month and what is paid of it
    const got = new Map((st?.contracts || []).map(k => [k.id, k]));
    const long = cfg.contracts.filter(k => k.start && ((k.agent || '') === agent || (!k.agent && mine(k.accounts?.[0] || k.title)))).map(k => {
      const P = INST.planOf(k), s = got.get(k.id);
      return { title: k.title, client: k.accounts?.[0] || k.title, start: k.start, months: P.map((plan, i) => { const w = CAL.ctMonth(k.start, i), due = INST.dueOf(k, i), paid = s?.list?.[i]?.paid ?? null; return { from: w.from, to: due, plan: r2(plan), paid: paid == null ? null : r2(paid), st: paid != null && paid >= plan - 0.5 ? 'paid' : due < t0 ? 'late' : 'wait' }; }) };
    });
    return { cal, contracts: { once: once.sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, 120), long } };
  },

  async gh(c, method, path, body) {
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
    const h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' }), sha = cur.ok ? (await cur.json()).sha : undefined;
    if (method === 'DELETE' && !sha) return;
    const r = await fetch(url, { method: method === 'DELETE' ? 'DELETE' : 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: body.message, ...(body.content ? { content: body.content } : {}), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub: ' + r.status);
  },
  b64: text => { const bytes = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },

  // the same cabinet for agents who have their own CRM account (MITAL database, table agent_cabinets): the agent signs in with
  // his login and sees it on me.html. Matched by the account's «Имя в LINKO». Works without the GitHub key and the personal codes.
  // Only from the CRM of the person this device's data belongs to (CLOUD.gate), never from an agent's or another person's sign-in.
  norm: s => String(s || '').toLowerCase().replace(/[’ʻʼ`´‘]/g, "'").replace(/\s+/g, ' ').trim(),
  async publishDb({ force = false } = {}) {
    const sb = window.AUTH?.sb, me = window.AUTH?.profile;
    if (!sb || !me || ['agent', 'store'].includes(me.role) || window.CLOUD?.gate?.() || AC._busyDb) return { n: 0 };
    AC._busyDb = true;
    try {
      const { data: ppl, error } = await sb.from('profiles').select('id, full_name, linko_name, is_active').eq('role', 'agent');
      if (error) throw error;
      const want = (ppl || []).filter(p => p.is_active && p.linko_name);
      if (!want.length) return { n: 0, missing: [] };
      const d = await REP.load(); if (d.empty) return { n: 0, missing: [] };
      let stock = null; try { stock = await CRMLocal.request('GET', '/api/wh/stock'); } catch { /* no stock */ }
      let disc = null; try { if (typeof DS !== 'undefined' && LX.has()) disc = DS.model(); } catch { /* no LINKO data */ }
      const names = d.agents.map(a => a.agent), missing = [];
      AC._lastDb ||= {}; let n = 0;
      for (const p of want) {
        const agent = names.find(x => AC.norm(x) === AC.norm(p.linko_name));
        if (!agent) { missing.push(p.full_name); continue; }
        const snap = await AC.snapshot(agent, d, stock, disc), key = JSON.stringify({ ...snap, at: '' });
        if (!force && AC._lastDb[p.id] === key) continue;
        const { error: e2 } = await sb.from('agent_cabinets').upsert({ agent_id: p.id, data: snap, updated_at: new Date().toISOString(), updated_by: me.id });
        if (e2) throw e2;
        AC._lastDb[p.id] = key; n++;
      }
      return { n, missing };
    } finally { AC._busyDb = false; }
  },

  // write every enabled agent's file (only when it changed); returns how many were written
  async publish({ force = false } = {}) {
    const c = AC.cloud(), A = AC.cfg(), on = Object.entries(A.agents).filter(([, v]) => v.on && v.code);
    if (!c || !on.length || AC._busy) return 0;
    AC._busy = true;
    try {
      const d = await REP.load(); if (d.empty) return 0;
      let stock = null; try { stock = await CRMLocal.request('GET', '/api/wh/stock'); } catch { /* no stock */ }
      let disc = null; try { if (typeof DS !== 'undefined' && LX.has()) disc = DS.model(); } catch { /* no LINKO data */ }
      AC._last ||= {}; let n = 0;
      for (const [agent, v] of on) {
        const snap = await AC.snapshot(agent, d, stock, disc), key = JSON.stringify({ ...snap, at: '' });
        if (!force && AC._last[agent] === key) continue;
        const content = AC.b64(JSON.stringify(snap)), chat = AC.chatOf(agent);
        await AC.gh(c, 'PUT', AC.DIR + (await AC.sha(v.code)) + '.json', { message: 'CRM: кабинет агента', content });
        if (chat) await AC.gh(c, 'PUT', AC.DIR + 'tg/' + chat + '.json', { message: 'CRM: кабинет агента (Telegram)', content });
        AC._last[agent] = key; n++;
      }
      A.publishedAt = new Date().toISOString(); // not a reason to sync the whole state: saved with the next real change
      return n;
    } finally { AC._busy = false; }
  },
  async revoke(code, agent) {
    const c = AC.cloud(); if (!c) return;
    if (code) await AC.gh(c, 'DELETE', AC.DIR + (await AC.sha(code)) + '.json', { message: 'CRM: доступ агента закрыт' });
    const chat = agent && AC.chatOf(agent);
    if (chat) { await AC.gh(c, 'DELETE', AC.DIR + 'tg/' + chat + '.json', { message: 'CRM: доступ агента закрыт' }); try { await TG.call('setChatMenuButton', { chat_id: Number(chat), menu_button: AC.panelBtn() }); } catch { /* bot not reachable */ } }
  },
  // the bot's menu button for this agent («Панель», as everyone has) + a message with his cabinet button
  async connectTg(agent) {
    const chat = AC.chatOf(agent); if (!chat) throw new Error('Агент не привязан в «Telegram агентам»');
    const url = AC.miniUrl();
    await TG.call('setChatMenuButton', { chat_id: Number(chat), menu_button: AC.panelBtn() });
    await TG.call('sendMessage', { chat_id: Number(chat), parse_mode: 'HTML', text: '<b>Ваш кабинет MITAL CRM</b>\nВаши клиенты и долги, план и факт, склад, дисциплина и место в рейтинге — прямо в Telegram.\n\nНажмите кнопку ниже. Со своим логином и паролем — синяя кнопка «Панель» слева от поля ввода.', reply_markup: { inline_keyboard: [[{ text: '📱 Открыть мой кабинет', web_app: { url } }]] } });
  },
};

// publish after the data changes (LINKO import, a balance upload) and on start; «режим офиса» refreshes every 15 minutes
(() => {
  const later = () => { clearTimeout(AC._t); AC._t = setTimeout(() => {
    AC.publish().catch(e => console.warn('agent cabinets', e));
    AC.publishDb().catch(e => console.warn('agent cabinets (database)', e));
    if (typeof WC !== 'undefined' && WC.publishSb) WC.publishSb().catch(e => console.warn('store keepers (database)', e)); // завсклад with his own login
    if (typeof WC !== 'undefined' && WC.publish && Object.keys(WC.cfg().stores).length) WC.publish().catch(e => console.warn('store keepers (Telegram)', e)); // «Заканчивается», rating
  }, 20000); };
  const panel = () => setTimeout(() => AC.panelAll().then(n => n && console.info('«Панель»: кнопка у', n, 'чатов')).catch(e => console.warn('«Панель»', e)), 25000);
  Promise.resolve(CRMLocal.ready).then(panel); addEventListener('crm:login', panel);
  addEventListener('crm:login', later); // signed in on an open page: the agents get their cabinets without waiting for new data
  for (const k of ['importSnap', 'importFast', 'put']) { const orig = LX[k]; if (typeof orig === 'function') LX[k] = function (...a) { const r = orig.apply(this, a); later(); return r; }; }
  Promise.resolve(CRMLocal.ready).then(later);
  setInterval(async () => { if (!AC.office()) return; try { if (window.REFRESH?.run) await REFRESH.run(); } catch { /* refresh failed: publish what we have */ } later(); }, 15 * 60000);
})();

EXT_PAGES.access = async el => {
  await CRMLocal.ready;
  const A = AC.cfg(), d = await REP.load();
  const names = d.empty ? [] : d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  let whs = []; try { whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* none */ }
  const tg = CRMLocal.ext().tg || {}, cloud = AC.cloud(), web = AC.web();
  const missing = [!cloud && 'включите синхронизацию (<a href="#/cloud">Синхронизация и настройки</a>)', !web && 'опубликуйте скрипт автозагрузки как веб-приложение (там же, «Кнопка Обновить»)'].filter(Boolean);
  el.innerHTML = `<div class="page-head"><div><h2>Доступ агентов</h2><div class="sub">Личная ссылка для каждого агента: он видит только своих клиентов и долги, план и факт, свою дисциплину и штрафы, своё место в рейтинге и остатки своего склада. Изменить ничего не может.</div></div></div>
    ${missing.length ? `<p class="neg">Чтобы кабинеты заработали: ${missing.join('; ')}.</p>` : ''}
    <div class="bar"><label><input type="checkbox" id="acOffice" ${AC.office() ? 'checked' : ''}> Режим офиса на этом устройстве</label><span class="mut">— пока CRM открыта здесь, она сама обновляет данные и кабинеты агентов каждые 15 минут. Включите на компьютере, который весь день работает.</span>
    <span class="spacer"></span><button class="btn gray" id="acPub"${cloud ? '' : ' disabled'}>Обновить кабинеты сейчас</button></div>
    <p class="mut">${A.publishedAt ? `Кабинеты обновлены ${new Date(A.publishedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : 'Кабинеты ещё не отправлялись.'} Данные в кабинете обновляются, когда открыта ваша CRM (телефон или компьютер) — или постоянно, если включён режим офиса.</p>
    ${names.length ? UI.panel('Агенты', LX.table(['Агент', 'Склад агента', 'Доступ', 'Ссылка', 'Telegram'], names.map(n => { const v = A.agents[n] || {}, chat = tg.token && tg.chats?.[n]; return `<tr><td>${LX.ag(n)}</td>
      <td><select data-wh="${esc(n)}" aria-label="Склад"><option value="">— без склада —</option>${whs.map(w => `<option ${v.wh === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></td>
      <td><label><input type="checkbox" data-on="${esc(n)}" ${v.on ? 'checked' : ''}> ${v.on ? 'открыт' : 'закрыт'}</label></td>
      <td>${v.on && v.code ? `<button class="btn gray sm" data-copy="${esc(n)}">Скопировать</button> <a class="btn gray sm" href="${esc(AC.link(v.code))}" target="_blank" rel="noopener">Открыть как агент</a> <button class="btn gray sm" data-new="${esc(n)}" title="Старая ссылка перестанет работать">Новая ссылка</button>` : '<span class="mut">—</span>'}</td>
      <td>${v.on && v.code ? (chat ? `<button class="btn sm" data-tgc="${esc(n)}">📱 ${v.tgAt ? 'Подключить заново' : 'Подключить в Telegram'}</button>${v.tgAt ? `<br><small class="mut">кнопка в боте с ${UI.dateRu(v.tgAt.slice(0, 10))}</small>` : ''} <button class="btn gray sm" data-send="${esc(n)}" title="Обычная ссылка — если Telegram на телефоне агента не открывает приложение">ссылкой</button>` : '<small class="mut">агент не привязан в «Telegram агентам»</small>') : ''}</td></tr>`; })), { cls: 'w12', sub: 'Откройте доступ, выберите склад и нажмите «Подключить в Telegram» — у агента в боте появится кнопка «Мой кабинет» (вход без ссылки и пароля, по его Telegram). «Новая ссылка» — если ссылка попала к чужому: старая сразу перестаёт работать.' }) : UI.empty('Нет агентов', 'Агенты появятся после загрузки «Баланс клиентов».')}`;
  const re = () => EXT_PAGES.access(el), save = () => { CRMLocal.touch(); setTimeout(() => AC.publish({ force: true }).catch(e => toast(e.message)), 500); };
  $('#acOffice', el).onchange = e => { try { localStorage.setItem('crm_office', e.target.checked ? '1' : '0'); } catch { /* storage blocked */ } toast(e.target.checked ? 'Режим офиса включён на этом устройстве' : 'Режим офиса выключен'); };
  $('#acPub', el).onclick = async () => { try { const n = await AC.publish({ force: true }); toast(`Кабинеты обновлены: ${n}`); re(); } catch (e) { toast(e.message); } };
  el.querySelectorAll('[data-wh]').forEach(s => s.onchange = () => { (A.agents[s.dataset.wh] ||= {}).wh = s.value; save(); });
  el.querySelectorAll('[data-on]').forEach(cb => cb.onchange = async () => {
    const v = (A.agents[cb.dataset.on] ||= {});
    if (cb.checked) { v.on = true; v.code ||= AC.newCode(); } else { v.on = false; try { await AC.revoke(v.code, cb.dataset.on); } catch (e) { toast(e.message); } v.code = ''; v.tgAt = ''; }
    save(); re();
  });
  el.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => {
    const v = A.agents[b.dataset.new]; if (!confirm(`Сделать новую ссылку для ${b.dataset.new}? Старая сразу перестанет работать — новую надо будет отправить агенту.`)) return;
    try { await AC.revoke(v.code); } catch (e) { toast(e.message); }
    v.code = AC.newCode(); v.sentAt = ''; save(); re();
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const l = AC.link(A.agents[b.dataset.copy].code); try { await navigator.clipboard.writeText(l); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку', l); } });
  el.querySelectorAll('[data-tgc]').forEach(b => b.onclick = async () => {
    const n = b.dataset.tgc, v = A.agents[n];
    if (!confirm(`Отправить ${n} в боте сообщение с кнопкой «Открыть мой кабинет»? Внизу у него будет «Панель» (вход по логину).`)) return;
    try { await AC.publish({ force: true }); await AC.connectTg(n); v.tgAt = new Date().toISOString(); CRMLocal.touch(); toast('Готово: агенту отправлена кнопка «Открыть мой кабинет», внизу у него «Панель»'); re(); } catch (e) { toast(e.message); }
  });
  el.querySelectorAll('[data-send]').forEach(b => b.onclick = async () => {
    const n = b.dataset.send, v = A.agents[n], chat = tg.chats[n];
    if (!confirm(`Отправить ${n} его личную ссылку в Telegram?`)) return;
    try {
      await AC.publish({ force: true });
      await TG.send(chat.id, `<b>Ваш кабинет MITAL CRM</b>\nЗдесь ваши клиенты и долги, план и факт, дисциплина и место в рейтинге.\n\n${esc(AC.link(v.code))}\n\nСсылка личная — никому её не пересылайте. Откройте и добавьте на экран телефона.`);
      v.sentAt = new Date().toISOString(); CRMLocal.touch(); toast('Ссылка отправлена'); re();
    } catch (e) { toast(e.message); }
  });
};
