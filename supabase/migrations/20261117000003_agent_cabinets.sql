-- MITAL CRM: the agent's own cabinet in the database.
-- The supervisor's CRM already builds each agent's part of the data (agentcab.js AC.snapshot: his clients and debts, plan / fact,
-- tasks, discipline and fines, pay slip, place in the leaderboard, stock of his warehouse). It is also written here, one row per
-- agent account (matched by profiles.linko_name), and the agent signed in with his own login reads it on me.html.
-- Who reads a row: the agent himself, his supervisor, РОП and admin (can_see_person). Who writes: anyone of them except the agent.

create table public.agent_cabinets (
  agent_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index agent_cabinets_updated_by_idx on public.agent_cabinets (updated_by);

alter table public.agent_cabinets enable row level security;
revoke all on public.agent_cabinets from anon;

create policy cab_read on public.agent_cabinets for select to authenticated using (public.can_see_person(agent_id));
create policy cab_insert on public.agent_cabinets for insert to authenticated
  with check (public.can_see_person(agent_id) and public.my_role() <> 'agent');
create policy cab_update on public.agent_cabinets for update to authenticated
  using (public.can_see_person(agent_id) and public.my_role() <> 'agent')
  with check (public.can_see_person(agent_id) and public.my_role() <> 'agent');
create policy cab_delete on public.agent_cabinets for delete to authenticated
  using (public.can_see_person(agent_id) and public.my_role() <> 'agent');
