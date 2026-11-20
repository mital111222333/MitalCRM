-- JUMAVOY (ai-bot) personal tasks, like Google Tasks with a kanban board:
--   todo («К выполнению») → doing («В процессе») → done («Готово»).
-- Set from the chat («поставь задачу…», /tasks with buttons) and from the Telegram Mini App board (tasks.html).
-- Only the edge function (service role) touches it; the board signs its requests with Telegram initData.
create table if not exists public.ai_tasks (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  title text not null check (length(title) between 1 and 300),
  note text not null default '',
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority smallint not null default 0 check (priority between 0 and 2), -- 0 normal, 1 important, 2 urgent
  due date,
  sphere text not null default 'work',
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);
create index if not exists ai_tasks_open_idx on public.ai_tasks (chat_id, status, due);
create index if not exists ai_tasks_done_idx on public.ai_tasks (chat_id, done_at desc) where status = 'done';
alter table public.ai_tasks enable row level security; -- no policies: service role only
revoke all on public.ai_tasks from anon, authenticated;
revoke all on sequence public.ai_tasks_id_seq from anon, authenticated;
