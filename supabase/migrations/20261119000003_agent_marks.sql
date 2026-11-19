-- Agent marks from the cabinet when the agent signed in with his own login (me.html, MITAL database).
-- Before this the buttons «✅ Выполнено», «💰 Сбор» (оплатил / обещал / отказ / недозвон) and «📝 Отсутствие» worked only through the
-- Google auto-loader (Telegram Mini App or the personal link). Now the agent writes the same record into crm_inbox (kind 'agent'),
-- addressed to the person whose CRM published his cabinet (agent_cabinets.updated_by), and that CRM applies it (botinbox.js).
-- The agent can only write as himself: payload.agent_id must be his id and payload.agent the agent name of HIS cabinet.
-- Photos for a task go to the private bucket agent-inbox/<agent id>/…; the agent writes only his folder, his supervisor reads it.

alter table public.crm_inbox drop constraint if exists crm_inbox_kind_check;
alter table public.crm_inbox add constraint crm_inbox_kind_check check (kind in ('atask', 'note', 'agent'));

drop policy if exists crm_inbox_agent_insert on public.crm_inbox;
create policy crm_inbox_agent_insert on public.crm_inbox for insert to authenticated with check (
  kind = 'agent'
  and payload ->> 'agent_id' = (select auth.uid())::text
  and owner_id = (select c.updated_by from public.agent_cabinets c where c.agent_id = (select auth.uid()))
  and payload ->> 'agent' = (select c.data ->> 'agent' from public.agent_cabinets c where c.agent_id = (select auth.uid()))
  and payload ->> 'act' in ('done', 'collect', 'absreq')
  and octet_length(payload::text) < 20000
);
grant insert on public.crm_inbox to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-inbox', 'agent-inbox', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists agent_inbox_insert on storage.objects;
create policy agent_inbox_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'agent-inbox' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists agent_inbox_read on storage.objects;
create policy agent_inbox_read on storage.objects for select to authenticated using (
  bucket_id = 'agent-inbox' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (public.my_role() <> 'agent' and public.can_see_person(((storage.foldername(name))[1])::uuid))));
