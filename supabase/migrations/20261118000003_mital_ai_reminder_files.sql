-- Mital AI: a reminder can carry the photo / file the user sent with it (Telegram file_id, sent again when the reminder is due)
alter table public.ai_reminders add column if not exists file_id text;
alter table public.ai_reminders add column if not exists file_kind text check (file_kind in ('photo', 'document'));
