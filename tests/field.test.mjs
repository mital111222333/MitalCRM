// «Поле» (supabase/functions/field-watch/logic.ts): when a visit opens, stays, closes, which alerts are due, what LINKO shows.
// Synthetic data only. Node ≥ 23.6 runs the .ts file directly (type stripping).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../supabase/functions/field-watch/logic.ts';

const T0 = Date.parse('2026-11-28T05:00:00Z'); // 10:00 Tashkent
const cfg = { radius_m: 100, min_stop_s: 120, alerts: [15, 30, 45] };
const shop = { key: 'm1', name: 'Shop A', address: 'Fergana', lat: 40.3800, lon: 71.7800, planned: true };
const poi = { key: 'pB', name: 'Shop B', address: '', lat: 40.3900, lon: 71.7900, planned: false };
const places = [shop, poi];
const dev = (o = {}) => ({ id: '9', name: 'Адхамжон Наманган', lat: 40.38005, lon: 71.78005, speed: 0, ts: T0, stopS: 300, online: 'online', address: '', ...o });

test('stop duration of the GPS platform', () => {
  assert.equal(F.parseStop('25мин 41с'), 25 * 60 + 41);
  assert.equal(F.parseStop('118ч 24мин 55с'), 118 * 3600 + 24 * 60 + 55);
  assert.equal(F.parseStop('6с'), 6);
  assert.equal(F.parseStop('1д 2ч'), 26 * 3600);
  assert.equal(F.parseStop(''), 0);
});

test('GPS device names find their LINKO agents', () => {
  const agents = [{ id: '199', name: 'Adxamjon Umarov' }, { id: '211', name: 'Abdulmutallib Sobirov' }, { id: '212', name: 'Qahramonjon Abduxakimov' }, { id: '221', name: "Xamroxo'ja Abduvaliyev" }];
  assert.equal(F.matchAgent('Адхамжон Наманган', agents), '199');
  assert.equal(F.matchAgent('Абдулмутоллиб Фаргона', agents), '211');
  assert.equal(F.matchAgent('Кахрамонжон Фаргона', agents), '212');
  assert.equal(F.matchAgent('Хамрохўжа Наманган', agents), '221');
  assert.equal(F.matchAgent('Бобур самарканд', agents), null);
});

test('standing 5 min near a route client opens a visit from the start of the stop', () => {
  const s = F.step(dev(), null, null, places, cfg, T0 + 30000);
  assert.equal(s.kind, 'open');
  assert.equal(s.visit.place_key, 'm1');
  assert.equal(s.visit.planned, true);
  assert.equal(s.visit.started_at, new Date(T0 - 300000).toISOString());
  assert.deepEqual(s.due, []);
});

test('no visit: driving, standing too short, far from clients, parked for hours, old GPS point', () => {
  assert.equal(F.step(dev({ speed: 30 }), null, null, places, cfg, T0).kind, 'none');
  assert.equal(F.step(dev({ stopS: 60 }), null, null, places, cfg, T0).kind, 'none');
  assert.equal(F.step(dev({ lat: 40.40, lon: 71.70 }), null, null, places, cfg, T0).kind, 'none');
  assert.equal(F.step(dev({ stopS: 5 * 3600 }), null, null, places, cfg, T0).kind, 'none');
  assert.equal(F.step(dev(), null, null, places, cfg, T0 + 31 * 60000).kind, 'none');
});

test('a route client wins over a nearer map point only within 25 m', () => {
  const near = { ...poi, lat: 40.38010, lon: 71.78010 };
  assert.equal(F.nearest([shop, near], 40.38010, 71.78010, 100).place.key, 'm1');
  const far = { ...shop, lat: 40.3794, lon: 71.7800 }; // ~70 m away
  assert.equal(F.nearest([far, near], 40.38010, 71.78010, 100).place.key, 'pB');
});

const openV = (o = {}) => ({ id: 5, device_id: '9', place_key: 'm1', place_name: 'Shop A', planned: true, lat: shop.lat, lon: shop.lon, started_at: new Date(T0).toISOString(), last_seen_at: new Date(T0).toISOString(), ended_at: null, alerts: [], ...o });

