// field-watch: pure logic (no network) — when an agent is «at a client», when he left, which alerts are due, what LINKO shows.
// Tested by tests/field.test.mjs (Node runs this file directly: only erasable TypeScript types are used here).

export type Place = { key: string; name: string; address: string; lat: number; lon: number; planned: boolean };
export type Dev = { id: string; name: string; lat: number; lon: number; speed: number; ts: number; stopS: number; online: string; address: string };
export type Visit = {
  id?: number; device_id: string; place_key: string; place_name: string; address?: string | null; planned: boolean;
  lat: number; lon: number; started_at: string; last_seen_at: string; ended_at: string | null; alerts: number[];
};
export type Cfg = { radius_m: number; min_stop_s: number; alerts: number[] };
export type Step =
  | { kind: 'none' }
  | { kind: 'stay'; last_seen_at: string; due: number[]; stale: boolean }
  | { kind: 'close'; ended_at: string; lost: boolean; then: Step }
  | { kind: 'open'; visit: Visit; due: number[] }
  | { kind: 'reopen'; id: number; last_seen_at: string; due: number[] };

export const MIN = 60000;
export const STALE_MS = 30 * MIN;   // no GPS point for 30 min: the agent is still counted at the client, but «нет связи» is shown
export const LOST_MS = 60 * MIN;    // no GPS point for an hour: the visit is closed at the last point
export const REOPEN_MS = 10 * MIN;  // came back to the same client within 10 min = the same visit
export const OLD_STOP_MS = 4 * 60 * MIN; // standing still longer than 4 h (parked overnight near a client) is not a visit
export const STILL_KMH = 3;
// not clients: «Adhamjon 007 Namangan» (an agent's own LINKO point, he marks «Ishga chiqdim» there), «Абдулмуттолиб уй» (home)
export const SELF_RE = /(^|[\s(])(007|уй|уйи|uy|uyi|дом|home)([\s).,]|$)/i;

// «25мин 41с», «118ч 24мин 55с», «6с», «1д 2ч» (GPSWOX stop_duration, Russian or English units) → seconds
export function parseStop(s: unknown): number {
  const t = String(s ?? '').toLowerCase();
  let n = 0;
  for (const m of t.matchAll(/(\d+)\s*(д|d|ч|h|мин|min|m|сек|с|sec|s)/g)) {
    const v = +m[1], u = m[2];
    n += u === 'д' || u === 'd' ? v * 86400 : u === 'ч' || u === 'h' ? v * 3600 : u === 'мин' || u === 'min' || u === 'm' ? v * 60 : v;
  }
  return n;
}

export function dist(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180, x = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLon - aLon) * r / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

