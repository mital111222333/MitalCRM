// Mital AI — local test with stubs, no network and no real data.
//   deno test -A index.test.ts
// GitHub (mitalcrm-data) returns a small synthetic dataset, Telegram and Gemini are recorded / scripted,
// Supabase REST is a tiny in-memory PostgREST (eq, is, gt/gte/lt/lte, or=(...), order, limit, on_conflict, Prefer).
// deno-lint-ignore-file no-explicit-any
const D = (globalThis as any).Deno;
const ENV: Record<string, string> = {
  AI_BOT_TEST: '1', TG_TOKEN: 'T', TG_SECRET: 'sec', ALLOWED_USERS: '111', GEMINI_KEY: 'g', GH_TOKEN: 'gh',
  SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service', TZ_NAME: 'Asia/Tashkent', QUIET_DAYS: 'none',
};
for (const [k, v] of Object.entries(ENV)) D.env.set(k, v);

function assert(c: any, msg: string) { if (!c) throw new Error('ASSERT: ' + msg); }
function eq(a: any, b: any, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERT ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

// ───── synthetic data (dates relative to today in Tashkent) ─────
const tz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const T = tz(new Date()), ago = (k: number) => tz(new Date(Date.now() - k * 864e5));
const ord = (id: number, date: string, client: string, sum: number, user: string, status = 3) => ({ id, created_date: date + ' 10:00:00', 'client.name': client, total_price: sum, status, 'user.first_name': user.split(' ')[0], 'user.second_name': user.split(' ')[1] });
const AG1 = 'Adxamjon Umarov', AG2 = 'Abdulmutallib Sobirov';
const orders = [
  ord(1, ago(60), 'Big Client', 1000, AG1), ord(2, ago(53), 'Big Client', 1200, AG1), ord(3, ago(46), 'Big Client', 900, AG1), ord(4, ago(39), 'Big Client', 1100, AG1),
  ord(5, T, 'Fozilxon Fargona', 500, AG1), ord(6, ago(1), 'Fozilxon Fargona', 300, AG1), ord(7, ago(2), 'Small Shop', 200, AG2), ord(8, T, 'Small Shop', 999, AG2, 4),
];
const fast = {
  at: new Date().toISOString(), data: {
    orders, items: [{ order_id: 5, product_name: 'Liman ATF', amount: 10, price: 50 }],
    pays: [{ id: 1, type: 1, amount: 250, 'currency.name': 'USD', created_date: T + ' 12:00:00', 'client.name': 'Fozilxon Fargona', 'user.first_name': 'Adxamjon', 'user.second_name': 'Umarov' }],
    debtors: [{ 'client.name': 'Fozilxon Fargona', currencies: [{ name: 'USD', debt_total: 800, debt_first: 300, debt_second: 500, debt_third: 0, debt_fourth: 0 }], 'client.phone': '+998901112233' }],
  },
};
const extra = { from: ago(10), to: T, data: { recom: [{ full_name: 'Mitanol 5W40 4L', 'brand.name': 'Mitanol', total_balance: 6, by_day: 3, remain_days: 2, week_recommendations: 21, month_recommendations: 90 }, { full_name: 'Plenty', total_balance: 900, by_day: 1, remain_days: 900 }] } };
const inst = { at: new Date().toISOString(), clients: [{ name: 'Fozilxon Fargona', agent: AG1, debt: 800, late: 200, today: 100, lastPay: ago(3), phone: '+998901112233' }], contracts: [] };
const planFrom = (() => { const [y, m, d] = T.split('-').map(Number); return d >= 16 ? `${y}-${String(m).padStart(2, '0')}-16` : m === 1 ? `${y - 1}-12-16` : `${y}-${String(m - 1).padStart(2, '0')}-16`; })();
const crm = {
  savedAt: new Date().toISOString(), state: {
    ag: { clients: { 'Fozilxon Fargona': { agent: AG1, phone: '+998901112233' }, 'Big Client': { agent: AG1 }, 'Small Shop': { agent: AG2 } }, uploads: [] }, wh: { uploads: [] },
    ext: { payPlan: { 'Small Shop': [{ d: ago(2), s: 400 }], 'Fozilxon Fargona': [{ d: T, s: 100 }] }, agentPlans: { [planFrom]: { [AG1]: { plan: 10000 }, [AG2]: { plan: 5000 } } } },
  },
};
async function gz(o: any) { return new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
const GH: Record<string, any> = { 'linko-fast.json': fast, 'linko-extra.json': extra, 'inst-state.json': inst };
const GHGZ: Record<string, Uint8Array> = { 'crm-data.json.gz': await gz(crm) };

// ───── a real ZIP writer (deflate) to build .docx / .xlsx files ─────
const crcT = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function zip(files: Record<string, string>) {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = new TextEncoder().encode(text), nm = new TextEncoder().encode(name);
    const comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(8, 8, true); h.setUint32(14, crc32(raw), true); h.setUint32(18, comp.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, crc32(raw), true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, comp); central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + comp.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
const DOCX = await zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Условия акции «Осень»</w:t></w:r></w:p><w:p><w:r><w:t>При заказе от 50 канистр Mitanol скидка 7% &amp; бесплатная доставка.</w:t></w:r></w:p></w:body></w:document>' });
const XLSX = await zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Прайс" sheetId="1"/></sheets></workbook>',
  'xl/sharedStrings.xml': '<sst><si><t>Товар</t></si><si><t>Цена</t></si><si><r><t>Liman </t></r><r><t>ATF</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Mitanol</t></is></c><c r="B3"/></row></sheetData></worksheet>',
});
const FILES: Record<string, Uint8Array> = { docx1: DOCX, xlsx1: XLSX };

// ───── mini PostgREST ─────
const DB: Record<string, any[]> = { ai_messages: [], ai_memory: [], ai_reminders: [], ai_notebook: [], ai_events: [], ai_usage: [], ai_ledger: [], workspaces: [] };
// the CRM workspace in Supabase Storage (newer than the GitHub copy): the same state plus one client that only it has
const WS_FILE = await gz({ app: 'mitalcrm', savedAt: new Date(Date.now() + 1000).toISOString(), state: { ...crm.state, ag: { ...crm.state.ag, clients: { ...crm.state.ag.clients, 'Workspace Only': { agent: AG2 } } } } });
DB.workspaces.push({ owner_id: 'u1', version: 7, saved_at: new Date().toISOString() });
let seq = 1;
const isTime = (k: string) => k.endsWith('_at');
const cmp = (k: string, a: any, b: string) => isTime(k) ? Date.parse(a) - Date.parse(b) : typeof a === 'number' ? a - Number(b) : String(a ?? '').localeCompare(b);
function test1(row: any, k: string, expr: string): boolean {
  const i = expr.indexOf('.'), op = expr.slice(0, i), v = decodeURIComponent(expr.slice(i + 1)), a = row[k];
  if (op === 'is') return v === 'null' ? a == null : String(a) === v;
  if (a == null) return false;
  const c = cmp(k, a, v);
  if (op === 'eq') return c === 0;
  if (op === 'gt') return c > 0;
  if (op === 'gte') return c >= 0;
  if (op === 'lt') return c < 0;
  if (op === 'lte') return c <= 0;
  throw new Error('op ' + op);
}
function filterRows(rows: any[], sp: URLSearchParams) {
  let out = rows;
  for (const [k, v] of sp) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') { const conds = v.replace(/^\(|\)$/g, '').split(','); out = out.filter(r => conds.some(c => { const j = c.indexOf('.'); return test1(r, c.slice(0, j), c.slice(j + 1)); })); continue; }
    out = out.filter(r => test1(r, k, v));
  }
  return out;
}
function postgrest(url: URL, method: string, body: any, prefer: string) {
  const table = url.pathname.replace('/rest/v1/', ''), sp = url.searchParams, rows = DB[table];
  if (table === 'rpc/ai_usage_add') { // same logic as the SQL function: upsert + add, returns the day's requests
    let u = DB.ai_usage.find(r => r.day === body.p_day && r.model === body.p_model);
    if (!u) { u = { day: body.p_day, model: body.p_model, requests: 0, limited: 0, tokens_in: 0, tokens_out: 0 }; DB.ai_usage.push(u); }
    u.requests += body.p_req; u.limited += body.p_limited; u.tokens_in += body.p_in; u.tokens_out += body.p_out;
    return new Response(JSON.stringify(u.requests));
  }
  if (!rows) return new Response(JSON.stringify({ code: 'PGRST205', message: `relation ${table} does not exist` }), { status: 404 });
  const rep = /return=representation/.test(prefer), ok = (data: any, st = 200) => new Response(rep || method === 'GET' ? JSON.stringify(data) : '', { status: st });
  if (method === 'GET') {
    let out = filterRows(rows, sp);
    const o = sp.get('order'); if (o) { const [col, dir] = o.split('.'); out = [...out].sort((a, b) => cmp(col, a[col], b[col]) * (dir === 'desc' ? -1 : 1)); }
    if (sp.get('limit')) out = out.slice(0, +sp.get('limit')!);
    const sel = sp.get('select'); if (sel && sel !== '*') out = out.map(r => Object.fromEntries(sel.split(',').map(c => [c, r[c]])));
    return ok(out);
  }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body], added: any[] = [];
    // real PostgREST: a bulk insert must have the same keys in every row (PGRST102)
    if (list.some(b => Object.keys(b).sort().join() !== Object.keys(list[0]).sort().join())) return new Response('{"code":"PGRST102","message":"All object keys must match"}', { status: 400 });
    for (const b of list) {
      if (table === 'ai_events' && rows.some(r => r.key === b.key)) { if (/ignore-duplicates/.test(prefer)) continue; return new Response('{"code":"23505"}', { status: 409 }); }
      const row = { id: seq++, created_at: new Date().toISOString(), ...b }; rows.push(row); added.push(row);
    }
    return ok(added, 201);
  }
  const hit = filterRows(rows, sp);
  if (method === 'PATCH') { for (const r of hit) Object.assign(r, body); return ok(hit); }
  if (method === 'DELETE') { DB[table] = rows.filter(r => !hit.includes(r)); return ok(hit); }
  throw new Error('method ' + method);
}

