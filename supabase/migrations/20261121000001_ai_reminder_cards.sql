-- JUMAVOY: every reminder is also a card on the kanban board (ai_tasks), with the same statuses
-- todo («К выполнению») → doing («В процессе») → done («Готово»). The reminder message has buttons
-- (done / in progress / snooze / cancel); deleting the card deletes its reminders.
alter table public.ai_reminders add column if not exists task_id bigint references public.ai_tasks(id) on delete cascade;
create index if not exists ai_reminders_task_idx on public.ai_reminders (task_id) where task_id is not null;

-- reminders that are still waiting get their card now
do $$
declare r record; tid bigint;
begin
  for r in select * from public.ai_reminders where sent_at is null and task_id is null loop
    insert into public.ai_tasks (chat_id, title, due, sphere)
    values (r.chat_id, left(r.text, 300), (r.due_at at time zone 'Asia/Tashkent')::date, coalesce(r.sphere, 'work'))
    returning id into tid;
    update public.ai_reminders set task_id = tid where id = r.id;
  end loop;
end $$;
