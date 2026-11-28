// field-watch — «Поле»: live visits of agents to clients by GPS, Telegram alerts to the supervisor.
// Called every minute by pg_cron (migration 20261128000001_field_watch.sql) with the Vault password x-field-cron.
// Each tick, for every enabled field_config (the supervisor whose workspace the auto-loader feeds):
//   1. GPS: live positions straight from the GPS platform (address + key from gps-latest.json written by autolinko.gs every
//      5 min; if the platform does not answer, that file itself when it is younger than 15 min);
//   2. LINKO: today's route of every agent from linko-visits.json (every 5 min, ETag) and the clients on the GPS map (hourly);
//   3. logic.ts decides per device: a visit opens (standing ≥ 2 min within 100 m of a client), stays, closes, alerts are due;
//   4. events (field_events, shown by the CRM page «Поле»): entered, 15 / 30 / 45 min, left, outcome. Each device is tied to
//      the agent's CRM account and his supervisor — a supervisor sees only his own agents. Telegram only if chat_ids are set.
// Secrets (shared with ai-bot): TG_TOKEN, ALLOWED_USERS (first id = where alerts go while field_config.chat_ids is empty),
// GH_TOKEN (read mitalcrm-data), optional GH_OWNER, GH_REPO. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY come by themselves.
// Verify JWT is off: the caller is pg_cron, checked by field_cron_check().
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as F from './logic.ts';