// ───── Telegram + Gemini recorders ─────
const SENT: { method: string; body: any }[] = [];
const sentTexts = () => SENT.filter(s => s.method === 'sendMessage').map(s => s.body.text);
let GEM: (body: any) => any = () => say('ok');
const GEM_LOG: any[] = [];
function call(name: string, args: any) { return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] }; }
function say(text: string) { return { candidates: [{ content: { role: 'model', parts: [{ text }] } }] }; }

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url), method = (init.method || 'GET').toUpperCase();
  if (url.host === 'api.github.com') {
    if (url.pathname.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [] }));
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] || '');
    if (GHGZ[path]) return new Response(GHGZ[path].slice());
    if (GH[path]) return new Response(JSON.stringify(GH[path]));
    return new Response('nf', { status: 404 });
  }
  if (url.host === 'api.telegram.org') {
    if (url.pathname.startsWith('/file/')) return new Response(FILES[url.pathname.split('/').pop()!].slice());
    const methodName = url.pathname.split('/').pop()!;
    let body: any = init.body;
    if (body instanceof FormData) { const o: any = {}; for (const [k, v] of body) o[k] = typeof v === 'string' ? v : await (v as File).text(); body = o; } else body = JSON.parse(body || '{}');
    SENT.push({ method: methodName, body });
    if (methodName === 'getFile') return new Response(JSON.stringify({ ok: true, result: { file_path: 'docs/' + body.file_id, file_size: FILES[body.file_id]?.length || 10 } }));
    return new Response(JSON.stringify({ ok: true, result: true }));
  }
  if (url.host === 'generativelanguage.googleapis.com') {
    const b = JSON.parse(init.body); GEM_LOG.push(b); const res = GEM(b);
    if (res.__status) return new Response(JSON.stringify(res.body), { status: res.__status });
    return new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 }, ...res }));
  }
  if (url.host === 'sb.test' && url.pathname === '/storage/v1/object/workspaces/u1/v7.json.gz') return new Response(WS_FILE);
  if (url.host === 'sb.test') {
    assert(init.headers?.apikey === 'service', 'Supabase apikey header');
    return postgrest(url, method, init.body ? JSON.parse(init.body) : undefined, init.headers?.Prefer || '');
  }
  throw new Error('unexpected fetch ' + url);
};