test('alerts at 15, 30 and 45 minutes, each once', () => {
  const at = m => T0 + m * 60000;
  let s = F.step(dev({ ts: at(14) }), openV(), null, places, cfg, at(14));
  assert.deepEqual([s.kind, s.due], ['stay', []]);
  s = F.step(dev({ ts: at(15) }), openV(), null, places, cfg, at(15));
  assert.deepEqual(s.due, [15]);
  s = F.step(dev({ ts: at(31) }), openV({ alerts: [15] }), null, places, cfg, at(31));
  assert.deepEqual(s.due, [30]);
  s = F.step(dev({ ts: at(50) }), openV({ alerts: [15, 30, 45] }), null, places, cfg, at(50));
  assert.deepEqual(s.due, []);
});

test('GPS jitter inside the radius does not end a visit; driving away does', () => {
  const at = T0 + 10 * 60000;
  assert.equal(F.step(dev({ ts: at, speed: 6 }), openV(), null, places, cfg, at).kind, 'stay');
  const s = F.step(dev({ ts: at, speed: 40, lat: 40.3830, lon: 71.7800 }), openV({ last_seen_at: new Date(at - 60000).toISOString() }), null, places, cfg, at);
  assert.equal(s.kind, 'close');
  assert.equal(s.ended_at, new Date(at - 60000).toISOString());
  assert.equal(s.lost, false);
});

test('leaving one client and standing at another closes the first and opens the second', () => {
  const at = T0 + 20 * 60000;
  const s = F.step(dev({ ts: at, lat: poi.lat, lon: poi.lon, stopS: 180 }), openV({ last_seen_at: new Date(at - 4 * 60000).toISOString() }), null, places, cfg, at);
  assert.equal(s.kind, 'close');
  assert.equal(s.then.kind, 'open');
  assert.equal(s.then.visit.place_key, 'pB');
});

test('coming back to the same client within 10 min continues the visit', () => {
  const ended = T0 + 20 * 60000;
  const recent = openV({ ended_at: new Date(ended).toISOString(), alerts: [15] });
  const s = F.step(dev({ ts: ended + 5 * 60000, stopS: 30 }), null, recent, places, cfg, ended + 5 * 60000);
  assert.equal(s.kind, 'reopen');
  assert.equal(s.id, 5);
});

test('no GPS for 40 min: still at the client but stale; for 70 min: closed at the last point', () => {
  const s = F.step(dev({ ts: T0 }), openV(), null, places, cfg, T0 + 40 * 60000);
  assert.equal(s.kind, 'stay'); assert.equal(s.stale, true); assert.deepEqual(s.due, [15, 30]);
  const c = F.step(dev({ ts: T0 + 5 * 60000 }), openV(), null, places, cfg, T0 + 70 * 60000);
  assert.equal(c.kind, 'close'); assert.equal(c.lost, true); assert.equal(c.ended_at, new Date(T0 + 5 * 60000).toISOString());
});

test('LINKO route stops and the outcome of a visit (Tashkent times)', () => {
  const plan = [{ market: { id: 1, name: 'Shop A', address: 'Fergana', location: { lat: shop.lat, lon: shop.lon } }, plans: [
    { type: 'visit', text: 'Следует посетить', status: 'done', done_time: '2026-11-28T10:05:00' },
    { type: 'order', text: 'Оформили заказ №1: 909.68 USD', status: 'done', done_time: '2026-11-28T10:20:00.123' },
    { type: 'payment', text: 'Оплатили 100 USD', status: 'done', done_time: '2026-11-28T10:22:00' },
    { type: 'rejection', text: 'Отказ: вчерашний', status: 'done', done_time: '2026-11-27T10:22:00' },
  ] }, { market: { id: 2, name: 'No coords', location: null }, plans: [] }];
  const stops = F.stopsOf(plan);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].tasks[1].at, Date.parse('2026-11-28T05:20:00.123Z'));
  const v = openV({ ended_at: new Date(T0 + 25 * 60000).toISOString() });
  const out = F.outcomeOf(v, stops);
  assert.deepEqual(out.map(t => t.type), ['order', 'payment']);
  const msg = F.msgExit('Адхамжон', v, out, false, false);
  assert.match(msg, /вышел от <b>Shop A<\/b>: 25 мин \(10:00–10:25\)/);
  assert.match(msg, /🛒 Оформили заказ №1: 909\.68 USD/);
  assert.match(F.msgExit('A', v, [], true, false), /ничего не отмечено/);
});

