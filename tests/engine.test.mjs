// Regression tests for the CRM numbers (engine.bundle.js): an update must never change how LINKO files are read or how money is summed.
// Run: node --test tests/      (Node 18+, no packages needed). All data here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// the bundle returns only the engine; the test build also hands out the module loader to reach util/parse/agents directly
const src = readFileSync(new URL('../engine.bundle.js', import.meta.url), 'utf8');
assert.ok(src.includes("return load('engine');"), 'engine.bundle.js changed shape: update the loader in this test');
const ctx = { window: {}, TextDecoder, TextEncoder, DecompressionStream, Blob, Response, console, URL, URLSearchParams };
vm.createContext(ctx);
vm.runInContext(src.replace("return load('engine');", 'return { load, engine: load("engine") };'), ctx);
const { load } = ctx.window.CRMEngine;
const util = load('util'), parse = load('parse'), agents = load('ag-calc');
const { createEngine } = load('engine');

const cents = x => Math.round(x * 100);

test('N reads LINKO number formats', () => {
  assert.equal(util.N('1 234,5'), 1234.5);
  assert.equal(util.N('1 234 567,89'), 1234567.89);
  assert.equal(util.N('1.234,56'), 1234.56);
  assert.equal(util.N('1,234.56'), 1234.56);
  assert.equal(util.N('1,234,567'), 1234567);
  assert.equal(util.N('-5 692'), -5692);
  assert.equal(util.N(''), 0);
  assert.equal(util.N(null), 0);
  assert.equal(util.N('abc'), 0);
  assert.equal(util.N(Infinity), 0);
});

