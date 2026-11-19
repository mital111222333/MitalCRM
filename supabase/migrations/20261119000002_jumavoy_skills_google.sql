-- JUMAVOY: ideas from OpenJarvis.
--   ai_skills  — skills: named step-by-step procedures the bot loads only when a task needs them (agentskills.io style)
--   ai_google  — the owner's Google sign-in (Calendar, Gmail read-only, Contacts): only the refresh token, never a password
-- Like the other ai_* tables: RLS on without policies, so only the service role (the ai-bot function) can read or write.

create table if not exists public.ai_skills (
  id bigserial primary key,
  chat_id bigint not null,
  name text not null,
  description text not null default '',
  instructions text not null,
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  unique (chat_id, name)
);
alter table public.ai_skills enable row level security;

create table if not exists public.ai_google (
  chat_id bigint primary key,
  refresh_token text not null,
  scopes text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_google enable row level security;
