// MITAL CRM — account management (Supabase Edge Function «admin-users»).
// Only an active admin or РОП may call it. Accounts get a login (no e-mail needed): it is stored in Supabase Auth as <login>@mital.crm.
// Actions (POST JSON {action, ...}):
//   create       {login, password, full_name, role, phone?, linko_name?, supervisor_id?, region_id?, region_ids?}
//   update       {id, full_name?, phone?, linko_name?, role?, supervisor_id?, region_id?, region_ids?, reassign_to?}
//   set_password {id, password}
//   set_active   {id, active, reassign_to?}  — a lead who is blocked or loses the lead role hands his team to reassign_to
// РОП cannot create, change or block an admin; nobody can block himself. Every action is written to audit_log with the caller's id.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const DOMAIN = 'mital.crm';
const ROLES = ['admin', 'rop', 'supervisor', 'agent', 'store']; // store — завсклад: his own cabinet with the daily stock count
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class Fail extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const checkPassword = (p: unknown) => { if (typeof p !== 'string' || p.length < 8) throw new Fail('Пароль — минимум 8 символов'); return p; };

async function profile(id: string) {
  const { data, error } = await db.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// who may lead a team of agents and have regions: a supervisor, and also an admin or РОП who runs his own regions
const LEADS = ['supervisor', 'admin', 'rop'];

// the regions a supervisor leads (empty = not set yet: any region is accepted)
async function regionsOf(id: string) {
  const { data, error } = await db.from('supervisor_regions').select('region_id').eq('supervisor_id', id);
  if (error) throw error;
  return (data || []).map(r => String(r.region_id));
}

// checks the links of an agent and returns the clean fields; was = the person before the change (an unchanged link is not re-checked)
async function links(role: string, b: Record<string, unknown>, was: Record<string, unknown> | null = null) {
  const out: Record<string, unknown> = { supervisor_id: null, region_id: null };
  if (role === 'agent') {
    const sv = b.supervisor_id ? await profile(String(b.supervisor_id)) : null;
    if (!sv || !LEADS.includes(sv.role)) throw new Fail('Выберите супервайзера агента');
    if (!b.region_id) throw new Fail('Выберите регион агента');
    const changed = !was || was.role !== role || was.supervisor_id !== sv.id || was.region_id !== String(b.region_id);
    if (changed && !sv.is_active) throw new Fail('Этот супервайзер заблокирован — выберите другого');
    // an agent of Fergana cannot be put under the supervisor of Namangan by mistake
    if (changed && sv.role === 'supervisor') {
      const regs = await regionsOf(sv.id);
      if (regs.length && !regs.includes(String(b.region_id))) throw new Fail(`${sv.full_name} не ведёт этот регион. Выберите его регион или добавьте регион супервайзеру.`);
    }
    out.supervisor_id = sv.id; out.region_id = String(b.region_id);
  }
  // a store keeper belongs to the supervisor whose CRM publishes his warehouse; the region is optional
  if (role === 'store') {
    const sv = b.supervisor_id ? await profile(String(b.supervisor_id)) : null;
    if (!sv || !LEADS.includes(sv.role)) throw new Fail('Выберите супервайзера завсклада');
    if ((!was || was.supervisor_id !== sv.id) && !sv.is_active) throw new Fail('Этот супервайзер заблокирован — выберите другого');
    if (!str(b.linko_name)) throw new Fail('Укажите склад завсклада (как в LINKO)');
    out.supervisor_id = sv.id; out.region_id = b.region_id ? String(b.region_id) : null;
  }
  return out;
}

// a lead who stops leading (another role, or blocked) must hand his agents and store keepers to another lead first:
// otherwise their cabinets silently stop updating and their marks go nowhere. reassign_to = the new lead.
async function handOver(p: Record<string, unknown>, to: unknown) {
  const { data: team, error } = await db.from('profiles').select('id, full_name').eq('supervisor_id', String(p.id)).eq('is_active', true);
  if (error) throw error;
  if (!team?.length) return;
  const nl = to ? await profile(String(to)) : null;
  if (!nl || nl.id === p.id || !nl.is_active || !LEADS.includes(nl.role)) {
    throw new Fail(`Сначала передайте людей ${p.full_name} другому руководителю: ${team.map(t => t.full_name).join(', ')}`, 409);
  }
  const { error: e2 } = await db.from('profiles').update({ supervisor_id: nl.id }).eq('supervisor_id', String(p.id)).in('role', ['agent', 'store']);
  if (e2) throw e2;
}

async function setRegions(id: string, role: string, ids: unknown) {
  const { error: e1 } = await db.from('supervisor_regions').delete().eq('supervisor_id', id);
  if (e1) throw e1;
  if (!LEADS.includes(role) || !Array.isArray(ids) || !ids.length) return;
  const { error } = await db.from('supervisor_regions').insert(ids.map(r => ({ supervisor_id: id, region_id: String(r) })));
  if (error) throw error;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  try {
    // who is calling
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await db.auth.getUser(jwt);
    if (!who?.user) throw new Fail('Войдите заново', 401);
    const me = await profile(who.user.id);
    if (!me || !me.is_active || !['admin', 'rop'].includes(me.role)) throw new Fail('Аккаунтами управляют только администратор и РОП', 403);
    const isAdmin = me.role === 'admin';

    const b = await req.json().catch(() => ({}));
    const action = str(b.action, 30);
    let result: unknown = { ok: true }, target = '';

    if (action === 'create') {
      const login = str(b.login, 32).toLowerCase(), full_name = str(b.full_name), role = str(b.role, 20);
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) throw new Fail('Логин: 3–32 латинские буквы, цифры, точка, дефис');
      if (!full_name) throw new Fail('Укажите имя');
      if (!ROLES.includes(role)) throw new Fail('Неизвестная роль');
      if (role === 'admin' && !isAdmin) throw new Fail('Администратора может создать только администратор', 403);
      const password = checkPassword(b.password);
      const extra = await links(role, b);
      const { data: made, error } = await db.auth.admin.createUser({ email: `${login}@${DOMAIN}`, password, email_confirm: true, app_metadata: { crm: true } });
      if (error) throw new Fail(/already/i.test(error.message) ? 'Такой логин уже есть' : error.message);
      const id = made.user.id; target = id;
      const { error: e2 } = await db.from('profiles').insert({ id, login, full_name, role, phone: str(b.phone, 40) || null, linko_name: str(b.linko_name) || null, ...extra });
      if (e2) { await db.auth.admin.deleteUser(id); throw new Fail(/duplicate/i.test(e2.message) ? 'Такой логин уже есть' : e2.message); }
      await setRegions(id, role, b.region_ids);
      result = { ok: true, id };
    } else {
      const id = str(b.id, 60); target = id;
      const p = id ? await profile(id) : null;
      if (!p) throw new Fail('Пользователь не найден', 404);
      if (p.role === 'admin' && !isAdmin) throw new Fail('Администратора может менять только администратор', 403);

      if (action === 'update') {
        const role = b.role ? str(b.role, 20) : p.role;
        if (!ROLES.includes(role)) throw new Fail('Неизвестная роль');
        if (role === 'admin' && !isAdmin) throw new Fail('Назначить администратора может только администратор', 403);
        if (id === me.id && role !== p.role) throw new Fail('Свою роль поменять нельзя');
        const next = { ...p, ...b, role };
        const fields = {
          full_name: str(next.full_name) || p.full_name, phone: str(next.phone, 40) || null, linko_name: str(next.linko_name) || null, role,
          ...(await links(role, next, p)),
        };
        if (LEADS.includes(p.role) && !LEADS.includes(role)) await handOver(p, b.reassign_to);
        const { error } = await db.from('profiles').update(fields).eq('id', id);
        if (error) throw error;
        if (LEADS.includes(role) && Array.isArray(b.region_ids)) await setRegions(id, role, b.region_ids);
        if (!LEADS.includes(role)) await setRegions(id, role, []);
      } else if (action === 'set_password') {
        const { error } = await db.auth.admin.updateUserById(id, { password: checkPassword(b.password) });
        if (error) throw new Fail(error.message);
      } else if (action === 'set_active') {
        const active = b.active === true;
        if (id === me.id && !active) throw new Fail('Себя заблокировать нельзя');
        if (!active && LEADS.includes(p.role)) await handOver(p, b.reassign_to);
        const { error } = await db.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
        if (error) throw new Fail(error.message);
        const { error: e2 } = await db.from('profiles').update({ is_active: active }).eq('id', id);
        if (e2) throw e2;
      } else throw new Fail('Неизвестное действие');
    }

    await db.from('audit_log').insert({ user_id: me.id, table_name: 'accounts', action, row_id: target, new_data: { ...b, password: b.password ? '***' : undefined } });
    return reply(result);
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    return reply({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
