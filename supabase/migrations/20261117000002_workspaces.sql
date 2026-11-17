-- MITAL CRM, stage 3: each team lead's CRM lives in the database instead of the GitHub file.
-- workspaces: one row per owner (supervisor or admin leading a team). The CRM state itself is a gzip file in the private
--   Storage bucket «workspaces» at <owner_id>/v<version>.json.gz (same format as the old crm-data.json.gz: {app, savedAt, device, state}).
--   version is the compare-and-swap counter: a device saves only if nobody saved a newer version meanwhile (old GitHub sha check).
-- workspace_secrets: the keys taken out of the state (Telegram bot token, AI key, LINKO web key) — only the owner reads them, nobody else.
-- Who sees a workspace: its owner, РОП and admin. Agents never.

create table public.workspaces (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  version bigint not null default 0,
  saved_at timestamptz not null default now(),
  saved_by uuid references public.profiles (id) on delete set null,
  device text,
  size integer,
  summary jsonb   -- counts (uploads, clients, tasks) for the РОП overview and for checking a move
);

create table public.workspace_secrets (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspace_secrets enable row level security;
revoke all on public.workspaces, public.workspace_secrets from anon;

create policy ws_read on public.workspaces for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());
create policy ws_insert on public.workspaces for insert to authenticated with check (
  (owner_id = (select auth.uid()) and public.my_role() in ('admin', 'rop', 'supervisor')) or public.is_manager());
create policy ws_update on public.workspaces for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_manager()) with check (owner_id = (select auth.uid()) or public.is_manager());
create policy ws_delete on public.workspaces for delete to authenticated using (public.my_role() = 'admin');

create policy wss_read on public.workspace_secrets for select to authenticated using (owner_id = (select auth.uid()));
create policy wss_insert on public.workspace_secrets for insert to authenticated with check (owner_id = (select auth.uid()) and public.my_role() is not null);
create policy wss_update on public.workspace_secrets for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create trigger workspaces_audit after insert or delete on public.workspaces for each row execute function public.write_audit();

-- ---------- the private file bucket ----------
insert into storage.buckets (id, name, public, file_size_limit) values ('workspaces', 'workspaces', false, 52428800)
  on conflict (id) do nothing;

create policy ws_files_read on storage.objects for select to authenticated using (
  bucket_id = 'workspaces' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_manager()));
create policy ws_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'workspaces' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_manager()));
create policy ws_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'workspaces' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_manager()));

-- re-saving the same version after a broken connection overwrites the file (upload with upsert needs the update right)
create policy ws_files_update on storage.objects for update to authenticated
  using (bucket_id = 'workspaces' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_manager()))
  with check (bucket_id = 'workspaces' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_manager()));
