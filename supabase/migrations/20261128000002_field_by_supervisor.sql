-- «Поле» by supervisor: every GPS device is tied to the agent's CRM account (profiles.linko_name ↔ GPS device name), and through
-- it to his supervisor. A supervisor reads only his own agents; admin / РОП read everything. Devices of nobody's agent
-- (other cities on the same GPS account) are visible only to managers.
-- Alerts are no longer sent to Telegram: field-watch writes them to field_events, the CRM page shows them.

alter table public.field_live add column if not exists agent_user uuid references public.profiles(id) on delete set null;
alter table public.field_live add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;
alter table public.field_visits add column if not exists agent_user uuid references public.profiles(id) on delete set null;
alter table public.field_visits add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;
alter table public.field_routes add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;
create index if not exists field_visits_sup_idx on public.field_visits (supervisor_id, day);

create table if not exists public.field_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  supervisor_id uuid references public.profiles(id) on delete set null,
  visit_id bigint references public.field_visits(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('enter', 'alert', 'exit', 'outcome')),
  minutes int,
  who text not null default '',
  place text not null default '',
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists field_events_day_idx on public.field_events (day, id);
alter table public.field_events enable row level security;
revoke all on public.field_events from anon, authenticated;
grant select on public.field_events to authenticated;

drop policy if exists field_live_read on public.field_live;
drop policy if exists field_routes_read on public.field_routes;
drop policy if exists field_visits_read on public.field_visits;
create policy field_live_read on public.field_live for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));
create policy field_routes_read on public.field_routes for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));
create policy field_visits_read on public.field_visits for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));
create policy field_events_read on public.field_events for select to authenticated using (public.is_manager() or supervisor_id = (select auth.uid()));

-- Telegram off: no chats (the function no longer falls back to the JUMAVOY owner)
update public.field_config set chat_ids = '{}';