const M: any = await import('./index.ts');
let upd = 1;
const tgPost = (message: any) => M.serve(new Request('https://x/functions/v1/ai-bot', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify({ update_id: upd++, message: { chat: { id: 111 }, from: { id: 111 }, ...message } }) }));
const lastText = () => sentTexts().at(-1) || '';

D.test('time: local → UTC, invalid dates, working days, plan period', () => {
  eq(M.localToUtc('2026-11-19T10:00')?.toISOString(), '2026-11-19T05:00:00.000Z', 'Tashkent is UTC+5');
  eq(M.localToUtc('2026-02-30T10:00'), null, '30 Feb rejected');
  eq(M.localToUtc('2026-11-19T25:00'), null, 'hour 25 rejected');
  eq(M.workDays('2026-11-16', '2026-12-15'), 26, '30 days minus 4 Sundays');
  const P = M.planPeriod(); assert(P.from.endsWith('-16') && P.end.endsWith('-15') && P.from <= P.to && P.to <= P.end, 'plan period 16 → 15: ' + JSON.stringify(P));
});

D.test('agents overview: balance file of the period like «Лидерборд», else orders minus returns', () => {
  const o = (id: number, date: string, client: string, total_price: number) => ({ id, created_date: date + ' 10:00:00', 'client.name': client, total_price, status: 3 });
  const S = {
    ag: {
      clients: { A1: { agent: 'Agent One' }, B1: { agent: 'Agent Two' } },
      uploads: [
        { period_from: '2026-10-16', period_to: '2026-11-15', taken_at: '2026-11-15', rows: [{ client: 'A1', agent: 'Agent One', sold: 900, ret: 100, paid: 300 }, { client: 'B1', sold: 50, ret: 0, paid: 10 }] },
        // the final upload: sales up to the 15th, money plus the 16th — this one must win
        { period_from: '2026-10-16', period_to: '2026-11-16', taken_at: '2026-11-17', rows: [
          // Adxamjon in LINKO 16.10–15.11: start −19 239,324, sold 22 527,822, returns 1 372,596, paid 18 012,683
          { client: 'A1', agent: 'Agent One', b0: -19239.324, sold: 22527.822, sold0: 23000, ret: 1372.596, paid: 18012.683, other_in: 0, other_out: 0, b1: -20000 },
          { client: 'B1', b0: 0, sold: 50, ret: 0, paid: 20, other_in: 0, other_out: -10, b1: -40 }] },
        // the 16th alone: its 2 092,68 must NOT be taken out of the final's paid again (that was the bug)
        { period_from: '2026-11-16', period_to: '2026-11-16', taken_at: '2026-11-16', rows: [{ client: 'A1', agent: 'Agent One', b0: -22381.867, sold: 50, ret: 0, paid: 0, paid0: 2092.683, other_in: 0, other_out: 0, b1: -20339 }] },
      ],
    },
    wh: { uploads: [] }, ext: {},
  };
  const fastD = { data: { orders: [o(1, '2026-10-20', 'A1', 1000), o(2, '2026-11-01', 'B1', 50), o(3, '2026-09-20', 'A1', 70)], pays: [{ id: 1, type: 1, amount: 200, 'currency.name': 'USD', created_date: '2026-10-25 10:00:00', 'client.name': 'A1' }] } };
  const extraD = { data: { returns: [{ id: 9, created_date: '2026-10-30 10:00:00', 'client.name': 'A1', total_price: 100 }] } };
  const db = M.build({ state: S }, fastD, extraD, null, [], []);
  const r = M.TOOLS.agents_overview.run(db, { from: '2026-10-16', to: '2026-11-15' }, {});
  const a1 = r.agents.find((x: any) => x.agent === 'Agent One'), a2 = r.agents.find((x: any) => x.agent === 'Agent Two');
  // exactly LINKO 16.10–15.11: end = −19 239,324 − 22 527,822 + 1 372,596 + 18 012,683 = −22 381,867 → debt 22 381,87
  eq([a1.sales, a1.returns, a1.collected, a1.clients_debt, a1.collected_cash, a1.orders], [22527.82, 1372.6, 18012.68, 22381.87, 200, 1], 'Agent One = LINKO 16.10–15.11');
  eq([a2.sales, a2.collected, a2.clients_debt], [50, 20, 40], 'row without agent → client master agent, other out counted');
  eq([r.team_debt, r.team_collected], [22421.87, 18032.68], 'team totals');
  const txt = M.TPL.agents_overview(r);
  assert(/16\.10 — 15\.11/.test(txt) && !/16\.11/.test(txt) && /долг на 15\.11/.test(txt), 'period 16.10–15.11 everywhere, no 16.11: ' + txt);
  const n = M.TOOLS.agents_overview.run(db, { from: '2026-10-17', to: '2026-11-15' }, {}); // no balance file for this period
  eq(n.agents.find((x: any) => x.agent === 'Agent One').sales, 900, 'without balance file: orders 1000 minus return 100');
  assert(/только наличные/.test(n.source), 'fallback source explained');
});

