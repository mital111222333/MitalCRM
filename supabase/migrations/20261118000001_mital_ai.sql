-- Mital AI (Telegram bot, Edge Function «ai-bot»): long-term memory, rules it was taught, reminders,
-- the knowledge notebook (documents it answers from, NotebookLM-style) and a log of sent briefs/alerts.
-- Only the Edge Function reads and writes these tables, with the service role key. RLS is on with no policies,
-- and anon / authenticated get no grants, so the CRM pages and agents cannot see the owner's chat.

-- the whole conversation (the bot reloads the last messages after a cold start)
create table public.ai_messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  role text not null check (role in ('user', 'model')),
  text text not null,
  tools text,
  created_at timestamptz not null default now()
);
create index ai_messages_chat_idx on public.ai_messages (chat_id, id desc);

-- fact = what the owner told it («агент в отпуске до 25.11»); rule = how to work («всегда показывай телефон»)
create table public.ai_memory (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  kind text not null check (kind in ('fact', 'rule')),
  text text not null check (length(text) between 1 and 1000),
  until date,
  created_at timestamptz not null default now()
);
create index ai_memory_chat_idx on public.ai_memory (chat_id, kind);

-- «напомни завтра в 10 позвонить X»; repeat: daily / weekly
create table public.ai_reminders (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  due_at timestamptz not null,
  text text not null check (length(text) between 1 and 1000),
  repeat text check (repeat in ('daily', 'weekly')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_reminders_due_idx on public.ai_reminders (due_at) where sent_at is null;
create index ai_reminders_chat_idx on public.ai_reminders (chat_id);

-- knowledge notebook: text of uploaded documents, links and notes (the original file stays in Telegram: tg_file_id)
create table public.ai_notebook (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  title text not null check (length(title) between 1 and 200),
  kind text not null check (kind in ('note', 'file', 'url')),
  content text not null check (length(content) between 1 and 400000),
  tg_file_id text,
  mime text,
  created_at timestamptz not null default now()
);
create index ai_notebook_chat_idx on public.ai_notebook (chat_id);

-- one row per sent brief / alert («morning:2026-11-18»): the bot never sends the same one twice
create table public.ai_events (
  key text primary key,
  created_at timestamptz not null default now()
);

alter table public.ai_messages enable row level security;
alter table public.ai_memory enable row level security;
alter table public.ai_reminders enable row level security;
alter table public.ai_notebook enable row level security;
alter table public.ai_events enable row level security;
revoke all on public.ai_messages, public.ai_memory, public.ai_reminders, public.ai_notebook, public.ai_events from anon, authenticated;