test('dates: addDays / daysBetween across month and year ends', () => {
  assert.equal(util.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(util.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(util.daysBetween('2026-10-16', '2026-11-15'), 30);
});

test('company plan period 16 → 15', () => {
  const end = pf => agents.forecast({ period_from: pf, period_to: pf }).period_end;
  assert.equal(end('2026-10-16'), '2026-11-15');
  assert.equal(end('2026-11-16'), '2026-12-15');
  assert.equal(end('2026-12-16'), '2027-01-15');
  assert.equal(end('2027-01-16'), '2027-02-15');
  assert.equal(end('2026-10-01'), '2026-10-31');
  const f = agents.forecast({ period_from: '2026-10-16', period_to: '2026-10-20' });
  assert.deepEqual({ ...f }, { projectable: true, elapsed: 5, month_days: 31, days_left: 26, period_end: '2026-11-15' });
  assert.equal(agents.forecast({ period_from: '2026-10-16', period_to: '2026-11-16' }).projectable, false);
});

// a synthetic «Баланс клиентов» export the way LINKO writes it: a title row, Latin look-alikes in headers, «Продано» negative
const header = ['№', 'Клиент', 'Тип', 'Агент', 'Баланс на начало периода', 'Продано', 'Возврат', 'Оплачено', 'Баланс на конец периода'];
const linkoRows = [
  [1, 'Магазин Нур', 'Магазин', 'Агент А', '-1 000,10', '-2 500,25', '0', '1 200,05', '-2 300,30'],
  [2, 'Ташкент Савдо', 'Магазин', 'Агент А', 0, -0.1, 0, 0.2, 0.1],
  [3, 'Магазин Нур', 'Магазин', 'Агент Б', -300, -0.2, 0, 0.1, -300.1],
  [4, 'Бозор', 'Рынок', 'Агент Б', 500, 0, 0, 0, 500],
  ['', 'Итого', '', '', -800.1, -2500.55, 0, 1200.35, -2100.3],
];
const sheet = () => [{ name: 'Баланс', rows: [['Баланс клиентов за период'], header, ...linkoRows] }];

test('parseBalance: sale becomes positive, totals row skipped, namesakes kept apart', () => {
  const { rows } = parse.parseBalance(sheet());
  assert.equal(rows.length, 4);
  assert.deepEqual([...rows.map(r => r.name)], ['Магазин Нур', 'Ташкент Савдо', 'Магазин Нур (№3)', 'Бозор']);
  assert.equal(rows[0].sold, 2500.25);
  assert.equal(rows[0].b0, -1000.1);
  assert.equal(rows[0].b1, -2300.3);
});

test('parseBalance: headers with Latin look-alike letters are found', () => {
  const s = sheet(); s[0].rows[1] = header.map(h => h.replace('Клиент', 'Kлиент').replace('Продано', 'Пpодано'));
  assert.equal(parse.parseBalance(s).rows.length, 4);
});

test('parseBalance: a wrong file is refused, not read as zeros', () => {
  assert.throws(() => parse.parseBalance([{ name: 'x', rows: [['Товар', 'Остаток'], ['A', 1]] }]), /Баланс клиентов/);
});

test('agent totals match the LINKO file to the cent', () => {
  const { rows } = parse.parseBalance(sheet());
  const m = agents.aggregate(rows.map(r => ({ ...r, client: r.name })), parse.AKB_RULES.paid);
  const a = m.get('Агент А'), b = m.get('Агент Б');
  assert.equal(cents(a.sold), 250035);
  assert.equal(cents(a.paid), 120025);
  assert.equal(cents(a.debt), 230030);
  assert.equal(a.debtors, 1);
  assert.equal(a.akb, 2);
  assert.equal(cents(b.debt), 30010);
  assert.equal(b.akb, 1);
  assert.equal(b.okb, 2);
  // whole file: sum of agents = the «Итого» row LINKO printed
  const tot = k => cents([...m.values()].reduce((s, x) => s + x[k], 0));
  assert.equal(tot('sold'), 250055);
  assert.equal(tot('paid'), 120035);
});

test('АКБ rules', () => {
  const r = { paid: 0, sold: 5 };
  assert.equal(parse.AKB_RULES.paid(r), false);
  assert.equal(parse.AKB_RULES.sold(r), true);
  assert.equal(parse.AKB_RULES.any(r), true);
});

test('state survives export → import unchanged (what every cloud save does)', () => {
  const e1 = createEngine();
  const s = JSON.parse(e1.exportState());
  s.ag.clients['Магазин Нур'] = { agent: 'Агент А', phone: '+998 90 000 00 00' };
  s.ag.tasks.push({ id: 1, client: 'Магазин Нур', kind: 'Сбор оплаты', target: 1200.05, base: 0 });
  const e2 = createEngine(); e2.importState(s);
  const e3 = createEngine(); e3.importState(e2.exportState());
  assert.equal(e3.exportState(), e2.exportState());
  assert.deepEqual({ ...e3.summary() }, { wh: 0, ag: 0, clients: 1, tasks: 1 });
});

// a history file (a closed period older than the newest one) goes to the reports only: it never moves a client back to an old agent
test('history upload: stored for its period, client cards untouched', async () => {
  const csv = rows => new TextEncoder().encode([header.join(';'), ...rows.map(r => r.join(';'))].join('\n'));
  const e = createEngine();
  const up = (q, rows) => e.request('POST', '/api/ag/upload?' + new URLSearchParams({ file: 'balance.csv', ...q }), { raw: csv(rows) }).then(r => r.json);
  const cur = await up({ date: '2026-11-20', from: '2026-11-16', to: '2026-11-20' }, [[1, 'Бозор', 'Рынок', 'Агент Б', 500, -100, 0, 50, 450]]);
  assert.equal(cur.ok, true); assert.equal(cur.history, false);
  e.getState().ag.clients['Бозор'].phone = '+998 90 111 11 11';
  const old = await up({ date: '2026-02-15', from: '2026-01-16', to: '2026-02-15' }, [
    [1, 'Бозор', 'Магазин', 'Агент А', 0, '-1 000,50', 0, '400,25', '-600,25'],
    [2, 'Старый клиент', 'Магазин', 'Агент А', 0, -10, 0, 0, -10],
  ]);
  assert.equal(old.ok, true); assert.equal(old.history, true);
  assert.deepEqual({ ...old.period }, { from: '2026-01-16', to: '2026-02-15' });
  const S = e.getState(), c = S.ag.clients['Бозор'];
  assert.equal(c.agent, 'Агент Б'); assert.equal(c.type, 'Рынок'); assert.equal(c.phone, '+998 90 111 11 11');
  const h = S.ag.uploads.find(u => u.period_from === '2026-01-16');
  assert.equal(h.taken_at, '2026-02-15');
  assert.equal(cents(h.sold), 101050); assert.equal(cents(h.paid), 40025);
  assert.equal(h.rows.find(r => r.client === 'Бозор').agent, 'Агент А'); // history keeps who worked the client then
  assert.ok(S.ag.clients['Старый клиент']);
  // a repeated file for the same period replaces the earlier one
  await up({ date: '2026-02-15', from: '2026-01-16', to: '2026-02-15' }, [[1, 'Бозор', 'Магазин', 'Агент А', 0, -5, 0, 0, -5]]);
  assert.equal(e.getState().ag.uploads.filter(u => u.period_from === '2026-01-16').length, 1);
  // the newest period still updates the cards as before
  const nw = await up({ date: '2026-11-21', from: '2026-11-16', to: '2026-11-21' }, [[1, 'Бозор', 'Рынок', 'Агент В', 450, 0, 0, 0, 450]]);
  assert.equal(nw.history, false); assert.equal(e.getState().ag.clients['Бозор'].agent, 'Агент В');
});