D.test('CRM state comes from the Supabase workspace when it is newer than GitHub', async () => {
  const db = await M.loadDB(true);
  assert(db.clients['Workspace Only'], 'workspace state used');
});

D.test('CRM summary (botsnap.js): salary, discipline, calendar, tasks — exactly as the CRM gave them', async () => {
  const snap = {
    v: 1, at: '2026-11-18T12:00:00Z', today: '2026-11-18', errors: { signals: 'boom' },
    pay: [{ label: '16.11–15.12.2026', closed: null, rate: 12000, work_days: 26, collected_source: 'баланс LINKO от 2026-11-18', rows: [
      { name: 'Adxamjon Umarov', role: 'Агент', total_uzs: 6543210, voucher: 0, lines: ['Фикс: $400 / 26 дн. × 3 дн.: $46,15', 'Штраф за опоздания: 12 мин: −12 000 сум'] },
      { name: 'Abdulmutallib Sobirov', role: 'Агент', total_uzs: 1000000, voucher: 0, lines: [] }] }],
    discipline: { from: '2026-11-16', to: '2026-11-18', start: '09:00', end: '18:00', fine_per_min_uzs: 1000, rows: [
      { agent: 'Adxamjon Umarov', late_days: 1, late_minutes: 12, fine_uzs: 12000, excused: {}, days: [{ day: '2026-11-17', first: '09:12', last: '17:40', status: '', late_min: 12, early_min: 20 }, { day: '2026-11-18', first: '', status: 'Полдня — отпросился', late_min: 0, early_min: 0 }] }],
      requests: [{ agent: 'Adxamjon Umarov', type: 'Полдня — отпросился', from: '2026-11-18', to: '2026-11-18', note: 'к врачу', state: 'одобрено', at: '2026-11-17T20:00:00Z' }] },
    calendar: { today: '2026-11-18', from: '2026-11-04', to: '2026-12-19', items: [{ date: '2026-11-18', sum: 500, client: 'Big Client', agent: 'Adxamjon Umarov', kind: 'Договор', state: 'ждём', why: 'месяц 2 из 12' }, { date: '2026-11-19', sum: 70, client: 'Small Shop', agent: 'Abdulmutallib Sobirov', kind: 'Обещание', state: 'ждём', why: '' }] },
    tasks: [{ agent: 'Adxamjon Umarov', title: 'Урок 5', state: 'открыто', overdue: true, due: '2026-11-17' }],
  };
  const db = { snap, agents: ['Adxamjon Umarov', 'Abdulmutallib Sobirov'], clients: {}, debtors: new Map() };
  const s = M.TOOLS.crm_salary.run(db, { agent: 'Адхамжон' }, {});
  eq([s.rows.length, s.total_uzs], [1, 6543210], 'salary of one person, the CRM total as is');
  assert(/6\s543\s210 сум/.test(M.TPL.crm_salary(s)) && /Штраф за опоздания/.test(M.TPL.crm_salary(s)), 'slip lines shown: ' + M.TPL.crm_salary(s));
  const d = M.TOOLS.crm_discipline.run(db, { agent: 'Adxamjon' }, {});
  const dt = M.TPL.crm_discipline(d);
  assert(/опоздал на 12 мин/.test(dt) && /ушёл раньше на 20 мин/.test(dt) && /Полдня — отпросился/.test(dt) && /к врачу/.test(dt), 'discipline days and requests: ' + dt);
  const c = M.TOOLS.crm_payment_calendar.run(db, {}, {});
  eq([c.count, c.total], [1, 500], 'calendar: today by default');
  eq(M.TOOLS.crm_tasks.run(db, { only_open: true }, {}).overdue, 1, 'overdue task');
  assert(/не смогла посчитать/.test(M.TOOLS.crm_signals.run(db, {}, {}).error), 'a failed part is reported, not guessed');
  assert(/Сводки из MitalCRM пока нет/.test(M.TOOLS.crm_leaderboard.run({ snap: null }, {}, {}).error), 'no summary → clear message');
  assert(/нет фото/.test((await M.TOOLS.save_photo.run(db, { title: 'x' }, { chatId: 111 })).error), 'save_photo needs a photo');
  const sp = await M.TOOLS.save_photo.run(db, { title: 'Mitanol 5W40', description: '3 канистры Mitanol 5W40 4L', note: 'цена $14' }, { chatId: 111, media: { file_id: 'PH1', mime: 'image/jpeg' } });
  assert(sp.saved && DB.ai_notebook.some((r: any) => r.tg_file_id === 'PH1' && /цена \$14/.test(r.content)), 'photo saved with its description and note');
  DB.ai_notebook.length = 0; // the telegram flow test below starts with an empty notebook
});