// names: Cyrillic → Latin as in the CRM (route.js ROUTE.TR), then sounds that are written differently squashed together
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ў: 'o', ҳ: 'h' };
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[ʻʼ'`’‘´"]/g, '').replace(/[а-яёқғўҳ]/g, ch => TR[ch] ?? ch).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
const squash = (w: string) => w.replace(/q/g, 'k').replace(/h/g, 'x').replace(/o/g, 'a').replace(/(.)\1+/g, '$1');

export function lev(a: string, b: string): number {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// GPS device «Адхамжон Наманган» → LINKO agent «Adxamjon Umarov»: by the first name, allowing 2 letters of difference
// (Абдулмутоллиб / Abdulmutallib, Кахрамонжон / Qahramonjon). Two agents equally close → no guess.
export function matchAgent(devName: string, agents: { id: string; name: string }[]): string | null {
  const words = norm(devName).split(/\s+/).filter(w => w.length > 3).map(squash);
  if (!words.length) return null;
  let best: { id: string; d: number } | null = null, tie = false;
  for (const a of agents) {
    const first = squash(norm(a.name).split(/\s+/)[0] || '');
    if (first.length < 4) continue;
    const d = Math.min(...words.map(w => lev(w, first)));
    if (d > 2) continue;
    if (!best || d < best.d) { best = { id: a.id, d }; tie = false; } else if (d === best.d && a.id !== best.id) tie = true;
  }
  return best && !tie ? best.id : null;
}

// the nearest client within the radius; a client of the agent's own route wins over another point up to 25 m farther
export function nearest(places: Place[], lat: number, lon: number, radius: number): { place: Place; d: number } | null {
  let best: { place: Place; d: number; s: number } | null = null;
  for (const p of places) {
    const d = dist(lat, lon, p.lat, p.lon);
    if (d > radius) continue;
    const s = d - (p.planned ? 25 : 0);
    if (!best || s < best.s) best = { place: p, d, s };
  }
  return best ? { place: best.place, d: best.d } : null;
}

// alerts that are due now; when several are due at once (the visit was found late) only the biggest is sent, all are marked
export function dueAlerts(startedMs: number, nowMs: number, cfg: Cfg, sent: number[]): number[] {
  const el = (nowMs - startedMs) / MIN;
  return [...cfg.alerts].sort((a, b) => a - b).filter(m => el >= m && !sent.includes(m));
}

const iso = (ms: number) => new Date(ms).toISOString();

// one GPS reading of one device against its open visit (if any) and the visit to the same device that just ended
export function step(dev: Dev, open: Visit | null, recent: (Visit & { id: number }) | null, places: Place[], cfg: Cfg, now: number): Step {
  const age = now - dev.ts, still = dev.speed < STILL_KMH;
  if (open) {
    const dP = dist(dev.lat, dev.lon, open.lat, open.lon);
    // still there: standing within the radius + 60 m, or even moving slowly inside the radius (GPS jitter shows a few km/h)
    if (dP <= cfg.radius_m + 60 && (still || dP <= cfg.radius_m)) {
      if (age > LOST_MS) return { kind: 'close', ended_at: iso(Math.max(dev.ts, Date.parse(open.last_seen_at))), lost: true, then: { kind: 'none' } };
      const last = iso(Math.max(dev.ts, Date.parse(open.last_seen_at)));
      return { kind: 'stay', last_seen_at: last, due: dueAlerts(Date.parse(open.started_at), now, cfg, open.alerts || []), stale: age > STALE_MS };
    }
    if (dev.ts <= Date.parse(open.last_seen_at)) return { kind: 'stay', last_seen_at: open.last_seen_at, due: [], stale: age > STALE_MS }; // no new point
    const closed: Visit & { id: number } = { ...(open as Visit & { id: number }), ended_at: open.last_seen_at };
    return { kind: 'close', ended_at: open.last_seen_at, lost: false, then: step(dev, null, closed, places, cfg, now) };
  }
  if (!still || age > STALE_MS) return { kind: 'none' };
  const n = nearest(places, dev.lat, dev.lon, cfg.radius_m);
  if (!n) return { kind: 'none' };
  if (recent && recent.place_key === n.place.key && recent.ended_at && dev.ts - Date.parse(recent.ended_at) < REOPEN_MS)
    return { kind: 'reopen', id: recent.id, last_seen_at: iso(dev.ts), due: dueAlerts(Date.parse(recent.started_at), now, cfg, recent.alerts || []) };
  const stopMs = dev.stopS * 1000, since = dev.ts - stopMs;
  if (dev.stopS < cfg.min_stop_s || stopMs > OLD_STOP_MS) return { kind: 'none' };
  const visit: Visit = {
    device_id: dev.id, place_key: n.place.key, place_name: n.place.name, address: n.place.address || null, planned: n.place.planned,
    lat: n.place.lat, lon: n.place.lon, started_at: iso(since), last_seen_at: iso(dev.ts), ended_at: null, alerts: [],
  };
  return { kind: 'open', visit, due: dueAlerts(since, now, cfg, []) };
}

// ---------- LINKO: route stops and what was done there ----------
export type Task = { type: string; text: string; status: string; at: number | null };
export type Stop = { id: string; name: string; address: string; lat: number; lon: number; tasks: Task[] };

// LINKO times have no zone: they are Tashkent wall-clock time (UTC+5, no daylight saving)
export const tashMs = (t: unknown): number | null => { const s = String(t || ''); if (!s) return null; const v = Date.parse(s.replace(/Z$|[+-]\d\d:\d\d$/, '') + '+05:00'); return isFinite(v) ? v : null; };

export function stopsOf(plan: unknown): Stop[] {
  const list = Array.isArray(plan) ? plan : (plan as { results?: unknown[] })?.results || [];
  const out: Stop[] = [];
  for (const s of list as any[]) {
    const m = s?.market, loc = m?.location;
    if (!m || !loc || !isFinite(+loc.lat) || !isFinite(+loc.lon) || !(+loc.lat)) continue;
    out.push({
      id: String(m.id), name: String(m.name || ''), address: String(m.address || ''), lat: +loc.lat, lon: +loc.lon,
      tasks: (s.plans || []).map((p: any) => ({ type: String(p.type || ''), text: String(p.text || ''), status: String(p.status || ''), at: tashMs(p.done_time) })),
    });
  }
  return out;
}

const OUT_TYPES = ['order', 'payment', 'order_return', 'rejection', 'service_time'];
// what LINKO shows for the visited client from 15 min before the visit to 90 min after it
export function outcomeOf(v: Visit, stops: Stop[]): Task[] {
  const a = Date.parse(v.started_at) - 15 * MIN, b = Date.parse(v.ended_at || v.last_seen_at) + 90 * MIN;
  const id = v.place_key.startsWith('m') ? v.place_key.slice(1) : '';
  const out: Task[] = [];
  for (const s of stops) {
    if (!(s.id === id || dist(s.lat, s.lon, v.lat, v.lon) <= 150)) continue;
    for (const t of s.tasks) if (OUT_TYPES.includes(t.type) && t.status === 'done' && t.at != null && t.at >= a && t.at <= b) out.push(t);
  }
  return out.sort((x, y) => (x.at || 0) - (y.at || 0));
}

// ---------- texts of the Telegram messages ----------
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const hm = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
export const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / MIN)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };
const ICON: Record<string, string> = { order: '🛒', payment: '💵', order_return: '↩️', rejection: '✋', service_time: '⏱' };

