-- JUMAVOY for the team: a separate Telegram bot (edge function team-bot) where every agent has his own assistant.
-- The bot reads ONLY the agent's own cabinet (agent_cabinets row of the linked profile). Its tables are separate from the
-- owner's JUMAVOY (ai_*): the owner's bot never sees agents' messages or reminders, and an agent's bot never sees the owner's.
-- All team_* tables are used only by the edge function with the service key: clients get no rights at all.

-- which Telegram chat belongs to which MITAL login (one Telegram account per login, one login per Telegram account)
create table if not exists public.team_users (
  chat_id bigint primary key,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  linked_at timestamptz not null default now()
);
-- one-time codes: the agent presses «Мой ассистент» in his cabinet (signed in) → code → t.me/<bot>?start=<code>
create table if not exists public.team_links (
  code text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists team_links_user_idx on public.team_links (user_id);
-- conversation history (the last messages are sent to the AI with each question)
create table if not exists public.team_messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.team_users (chat_id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  text text not null,
  tools text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists team_messages_chat_idx on public.team_messages (chat_id, id desc);
-- «запомни …» — facts the agent taught his assistant
create table if not exists public.team_memory (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.team_users (chat_id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists team_memory_chat_idx on public.team_memory (chat_id);
-- «напомни завтра в 10 …»
create table if not exists public.team_reminders (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.team_users (chat_id) on delete cascade,
  due_at timestamptz not null,
  text text not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_reminders_due_idx on public.team_reminders (due_at) where sent_at is null;
create index if not exists team_reminders_chat_idx on public.team_reminders (chat_id);
-- Gemini requests per agent per day (a personal daily limit keeps one agent from spending the whole team's quota)
create table if not exists public.team_usage (
  day date not null,
  chat_id bigint not null,
  requests integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, chat_id)
);

alter table public.team_users enable row level security;
alter table public.team_links enable row level security;
alter table public.team_messages enable row level security;
alter table public.team_memory enable row level security;
alter table public.team_reminders enable row level security;
alter table public.team_usage enable row level security;
revoke all on public.team_users, public.team_links, public.team_messages, public.team_memory, public.team_reminders, public.team_usage from anon, authenticated;

create or replace function public.team_usage_add(p_day date, p_chat bigint, p_n integer)
returns integer language sql set search_path = '' as $$
  insert into public.team_usage as u (day, chat_id, requests) values (p_day, p_chat, p_n)
  on conflict (day, chat_id) do update set requests = u.requests + excluded.requests, updated_at = now()
  returning requests;
$$;
revoke execute on function public.team_usage_add(date, bigint, integer) from public, anon, authenticated;
grant execute on function public.team_usage_add(date, bigint, integer) to service_role;

-- the schedule password lives only in Vault: pg_cron sends it, the function asks the database whether it is right
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'team_bot_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'team_bot_cron', 'team-bot: password of the every-minute schedule');
  end if;
end $$;
create or replace function public.team_cron_check(p text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(p <> '' and p = (select decrypted_secret from vault.decrypted_secrets where name = 'team_bot_cron'), false);
$$;
revoke execute on function public.team_cron_check(text) from public, anon, authenticated;
grant execute on function public.team_cron_check(text) to service_role;

-- every minute: reminders that are due (the function does nothing until the bot token TEAM_TG_TOKEN is set)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'team-bot-tick') then perform cron.unschedule('team-bot-tick'); end if;
end $$;
select cron.schedule('team-bot-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://oxchgcfyzszemqlvdjjr.supabase.co/functions/v1/team-bot?cron=1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-team-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'team_bot_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);
