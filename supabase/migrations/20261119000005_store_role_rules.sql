-- Rules for the store keeper role: a supervisor like an agent has; a cabinet-only person (agent or store keeper) never writes cabinets
-- and never reads other people's photos.
alter table public.profiles drop constraint if exists profiles_check;
alter table public.profiles add constraint profiles_check check (role in ('agent', 'store') or supervisor_id is null);

drop policy if exists cab_insert on public.agent_cabinets;
drop policy if exists cab_update on public.agent_cabinets;
drop policy if exists cab_delete on public.agent_cabinets;
create policy cab_insert on public.agent_cabinets for insert to authenticated
  with check (public.can_see_person(agent_id) and public.my_role() not in ('agent', 'store'));
create policy cab_update on public.agent_cabinets for update to authenticated
  using (public.can_see_person(agent_id) and public.my_role() not in ('agent', 'store'))
  with check (public.can_see_person(agent_id) and public.my_role() not in ('agent', 'store'));
create policy cab_delete on public.agent_cabinets for delete to authenticated
  using (public.can_see_person(agent_id) and public.my_role() not in ('agent', 'store'));

drop policy if exists agent_inbox_read on storage.objects;
create policy agent_inbox_read on storage.objects for select to authenticated using (
  bucket_id = 'agent-inbox' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (public.my_role() not in ('agent', 'store') and public.can_see_person(((storage.foldername(name))[1])::uuid))));