export function msgEnter(who: string, v: Visit, now: number, stopIdx?: string): string {
  const s = Date.parse(v.started_at), el = now - s;
  return `🚪 <b>${esc(who)}</b> у клиента <b>${esc(v.place_name)}</b>${v.planned ? ` (по маршруту${stopIdx ? ', ' + stopIdx : ''})` : ' (вне маршрута)'}\nс ${hm(s)}${el >= 3 * MIN ? ` · уже ${dur(el)}` : ''}${v.address ? `\n📍 ${esc(v.address)}` : ''}`;
}
export function msgAlert(who: string, v: Visit, min: number, now: number, stale: boolean): string {
  const s = Date.parse(v.started_at);
  return `${min >= 45 ? '⚠️' : '⏱'} <b>${esc(who)}</b> у <b>${esc(v.place_name)}</b> уже ${dur(now - s)} (с ${hm(s)})${stale ? '\n📴 GPS давно не обновлялся — возможно, телефон без связи' : ''}`;
}
export function msgExit(who: string, v: Visit, outcome: Task[] | null, final: boolean, lost: boolean): string {
  const s = Date.parse(v.started_at), e = Date.parse(v.ended_at || v.last_seen_at);
  const head = `✅ <b>${esc(who)}</b> вышел от <b>${esc(v.place_name)}</b>: ${dur(e - s)} (${hm(s)}–${hm(e)})${lost ? '\n📴 GPS пропал — время выхода по последней точке' : ''}`;
  const res = outcome && outcome.length
    ? '\n' + outcome.map(t => `${ICON[t.type] || '•'} ${esc(t.text)}${t.at ? ` <i>${hm(t.at)}</i>` : ''}`).join('\n')
    : final ? '\n❔ В LINKO по этому клиенту ничего не отмечено' : '\n⏳ Жду, что агент отметит в LINKO…';
  return head + res;
}
