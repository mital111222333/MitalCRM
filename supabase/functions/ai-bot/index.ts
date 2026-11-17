// MITAL CRM — AI-помощник в Telegram (Supabase Edge Function «ai-bot»).
//
// Как работает: Telegram → эта функция → Google Gemini. Gemini только понимает вопрос (текст или голосовое на русском /
// узбекском), выбирает нужную функцию и пишет ответ. Все цифры считает код ниже — из тех же файлов, что и CRM:
// приватный репозиторий mitalcrm-data (автозагрузка из LINKO каждые 5 минут, архив по дням, состояние CRM, рассрочка).
// Поэтому ИИ не может «придумать» сумму: если функции нечего вернуть, бот так и говорит.
//
// Секреты (Supabase → Edge Functions → Secrets):
//   TG_TOKEN       токен НОВОГО бота от @BotFather (не того, что для агентов — у одного бота может быть только один webhook)
//   TG_SECRET      любая длинная строка — пароль между Telegram и функцией
//   ALLOWED_USERS  ваш Telegram ID (несколько — через запятую). Пусто → бот только сообщает ID тому, кто ему пишет
//   GEMINI_KEY     ключ Gemini (тот же, что в CRM → ИИ-ассистент, или новый на aistudio.google.com)
//   GH_TOKEN       GitHub-токен с правом ЧТЕНИЯ репозитория mitalcrm-data
//   необязательные: GEMINI_MODEL (по умолчанию gemini-flash-latest), GH_OWNER, GH_REPO, TZ_NAME (Asia/Tashkent)
// Подключение webhook: откройте в браузере  <адрес функции>?setup=<TG_SECRET>
// «Verify JWT» у функции должен быть выключен (Telegram не присылает токен Supabase).

// deno-lint-ignore-file no-explicit-any
const env = (k: string, d = '') => (globalThis as any).Deno?.env.get(k) || d;
const CFG = {
  tg: () => env('TG_TOKEN'),
  secret: () => env('TG_SECRET'),
  allowed: () => env('ALLOWED_USERS').split(/[,\s]+/).filter(Boolean),
  gKey: () => env('GEMINI_KEY'),
  model: () => env('GEMINI_MODEL', 'gemini-flash-latest'),
  ghToken: () => env('GH_TOKEN'),
  owner: () => env('GH_OWNER', 'mital111222333'),
  repo: () => env('GH_REPO', 'mitalcrm-data'),
  tz: () => env('TZ_NAME', 'Asia/Tashkent'),
};