D.test('office files: docx and xlsx text', async () => {
  const d = await M.officeText(DOCX, 'docx');
  assert(d.includes('Условия акции «Осень»') && d.includes('скидка 7% & бесплатная'), 'docx: ' + d);
  const x = await M.officeText(XLSX, 'xlsx');
  assert(x.includes('## Прайс') && x.includes('Товар | Цена') && x.includes('Liman ATF | 12.5') && x.includes('Mitanol'), 'xlsx: ' + x);
});

D.test('notebook search: small → whole, big → BM25 finds the right passage', () => {
  eq(M.searchNotebook([{ id: 1, title: 'a', content: 'short' }], 'x').length, 1, 'small notebook returned whole');
  const filler = 'Общие положения компании о работе склада и логистике. '.repeat(400);
  const rows = [{ id: 1, title: 'Регламент', content: filler + '\n\nШтраф агента за опоздание на утреннюю планёрку — 50 000 сум.\n\n' + filler }, { id: 2, title: 'Прайс', content: filler }];
  const hits = M.searchNotebook(rows, 'какой штраф за опоздание');
  assert(hits.length && hits[0].id === 1 && hits[0].text.includes('Штраф агента'), 'BM25 top hit: ' + JSON.stringify(hits[0]).slice(0, 200));
  const parts = M.chunkText('a'.repeat(5000)); assert(parts.length >= 4 && parts.every((p: string) => p.length <= 1200), 'chunks ≤ 1200');
});