const env = (k: string, d = '') => (Deno.env.get(k) ?? d).replace(/[​-‍﻿ \r\n]/g, '').trim().replace(/^["']|["']$/g, '') || d;
const SB = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const GH = () => ({ owner: env('GH_OWNER', 'mital111222333'), repo: env('GH_REPO', 'mitalcrm-data'), token: env('GH_TOKEN') });
const TZ = 'Asia/Tashkent';
const HOURS = { from: 7, to: 21 }; // watched hours, Tashkent time
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const localDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const localHour = (ms: number) => +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(ms);
const mask = (s: unknown) => String(s ?? '').replace(/(user_api_hash=|bot)[^&\s/]+/g, '$1***');

async function ghRead(path: string, etag?: string): Promise<{ status: number; json?: any; etag?: string }> {
  const g = GH(); if (!g.token) return { status: 0 };
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/contents/${path}`, {
    headers: { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'field-watch', ...(etag ? { 'If-None-Match': etag } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status !== 200) { await r.body?.cancel(); return { status: r.status }; }
  return { status: 200, json: await r.json(), etag: r.headers.get('ETag') || undefined };
}

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const t = env('TG_TOKEN'); if (!t) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const j = await r.json(); if (!j.ok) console.log('tg', method, r.status, j.description); return j.ok ? j.result : null;
  } catch (e) { console.log('tg', method, mask((e as Error).message)); return null; }
}
// Telegram only for chats set explicitly in field_config.chat_ids (empty by default): the alerts live in the CRM (field_events)
const chatsOf = (cfg: any): string[] => (Array.isArray(cfg.chat_ids) ? cfg.chat_ids.filter(Boolean) : []);
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function send(cfg: any, text: string): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  for (const chat of chatsOf(cfg)) { const m = await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); if (m?.message_id) ids[chat] = m.message_id; }
  return ids;
}
async function edit(ids: Record<string, number>, text: string) {
  for (const [chat, id] of Object.entries(ids || {})) await tg('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

// GPSWOX get_devices: [{title, items:[{id, name, online, timestamp (UTC s), lat, lng, speed, stop_duration, address}]}] or the flat list of gps-latest.json
function devicesOf(x: any): F.Dev[] {
  const flat: any[] = Array.isArray(x) && x.some(g => Array.isArray(g?.items)) ? x.flatMap((g: any) => g.items || []) : Array.isArray(x) ? x : [];
  return flat.map(d => ({
    id: String(d.id), name: String(d.name || ''), lat: +d.lat, lon: +d.lng, speed: +d.speed || 0, ts: (+d.timestamp || 0) * 1000,
    stopS: F.parseStop(d.stop_duration), online: String(d.online || ''), address: d.address && d.address !== '-' ? String(d.address) : '',
  })).filter(d => isFinite(d.lat) && isFinite(d.lon) && (d.lat || d.lon) && d.ts > 0);
}

async function gpsNow(st: any, now: number): Promise<{ devices: F.Dev[]; src: string }> {
  let snap: any = null;
  if (!st.gps?.url || now - (st.gps.at || 0) > 30 * F.MIN || st.gps.bad) {
    const r = await ghRead('gps-latest.json');
    if (r.status === 200) { snap = r.json; if (snap?.live?.url && snap.live.hash) st.gps = { url: String(snap.live.url).replace(/\/+$/, ''), hash: snap.live.hash, at: now }; }
  }
  if (st.gps?.url) {
    try {
      const r = await fetch(`${st.gps.url}/api/get_devices?lang=ru&user_api_hash=${encodeURIComponent(st.gps.hash)}`, { signal: AbortSignal.timeout(12000) });
      if (r.ok) { st.gps.bad = false; return { devices: devicesOf(await r.json()), src: 'live' }; }
      await r.body?.cancel(); st.gps.bad = true; console.log('gps', r.status);
    } catch (e) { st.gps.bad = true; console.log('gps', mask((e as Error).message)); }
  }
  if (!snap) { const r = await ghRead('gps-latest.json'); snap = r.json; }
  if (snap?.at && now - Date.parse(snap.at) < 15 * F.MIN) return { devices: devicesOf(snap.devices), src: 'file' };
  return { devices: [], src: 'none' };
}

// today's LINKO routes (linko-visits.json), kept in field_state and mirrored to field_routes for the page
async function routesNow(cfg: any, st: any, now: number, day: string) {
  if (st.lv && st.lv.day === day && now - (st.lv.at || 0) < 5 * F.MIN) return;
  const r = await ghRead('linko-visits.json', st.lv?.day === day ? st.lv.etag : undefined);
  if (r.status === 304) { st.lv.at = now; return; }
  if (r.status !== 200 || r.json?.day !== day) { if (st.lv?.day !== day) st.lv = { day, at: now, agents: {} }; else st.lv.at = now; return; }
  const agents: Record<string, { name: string; stops: F.Stop[] }> = {}, rows: any[] = [];
  const { data: people } = await SB.from('profiles').select('linko_name,supervisor_id').eq('role', 'agent').eq('is_active', true);
  const supOf = (name: string) => (people || []).find((p: any) => p.linko_name && F.norm(p.linko_name) === F.norm(name))?.supervisor_id || null;
  for (const [id, a] of Object.entries<any>(r.json.agents || {})) {
    const stops = F.stopsOf(a.plan);
    agents[id] = { name: String(a.name || id), stops };
    const s = a.stats || {}, tasks = stops.flatMap(x => x.tasks);
    rows.push({
      owner_id: cfg.owner_id, day, agent_id: id, agent_name: agents[id].name, supervisor_id: supOf(agents[id].name), updated_at: new Date(now).toISOString(),
      stops: stops.map(x => ({ id: x.id, name: x.name, address: x.address, lat: x.lat, lon: x.lon, done: x.tasks.some(t => t.status === 'done'), tasks: x.tasks.filter(t => t.type !== 'visit') })),
      stats: { plan: stops.length, done: stops.filter(x => x.tasks.some(t => t.status === 'done')).length, orders: +s.order_total_price || 0, paid: +s.client_transaction_total_price || 0, returns: +s.order_return_total_price || 0, rejections: tasks.filter(t => t.type === 'rejection').length },
    });
  }
  st.lv = { day, at: now, etag: r.etag, agents };
  if (rows.length) { const { error } = await SB.from('field_routes').upsert(rows); if (error) console.log('routes', error.message); }
}

async function poisNow(st: any, now: number) {
  if (st.pois && now - (st.poisAt || 0) < 60 * F.MIN) return;
  const r = await ghRead('gps-pois.json');
  st.poisAt = now;
  if (r.status === 200 && Array.isArray(r.json?.pois)) st.pois = r.json.pois.filter((p: any) => isFinite(+p.lat) && isFinite(+p.lng)).map((p: any) => [String(p.name || ''), +p.lat, +p.lng]);
}

async function tick(cfg: any, now: number) {
  const day = localDay(now);
  const { data: srow } = await SB.from('field_state').select('data').eq('owner_id', cfg.owner_id).maybeSingle();
  const st: any = srow?.data || {};
  const { devices, src } = await gpsNow(st, now);
  await routesNow(cfg, st, now, day);
  await poisNow(st, now);

  const lv: Record<string, { name: string; stops: F.Stop[] }> = st.lv?.day === day ? st.lv.agents || {} : {};
  const agentList = Object.entries(lv).map(([id, a]) => ({ id, name: a.name }));
  // «Adhamjon 007 Namangan»: the agent's own point in LINKO (he marks «Ishga chiqdim» there) — not a client
  for (const a of Object.values(lv)) a.stops = a.stops.filter(s => !F.SELF_RE.test(s.name));
  const allStops = Object.values(lv).flatMap(a => a.stops);
  const linkoPlaces = new Map<string, F.Place>();
  for (const s of allStops) linkoPlaces.set('m' + s.id, { key: 'm' + s.id, name: s.name, address: s.address, lat: s.lat, lon: s.lon, planned: false });
  const mPlaces = [...linkoPlaces.values()];
  const poiPlaces: F.Place[] = (st.pois || []).filter((p: any[]) => !F.SELF_RE.test(p[0]) && !mPlaces.some(m => F.dist(m.lat, m.lon, p[1], p[2]) < 40)).map((p: any[]) => ({ key: 'p' + p[0], name: p[0], address: '', lat: p[1], lon: p[2], planned: false }));
  const cfgL: F.Cfg = { radius_m: cfg.radius_m, min_stop_s: cfg.min_stop_s, alerts: cfg.alerts || [15, 30, 45] };
  const hide = new Set<string>((cfg.hide || []).map(String));

  const since15 = new Date(now - 15 * F.MIN).toISOString();
  const { data: vrows, error: verr } = await SB.from('field_visits').select('*').eq('owner_id', cfg.owner_id)
    .or(`ended_at.is.null,and(day.eq.${day},ended_at.gt.${since15}),and(day.eq.${day},outcome_final.eq.false)`);
  if (verr) throw new Error('visits: ' + verr.message);
  const visits: any[] = vrows || [];
  const dayStart = Date.parse(day + 'T00:00:00+05:00');
  const live: any[] = [], log: string[] = [], events: any[] = [];
  // agents' CRM accounts: GPS device → agent → his supervisor (who may see the device)
  const { data: people } = await SB.from('profiles').select('id,full_name,linko_name,supervisor_id').eq('role', 'agent').eq('is_active', true);
  const profs: any[] = people || [];
  const profList = profs.map(p => ({ id: p.id, name: p.linko_name || p.full_name || '' }));
  const ev = (kind: string, v: any, minutes: number | null, html: string) => events.push({
    owner_id: cfg.owner_id, supervisor_id: v.supervisor_id || null, visit_id: v.id || null, day, kind, minutes, who: v.agent_name || '', place: v.place_name || '', text: plain(html),
  });

  for (const dev of devices) {
    if (hide.has(dev.id)) continue;
    const agentId: string | null = cfg.names?.[dev.id] != null ? String(cfg.names[dev.id]) || null : F.matchAgent(dev.name, agentList);
    const linkoName = agentId ? lv[agentId]?.name || '' : '';
    const prof = (linkoName && profs.find(p => p.linko_name && F.norm(p.linko_name) === F.norm(linkoName)))
      || (() => { const id = F.matchAgent(dev.name, profList); return id ? profs.find(p => p.id === id) : null; })() || null;
    const agentUser: string | null = prof?.id || null, supId: string | null = prof?.supervisor_id || null;
    const route: F.Stop[] = (agentId && lv[agentId]?.stops) || [];
    const places: F.Place[] = [
      ...route.map(s => ({ key: 'm' + s.id, name: s.name, address: s.address, lat: s.lat, lon: s.lon, planned: true })),
      ...mPlaces.filter(m => !route.some(s => 'm' + s.id === m.key)), ...poiPlaces,
    ];
    const open = visits.find(v => v.device_id === dev.id && !v.ended_at) || null;
    const recent = visits.filter(v => v.device_id === dev.id && v.ended_at).sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))[0] || null;
    const who = dev.name;
    const stopIdx = (key: string) => { const i = route.findIndex(s => 'm' + s.id === key); return i >= 0 ? `${i + 1}-я из ${route.length}` : ''; };
    let visitId: number | null = open?.id ?? null;

    const apply = async (s: F.Step, cur: any): Promise<void> => {
      if (s.kind === 'stay' && cur) {
        const patch: any = { last_seen_at: s.last_seen_at };
        if (cur.supervisor_id !== supId || cur.agent_user !== agentUser) Object.assign(patch, { supervisor_id: supId, agent_user: agentUser }), Object.assign(cur, { supervisor_id: supId, agent_user: agentUser });
        if (s.due.length) { const m = Math.max(...s.due), t = F.msgAlert(who, cur, m, now, s.stale); ev('alert', cur, m, t); await send(cfg, t); patch.alerts = [...new Set([...(cur.alerts || []), ...s.due])]; }
        if (Object.keys(patch).length > 1 || patch.last_seen_at !== cur.last_seen_at) await SB.from('field_visits').update(patch).eq('id', cur.id);
      } else if (s.kind === 'close' && cur) {
        const v = { ...cur, ended_at: s.ended_at };
        const out = F.outcomeOf(v, allStops);
        const t = F.msgExit(who, v, out, false, s.lost); ev('exit', v, Math.round((Date.parse(s.ended_at) - Date.parse(cur.started_at)) / F.MIN), t);
        const ids = await send(cfg, t);
        const tgv = { ...(cur.tg || {}), exit: ids, lost: s.lost };
        await SB.from('field_visits').update({ ended_at: s.ended_at, outcome: out, tg: tgv }).eq('id', cur.id);
        Object.assign(cur, { ended_at: s.ended_at, outcome: out, tg: tgv });
        log.push(`${who}: вышел ${cur.place_name}`); visitId = null;
        await apply(s.then, null);
      } else if (s.kind === 'open') {
        if (Date.parse(s.visit.started_at) < dayStart) return;
        const row = { ...s.visit, owner_id: cfg.owner_id, day, agent_id: agentId, agent_name: who, agent_user: agentUser, supervisor_id: supId, alerts: s.due };
        const { data, error } = await SB.from('field_visits').insert(row).select('*').single();
        if (error) { console.log('open', error.message); return; }
        visits.push(data); visitId = data.id;
        const t = F.msgEnter(who, data, now, data.planned ? stopIdx(data.place_key) : ''); ev('enter', data, s.due.length ? Math.max(...s.due) : null, t);
        await send(cfg, t);
        log.push(`${who}: зашёл ${data.place_name}`);
      } else if (s.kind === 'reopen') {
        const v = visits.find(x => x.id === s.id);
        await SB.from('field_visits').update({ ended_at: null, last_seen_at: s.last_seen_at, outcome_final: false }).eq('id', s.id);
        if (v) { v.ended_at = null; v.outcome_final = false; visitId = v.id; }
        if (v && s.due.length) { const m = Math.max(...s.due), t = F.msgAlert(who, v, m, now, false); ev('alert', v, m, t); await send(cfg, t); await SB.from('field_visits').update({ alerts: [...new Set([...(v.alerts || []), ...s.due])] }).eq('id', s.id); }
        log.push(`${who}: вернулся ${v?.place_name || s.id}`);
      }
    };
    try {
      if (dev.ts >= dayStart || open) await apply(F.step(dev, open, recent, places, cfgL, now), open);
    } catch (e) { console.log('device', dev.id, mask((e as Error).message)); }

    const still = dev.speed < F.STILL_KMH;
    const near = still ? F.nearest(places, dev.lat, dev.lon, cfg.radius_m) : null;
    live.push({
      owner_id: cfg.owner_id, device_id: dev.id, device_name: dev.name, agent_id: agentId, agent_name: agentId ? lv[agentId]?.name || null : prof?.linko_name || null,
      agent_user: agentUser, supervisor_id: supId,
      lat: dev.lat, lon: dev.lon, speed: dev.speed, online: dev.online, fix_at: new Date(dev.ts).toISOString(),
      stop_since: still ? new Date(dev.ts - dev.stopS * 1000).toISOString() : null, near_name: near?.place.name || null, visit_id: visitId,
      updated_at: new Date(now).toISOString(),
    });
  }
  if (live.length) { const { error } = await SB.from('field_live').upsert(live); if (error) console.log('live', error.message); }

  // outcomes: what LINKO shows for clients visited today, until 2 h after the visit
  for (const v of visits) {
    if (!v.ended_at || v.outcome_final || v.day !== day) continue;
    const out = F.outcomeOf(v, allStops);
    const final = now - Date.parse(v.ended_at) > 120 * F.MIN;
    if (JSON.stringify(out) === JSON.stringify(v.outcome || []) && !final) continue;
    const t = F.msgExit(v.agent_name, v, out, final, !!v.tg?.lost);
    if (out.length && JSON.stringify(out) !== JSON.stringify(v.outcome || [])) ev('outcome', v, null, t);
    if (v.tg?.exit) await edit(v.tg.exit, t);
    await SB.from('field_visits').update({ outcome: out, outcome_final: final }).eq('id', v.id);
  }
  if (events.length) { const { error } = await SB.from('field_events').insert(events); if (error) console.log('events', error.message); }

  await SB.from('field_state').upsert({ owner_id: cfg.owner_id, data: st, updated_at: new Date(now).toISOString() });
  return { owner: cfg.owner_id, gps: src, devices: devices.length, agents: agentList.length, places: mPlaces.length + poiPlaces.length, open: visits.filter(v => !v.ended_at).length, log };
}

// ---------- history: a whole day per device from the GPS track (field_days) ----------
async function ghGz(path: string): Promise<any | null> {
  const g = GH(); if (!g.token) return null;
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/contents/${path}`, {
    headers: { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'field-watch' }, signal: AbortSignal.timeout(20000),
  });
  if (r.status !== 200) { await r.body?.cancel(); return null; }
  const buf = new Uint8Array(await r.arrayBuffer());
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  const text = gz ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf);
  try { return JSON.parse(text); } catch { return null; }
}
const linkoStats = (stops: F.Stop[], s: any) => ({
  plan: stops.length, done: stops.filter(x => x.tasks.some(t => t.status === 'done')).length, orders: +s?.order_total_price || 0,
  paid: +s?.client_transaction_total_price || 0, returns: +s?.order_return_total_price || 0, rejections: stops.flatMap(x => x.tasks).filter(t => t.type === 'rejection').length,
});