// ───────────────────────────── helpers ─────────────────────────────
const n = (v: any) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const day = (v: any) => String(v || '').slice(0, 10);
const person = (o: any, p: string) => [o?.[p + '.first_name'], o?.[p + '.second_name']].filter(Boolean).join(' ').trim();
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: CFG.tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowTime = (iso?: string) => iso ? new Intl.DateTimeFormat('ru-RU', { timeZone: CFG.tz(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const inRange = (d: string, from?: string, to?: string) => (!from || d >= from) && (!to || d <= to);

// Cyrillic (Russian + Uzbek) → Latin, so «Абдулмутталиб» finds «Abdulmutallib Sobirov» and «Фарғона» finds «Farg'ona»
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
const norm = (s: any) => String(s || '').toLowerCase().replace(/[а-яёўқғҳ]/g, ch => TR[ch] ?? ch)
  .replace(/[ʻʼ'’`‘]/g, '').replace(/h/g, 'x').replace(/(.)\1+/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
const grams = (s: string) => { const g = new Set<string>(); const t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const dice = (a: string, b: string) => { const A = grams(a), B = grams(b); let k = 0; for (const x of A) if (B.has(x)) k++; return (2 * k) / (A.size + B.size || 1); };
function score(query: string, name: string) {
  const q = norm(query), t = norm(name); if (!q || !t) return 0;
  if (q === t) return 1;
  const qw = q.split(' '), tw = t.split(' ');
  const wordHit = qw.filter(w => tw.some(x => x.startsWith(w) || w.startsWith(x) || (w.length > 3 && dice(w, x) > 0.7))).length / qw.length;
  return Math.max(t.includes(q) ? 0.9 : 0, wordHit * 0.85 + dice(q, t) * 0.15, dice(q, t));
}
function best<T>(query: string, list: T[], key: (x: T) => string, limit = 8, min = 0.45) {
  return list.map(x => ({ x, s: score(query, key(x)) })).filter(o => o.s >= min).sort((a, b) => b.s - a.s).slice(0, limit);
}

// ───────────────────────────── data (GitHub mitalcrm-data) ─────────────────────────────
async function gh(path: string): Promise<Response> {
  const r = await fetch(`https://api.github.com/repos/${CFG.owner()}/${CFG.repo()}/${path}`, {
    headers: { Authorization: 'Bearer ' + CFG.ghToken(), Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mital-ai-bot' },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} для ${path}`);
  return r;
}
async function ghJson(path: string): Promise<any> {
  const r = await gh('contents/' + path.split('/').map(encodeURIComponent).join('/'));
  if (!path.endsWith('.gz')) return r.json();
  const text = await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}
const safeJson = (p: string) => ghJson(p).catch(e => { console.warn(p, e.message); return null; });

const arcCache = new Map<string, any>(); // archived days never change except the last two
let DBC: { at: number; db: any } | null = null;

async function loadDB(force = false) {
  if (!force && DBC && Date.now() - DBC.at < 120e3) return DBC.db;
  const [crm, fast, extra, inst, tree] = await Promise.all([
    safeJson('crm-data.json.gz'), safeJson('linko-fast.json'), safeJson('linko-extra.json'), safeJson('inst-state.json'),
    gh('git/trees/HEAD?recursive=1').then(r => r.json()).catch(() => ({ tree: [] })),
  ]);
  const arcPaths = (tree.tree || []).map((t: any) => t.path).filter((p: string) => /^archive\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\/fast\.json\.gz$/.test(p)).sort();
  const recent = new Set(arcPaths.slice(-2));
  const arcs = await Promise.all(arcPaths.map(async (p: string) => {
    if (!recent.has(p) && arcCache.has(p)) return arcCache.get(p);
    const j = await safeJson(p); if (j) arcCache.set(p, j); return j;
  }));
  const db = build(crm, fast, extra, inst, arcs.filter(Boolean), arcPaths);
  DBC = { at: Date.now(), db };
  return db;
}

function build(crm: any, fast: any, extra: any, inst: any, arcs: any[], arcPaths: string[]) {
  const S = crm?.state || {}, ext = S.ext || {};
  const clients: Record<string, any> = S.ag?.clients || {};
  const agents = [...new Set(Object.values(clients).map((c: any) => c.agent).filter(Boolean))] as string[];
  const agentByRaw = (raw: string) => { if (!raw) return ''; const h = best(raw, agents, a => a, 1, 0.6)[0]; return h ? h.x : raw; };
  const agentOf = (client: string, raw: string) => clients[client]?.agent || agentByRaw(raw) || 'Без агента';

  // orders / items / payments: every archived day (oldest first) and then the newest file — a later copy of the same id wins
  const orders = new Map<any, any>(), items = new Map<any, any[]>(), pays = new Map<any, any>(), rets = new Map<any, any>();
  const sources = [...arcs.map(a => a?.data), fast?.data, ext.lx?.d].filter(Boolean);
  for (const d of sources) {
    for (const o of d.orders || []) orders.set(o.id, {
      id: o.id, date: day(o.created_date), time: String(o.created_date || '').slice(11, 16), client: o['client.name'] || '',
      agent: agentOf(o['client.name'] || '', person(o, 'user')), sum: r2(n(o.total_price)), ret: r2(n(o.total_return_price)),
      disc: r2(n(o.discount_price)), paid: !!o.is_paid, status: String(o.status ?? ''), ptype: o.payment_type || '', deliver: day(o.date_delivery), address: o['market.address'] || '',
    });
    const byOrd = new Map<any, any[]>();
    for (const i of d.items || []) { if (!byOrd.has(i.order_id)) byOrd.set(i.order_id, []); byOrd.get(i.order_id)!.push(i); }
    for (const [id, list] of byOrd) items.set(id, list.map(i => ({ product: i.product_name, art: i['product.vendor_code'] || '', qty: n(i.amount) - n(i.return_amount), price: r2(n(i.price)), bonus: !!i.is_bonus })));
    for (const p of d.pays || []) pays.set(p.id, {
      id: p.id, type: n(p.type), amount: r2(n(p.amount)), sum_uzs: n(p.real_amount), cur: p['currency.name'] || '', date: day(p.created_date || p.accepted_time),
      time: String(p.created_date || '').slice(11, 16), client: p['client.name'] || '', agent: agentOf(p['client.name'] || '', person(p, 'user')),
      by: person(p, 'user'), ptype: p.payment_type || '', isReturn: !!p.order_return,
    });
  }
  for (const r of extra?.data?.returns || []) rets.set(r.id, { id: r.id, date: day(r.created_date), sum: r2(n(r.total_price)), client: r['client.name'] || '', agent: agentOf(r['client.name'] || '', person(r, 'responsible_agent')) });
  // returns also arrive as payments of type 3 (order_return) — use them for periods older than linko-extra
  for (const p of pays.values()) if (p.type === 3 && !rets.has('p' + p.id)) rets.set('p' + p.id, { id: 'p' + p.id, date: p.date, sum: Math.abs(p.amount), client: p.client, agent: p.agent });
  const dedupRets = new Map<string, any>(); for (const r of rets.values()) dedupRets.set(`${r.date}|${r.client}|${r.sum}`, r);

  const debtors = new Map<string, any>();
  for (const d of fast?.data?.debtors || ext.lx?.d?.debtors || []) {
    const usd = (d.currencies || []).find((c: any) => /usd/i.test(c.name)) || {};
    debtors.set(d['client.name'], {
      total: r2(n(usd.debt_total)), d0_7: r2(n(usd.debt_first)), d8_30: r2(n(usd.debt_second)), d31_120: r2(n(usd.debt_third)), d120: r2(n(usd.debt_fourth)),
      phone: d['client.phone'] || '', address: d['client.address'] || d['market.address'] || '', guide: d['client.guide'] || '',
      agent: agentOf(d['client.name'], person(d, 'client.responsible_agent')),
    });
  }
  const instClients = new Map<string, any>((inst?.clients || []).map((c: any) => [c.name, c]));
  const lastUp = (S.ag?.uploads || []).slice(-1)[0] || null;
  const stock: Record<string, any> = {};
  for (const u of S.wh?.uploads || []) if (!stock[u.warehouse] || stock[u.warehouse].taken_at <= u.taken_at) stock[u.warehouse] = u;
  const planKeys = Object.keys(ext.agentPlans || {}).sort();
  const allDates = [...orders.values()].map(o => o.date).filter(Boolean).sort();
  return {
    clients, agents, agentByRaw, orders, items, pays, rets: [...dedupRets.values()], debtors, instClients,
    contracts: inst?.contracts || [], contractCfg: ext.inst?.contracts || [], promises: ext.payPlan || {},
    balance: lastUp, stock, freq: extra?.data?.freq || [], workper: extra?.data?.workper || [], workFrom: extra?.from, workTo: extra?.to,
    plans: planKeys.length ? { from: planKeys.at(-1), byAgent: ext.agentPlans[planKeys.at(-1)!] } : null,
    meta: {
      linko_updated: nowTime(fast?.at), crm_saved: nowTime(crm?.savedAt), debts_counted: nowTime(inst?.at),
      orders_history_from: allDates[0] || null, orders_history_to: allDates.at(-1) || null, archive_days: arcPaths.length,
    },
    debtSummary: inst?.texts?.me || '',
  };
}

// ───────────────────────────── tools (all numbers are computed here) ─────────────────────────────
function allClientNames(db: any) {
  const s = new Set<string>([...Object.keys(db.clients), ...db.debtors.keys(), ...db.instClients.keys()]);
  for (const o of db.orders.values()) if (o.client) s.add(o.client);
  return [...s].filter(x => x && x !== '.');
}
function resolveClient(db: any, q: string) {
  const names = allClientNames(db);
  const exact = names.find(x => x === q) || names.find(x => norm(x) === norm(q));
  if (exact) return { name: exact };
  const hits = best(q, names, x => x, 6);
  if (hits.length && (hits.length === 1 || hits[0].s >= 0.9 && hits[0].s - hits[1].s > 0.08)) return { name: hits[0].x };
  return { error: hits.length ? 'Несколько похожих клиентов — уточните' : 'Клиент не найден', candidates: hits.map(h => h.x) };
}
function resolveAgent(db: any, q?: string) {
  if (!q) return { name: '' };
  const hits = best(q, db.agents as string[], a => a, 5, 0.4);
  if (hits.length && (hits.length === 1 || hits[0].s - hits[1].s > 0.1)) return { name: hits[0].x };
  return { error: hits.length ? 'Несколько похожих агентов — уточните' : 'Агент не найден', candidates: hits.length ? hits.map(h => h.x) : db.agents };
}
const histNote = (db: any, from?: string) => from && db.meta.orders_history_from && from < db.meta.orders_history_from
  ? `Внимание: история заказов и оплат в базе есть только с ${db.meta.orders_history_from}, раньше — нет данных` : undefined;
const payOk = (p: any) => p.type === 1 && p.amount > 0 && !p.isReturn && (!p.cur || /usd|\$|долл/i.test(p.cur));
// LINKO order status: 1 — new, 3 — shipped/delivered, 4 — cancelled (the balance file does not count cancelled orders)
const cancelled = (o: any) => o.status === '4' || /cancel|reject|отмен|отклон/i.test(o.status);

function ordersOf(db: any, a: { from?: string; to?: string; client?: string; agent?: string }) {
  return [...db.orders.values()].filter((o: any) => !cancelled(o) && inRange(o.date, a.from, a.to) && (!a.client || o.client === a.client) && (!a.agent || o.agent === a.agent))
    .sort((x: any, y: any) => (y.date + y.time).localeCompare(x.date + x.time));
}
function paysOf(db: any, a: { from?: string; to?: string; client?: string; agent?: string }) {
  return [...db.pays.values()].filter((p: any) => payOk(p) && inRange(p.date, a.from, a.to) && (!a.client || p.client === a.client) && (!a.agent || p.agent === a.agent))
    .sort((x: any, y: any) => (y.date + y.time).localeCompare(x.date + x.time));
}
const sum = (list: any[], k = 'sum') => r2(list.reduce((s, x) => s + n(x[k]), 0));

function debtOf(db: any, name: string) {
  const d = db.debtors.get(name), i = db.instClients.get(name);
  if (!d && !i) return { total: 0, note: 'долга нет' };
  return {
    total: d ? d.total : r2(n(i?.debt)),
    by_age: d ? { 'до 7 дн': d.d0_7, '8–30 дн': d.d8_30, '31–120 дн': d.d31_120, 'больше 120 дн': d.d120 } : undefined,
    overdue_by_schedule: i ? r2(n(i.late)) : undefined, due_today: i ? r2(n(i.today)) : undefined,
    next_payment: i?.next || undefined, oldest_unpaid_order: i?.since || undefined, debt_age_days: i?.age ?? undefined, last_payment: i?.lastPay || undefined,
  };
}

const TOOLS: Record<string, { desc: string; params: any; run: (db: any, a: any, ctx: any) => any }> = {
  find_client: {
    desc: 'Найти клиента по части имени, ориентиру или телефону (имена на латинице, ищет и по кириллице). Вызывай, если не уверен в точном имени.',
    params: { query: { type: 'string', description: 'имя, часть имени, ориентир или телефон' } },
    run(db, a) {
      const q = String(a.query || ''); const digits = q.replace(/\D/g, '');
      let names = allClientNames(db);
      const byPhone = digits.length >= 5 ? names.filter(x => String(db.clients[x]?.phone || db.debtors.get(x)?.phone || '').replace(/\D/g, '').includes(digits)) : [];
      const hits = byPhone.length ? byPhone.map(x => ({ x, s: 1 })) : best(q, names, x => `${x} ${db.clients[x]?.landmark || ''}`, 8, 0.4);
      names = hits.filter(h => h.s >= hits[0].s - 0.25).map(h => h.x);
      return { found: names.length, clients: names.map(x => ({ name: x, agent: db.clients[x]?.agent || db.debtors.get(x)?.agent || '', landmark: db.clients[x]?.landmark || db.debtors.get(x)?.guide || '', debt: debtOf(db, x).total })) };
    },
  },
  client_card: {
    desc: 'Полная карточка клиента: агент, телефон, адрес, ОСТАТОК/ДОЛГ (всего, по срокам, просрочка по графику, срок сегодня, следующий платёж), последняя оплата, обещание оплаты, договор, баланс за период, последние заказы и оплаты.',
    params: { client: { type: 'string', description: 'имя клиента' } },
    run(db, a) {
      const c = resolveClient(db, a.client); if (!c.name) return c;
      const name = c.name, info = db.clients[name] || {}, d = db.debtors.get(name) || {};
      const ords = ordersOf(db, { client: name }), ps = paysOf(db, { client: name });
      const bal = db.balance?.rows?.find((r: any) => r.client === name);
      const contracts = db.contracts.filter((k: any) => (k.accounts || []).some((x: string) => norm(x) === norm(name)));
      const files = db.contractCfg.filter((k: any) => (k.accounts || []).some((x: string) => norm(x) === norm(name))).reduce((s: number, k: any) => s + (k.files || []).length, 0);
      const prom = (db.promises[name] || []).slice(-1)[0];
      return {
        client: name, agent: info.agent || d.agent || '', phone: info.phone || d.phone || '', landmark: info.landmark || d.guide || '', address: d.address || '', type: info.type || '',
        debt: debtOf(db, name), promise_to_pay: prom ? { date: prom.d, sum: prom.s } : undefined,
        balance_file: bal ? { period: `${db.balance.period_from} — ${db.balance.period_to}`, start: r2(bal.b0), bought: r2(bal.sold), returned: r2(bal.ret), paid: r2(bal.paid), end: r2(bal.b1), note: 'минус = клиент должен' } : undefined,
        contracts: contracts.map((k: any) => ({ title: k.title, monthly_plan: k.monthly, months: k.months, start: k.start, end: k.end, this_month: k.cur, agent: k.agent })),
        contract_files: files,
        last_orders: ords.slice(0, 5).map((o: any) => ({ id: o.id, date: o.date, sum: o.sum, returned: o.ret || undefined, paid: o.paid })),
        last_payments: ps.slice(0, 5).map((p: any) => ({ date: p.date, amount: p.amount, by: p.by })),
        last_order_date: ords[0]?.date || null, days_without_order: ords[0] ? daysBetween(ords[0].date, todayStr()) : null,
        history_from: db.meta.orders_history_from,
      };
    },
  },
  orders: {
    desc: 'Заказы (продажи) за период — по клиенту, агенту или всем. Даёт количество, сумму, возвраты и список заказов. С with_products=true — что именно брали.',
    params: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, client: { type: 'string' }, agent: { type: 'string' }, with_products: { type: 'boolean' } },
    run(db, a) {
      const c = a.client ? resolveClient(db, a.client) : { name: '' }; if (a.client && !c.name) return c;
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const list = ordersOf(db, { from: a.from, to: a.to, client: c.name, agent: g.name });
      const rets = db.rets.filter((r: any) => inRange(r.date, a.from, a.to) && (!c.name || r.client === c.name) && (!g.name || r.agent === g.name));
      return {
        period: `${a.from || 'начало'} — ${a.to || 'сегодня'}`, client: c.name || undefined, agent: g.name || undefined, warning: histNote(db, a.from),
        orders_count: list.length, orders_sum: sum(list), returns_sum: sum(rets), net_sales: r2(sum(list) - sum(rets)), clients_count: new Set(list.map((o: any) => o.client)).size,
        orders: list.slice(0, 40).map((o: any) => ({ id: o.id, date: o.date, client: c.name ? undefined : o.client, agent: g.name ? undefined : o.agent, sum: o.sum, products: a.with_products ? (db.items.get(o.id) || []).map((i: any) => `${i.product} ×${i.qty}${i.bonus ? ' (бонус)' : ''}`) : undefined })),
        shown: Math.min(list.length, 40),
      };
    },
  },
  payments: {
    desc: 'Оплаты (инкассация, сбор денег) за период — по клиенту, агенту или всем. Сумма в $ и список.',
    params: { from: { type: 'string' }, to: { type: 'string' }, client: { type: 'string' }, agent: { type: 'string' } },
    run(db, a) {
      const c = a.client ? resolveClient(db, a.client) : { name: '' }; if (a.client && !c.name) return c;
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const list = paysOf(db, { from: a.from, to: a.to, client: c.name, agent: g.name });
      return {
        period: `${a.from || 'начало'} — ${a.to || 'сегодня'}`, warning: histNote(db, a.from), count: list.length, total: sum(list, 'amount'),
        note: 'оплаты из транзакций LINKO (наличные). Переводы на карту/счёт LINKO в транзакции не пишет — они видны в баланс-файле (client_card / agent_report)',
        payments: list.slice(0, 40).map((p: any) => ({ date: p.date, client: c.name ? undefined : p.client, agent: g.name ? undefined : p.agent, amount: p.amount, sum_uzs: p.sum_uzs !== p.amount ? p.sum_uzs : undefined, by: p.by })),
      };
    },
  },
  agent_report: {
    desc: 'Сколько сделал агент за период: заказы (кол-во, сумма), возвраты, оплаты собранные, сколько клиентов брали (АКБ), план, долг его клиентов, просрочка, главные должники.',
    params: { agent: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
    run(db, a) {
      const g = resolveAgent(db, a.agent); if (!g.name) return g;
      const ag = g.name, list = ordersOf(db, { from: a.from, to: a.to, agent: ag }), ps = paysOf(db, { from: a.from, to: a.to, agent: ag });
      const rets = db.rets.filter((r: any) => inRange(r.date, a.from, a.to) && r.agent === ag);
      const debts = [...db.debtors.entries()].filter(([, d]: any) => d.agent === ag).map(([k, d]: any) => ({ client: k, debt: d.total, over_30_days: r2(d.d31_120 + d.d120) })).filter(x => x.debt > 0.5).sort((x, y) => y.debt - x.debt);
      const lateSum = r2([...db.instClients.values()].filter((c: any) => c.agent === ag).reduce((s: number, c: any) => s + n(c.late), 0));
      const overlaps = db.workFrom && (!a.to || a.to >= db.workFrom) && (!a.from || a.from <= db.workTo);
      const wp = overlaps && db.workper.find((w: any) => db.agentByRaw(`${w.first_name} ${w.second_name}`) === ag);
      const bal = (db.balance?.rows || []).filter((r: any) => r.agent === ag);
      return {
        agent: ag, period: `${a.from || 'начало'} — ${a.to || 'сегодня'}`, warning: histNote(db, a.from),
        orders_count: list.length, orders_sum: sum(list), returns_sum: sum(rets), net_sales: r2(sum(list) - sum(rets)), active_clients: new Set(list.map((o: any) => o.client)).size,
        collected_cash: sum(ps, 'amount'), payments_count: ps.length,
        plan: db.plans?.byAgent?.[ag] ? { period_from: db.plans.from, plan: db.plans.byAgent[ag].plan } : undefined,
        linko_period_stats: wp ? { period: `${db.workFrom} — ${db.workTo}`, sales_fact: r2(n(wp.sales_fact)), orders: n(wp.order_count), akb: n(wp.akb), visits: n(wp.all_visit_count), rejects: n(wp.total_rejects) } : undefined,
        balance_file: bal.length ? { period: `${db.balance.period_from} — ${db.balance.period_to}`, sold: sum(bal, 'sold'), returned: sum(bal, 'ret'), paid_incl_card: sum(bal, 'paid') } : undefined,
        clients_debt_total: sum(debts, 'debt'), overdue_by_schedule: lateSum, debtors_count: debts.length, top_debtors: debts.slice(0, 7),
      };
    },
  },
  agents_overview: {
    desc: 'Сравнение всех агентов за период: продажи, возвраты, собранные оплаты, клиенты, долг клиентов. Для вопросов «кто лучше/хуже», «итоги команды».',
    params: { from: { type: 'string' }, to: { type: 'string' } },
    run(db, a) {
      const rows = (db.agents as string[]).map(ag => {
        const list = ordersOf(db, { from: a.from, to: a.to, agent: ag }), ps = paysOf(db, { from: a.from, to: a.to, agent: ag });
        const rets = db.rets.filter((r: any) => inRange(r.date, a.from, a.to) && r.agent === ag);
        const debt = r2([...db.debtors.values()].filter((d: any) => d.agent === ag).reduce((s: number, d: any) => s + d.total, 0));
        return { agent: ag, orders: list.length, sales: sum(list), returns: sum(rets), collected_cash: sum(ps, 'amount'), clients: new Set(list.map((o: any) => o.client)).size, clients_debt: debt };
      }).sort((x, y) => y.sales - x.sales);
      return { period: `${a.from || 'начало'} — ${a.to || 'сегодня'}`, warning: histNote(db, a.from), agents: rows, team_sales: sum(rows, 'sales'), team_collected: sum(rows, 'collected_cash'), team_debt: sum(rows, 'clients_debt') };
    },
  },
  debtors: {
    desc: 'Список должников (дебиторка) — все или одного агента, можно фильтровать по возрасту долга и по региону/городу в адресе. Сортировка по сумме.',
    params: { agent: { type: 'string' }, min_age_days: { type: 'number', description: '31 = долг старше 30 дней, 121 = старше 120' }, region: { type: 'string', description: 'часть адреса: Наманган, Фергана, Андижан, Кува…' }, limit: { type: 'number' } },
    run(db, a) {
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const min = n(a.min_age_days), reg = a.region ? norm(a.region) : '';
      let rows = [...db.debtors.entries()].map(([k, d]: any) => ({ client: k, agent: d.agent, debt: d.total, part: min > 120 ? d.d120 : min > 30 ? r2(d.d31_120 + d.d120) : min > 7 ? r2(d.d8_30 + d.d31_120 + d.d120) : d.total, phone: d.phone, address: d.address }))
        .filter(r => r.debt > 0.5 && r.part > 0.5 && (!g.name || r.agent === g.name) && (!reg || norm(r.address).includes(reg)));
      rows = rows.sort((x, y) => y.part - x.part);
      const lim = Math.min(n(a.limit) || 15, 60);
      return { filter: { agent: g.name || 'все', older_than_days: min || undefined, region: a.region || undefined }, count: rows.length, total: sum(rows, 'part'), shown: Math.min(lim, rows.length),
        rows: rows.slice(0, lim).map(r => ({ client: r.client, agent: g.name ? undefined : r.agent, amount: r.part, total_debt: r.part !== r.debt ? r.debt : undefined, phone: r.phone })), updated: db.meta.linko_updated };
    },
  },
  collect_today: {
    desc: 'Кого сегодня дожимать по оплате: у кого по графику рассрочки срок сегодня или просрочено, плюс обещания оплатить на сегодня/просроченные. Можно по одному агенту.',
    params: { agent: { type: 'string' }, limit: { type: 'number' } },
    run(db, a) {
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const t = todayStr();
      const rows = [...db.instClients.values()].filter((c: any) => (!g.name || c.agent === g.name) && (n(c.today) > 0.5 || n(c.late) > 0.5))
        .map((c: any) => { const p = (db.promises[c.name] || []).slice(-1)[0]; return { client: c.name, agent: g.name ? undefined : c.agent, due_today: r2(n(c.today)), overdue: r2(n(c.late)), debt: r2(n(c.debt)), last_payment: c.lastPay || 'не было', promise: p ? `${p.d} — $${p.s}${p.d < t ? ' (сорвал)' : p.d === t ? ' (сегодня)' : ''}` : undefined, phone: c.phone }; })
        .sort((x, y) => (y.due_today + y.overdue) - (x.due_today + x.overdue));
      const lim = Math.min(n(a.limit) || 15, 50);
      return { date: t, count: rows.length, due_today_total: sum(rows, 'due_today'), overdue_total: sum(rows, 'overdue'), rows: rows.slice(0, lim), counted_at: db.meta.debts_counted };
    },
  },
  sleeping_clients: {
    desc: 'Клиенты, которые давно не брали товар (сколько дней без заказа). Для поиска, кого вернуть.',
    params: { agent: { type: 'string' }, min_days: { type: 'number', description: 'по умолчанию 14' }, limit: { type: 'number' } },
    run(db, a) {
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const min = n(a.min_days) || 14, t = todayStr(), last = new Map<string, string>();
      for (const o of db.orders.values()) if (o.client && (!last.has(o.client) || last.get(o.client)! < o.date)) last.set(o.client, o.date);
      const rows = [...last.entries()].map(([c, d]) => ({ client: c, agent: db.clients[c]?.agent || '', last_order: d, days: daysBetween(d, t), debt: db.debtors.get(c)?.total || 0 }))
        .filter(r => r.days >= min && (!g.name || r.agent === g.name)).sort((x, y) => y.days - x.days);
      return { note: `только клиенты, у которых был заказ с ${db.meta.orders_history_from}`, count: rows.length, rows: rows.slice(0, Math.min(n(a.limit) || 20, 60)).map(r => g.name ? { ...r, agent: undefined } : r) };
    },
  },
  top_products: {
    desc: 'Какие товары продавались больше всего за период (шт. и $) — всего, по агенту или по клиенту.',
    params: { from: { type: 'string' }, to: { type: 'string' }, agent: { type: 'string' }, client: { type: 'string' }, limit: { type: 'number' } },
    run(db, a) {
      const c = a.client ? resolveClient(db, a.client) : { name: '' }; if (a.client && !c.name) return c;
      const g = resolveAgent(db, a.agent); if (a.agent && !g.name) return g;
      const m = new Map<string, { qty: number; sum: number }>();
      for (const o of ordersOf(db, { from: a.from, to: a.to, client: c.name, agent: g.name })) for (const i of db.items.get(o.id) || []) {
        const x = m.get(i.product) || { qty: 0, sum: 0 }; x.qty += i.qty; if (!i.bonus) x.sum += i.qty * i.price; m.set(i.product, x);
      }
      const rows = [...m.entries()].map(([p, x]) => ({ product: p, qty: r2(x.qty), sum: r2(x.sum) })).sort((x, y) => y.sum - x.sum);
      return { period: `${a.from || 'начало'} — ${a.to || 'сегодня'}`, warning: histNote(db, a.from), products: rows.slice(0, Math.min(n(a.limit) || 15, 50)), total_sum: sum(rows) };
    },
  },
  stock: {
    desc: 'Остатки товара на складах (Ташкент, Фергана, Наманган) по последней выгрузке. Можно искать товар по названию/артикулу.',
    params: { product: { type: 'string' }, warehouse: { type: 'string' } },
    run(db, a) {
      const whs = Object.keys(db.stock).filter(w => !a.warehouse || score(a.warehouse, w) > 0.5);
      return {
        warehouses: whs.map(w => {
          const u = db.stock[w]; let rows = u.rows || [];
          const qw = a.product ? norm(a.product).split(' ') : [];
          const all = rows.filter((r: any) => qw.length && qw.every((w: string) => norm(`${r.name} ${r.art} ${r.brand}`).includes(w)));
          if (all.length) rows = all;
          else if (a.product) rows = best(a.product, rows, (r: any) => `${r.name} ${r.art} ${r.brand}`, 15, 0.45).map(h => h.x);
          else rows = rows.filter((r: any) => n(r.available) > 0).sort((x: any, y: any) => n(y.available) - n(x.available)).slice(0, 25);
          return { warehouse: w, taken_at: u.taken_at, total_units: u.available, items: rows.map((r: any) => ({ name: r.name, art: r.art, available: n(r.available), reserved: n(r.reserved) || undefined })) };
        }),
      };
    },
  },
  send_contract_files: {
    desc: 'Прислать в чат фото/сканы подписанного договора клиента (те, что прикреплены в CRM → Рассрочка и договоры).',
    params: { client: { type: 'string' } },
    async run(db, a, ctx) {
      const c = resolveClient(db, a.client); if (!c.name) return c;
      const ks = db.contractCfg.filter((k: any) => (k.accounts || []).some((x: string) => norm(x) === norm(c.name!)) || score(a.client, k.title) > 0.8);
      if (!ks.length) return { client: c.name, sent: 0, note: 'У этого клиента нет договора в CRM' };
      const files = ks.flatMap((k: any) => (k.files || []).map((f: any) => ({ ...f, title: k.title })));
      if (!files.length) return { client: c.name, contracts: ks.map((k: any) => k.title), sent: 0, note: 'Договор есть, но скан/фото к нему не прикреплены в CRM' };
      let sent = 0;
      for (const f of files.slice(0, 10)) {
        try {
          const blob = await (await gh('contents/' + f.path.split('/').map(encodeURIComponent).join('/'))).blob();
          const isImg = /^image\//.test(f.type) && f.size < 10e6;
          const fd = new FormData(); fd.append('chat_id', String(ctx.chatId)); fd.append('caption', `📄 ${f.title} — ${f.name}`);
          fd.append(isImg ? 'photo' : 'document', new File([blob], f.name, { type: f.type || 'application/octet-stream' }));
          const r = await fetch(`https://api.telegram.org/bot${CFG.tg()}/${isImg ? 'sendPhoto' : 'sendDocument'}`, { method: 'POST', body: fd });
          if (r.ok) sent++;
        } catch (e) { console.warn('file', f.path, (e as Error).message); }
      }
      return { client: c.name, sent, total_files: files.length };
    },
  },
  data_status: {
    desc: 'Когда обновлялись данные и с какой даты есть история заказов. Вызывай, если спрашивают про свежесть данных.',
    params: {},
    run(db) { return { ...db.meta, agents: db.agents, debts_summary_text: db.debtSummary.slice(0, 1500) }; },
  },
};

// ───────────────────────────── Gemini ─────────────────────────────
const declarations = Object.entries(TOOLS).map(([name, t]) => ({
  name, description: t.desc,
  parameters: Object.keys(t.params).length ? { type: 'object', properties: t.params, required: ['client_card', 'send_contract_files'].includes(name) ? ['client'] : name === 'agent_report' ? ['agent'] : name === 'find_client' ? ['query'] : [] } : undefined,
}));

function systemPrompt(db: any) {
  const t = todayStr(), wd = new Intl.DateTimeFormat('ru-RU', { timeZone: CFG.tz(), weekday: 'long' }).format(new Date());
  return `Ты — AI-помощник по продажам компании MITAL (моторные масла Mitanol, Liman OIL, фильтры ECO FILTER) для супервайзера Саидбонура (регионы Фергана, Наманган, Андижан).
Сегодня ${t} (${wd}), часовой пояс Ташкент. Валюта — доллары ($).
Агенты: ${db.agents.join(', ')}.
Плановый период в компании — с 16-го числа по 15-е следующего месяца. «Этот месяц/период» = текущий плановый период, если не сказано «календарный».
История заказов и оплат в базе: с ${db.meta.orders_history_from} по ${db.meta.orders_history_to}. Данные LINKO обновлены: ${db.meta.linko_updated}.

ПРАВИЛА:
1. Любые цифры (суммы, долги, количество) бери ТОЛЬКО из ответов функций. Никогда не считай и не придумывай сам. Если функция не вернула данных — так и скажи.
2. Имена клиентов и агентов в базе на латинице; пользователь может назвать их по-русски, по-узбекски или с ошибкой — передавай как услышал, функция найдёт. Если функция вернула candidates — коротко перечисли варианты и спроси, кого он имел в виду.
3. Переводи периоды в даты YYYY-MM-DD сам («за неделю» = последние 7 дней, «вчера», «за октябрь» = 2026-10-01…2026-10-31 и т.п.).
4. Если в ответе функции есть warning или note — учти это в ответе одной короткой фразой.
5. «Остаток клиента» = его долг (сколько должен). Для этого вызывай client_card.
6. Отвечай на языке пользователя (русский или узбекский), коротко и по делу — читают с телефона. Без markdown, без таблиц и звёздочек. Списки — через «•». Деньги так: $12 444.
7. Можешь в конце дать 1 короткий практический совет, если он прямо следует из цифр (например, кого дожать сегодня).
8. Если сообщение голосовое — первой строкой напиши, что услышал: 🎤 «текст вопроса», затем ответ.`;
}

const HIST = new Map<number, { at: number; items: any[] }>();
function history(chatId: number) { const h = HIST.get(chatId); return h && Date.now() - h.at < 3600e3 ? h.items : []; }
function remember(chatId: number, q: string, a: string) {
  const items = [...history(chatId), { role: 'user', parts: [{ text: q }] }, { role: 'model', parts: [{ text: a }] }].slice(-12);
  HIST.set(chatId, { at: Date.now(), items });
}

async function gemini(body: any) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CFG.model()}:generateContent?key=${encodeURIComponent(CFG.gKey())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? 'Лимит Gemini исчерпан, попробуйте через минуту' : `Gemini ${r.status}: ${d.error?.message || ''}`);
  return d;
}

export async function ask(db: any, chatId: number, userParts: any[], qText: string) {
  const contents: any[] = [...history(chatId), { role: 'user', parts: userParts }];
  const used: string[] = [];
  for (let step = 0; step < 7; step++) {
    const d = await gemini({
      systemInstruction: { parts: [{ text: systemPrompt(db) }] }, contents,
      tools: [{ functionDeclarations: declarations }], generationConfig: { temperature: 0.1 },
    });
    const content = d.candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error('Gemini не ответил' + (d.promptFeedback?.blockReason ? ': ' + d.promptFeedback.blockReason : ''));
    contents.push(content);
    const calls = content.parts.filter((p: any) => p.functionCall);
    if (!calls.length) {
      let text = content.parts.map((p: any) => p.text || '').join('').trim();
      text = text.replace(/\*\*|__|^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ');
      const heard = (text.match(/^🎤\s*«([^»]+)»/) || [])[1];
      remember(chatId, heard || qText, text);
      return { text: text || 'Не нашёл, что ответить. Переформулируйте, пожалуйста.', used };
    }
    const responses = [];
    for (const p of calls) {
      const { name, args } = p.functionCall; used.push(name);
      let result: any;
      try { result = TOOLS[name] ? await TOOLS[name].run(db, args || {}, { chatId }) : { error: 'нет такой функции' }; } catch (e) { result = { error: (e as Error).message }; }
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { text: 'Вопрос получился слишком сложным — разбейте, пожалуйста, на части.', used };
}

// ───────────────────────────── Telegram ─────────────────────────────
async function tg(method: string, params: any) {
  const r = await fetch(`https://api.telegram.org/bot${CFG.tg()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return r.json().catch(() => ({}));
}
async function say(chatId: number, text: string) {
  for (let i = 0; i < text.length; i += 4000) await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000), disable_web_page_preview: true });
}
async function voicePart(fileId: string) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f.ok) throw new Error('Не удалось получить голосовое');
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${CFG.tg()}/${f.result.file_path}`)).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { inlineData: { mimeType: 'audio/ogg', data: btoa(bin) } };
}

const HELP = `Я AI-помощник MITAL CRM. Спрашивайте текстом или голосом (русский / узбекский):
• Какой остаток у Fozilxon Fargona?
• Сколько заказов было у Абдулмутталиба за эту неделю?
• Сколько сделал Адхамжон за период?
• Кого сегодня дожимать по оплате?
• Должники старше 30 дней в Намангане
• Пришли договор Pop Sarvarbek
• Кто не брал товар больше 2 недель?
• Остаток Liman ATF на складе в Фергане
/new — начать разговор заново`;

const seen = new Map<number, number>();
async function handle(u: any) {
  const m = u.message || u.edited_message; if (!m?.chat) return;
  if (seen.has(u.update_id)) return; seen.set(u.update_id, Date.now());
  if (seen.size > 500) for (const [k, t] of seen) if (Date.now() - t > 3600e3) seen.delete(k);
  const chatId = m.chat.id, uid = String(m.from?.id || '');
  if (!CFG.allowed().includes(uid)) {
    await say(chatId, `Нет доступа. Ваш Telegram ID: ${uid}\nЧтобы открыть доступ, добавьте его в секрет ALLOWED_USERS функции ai-bot.`);
    return;
  }
  const text = (m.text || m.caption || '').trim();
  if (/^\/(start|help)/.test(text)) return say(chatId, HELP);
  if (/^\/new/.test(text)) { HIST.delete(chatId); return say(chatId, 'Начали заново. Спрашивайте 🙂'); }
  const voice = m.voice || m.audio;
  if (!text && !voice) return say(chatId, 'Пришлите вопрос текстом или голосовым.');
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  const typing = setInterval(() => tg('sendChatAction', { chat_id: chatId, action: 'typing' }), 4500);
  try {
    const t0 = Date.now();
    const [db, vp] = await Promise.all([loadDB(/^\/fresh/.test(text)), voice ? voicePart(voice.file_id) : null]);
    const parts = vp ? [vp, { text: '(голосовое сообщение — сначала напиши, что услышал)' }] : [{ text }];
    const res = await ask(db, chatId, parts, text || '[голосовое]');
    console.log('ok', Date.now() - t0, 'ms', res.used.join(','));
    await say(chatId, res.text);
  } catch (e) {
    console.error(e);
    await say(chatId, '⚠️ ' + ((e as Error).message || 'Ошибка'));
  } finally { clearInterval(typing); }
}

async function serve(req: Request) {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // one-time setup: open <function url>?setup=<TG_SECRET> in a browser
    if (CFG.secret() && url.searchParams.get('setup') === CFG.secret()) {
      const hook = env('SUPABASE_URL') ? `${env('SUPABASE_URL')}/functions/v1/ai-bot` : `https://${url.host}/functions/v1/ai-bot`;
      const r = await tg('setWebhook', { url: hook, secret_token: CFG.secret(), allowed_updates: ['message', 'edited_message'], drop_pending_updates: true });
      await tg('setMyCommands', { commands: [{ command: 'help', description: 'Что я умею' }, { command: 'new', description: 'Начать разговор заново' }, { command: 'fresh', description: 'Обновить данные сейчас' }] });
      return new Response(JSON.stringify({ webhook: hook, telegram: r }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return new Response('MITAL AI bot is running');
  }
  if (req.headers.get('x-telegram-bot-api-secret-token') !== CFG.secret()) return new Response('forbidden', { status: 403 });
  const u = await req.json().catch(() => null);
  if (u) {
    const job = handle(u).catch(e => console.error(e));
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(job); else await job; // answer Telegram at once, work in the background
  }
  return new Response('ok');
}

export { TOOLS, build, loadDB, serve };
if (!env('AI_BOT_TEST')) (globalThis as any).Deno.serve(serve);
