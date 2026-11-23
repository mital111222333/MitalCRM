-- База клиентов в CRM (раздел «База клиентов»): то, что владелец рассказывает JUMAVOY о клиентах, теперь видно и в MitalCRM,
-- и туда же можно дописывать прямо из CRM. Одна таблица ai_client_info для бота и для CRM.
--   owner_id — чья это база (аккаунт владельца CRM). Бот пишет owner_id = владелец CRM; CRM видит и меняет только свои строки.
--   side     — для цены: buy = по какой цене клиент ПОКУПАЕТ (у нас или у другого поставщика), sell = по какой цене он ПРОДАЁТ.
--   source   — откуда запись: bot (сказали JUMAVOY) или crm (внесли в CRM руками).
--   category + preference — «что любит, характер, как с ним говорить».
-- Повторный запуск безопасен (всё через if not exists / drop if exists).

alter table public.ai_client_info add column if not exists owner_id uuid references public.profiles (id) on delete cascade;
alter table public.ai_client_info add column if not exists side text not null default '';
alter table public.ai_client_info add column if not exists source text not null default 'bot';
alter table public.ai_client_info alter column chat_id drop not null;

alter table public.ai_client_info drop constraint if exists ai_client_info_category_check;
alter table public.ai_client_info add constraint ai_client_info_category_check
  check (category in ('contact', 'supplier', 'oil', 'price', 'contract', 'volume', 'equipment', 'competitor', 'preference', 'note'));
alter table public.ai_client_info drop constraint if exists ai_client_info_side_check;
alter table public.ai_client_info add constraint ai_client_info_side_check check (side in ('', 'buy', 'sell'));
alter table public.ai_client_info drop constraint if exists ai_client_info_source_check;
alter table public.ai_client_info add constraint ai_client_info_source_check check (source in ('bot', 'crm'));
alter table public.ai_client_info drop constraint if exists ai_client_info_whose_check;
alter table public.ai_client_info add constraint ai_client_info_whose_check check (chat_id is not null or owner_id is not null);

-- старые записи бота — владельцу CRM (бот работает с одной CRM: самой свежей или CRM_OWNER_ID; бот и сам допишет owner_id)
update public.ai_client_info set owner_id = (select w.owner_id from public.workspaces w order by w.saved_at desc limit 1)
  where owner_id is null and (select count(*) from public.workspaces) = 1;

create index if not exists ai_client_info_owner_idx on public.ai_client_info (owner_id, client);

-- доступ из CRM: владелец — свои строки (читать, добавлять, отмечать заменённые, удалять ошибочные); РОП и админ — читать
grant select, insert, update, delete on public.ai_client_info to authenticated;
grant usage on sequence public.ai_client_info_id_seq to authenticated;
drop policy if exists ci_read on public.ai_client_info;
create policy ci_read on public.ai_client_info for select to authenticated using (owner_id = (select auth.uid()) or public.is_manager());
drop policy if exists ci_insert on public.ai_client_info;
create policy ci_insert on public.ai_client_info for insert to authenticated
  with check (owner_id = (select auth.uid()) and chat_id is null and source = 'crm' and public.my_role() in ('admin', 'rop', 'supervisor'));
drop policy if exists ci_update on public.ai_client_info;
create policy ci_update on public.ai_client_info for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists ci_delete on public.ai_client_info;
create policy ci_delete on public.ai_client_info for delete to authenticated using (owner_id = (select auth.uid()));