async function history(cfg: any, day: string, now: number) {
  const { data: srow } = await SB.from('field_state').select('data').eq('owner_id', cfg.owner_id).maybeSingle();
  const st: any = srow?.data || {};
  if (!st.gps?.url) await gpsNow(st, now);
  if (!st.gps?.url) throw new Error('GPS address unknown');
  await poisNow(st, now);
  // LINKO of that day: today — linko-visits.json, a past day — the archive the auto-loader keeps
  const src = day === localDay(now) ? await ghRead('linko-visits.json').then(r => r.json) : await ghGz(`archive/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}/visits.json.gz`);
  const lv: Record<string, { name: string; stops: F.Stop[]; stats: any }> = {};
  if (src?.day === day) for (const [id, a] of Object.entries<any>(src.agents || {})) lv[id] = { name: String(a.name || id), stops: F.stopsOf(a.plan).filter(s => !F.SELF_RE.test(s.name)), stats: a.stats || {} };
  const allStops = Object.values(lv).flatMap(a => a.stops);
  const mPlaces: F.Place[] = [...new Map(allStops.map(s => ['m' + s.id, { key: 'm' + s.id, name: s.name, address: s.address, lat: s.lat, lon: s.lon, planned: false }])).values()];
  const poiPlaces: F.Place[] = (st.pois || []).filter((p: any[]) => !F.SELF_RE.test(p[0]) && !mPlaces.some(m => F.dist(m.lat, m.lon, p[1], p[2]) < 40)).map((p: any[]) => ({ key: 'p' + p[0], name: p[0], address: '', lat: p[1], lon: p[2], planned: false }));
  const { data: devs } = await SB.from('field_live').select('device_id,device_name,agent_id,agent_name,agent_user,supervisor_id').eq('owner_id', cfg.owner_id);
  const hide = new Set<string>((cfg.hide || []).map(String));
  const rows: any[] = [], errors: string[] = [];
  for (const d of (devs || []).filter((x: any) => !hide.has(String(x.device_id)))) {
    try {
      const r = await fetch(`${st.gps.url}/api/get_history?lang=ru&user_api_hash=${encodeURIComponent(st.gps.hash)}&device_id=${encodeURIComponent(d.device_id)}&from_date=${day}&from_time=00:00&to_date=${day}&to_time=23:59`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) { await r.body?.cancel(); errors.push(`${d.device_name}: GPS ${r.status}`); continue; }
      const h = await r.json();
      const route: F.Stop[] = (d.agent_id && lv[d.agent_id]?.stops) || [];
      const places = [...route.map(s => ({ key: 'm' + s.id, name: s.name, address: s.address, lat: s.lat, lon: s.lon, planned: true })), ...mPlaces.filter(m => !route.some(s => 'm' + s.id === m.key)), ...poiPlaces];
      const g = F.dayFromHistory(h, places, cfg.radius_m, cfg.min_stop_s);
      if (!g.stops.length && !g.km) continue; // the device did not work that day
      for (const s of g.stops) s.out = F.outcomeOf({ device_id: d.device_id, place_key: s.key || 'x', place_name: s.name, planned: s.planned, lat: s.lat, lon: s.lon, started_at: s.a, last_seen_at: s.b, ended_at: s.b, alerts: [] }, allStops);
      g.stops = F.assignOutcomes(g.stops);
      rows.push({
        owner_id: cfg.owner_id, day, device_id: d.device_id, device_name: d.device_name, agent_id: d.agent_id, agent_name: d.agent_id ? lv[d.agent_id]?.name || d.agent_name : d.agent_name,
        agent_user: d.agent_user, supervisor_id: d.supervisor_id, km: g.km, move_s: g.move_s, stop_s: g.stop_s, first_at: g.first_at, last_at: g.last_at, stops: g.stops,
        linko: d.agent_id && lv[d.agent_id] ? linkoStats(lv[d.agent_id].stops, lv[d.agent_id].stats) : {}, updated_at: new Date(now).toISOString(),
      });
    } catch (e) { errors.push(`${d.device_name}: ${mask((e as Error).message)}`); }
  }
  if (rows.length) { const { error } = await SB.from('field_days').upsert(rows); if (error) throw new Error('days: ' + error.message); }
  return { owner: cfg.owner_id, day, devices: rows.length, linko: Object.keys(lv).length, errors };
}

