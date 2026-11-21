// deno test -A index.test.ts — no network: Supabase, Telegram and Gemini are replaced by a fake fetch.
// deno-lint-ignore-file no-explicit-any
const E = (globalThis as any).Deno.env;
E.set('TEAM_BOT_TEST', '1'); E.set('SUPABASE_URL', 'https://sb.test'); E.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test'); E.set('TEAM_TG_TOKEN', '123:test-token'); E.set('TEAM_GEMINI_KEY', 'keyAAAAAA1, keyBBBBBB2'); E.set('GEMINI_KEY', 'OWNERKEY');
const M = await import('./index.ts');
const eq = (a: any, b: any, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n got ${JSON.stringify(a)}\nwant ${JSON.stringify(b)}`); };
const ok = (v: any, msg = '') => { if (!v) throw new Error(msg || 'expected true'); };

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
const addD = (k: number) => new Date(Date.parse(today + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const CAB_A = {
  agent: 'Fozil Agentov', at: '2026-11-20T08:00:00Z', period: { from: '2026-11-16', to: '2026-12-15', days_left: 25 },
  kpi: { plan: 40000, sold: 1200, paid: 900, debt: 15000 }, day: { sell: 100, collect: 50 },
  board: [{ place: 1, agent: 'Other Agent', sold: 5000, paid: 1, me: false }, { place: 2, agent: 'Fozil Agentov', sold: 1200, paid: 900, me: true }],
  clients: [
    { name: 'Fozilxon Fargona', debt: 12444.52, sold: 0, paid: 0, lastBuy: addD(-41), lastPay: addD(-4), phone: '+998900000001', promise: null },
    { name: 'Iqbol Fargona', debt: 0, sold: 800, paid: 300, lastBuy: addD(-2), lastPay: addD(-2), phone: '+998900000002', promise: { d: addD(1), s: 50 } },
    { name: 'Nasibilloh Quva', debt: 2555.48, sold: 400, paid: 600, lastBuy: addD(-10), lastPay: addD(-40), phone: '+998900000003', promise: null },
  ],
  cards: { 'Fozilxon Fargona': { old: 0, ord: [{ d: '2026-10-10', s: 3170, id: '1', left: 3170, st: 'late' }], pay: [{ d: addD(-4), s: 100 }], ret: [], days: [{ d: addD(-1), b: -12444.52 }] } },
  cal: [
    { d: addD(-3), s: 104, st: 'late', kind: 'spec', client: 'Fozilxon Fargona', why: 'часть 3 из 4' },
    { d: addD(2), s: 50, st: 'wait', kind: 'prom', client: 'Iqbol Fargona' },
    { d: addD(30), s: 999, st: 'wait', kind: 'ct', client: 'Nasibilloh Quva' },
    { d: addD(-20), s: 10, st: 'paid', kind: 'spec', client: 'Iqbol Fargona' },
  ],
  route: { 1: { zone: 'Quva', clients: ['Nasibilloh Quva'] }, 3: { zone: '', clients: ['Fozilxon Fargona', 'Iqbol Fargona'] } },
  stock: { warehouse: 'Фергана', at: today, items: [{ art: 'GB 5W-30 4L', name: 'GOLDEN BOOSTER 5W-30 4L', brand: 'GB', total: 10, available: 6 }, { art: 'FLT', name: 'Открыватель фильтров', brand: '', total: 1, available: 0 }] },
  pay: { label: '16.10–15.11.2026', total: 8257560, lines: [['Фикс', '$400']] },
  disc: { late: 0, early: 3, fine: 0, route: 0.25, days: [{ day: addD(-1), first: '08:42' }] },
  queue: [{ name: 'Fozilxon Fargona', debt: 1, why: 'сорвал обещание' }, { name: 'Iqbol Fargona', debt: 50, why: 'x' }],
  tasks: [],
};

// ── fake network ──
let calls: { url: string; method: string; body?: any; headers?: any }[] = [];
let state: any;
function reset() {
  calls = [];
  state = {
    users: [{ chat_id: 100, user_id: A, profiles: { full_name: 'Fozil', role: 'agent', is_active: true, linko_name: 'Fozil Agentov' } },
            { chat_id: 300, user_id: B, profiles: { full_name: 'Off', role: 'agent', is_active: false, linko_name: 'Off' } }],
    cabinets: { [A]: CAB_A, [B]: { ...CAB_A, agent: 'OTHER AGENT B', clients: [{ name: 'SECRET CLIENT B', debt: 777 }] } },
    sent: [] as any[], links: [] as any[], profiles: { [A]: { role: 'agent', is_active: true }, [B]: { role: 'supervisor', is_active: true } },
    gemini: [] as any[],
  };
}
// deno-lint-ignore require-await
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body, headers: init.headers });
  const J = (v: any, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.telegram.org/')) {
    const m = url.split('/').pop();
    if (m === 'sendMessage') state.sent.push(body);
    if (m === 'getMe') return J({ ok: true, result: { username: 'mital_team_bot' } });
    return J({ ok: true, result: {} });
  }
  if (url.includes('generativelanguage')) { (state.keys ||= []).push(init.headers['x-goog-api-key']); if (state.over503 && (state.over503 === '*' || url.includes(state.over503))) return J({ error: { code: 503, message: 'This model is currently experiencing high demand.' } }, 503); if (state.quota429?.includes(init.headers['x-goog-api-key'])) return J({ error: { code: 429, message: 'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel' } }, 429); const r = state.gemini.shift() || { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }; state.lastGeminiBody = body; return J(r); }
  if (url === 'https://sb.test/auth/v1/user') { const tok = String(init.headers?.Authorization || '').replace('Bearer ', ''); return tok === 'tokA' ? J({ id: A }) : tok === 'tokB' ? J({ id: B }) : J({}, 401); }
  const path = url.replace('https://sb.test/rest/v1/', '');
  if (path.startsWith('team_users?chat_id=eq.') && method === 'GET') { const id = +path.match(/chat_id=eq\.(\d+)/)![1]; return J(state.users.filter((u: any) => u.chat_id === id)); }
  if (path.startsWith('team_users?user_id=eq.')) return J([]);
  if (path.startsWith('agent_cabinets?')) { const id = path.match(/agent_id=eq\.([0-9a-f-]+)/)![1]; return J(state.cabinets[id] ? [{ data: state.cabinets[id] }] : []); }
  if (path.startsWith('profiles?')) { const id = path.match(/id=eq\.([0-9a-f-]+)/)![1]; return J(state.profiles[id] ? [state.profiles[id]] : []); }
  if (path === 'team_links' && method === 'POST') { state.links.push(body); return J(null, 201); }
  if (path.startsWith('team_usage?')) return J([{ requests: state.usage || 0 }]);
  if (path === 'rpc/team_usage_add') return J(1);
  if (path.startsWith('rpc/team_cron_check')) return J(body.p === 'good');
  if (method === 'GET') return J([]);
  return J(null, 201);
};

Deno.test('isolation: the cabinet is fetched only by the linked user id, never another one', async () => {
  reset();
  const who = await M.whoIs(100); eq(who?.user_id, A);
  const cab = await M.cabinetOf(who!.user_id);
  eq(cab.agent, 'Fozil Agentov');
  const cabCalls = calls.filter(c => c.url.includes('agent_cabinets'));
  eq(cabCalls.length, 1); ok(cabCalls[0].url.includes(`agent_id=eq.${A}`) && !cabCalls[0].url.includes(B), cabCalls[0].url);
  ok(!calls.some(c => /workspaces|crm_|ai_/.test(c.url)), 'never touches the owner data');
});
Deno.test('isolation: no tool takes an agent, user or chat parameter', () => {
  for (const d of M.declarations as any[]) {
    const props = Object.keys(d.parameters?.properties || {});
    ok(!props.some(p => /agent|user|chat|owner|workspace/i.test(p)), `${d.name} has ${props}`);
  }
});
Deno.test('isolation: a rejected cabinet id format never reaches the database', async () => {
  reset(); eq(await M.cabinetOf("x' or 1=1"), null); eq(calls.length, 0);
});
Deno.test('switched-off login and non-agents get no assistant', async () => {
  reset();
  eq(await M.whoIs(300), null);
  eq(await M.whoIs(999), null);
});
Deno.test('store keeper cabinet is not served', async () => {
  reset(); const C = '33333333-3333-3333-3333-333333333333'; state.cabinets[C] = { role: 'store', items: 69 };
  eq(await M.cabinetOf(C), null);
  ok(calls.some(c => c.url.includes(`agent_id=eq.${C}`)), 'the row was really read and rejected');
});
Deno.test('unlinked chat is told how to connect and no data is read', async () => {
  reset();
  await M.handle({ update_id: 1, message: { chat: { id: 555, type: 'private' }, text: 'qarzlarim' } });
  eq(state.sent.length, 1); ok(state.sent[0].text.includes('Мой ассистент'));
  ok(!calls.some(c => c.url.includes('agent_cabinets')));
});
Deno.test('group chats are ignored', async () => {
  reset(); await M.handle({ update_id: 2, message: { chat: { id: -5, type: 'group' }, text: 'hi' } }); eq(calls.length, 0);
});

Deno.test('my_clients: debtors sorted by debt, totals', () => {
  const r = M.TOOLS.my_clients.run(CAB_A, { filter: 'debtors' }, { chatId: 1 });
  eq(r.rows.map((x: any) => x.name), ['Fozilxon Fargona', 'Nasibilloh Quva']); eq(r.debt_total, 15000);
});
Deno.test('my_clients: no_pay 30 days', () => {
  const r = M.TOOLS.my_clients.run(CAB_A, { filter: 'no_pay', days: 30 }, { chatId: 1 });
  eq(r.rows.map((x: any) => x.name), ['Nasibilloh Quva']);
});
Deno.test('client_card: Cyrillic name finds the Latin client', () => {
  const r = M.TOOLS.client_card.run(CAB_A, { client: 'Фозилхон' }, { chatId: 1 });
  eq(r.client, 'Fozilxon Fargona'); eq(r.balance_now, -12444.52); eq(r.calendar.length, 1);
});
Deno.test('client_card: a client of another agent is not found', () => {
  const r = M.TOOLS.client_card.run(CAB_A, { client: 'SECRET CLIENT B' }, { chatId: 1 });
  ok(r.error, JSON.stringify(r));
});
Deno.test('my_payments: open = late + next 7 days, paid hidden', () => {
  const r = M.TOOLS.my_payments.run(CAB_A, {}, { chatId: 1 });
  eq(r.rows.map((x: any) => x.s), [104, 50]); eq(r.late_sum, 104);
  eq(M.TOOLS.my_payments.run(CAB_A, { status: 'late' }, { chatId: 1 }).count, 1);
});
Deno.test('my_route: by weekday number and date', () => {
  eq(M.TOOLS.my_route.run(CAB_A, { day: '1' }, { chatId: 1 }).clients[0].name, 'Nasibilloh Quva');
  eq(M.TOOLS.my_route.run(CAB_A, { day: '2026-11-18' }, { chatId: 1 }).clients.length, 2); // Wednesday
  ok(M.TOOLS.my_route.run(CAB_A, { day: '2026-11-22' }, { chatId: 1 }).note); // Sunday
});
Deno.test('my_stock: search and only available', () => {
  eq(M.TOOLS.my_stock.run(CAB_A, { query: '5w30' }, { chatId: 1 }).rows[0].available, 6);
  eq(M.TOOLS.my_stock.run(CAB_A, { only_available: true }, { chatId: 1 }).found, 1);
});
Deno.test('my_queue uses fresh debts and drops paid-off clients', () => {
  const r = M.TOOLS.my_queue.run(CAB_A, {}, { chatId: 1 });
  eq(r.rows.map((x: any) => [x.name, x.debt]), [['Fozilxon Fargona', 12444.52]]);
});
Deno.test('my_summary shows own place', () => { eq(M.TOOLS.my_summary.run(CAB_A, {}, { chatId: 1 }).place, 2); });

Deno.test('a question goes to Gemini with the tools, the tool reads the own cabinet', async () => {
  reset();
  state.gemini.push({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'my_clients', args: { filter: 'debtors' } } }] } }] });
  state.gemini.push({ candidates: [{ content: { role: 'model', parts: [{ text: '**Qarzdorlar:**\n- Fozilxon' }] } }] });
  await M.handle({ update_id: 3, message: { chat: { id: 100, type: 'private' }, text: 'kim qarzdor?' } });
  const last = state.sent.at(-1).text; eq(last, 'Qarzdorlar:\n• Fozilxon');
  const fr = JSON.stringify(state.lastGeminiBody.contents);
  ok(fr.includes('Fozilxon Fargona') && !fr.includes('SECRET CLIENT B'), 'only own clients go to the AI');
  ok(JSON.stringify(state.lastGeminiBody.systemInstruction).includes('Fozil Agentov'));
});
Deno.test('daily limit stops the AI', async () => {
  reset(); state.usage = 9999;
  await M.handle({ update_id: 4, message: { chat: { id: 100, type: 'private' }, text: 'reja?' } });
  ok(state.sent.at(-1).text.includes('limit'));
  ok(!calls.some(c => c.url.includes('generativelanguage')));
});

Deno.test('link: only a signed-in agent gets a code', async () => {
  reset();
  const call = (tok: string) => M.linkApi(new Request('https://f/team-bot?act=link', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {} }));
  eq((await call('')).status, 401);
  eq((await call('bad')).status, 401);
  eq((await call('tokB')).status, 403); // supervisor
  const r = await call('tokA'); eq(r.status, 200);
  const j = await r.json(); ok(/^https:\/\/t\.me\/mital_team_bot\?start=[0-9a-f]{32}$/.test(j.url), j.url);
  eq(state.links[0].user_id, A);
});
Deno.test('webhook: wrong secret is refused, right one accepted', async () => {
  reset();
  const bad = await M.serve(new Request('https://f/team-bot', { method: 'POST', body: '{}', headers: { 'x-telegram-bot-api-secret-token': 'nope' } }));
  eq(bad.status, 403);
  const good = await M.serve(new Request('https://f/team-bot', { method: 'POST', body: JSON.stringify({ update_id: 77, message: { chat: { id: 555, type: 'private' }, text: 'hi' } }), headers: { 'x-telegram-bot-api-secret-token': await M.webhookSecret() } }));
  eq(good.status, 200);
});
Deno.test('cron: wrong password refused', async () => {
  reset();
  eq((await M.serve(new Request('https://f/team-bot?cron=1', { method: 'POST', headers: { 'x-team-cron': 'bad' } }))).status, 403);
  eq((await M.serve(new Request('https://f/team-bot?cron=1', { method: 'POST', headers: { 'x-team-cron': 'good' } }))).status, 200);
});
Deno.test('local time → UTC (Tashkent +5)', () => {
  eq(M.localToUtc('2026-11-21T10:00')?.toISOString(), '2026-11-21T05:00:00.000Z');
  eq(M.localToUtc('2026-02-30T10:00'), null);
});
Deno.test('secrets never leak into logs', () => { eq(M.redact('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ/x'), 'https://api.telegram.org/bot***/x'); });

Deno.test('keys: the owner key is never used; a spent key moves to the next one', async () => {
  reset(); state.quota429 = ['keyAAAAAA1'];
  const d1 = await M.gemini({ contents: [] }), d2 = await M.gemini({ contents: [] });
  ok(d1.candidates && d2.candidates);
  ok(!state.keys.includes('OWNERKEY'), 'owner key used!');
  ok(state.keys.includes('keyBBBBBB2'));
  eq(state.keys.filter((k: string) => k === 'keyAAAAAA1').length <= 2, true, 'spent key is skipped afterwards');
});
Deno.test('keys: all keys spent → a clear team message', async () => {
  reset(); state.quota429 = ['keyAAAAAA1', 'keyBBBBBB2'];
  let msg = ''; try { await M.gemini({ contents: [] }); } catch (e) { msg = (e as any).user; }
  ok(msg.includes('команду') || msg.includes('jamoaning'), msg);
});
Deno.test('keys: no team key → never falls back to the owner key', async () => {
  reset(); E.set('TEAM_GEMINI_KEY', '');
  let msg = ''; try { await M.gemini({ contents: [] }); } catch (e) { msg = (e as any).user; }
  E.set('TEAM_GEMINI_KEY', 'keyAAAAAA1, keyBBBBBB2');
  eq(msg, M.NO_KEY); ok(!(state.keys || []).length, 'no request was sent');
});
Deno.test('503 high demand: the fallback model answers', async () => {
  reset(); M._resetSpent(); state.over503 = 'gemini-3.1-flash-lite';
  const d = await M.gemini({ contents: [] }); ok(d.candidates, 'fallback answered');
});
Deno.test('503 everywhere: a plain «overloaded» message, not Google text', async () => {
  reset(); M._resetSpent(); state.over503 = '*';
  let msg = ''; try { await M.gemini({ contents: [] }); } catch (e) { msg = (e as any).user; }
  ok(msg.includes('перегружен') && !msg.includes('high demand'), msg);
});
