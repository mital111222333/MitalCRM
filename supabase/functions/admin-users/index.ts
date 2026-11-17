// MITAL CRM — account management (Supabase Edge Function «admin-users»).
// Only an active admin or РОП may call it. Accounts get a login (no e-mail needed): it is stored in Supabase Auth as <login>@mital.crm.
// Actions (POST JSON {action, ...}):
//   create       {login, password, full_name, role, phone?, linko_name?, supervisor_id?, region_id?, region_ids?}
//   update       {id, full_name?, phone?, linko_name?, role?, supervisor_id?, region_id?, region_ids?}
//   set_password {id, password}
//   set_active   {id, active}
// РОП cannot create, change or block an admin; nobody can block himself. Every action is written to audit_log with the caller's id.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const DOMAIN = 'mital.crm';
const ROLES = ['admin', 'rop', 'supervisor', 'agent'];
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

// checks the links of an agent and returns the clean fields
async function links(role: string, b: Record<string, unknown>) {
  const out: Record<string, unknown> = { supervisor_id: null, region_id: null };
  if (role === 'agent') {
    const sv = b.supervisor_id ? await profile(String(b.supervisor_id)) : null;
    if (!sv || sv.role !== 'supervisor') throw new Fail('Выберите супервайзера агента');
    if (!b.region_id) throw new Fail('Выберите регион агента');
    out.supervisor_id = sv.id; out.region_id = String(b.region_id);
  }
  return out;
}

async function setRegions(id: string, role: string, ids: unknown) {
  const { error: e1 } = await db.from('supervisor_regions').delete().eq('supervisor_id', id);
  if (e1) throw e1;
  if (role !== 'supervisor' || !Array.isArray(ids) || !ids.length) return;
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
          ...(await links(role, next)),
        };
        const { error } = await db.from('profiles').update(fields).eq('id', id);
        if (error) throw error;
        if (role === 'supervisor' && Array.isArray(b.region_ids)) await setRegions(id, role, b.region_ids);
        if (role !== 'supervisor') await setRegions(id, role, []);
      } else if (action === 'set_password') {
        const { error } = await db.auth.admin.updateUserById(id, { password: checkPassword(b.password) });
        if (error) throw new Fail(error.message);
      } else if (action === 'set_active') {
        const active = b.active === true;
        if (id === me.id && !active) throw new Fail('Себя заблокировать нельзя');
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
