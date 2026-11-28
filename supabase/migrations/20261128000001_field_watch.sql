-- «Поле»: live visits of agents to clients, found by GPS (agent stands near a client point) — edge function field-watch.
-- Every minute the function reads the GPS platform, opens a visit when an agent stands still near a client of his LINKO route
-- (or any client marked on the GPS map), closes it when he drives away, and sends Telegram alerts: entered, 15 / 30 / 45 min,
-- left (+ what LINKO shows for that client: order, payment, refusal). The CRM page «Поле» reads these tables.
-- Only the owner of the workspace (the supervisor) and managers (admin, РОП) read them; agents don't. Writes: only the function.

create table if not exists public.field_config (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  chat_ids text[] not null default '{}',          -- Telegram chats for alerts; empty → the first ALLOWED_USERS of JUMAVOY
  alerts int[] not null default '{15,30,45}',     -- minutes at a client that send an alert
  radius_m int not null default 100 check (radius_m between 30 and 500),
  min_stop_s int not null default 120 check (min_stop_s between 30 and 1800), -- standing this long near a client = a visit
  names jsonb not null default '{}'::jsonb,       -- GPS device id → LINKO agent id (set by hand on the page; else matched by name)
  hide jsonb not null default '[]'::jsonb,        -- GPS device ids not to watch
  updated_at timestamptz not null default now()
);

-- internal state of the function (GPS address, ETags, cached routes / client points) — never read by clients
create table if not exists public.field_state (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- where every agent is now (one row per GPS device)
create table if not exists public.field_live (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  device_name text not null default '',
  agent_id text,                     -- LINKO user id
  agent_name text,
  lat double precision, lon double precision,
  speed real not null default 0,
  online text not null default '',
  fix_at timestamptz,                -- time of the last GPS point
  stop_since timestamptz,            -- standing still since (null = moving)
  near_name text,                    -- nearest client within the radius
  visit_id bigint,                   -- open visit
  updated_at timestamptz not null default now(),
  primary key (owner_id, device_id)
);

-- the day's route of every agent from LINKO (plan, what is done, sums) — for «7 of 18» on the page
create table if not exists public.field_routes (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  agent_id text not null,
  agent_name text not null default '',
  stops jsonb not null default '[]'::jsonb,   -- [{id, name, address, lat, lon, done, tasks:[{type, text, status, at}]}]
  stats jsonb not null default '{}'::jsonb,   -- {plan, done, orders, paid, returns, rejections}
  updated_at timestamptz not null default now(),
  primary key (owner_id, day, agent_id)
);

create table if not exists public.field_visits (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  device_id text not null,
  agent_id text,
  agent_name text not null default '',
  place_key text not null,            -- m<LINKO market id> or p<name> (GPS map point)
  place_name text not null default '',
  address text,
  planned boolean not null default false,  -- the client is in today's LINKO route of this agent
  lat double precision, lon double precision,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz,
  alerts int[] not null default '{}',      -- alert minutes already sent
  tg jsonb not null default '{}'::jsonb,   -- Telegram message ids {chat: {exit: id}}
  outcome jsonb,                           -- [{type, text, at}] from LINKO for this client during / after the visit
  outcome_final boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists field_visits_day_idx on public.field_visits (owner_id, day);
create unique index if not exists field_visits_open_idx on public.field_visits (owner_id, device_id) where ended_at is null;

alter table public.field_config enable row level security;
alter table public.field_state enable row level security;
alter table public.field_live enable row level security;
alter table public.field_routes enable row level security;
alter table public.field_visits enable row level security;
revoke all on public.field_config, public.field_state, public.field_live, public.field_routes, public.field_visits from anon, authenticated;
grant select on public.field_config, public.field_live, public.field_routes, public.field_visits to authenticated;
grant update (enabled, chat_ids, alerts, radius_m, min_stop_s, names, hide, updated_at) on public.field_config to authenticated;
grant insert (owner_id, enabled, chat_ids, alerts, radius_m, min_stop_s, names, hide) on public.field_config to authenticated;

create policy field_config_read on public.field_config for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());
create policy field_config_insert on public.field_config for insert to authenticated with check (owner_id = (select auth.uid()) and public.my_role() in ('admin', 'rop', 'supervisor'));
create policy field_config_update on public.field_config for update to authenticated using (owner_id = (select auth.uid()) or public.is_manager()) with check (owner_id = (select auth.uid()) or public.is_manager());
create policy field_live_read on public.field_live for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());
create policy field_routes_read on public.field_routes for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());
create policy field_visits_read on public.field_visits for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());

-- the schedule password lives only in Vault: pg_cron sends it, the function asks the database whether it is right
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'field_watch_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'field_watch_cron', 'field-watch: password of the every-minute schedule');
  end if;
end $$;
create or replace function public.field_cron_check(p text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(p <> '' and p = (select decrypted_secret from vault.decrypted_secrets where name = 'field_watch_cron'), false);
$$;
revoke execute on function public.field_cron_check(text) from public, anon, authenticated;
grant execute on function public.field_cron_check(text) to service_role;

-- the first workspace owner (admin) is watched from the start
insert into public.field_config (owner_id)
select p.id from public.profiles p join public.workspaces w on w.owner_id = p.id where p.role = 'admin'
on conflict do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'field-watch-tick') then perform cron.unschedule('field-watch-tick'); end if;
end $$;
select cron.schedule('field-watch-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://oxchgcfyzszemqlvdjjr.supabase.co/functions/v1/field-watch?cron=1&forceFunctionRegion=ap-southeast-1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-field-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'field_watch_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
