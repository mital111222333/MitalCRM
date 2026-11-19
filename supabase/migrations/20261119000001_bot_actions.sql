-- JUMAVOY (ai-bot) actions.
-- ai_outbox: what the bot prepared and waits for the owner's «✅ Отправить» button (a message to an agent, a task for an agent).
--   Only the edge function (service role) touches it.
-- crm_inbox: changes the bot asks the CRM to make (a task, a note / promise to pay on a client card). The CRM of the workspace
--   owner (botinbox.js) applies them the next time it is open and marks applied_at. The owner may read and mark only his rows.
create table if not exists public.ai_outbox (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  kind text not null check (kind in ('agent_msg', 'crm_task')),
  target text not null,
  text text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'sent', 'cancelled', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists ai_outbox_chat_idx on public.ai_outbox (chat_id, created_at desc);
alter table public.ai_outbox enable row level security; -- no policies: service role only

create table if not exists public.crm_inbox (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('atask', 'note')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  result text
);
create index if not exists crm_inbox_open_idx on public.crm_inbox (owner_id) where applied_at is null;
alter table public.crm_inbox enable row level security;
drop policy if exists crm_inbox_read on public.crm_inbox;
create policy crm_inbox_read on public.crm_inbox for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists crm_inbox_mark on public.crm_inbox;
create policy crm_inbox_mark on public.crm_inbox for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
