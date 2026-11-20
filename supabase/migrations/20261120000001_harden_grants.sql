-- Security hardening after the 20.11 audit. Nothing changes for the app: every rule below only removes rights that RLS already denied.
-- 1) Tables added after stage 1 (crm_inbox, ai_google, ai_outbox, ai_skills) kept Supabase's default grants for the anon role.
--    RLS has no anon policy so nothing leaked, but a single policy mistake would have opened them to anyone with the public key.
-- 2) TRUNCATE is not checked by RLS at all: no client role should ever hold it (nor TRIGGER / REFERENCES).
-- 3) JUMAVOY tables (ai_*) are read and written only by the ai-bot edge function with the service key: clients get no rights at all.
--    ai_google holds Google OAuth tokens.
-- 4) Default privileges: future tables in public no longer get anon rights or TRUNCATE automatically.

revoke all on public.crm_inbox, public.ai_google, public.ai_outbox, public.ai_skills from anon;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
    if t like 'ai\_%' then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- performance advisor: foreign key without an index
create index if not exists workspaces_saved_by_idx on public.workspaces (saved_by);