// after the watched hours: open visits end at their last GPS point, without messages
async function closeAll() {
  const { data } = await SB.from('field_visits').select('id,last_seen_at').is('ended_at', null);
  for (const v of data || []) await SB.from('field_visits').update({ ended_at: v.last_seen_at }).eq('id', v.id);
  return (data || []).length;
}

Deno.serve(async req => {
  const u = new URL(req.url);
  if (u.searchParams.get('cron') !== '1') return json({ ok: false, error: 'not found' }, 404);
  const { data: ok } = await SB.rpc('field_cron_check', { p: req.headers.get('x-field-cron') || '' });
  if (!ok) return json({ ok: false, error: 'forbidden' }, 403);
  const now = Date.now(), h = localHour(now);
  const hd = u.searchParams.get('history');
  if (hd) { // ?history=today | YYYY-MM-DD — rebuild that day from the GPS track (field_days)
    const day = hd === 'today' ? localDay(now) : hd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > localDay(now)) return json({ ok: false, error: 'bad day' }, 400);
    const { data: cfgs } = await SB.from('field_config').select('*').eq('enabled', true);
    const res: any[] = [];
    for (const cfg of cfgs || []) { try { res.push(await history(cfg, day, now)); } catch (e) { res.push({ owner: cfg.owner_id, day, error: mask((e as Error).message) }); } }
    console.log('field history', JSON.stringify(res));
    return json({ ok: true, res });
  }
  if (h < HOURS.from || h >= HOURS.to) return json({ ok: true, idle: true, closed: await closeAll() });
  const { data: cfgs, error } = await SB.from('field_config').select('*').eq('enabled', true);
  if (error) return json({ ok: false, error: error.message }, 500);
  const res: any[] = [];
  for (const cfg of cfgs || []) {
    try { res.push(await tick(cfg, now)); } catch (e) { const m = mask((e as Error).message); console.log('tick', cfg.owner_id, m); res.push({ owner: cfg.owner_id, error: m }); }
  }
  const lines = res.flatMap(r => r.log || []);
  console.log('field ok', JSON.stringify(res.map(r => ({ gps: r.gps, devices: r.devices, agents: r.agents, open: r.open, error: r.error }))), lines.join(' | '));
  return json({ ok: true, res });
});