test('a day from the GPS track history: client stops, other stops, km, first and last move', () => {
  const pt = (lat, lon) => ({ latitude: lat, longitude: lon });
  const h = { distance_sum: '60.95 Км', move_duration: '2ч 27мин 26с', stop_duration: '10ч 37мин 0с', items: [
    { status: 3, raw_time: '2026-11-27 07:21:59' },
    { status: 2, raw_time: '2026-11-27 07:21:59', time_seconds: 4987, items: [pt(40.30, 71.70)] },               // home: no client
    { status: 1, raw_time: '2026-11-27 08:45:06', time_seconds: 1819, items: [] },
    { status: 2, raw_time: '2026-11-27 09:15:25', time_seconds: 1724, items: [pt(40.38001, 71.78001), pt(40.38003, 71.78002), pt(40.5, 71.5)] },
    { status: 1, raw_time: '2026-11-27 09:44:09', time_seconds: 730, items: [] },
    { status: 2, raw_time: '2026-11-27 09:56:19', time_seconds: 60, items: [pt(40.39, 71.79)] },                // too short
    { status: 1, raw_time: '2026-11-27 18:22:18', time_seconds: 162, items: [] },
  ] };
  const d = F.dayFromHistory(h, places, 100, 120);
  assert.equal(d.km, 60.95);
  assert.equal(d.move_s, 2 * 3600 + 27 * 60 + 26);
  assert.equal(d.first_at, '2026-11-27T03:45:06.000Z');
  assert.equal(d.last_at, '2026-11-27T13:25:00.000Z');
  assert.equal(d.stops.length, 2);
  assert.deepEqual([d.stops[0].key, d.stops[1].key, d.stops[1].planned], ['', 'm1', true]);
  assert.equal(d.stops[1].a, '2026-11-27T04:15:25.000Z');
  assert.equal(d.stops[1].b, '2026-11-27T04:44:09.000Z');
});

test('working mileage 07–22 from home and back home; a drive across the edge counts by its part inside', () => {
  const pt = (lat, lon) => ({ latitude: lat, longitude: lon });
  const home = pt(40.30, 71.70);
  const h = { items: [
    { status: 2, raw_time: '2026-11-27 00:00:00', time_seconds: 6 * 3600 + 30 * 60, items: [home] },      // night at home
    { status: 1, raw_time: '2026-11-27 06:30:00', time_seconds: 3600, distance: '20' },                    // 06:30–07:30: half inside
    { status: 2, raw_time: '2026-11-27 07:30:00', time_seconds: 3600, items: [pt(40.38, 71.78)] },
    { status: 1, raw_time: '2026-11-27 08:30:00', time_seconds: 1800, distance: '15.5' },
    { status: 2, raw_time: '2026-11-27 18:00:00', time_seconds: 3600, items: [pt(40.3001, 71.7001)] },     // back home
    { status: 1, raw_time: '2026-11-27 21:30:00', time_seconds: 3600, distance: '40' },                    // 21:30–22:30: half inside
    { status: 1, raw_time: '2026-11-27 23:00:00', time_seconds: 1800, distance: '30' },                    // after 22: not work
  ] };
  const w = F.workFromHistory(h, '2026-11-27');
  assert.equal(w.work_km, 10 + 15.5 + 20);
  assert.equal(w.home_out, '2026-11-27T01:30:00.000Z');
  assert.equal(w.home_in, '2026-11-27T13:00:00.000Z');
});

test('a LINKO mark goes to the visit nearest in time, not to both visits of the same client', () => {
  const t = { type: 'order', text: 'Оформили заказ №1: 10 USD', status: 'done', at: Date.parse('2026-11-27T10:20:00Z') };
  const s1 = { a: '2026-11-27T10:00:00Z', b: '2026-11-27T10:25:00Z', lat: 0, lon: 0, key: 'm1', name: 'A', planned: true, out: [t] };
  const s2 = { ...s1, a: '2026-11-27T11:00:00Z', b: '2026-11-27T11:10:00Z', out: [t] };
  const r = F.assignOutcomes([s1, s2]);
  assert.equal(r[0].out.length, 1); assert.equal(r[1].out.length, 0);
});

test('messages escape names', () => {
  const v = openV({ place_name: '<b>x</b> & y' });
  assert.match(F.msgEnter('A', v, T0 + 5 * 60000), /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
  assert.match(F.msgAlert('A', v, 45, T0 + 45 * 60000, false), /^⚠️/);
});
