-- «Поле» history: one row per GPS device per day, rebuilt from the GPS platform's track history (get_history) — every stop of
-- the day (at a client or not), km driven, time moving / standing, first and last move, and what LINKO shows for that day
-- (route plan, orders, payments, refusals from the archive). Written by field-watch (?history=<day>): every 15 minutes for
-- today, on demand for past days. Read like the other field tables: the supervisor of the agent, or a manager.

create table if not exists public.field_days (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  device_id text not null,
  device_name text not null default '',
  agent_id text,                       -- LINKO user id
  agent_name text,
  agent_user uuid references public.profiles(id) on delete set null,
  supervisor_id uuid references public.profiles(id) on delete set null,
  km real not null default 0,
  move_s int not null default 0,
  stop_s int not null default 0,
  first_at timestamptz,                -- first move of the day
  last_at timestamptz,                 -- last move of the day
  stops jsonb not null default '[]'::jsonb, -- [{a, b, lat, lon, key, name, planned, out:[{type, text, at}]}], a/b ISO
  linko jsonb not null default '{}'::jsonb, -- {plan, done, orders, paid, returns, rejections} of the agent's LINKO day
  updated_at timestamptz not null default now(),
  primary key (owner_id, day, device_id)
);
create index if not exists field_days_sup_idx on public.field_days (supervisor_id, day);
alter table public.field_days enable row level security;
revoke all on public.field_days from anon, authenticated;
grant select on public.field_days to authenticated;
drop policy if exists field_days_read on public.field_days;
create policy field_days_read on public.field_days for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));

-- today's history every 15 minutes during the working day (07:00–21:45 Tashkent = 02–16 UTC)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'field-history') then perform cron.unschedule('field-history'); end if;
end $$;
select cron.schedule('field-history', '*/15 2-16 * * *', $$
  select net.http_post(
    url := 'https://oxchgcfyzszemqlvdjjr.supabase.co/functions/v1/field-watch?cron=1&history=today&forceFunctionRegion=ap-southeast-1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-field-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'field_watch_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

notify pgrst, 'reload schema';
