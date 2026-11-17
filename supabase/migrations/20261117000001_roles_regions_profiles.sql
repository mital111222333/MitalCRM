-- MITAL CRM, stage 1: who is who and who sees whom.
-- Roles: admin (full control), rop (head of sales: whole country, can edit), supervisor (own regions and own agents), agent (only himself).
-- Every later data table (clients, payments, plans, salary, fines...) carries region_id and agent_id and uses the helper functions below in its RLS.

create type public.app_role as enum ('admin', 'rop', 'supervisor', 'agent');

-- ---------- regions ----------
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'active' check (status in ('active', 'opening')),
  created_at timestamptz not null default now()
);

-- ---------- people (one row per CRM account) ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login text not null unique,
  full_name text not null,
  role public.app_role not null,
  supervisor_id uuid references public.profiles (id) on delete set null,  -- agents: their supervisor
  region_id uuid references public.regions (id) on delete set null,       -- agents: their region
  linko_name text,             -- the name exactly as LINKO writes it, to match LINKO rows to this person
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (role = 'agent' or supervisor_id is null)
);
create index profiles_supervisor_idx on public.profiles (supervisor_id);
create index profiles_region_idx on public.profiles (region_id);

-- supervisors may lead several regions (e.g. Fergana + Namangan + Andijan)
create table public.supervisor_regions (
  supervisor_id uuid not null references public.profiles (id) on delete cascade,
  region_id uuid not null references public.regions (id) on delete cascade,
  primary key (supervisor_id, region_id)
);
create index supervisor_regions_region_idx on public.supervisor_regions (region_id);

-- ---------- journal of changes (who changed what) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  action text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------- helper functions used by every access rule ----------
-- security definer: they read profiles without re-entering profiles' own RLS (no recursion); search_path is pinned.
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

create function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin', 'rop'), false)
$$;

create function public.my_supervisor_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select supervisor_id from public.profiles where id = (select auth.uid()) and is_active
$$;

-- regions whose data the current user may see
create function public.my_region_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.regions r where public.is_manager()
  union
  select sr.region_id from public.supervisor_regions sr
    where sr.supervisor_id = (select auth.uid()) and public.my_role() = 'supervisor'
  union
  select p.region_id from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'agent' and p.is_active and p.region_id is not null
$$;

-- may the current user see this person's data (salary, fines, clients...)
create function public.can_see_person(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (person = (select auth.uid()) and public.my_role() is not null)
      or public.is_manager()
      or (public.my_role() = 'supervisor' and exists (
            select 1 from public.profiles p where p.id = person and p.supervisor_id = (select auth.uid())))
$$;

revoke execute on function public.my_role(), public.is_manager(), public.my_supervisor_id(), public.my_region_ids(), public.can_see_person(uuid) from public, anon;
grant execute on function public.my_role(), public.is_manager(), public.my_supervisor_id(), public.my_region_ids(), public.can_see_person(uuid) to authenticated;

-- ---------- access rules ----------
alter table public.regions enable row level security;
alter table public.profiles enable row level security;
alter table public.supervisor_regions enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.regions, public.profiles, public.supervisor_regions, public.audit_log from anon;

-- regions: every signed-in person sees the list of regions; only admin/rop change it
create policy regions_read on public.regions for select to authenticated using (public.my_role() is not null);
create policy regions_insert on public.regions for insert to authenticated with check (public.is_manager());
create policy regions_update on public.regions for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy regions_delete on public.regions for delete to authenticated using (public.is_manager());

-- profiles: you see yourself; your supervisor; a supervisor sees own agents; admin/rop see everyone
create policy profiles_read on public.profiles for select to authenticated using (
  public.can_see_person(id) or id = public.my_supervisor_id()
);
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_manager());
create policy profiles_update on public.profiles for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy profiles_delete on public.profiles for delete to authenticated using (public.my_role() = 'admin');

-- supervisor_regions: admin/rop see and change all; a supervisor sees his own
create policy sr_read on public.supervisor_regions for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));
create policy sr_insert on public.supervisor_regions for insert to authenticated with check (public.is_manager());
create policy sr_update on public.supervisor_regions for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy sr_delete on public.supervisor_regions for delete to authenticated using (public.is_manager());

-- audit_log: only admin/rop read it; rows are written only by the trigger below
create policy audit_read on public.audit_log for select to authenticated using (public.is_manager());
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------- only the admin can create or touch admins ----------
create function public.guard_admin_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return coalesce(new, old); end if; -- server-side jobs (service key)
  if public.my_role() is distinct from 'admin' and (
       (tg_op <> 'INSERT' and old.role = 'admin') or (tg_op <> 'DELETE' and new.role = 'admin')) then
    raise exception 'Только администратор может менять администраторов';
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_guard_admin before insert or update or delete on public.profiles
  for each row execute function public.guard_admin_rows();

-- ---------- journal trigger ----------
create function public.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (table_name, action, row_id, old_data, new_data)
  values (tg_table_name, tg_op,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function public.write_audit();
create trigger regions_audit after insert or update or delete on public.regions for each row execute function public.write_audit();
create trigger supervisor_regions_audit after insert or update or delete on public.supervisor_regions for each row execute function public.write_audit();

revoke execute on function public.guard_admin_rows(), public.write_audit() from public, anon, authenticated;

-- ---------- starting regions (more are added from the admin screen) ----------
insert into public.regions (name, status) values
  ('Фергана', 'active'), ('Наманган', 'active'), ('Андижан', 'active'), ('Ташкент', 'active');
