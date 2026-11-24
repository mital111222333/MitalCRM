-- JUMAVOY for the team (team-bot): every agent's OWN kanban board and wallet — the same Mini Apps as the owner's
-- (tasks.html, wallet.html), opened from the agent's bot and signed with Telegram initData of the team bot.
-- Rows belong to the agent's login (user_id), so a new phone / Telegram keeps them. Only the edge function (service key)
-- touches these tables: nobody else, not even the owner's bot, reads an agent's tasks or money.
create table if not exists public.team_tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  note text not null default '',
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority smallint not null default 0 check (priority between 0 and 2),
  due date,
  sphere text not null default 'work',
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);
create index if not exists team_tasks_user_idx on public.team_tasks (user_id, status, due);
create table if not exists public.team_wallet (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null default 'UZS' check (currency in ('UZS', 'USD', 'RUB', 'EUR')),
  category text not null default 'Прочее' check (length(category) between 1 and 40),
  sphere text not null default 'personal' check (sphere in ('work', 'personal', 'family', 'friends', 'ideas')),
  trip text check (length(trip) <= 80),
  note text not null default '' check (length(note) <= 500),
  day date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_wallet_day_idx on public.team_wallet (user_id, day desc, id desc);
alter table public.team_tasks enable row level security;
alter table public.team_wallet enable row level security;
revoke all on public.team_tasks, public.team_wallet from anon, authenticated;
revoke all on sequence public.team_tasks_id_seq, public.team_wallet_id_seq from anon, authenticated;