D.test('telegram flow: access, commands, memory, reminders, notebook, NotebookLM export, briefs, cron', async () => {
  // unknown user, missing secrets
  await M.serve(new Request('https://x/', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify({ update_id: upd++, message: { chat: { id: 5 }, from: { id: 5 }, text: 'hi' } }) }));
  assert(lastText().includes('Нет доступа. Ваш Telegram ID: 5'), 'stranger gets his ID');
  eq((await M.serve(new Request('https://x/', { method: 'POST', body: '{}' }))).status, 403, 'webhook without secret');
  eq((await M.serve(new Request('https://x/?cron=1', { method: 'POST' }))).status, 403, 'cron without secret');

  await tgPost({ text: '/help' }); assert(lastText().includes('Mital AI'), 'help names the agent');

  // quick commands (no AI)
  const before = GEM_LOG.length;
  await tgPost({ text: '/plan' }); assert(/Прогноз плана/.test(lastText()) && lastText().includes('Adxamjon Umarov: факт $800 из $10 000'), '/plan: ' + lastText());
  await tgPost({ text: '/sklad' }); assert(lastText().includes('Mitanol 5W40 4L — на 2 дн.') && !lastText().includes('Plenty'), '/sklad: ' + lastText());
  await tgPost({ text: '/promise' }); assert(lastText().includes('Сорвали обещание') && lastText().includes('Small Shop') && lastText().includes('Обещали оплатить сегодня'), '/promise: ' + lastText());
  await tgPost({ text: '/stop' }); assert(lastText().includes('Big Client') && lastText().includes('обычно раз в 7 дн.'), '/stop: ' + lastText());
  await tgPost({ text: '/brief' }); const brief = lastText();
  assert(brief.includes('Доброе утро') && brief.includes('Fozilxon Fargona') && brief.includes('Big Client') && brief.includes('Mitanol 5W40'), '/brief: ' + brief);
  await tgPost({ text: '/evening' }); const ev = lastText();
  assert(ev.includes('Итог дня') && ev.includes('Продажи: $500 (1 заказов') && ev.includes('Собрано наличными: $250') && ev.includes('Без заказов сегодня: Abdulmutallib'), '/evening (cancelled order excluded): ' + ev);
  eq(GEM_LOG.length, before, 'quick commands use no AI');

  // remember → template answer, stored, then injected into the next prompt
  GEM = () => call('remember', { text: 'Abdulmutallib в отпуске до 25.11', kind: 'fact', until: '2026-11-25' });
  await tgPost({ text: 'запомни: Абдулмутталиб в отпуске до 25.11' });
  assert(lastText().startsWith('🧠 Запомнил #'), 'remember template: ' + lastText());
  eq(DB.ai_memory.length, 1, 'memory row stored');
  GEM = () => say('Он в отпуске.');
  await tgPost({ text: 'где Абдулмутталиб?' });
  const sys = GEM_LOG.at(-1).systemInstruction.parts[0].text;
  assert(sys.includes('Abdulmutallib в отпуске до 25.11') && sys.includes('Ты — Mital AI'), 'fact + persona in the system prompt');
  assert(GEM_LOG.at(-1).contents.length >= 3, 'conversation history sent');
  assert(DB.ai_messages.length >= 4, 'messages logged in Supabase');
  await tgPost({ text: '/memory' }); assert(lastText().includes('Abdulmutallib в отпуске'), '/memory');
  GEM = () => call('bot_help', { heard: 'Скажи, что ты умеешь' });
  await tgPost({ voice: { file_id: 'docx1', mime_type: 'audio/ogg' } });
  assert(lastText().startsWith('🎤 «Скажи, что ты умеешь»') && lastText().includes('Быстрые команды'), 'voice «what can you do» → help: ' + lastText().slice(0, 120));
  assert(GEM_LOG.at(-1).tools[0].functionDeclarations.some((f: any) => f.name === 'bot_help'), 'bot_help declared');
  await tgPost({ text: `/forget ${DB.ai_memory[0].id}` }); assert(lastText().startsWith('🗑 Забыл'), '/forget'); eq(DB.ai_memory.length, 0, 'memory deleted');

  // reminders: one for this minute (due), one daily, one in the past (rejected)
  const L = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
  GEM = () => call('reminder_add', { at: L, text: 'позвонить Fozilxon' });
  await tgPost({ text: 'напомни сейчас позвонить Fozilxon' }); assert(lastText().startsWith('⏰ Напомню'), 'reminder template: ' + lastText());
  GEM = () => call('reminder_add', { at: L, text: 'сбор денег', repeat: 'daily' });
  await tgPost({ text: 'каждый день напоминай про сбор' });
  GEM = () => call('reminder_add', { at: '2020-01-01T10:00', text: 'past' });
  await tgPost({ text: 'напомни в 2020' }); assert(lastText().includes('уже прошло'), 'past time rejected');
  eq(DB.ai_reminders.length, 2, 'two reminders');

  // cron tick: both reminders fire once, the daily one moves to tomorrow; the morning brief fires once in its hour
  const hourNow = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  D.env.set('MORNING_HOUR', String(hourNow)); D.env.set('EVENING_HOUR', String((hourNow + 1) % 24)); D.env.set('ALERT_HOUR', String((hourNow + 2) % 24));
  const r1 = await M.tick();
  eq(r1.reminders, 2, 'both reminders sent'); eq(r1.morning, 'sent', 'morning brief sent');
  const r2 = await M.tick();
  eq(r2.reminders, 0, 'not sent twice'); eq(r2.morning, undefined, 'brief not sent twice');
  const daily = DB.ai_reminders.find(r => r.repeat === 'daily');
  assert(daily.sent_at == null && Date.parse(daily.due_at) > Date.now(), 'daily reminder rescheduled');
  assert(DB.ai_reminders.find(r => !r.repeat).sent_at, 'one-off marked sent');
  assert(sentTexts().some(t => t.startsWith('⏰ Напоминание: позвонить Fozilxon')), 'reminder text delivered');
  eq((await M.serve(new Request('https://x/?cron=1', { method: 'POST', headers: { 'x-mital-cron': 'sec' } }))).status, 200, 'cron with secret');

  // knowledge notebook: a Word file without caption is saved; a question is answered from it
  await tgPost({ document: { file_id: 'docx1', file_name: 'Акция.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
  assert(lastText().startsWith('📚 Добавил в блокнот #') && DB.ai_notebook.length === 1, 'docx saved: ' + lastText());
  await tgPost({ document: { file_id: 'xlsx1', file_name: 'Прайс.xlsx', mime_type: '' }, caption: '/nb Прайс ноябрь' });
  eq(DB.ai_notebook[1]?.title, 'Прайс ноябрь', 'xlsx saved with /nb title');
  let step = 0;
  GEM = () => { step++; return step === 1 ? call('notebook_search', { query: 'скидка акция' }) : say('Скидка 7% от 50 канистр [Акция.docx]'); };
  await tgPost({ text: 'какая скидка по акции?' });
  const resp = JSON.stringify(GEM_LOG.at(-1).contents.at(-1));
  assert(resp.includes('скидка 7%') && resp.includes('ДАННЫЕ'), 'passages + data-not-instructions note sent to AI');
  assert(lastText().includes('[Акция.docx]'), 'answer cites the source');
  await tgPost({ text: '/nb' }); assert(lastText().includes('Акция.docx') && lastText().includes('Прайс ноябрь'), '/nb list');
  await tgPost({ text: '/nb Цена доставки в Кува — 20$' }); eq(DB.ai_notebook.length, 3, 'note added');
  await tgPost({ text: `/nb del ${DB.ai_notebook[2].id}` }); eq(DB.ai_notebook.length, 2, 'note deleted');

  // a document WITH a question is answered once (not saved)
  GEM = () => say('В документе акция на Mitanol.');
  await tgPost({ document: { file_id: 'docx1', file_name: 'Акция.docx', mime_type: '' }, caption: 'о чём этот документ?' });
  eq(DB.ai_notebook.length, 2, 'not saved'); assert(JSON.stringify(GEM_LOG.at(-1).contents.at(-1)).includes('Условия акции'), 'document text sent to the AI');

  // NotebookLM export
  await tgPost({ text: '/notebooklm' });
  const doc = SENT.filter(s => s.method === 'sendDocument').at(-1)!;
  assert(doc && doc.body.document.startsWith('# MITAL — сводка продаж') && doc.body.document.includes('| Adxamjon Umarov |') && doc.body.caption.includes('NotebookLM'), 'export file');
  assert(!/undefined|NaN/.test(doc.body.document), 'no undefined / NaN in export');

  // Gemini usage: every request counted; /limits and a plain question about limits answer without AI; 80% warning once; 429 explained
  const used = DB.ai_usage.reduce((s, r) => s + r.requests, 0);
  eq(used, GEM_LOG.length, 'every Gemini request is counted');
  const g0 = GEM_LOG.length;
  await tgPost({ text: '/limits' }); assert(lastText().includes(`Сегодня: ${used} из ~500 запросов`) && lastText().includes('Обновится в') && lastText().includes('тыс. вход'), '/limits: ' + lastText());
  await tgPost({ text: 'сколько осталось лимитов?' }); assert(lastText().startsWith('📊 Лимиты Gemini'), 'plain question about limits');
  eq(GEM_LOG.length, g0, '/limits spends no AI');
  D.env.set('GEMINI_RPD', String(used + 1));
  GEM = () => say('ok'); await tgPost({ text: 'вопрос один' });
  assert(lastText().startsWith('ok') && lastText().includes(`Лимит: осталось ~0 из ${used + 1} · этот ответ −1 · обновится в`), 'every AI answer shows what is left: ' + lastText());
  await tgPost({ text: 'вопрос два' });
  eq(sentTexts().filter(t => t.includes('потрачено') && t.includes('запросов Gemini')).length, 1, '80% warning sent exactly once');
  D.env.delete('GEMINI_RPD');
  GEM = () => ({ __status: 429, body: { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 500', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } } });
  await tgPost({ text: 'вопрос три' }); assert(lastText().includes('Дневной лимит Gemini исчерпан') && lastText().includes('/limits'), '429 per day: ' + lastText());
  GEM = () => ({ __status: 429, body: { error: { code: 429, message: 'Quota exceeded', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } } });
  await tgPost({ text: 'вопрос четыре' }); assert(lastText().includes('лимит Gemini в минуту'), '429 per minute: ' + lastText());
  eq(DB.ai_usage.reduce((s, r) => s + r.limited, 0), 2, 'refusals counted');

  // the conversation really is stored: every question has its answer row
  eq(DB.ai_messages.filter(r => r.role === 'user').length, DB.ai_messages.filter(r => r.role === 'model').length, 'question/answer pairs stored');
  assert(DB.ai_messages.length >= 10, 'messages stored: ' + DB.ai_messages.length);

  // no access to mitalcrm-data (GitHub 404) → a clear message, never answers with zeros
  const saved = { ...GH }, savedGz = { ...GHGZ };
  for (const k of Object.keys(GH)) delete GH[k]; for (const k of Object.keys(GHGZ)) delete GHGZ[k];
  await tgPost({ text: '/fresh' }); assert(lastText().includes('Нет доступа к данным CRM') && lastText().includes('404') && lastText().includes('GH_TOKEN'), '/fresh with 404: ' + lastText());
  await tgPost({ text: '/today' }); assert(lastText().includes('Нет доступа к данным CRM'), '/today with 404');
  const g1 = GEM_LOG.length; await tgPost({ text: 'какой долг у Fozilxon?' }); assert(lastText().includes('Нет доступа к данным CRM') && GEM_LOG.length === g1, 'question with 404: no AI, clear error');
  Object.assign(GH, saved); Object.assign(GHGZ, savedGz);
  await tgPost({ text: '/fresh' }); eq(lastText(), '🔄 Данные обновлены.', 'data back');

  // /new puts a marker
  await tgPost({ text: '/new' }); eq(DB.ai_messages.at(-1).text, '/new', 'reset marker');

  // setup
  const s = await (await M.serve(new Request('https://x/?setup=sec'))).json();
  eq(s.memory, 'подключена ✅', 'setup reports memory');
  assert(SENT.some(x => x.method === 'setMyCommands' && x.body.commands.some((c: any) => c.command === 'notebooklm')), 'commands registered');
  for (const t of sentTexts()) assert(!/undefined|NaN|\[object/.test(t), 'no broken values in: ' + t.slice(0, 300));
});

D.test('personal debts and spheres: apart from CRM debts, balance per person and currency, own chat only', async () => {
  const ctx = { chatId: 222 }, T = M.TOOLS, P = M.TPL;
  const L = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' });
  const due = L.format(new Date(Date.now() + 5 * 864e5));
  const a = await T.personal_debt_add.run(null, { person: 'Азиз', action: 'i_borrowed', amount: 200, currency: 'USD', due, note: 'на ремонт' }, ctx);
  eq([a.person, a.balance, a.sphere], ['Азиз', -200, 'personal'], 'I borrowed → I owe');
  const rem = DB.ai_reminders.find((r: any) => r.chat_id === 222);
  assert(a.reminder && rem && rem.text === 'Вернуть долг: Азиз — $200' && rem.sphere === 'personal', 'due date → reminder: ' + JSON.stringify(rem));
  const at = P.personal_debt_add(a);
  assert(at.includes('Азиз: вы должны $200') && at.includes('на ремонт') && at.includes('⏰ Напомню') && at.includes(`#${a.saved}`), 'add template: ' + at);
  const b = await T.personal_debt_add.run(null, { person: 'азиз', action: 'i_returned', amount: 50 }, ctx);
  eq([b.person, b.balance, b.reminder], ['Азиз', -150, undefined], 'same person by spelling, partial return, USD by default');
  const c = await T.personal_debt_add.run(null, { person: 'Брат', action: 'i_lent', amount: 500000, currency: 'uzs', sphere: 'family' }, ctx);
  assert(P.personal_debt_add(c).includes('Брат должен вам 500 000 сум'), 'sum currency: ' + P.personal_debt_add(c));
  await T.personal_debt_add.run(null, { person: 'Шерзод', action: 'i_lent', amount: 100, sphere: 'friends' }, ctx);
  const z = await T.personal_debt_add.run(null, { person: 'Шерзод', action: 'they_returned', amount: 100, sphere: 'friends' }, ctx);
  assert(z.balance === 0 && P.personal_debt_add(z).includes('Шерзод: в расчёте'), 'settled');
  assert(/Не понял/.test((await T.personal_debt_add.run(null, { person: 'X', action: 'gift', amount: 1 }, ctx)).error), 'bad action rejected');
  assert(/сумма/.test((await T.personal_debt_add.run(null, { person: 'X', action: 'i_lent', amount: 0 }, ctx)).error), 'zero rejected');

  const s = await T.personal_debts.run(null, {}, ctx);
  eq(s.i_owe.map((x: any) => [x.person, x.sum, x.due]), [['Азиз', -150, due]], 'I owe: Aziz, due kept');
  eq(s.owe_me.map((x: any) => [x.person, x.sum]), [['Брат', 500000]], 'owed to me: brother; settled Sherzod gone');
  eq([s.total_i_owe, s.total_owe_me], [{ USD: 150 }, { UZS: 500000 }], 'totals per currency');
  const st = P.personal_debts(s);
  assert(st.includes('Вы должны (1)') && st.includes('• Азиз — $150') && st.includes('Брат — 500 000 сум 👨‍👩‍👧') && st.includes('/dolg') && !st.includes('Шерзод'), 'summary: ' + st);
  const fam = await T.personal_debts.run(null, { sphere: 'family' }, ctx);
  eq([fam.i_owe.length, fam.owe_me.length], [0, 1], 'one sphere only');
  const h = await T.personal_debts.run(null, { person: 'Aziz' }, ctx);
  eq([h.person, h.history.length], ['Азиз', 2], 'history found by latin spelling');
  assert(P.personal_debts(h).includes('вы заняли $200') && P.personal_debts(h).includes('вы вернули $50'), 'history template: ' + P.personal_debts(h));
  const u = await T.personal_debts.run(null, { person: 'Никто' }, ctx);
  assert(u.error && u.candidates.includes('Азиз'), 'unknown person → candidates');
  const empty = await T.personal_debts.run(null, {}, { chatId: 333 });
  assert(P.personal_debts(empty).includes('Долгов нет'), 'another chat sees nothing');
  const d = await T.personal_debt_delete.run(null, { id: a.saved }, ctx);
  eq(d.deleted, a.saved, 'deleted');
  eq((await T.personal_debts.run(null, {}, ctx)).owe_me.find((x: any) => x.person === 'Азиз').sum, 50, 'after deleting the loan only my return is left');
  assert((await T.personal_debt_delete.run(null, { id: a.saved }, { chatId: 333 })).error, 'cannot delete from another chat');

  // spheres in memory
  const m = await T.remember.run(null, { text: 'у мамы день рождения 03.03', kind: 'fact', sphere: 'family' }, ctx);
  await T.remember.run(null, { text: 'Adxamjon в отпуске', kind: 'fact' }, ctx);
  await T.remember.run(null, { text: 'магазин фильтров в Коканде', kind: 'fact', sphere: 'ideas' }, ctx);
  assert(P.remember(m).includes('👨‍👩‍👧 Семья'), 'remember shows the sphere: ' + P.remember(m));
  eq(DB.ai_memory.filter((r: any) => r.chat_id === 222).map((r: any) => r.sphere), ['family', 'work', 'ideas'], 'sphere stored, work by default');
  const ml = P.memory_list(await T.memory_list.run(null, {}, ctx));
  assert(ml.includes('💼 Работа:') && ml.includes('👨‍👩‍👧 Семья:') && ml.includes('💡 Идеи:'), 'memory grouped by sphere: ' + ml);
  const ideas = await T.memory_list.run(null, { sphere: 'ideas' }, ctx);
  eq(ideas.facts.map((x: any) => x.text), ['магазин фильтров в Коканде'], 'only ideas');

  // in the chat: /my without AI, «сколько у меня долгов» → personal_debts, the prompt separates personal money from CRM debts
  const g0 = GEM_LOG.length;
  await tgPost({ text: '/my' }); assert(lastText().startsWith('💸 Личные долги'), '/my: ' + lastText());
  eq(GEM_LOG.length, g0, '/my spends no AI');
  GEM = () => call('personal_debts', {});
  await tgPost({ text: 'сколько у меня долгов?' }); assert(lastText().startsWith('💸 Личные долги'), 'personal question → personal debts: ' + lastText());
  const sys = GEM_LOG.at(-1).systemInstruction.parts[0].text;
  assert(sys.includes('ЛИЧНЫЕ И РАБОЧИЕ НЕ СМЕШИВАЙ') && sys.includes('как Джарвис'), 'prompt: spheres and money rules');
  assert(GEM_LOG.at(-1).tools[0].functionDeclarations.some((f: any) => f.name === 'personal_debt_add' && f.parameters.required.includes('amount')), 'personal_debt_add declared');
  GEM = () => say('ok');
  for (const t of [at, st, ml, P.personal_debts(h)]) assert(!/undefined|NaN|\[object/.test(t), 'no broken values: ' + t);
});
