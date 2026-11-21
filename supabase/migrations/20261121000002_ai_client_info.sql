-- JUMAVOY (ai-bot): база знаний о клиентах — то, чего нет в LINKO/CRM: с кем клиент работает, какие масла у него есть,
-- цены (наши и чужие), договоры с другими поставщиками, контакты, объёмы, заметки. Владелец рассказывает боту словами,
-- бот раскладывает это на строки-факты. Новая строка с тем же клиентом + категорией + предметом + стороной не удаляет
-- старую, а помечает её replaced_by — история сохраняется. Выгрузка всей базы — Excel (/baza).
create table if not exists public.ai_client_info (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  client text not null check (length(client) between 1 and 200),      -- как называет владелец (или имя из CRM)
  crm_client text,                                                     -- точное имя клиента в CRM, если он там есть
  category text not null check (category in ('contact', 'supplier', 'oil', 'price', 'contract', 'volume', 'equipment', 'competitor', 'note')),
  subject text not null default '',  -- бренд / товар / тема («Mobil Super 3000 5W-40 4л», «владелец»)
  party text not null default '',    -- с кем: поставщик, сторона договора, чья цена («мы», «Ravshan Oil»)
  detail text not null default '',
  price numeric,
  currency text check (currency in ('USD', 'UZS', 'RUB', 'EUR')),
  unit text not null default '',     -- шт / л / коробка / бочка
  valid_from date,
  valid_to date,
  replaced_by bigint,
  created_at timestamptz not null default now()
);
create index if not exists ai_client_info_chat_idx on public.ai_client_info (chat_id, client) where replaced_by is null;
alter table public.ai_client_info enable row level security; -- no policies: service role only
revoke all on public.ai_client_info from anon, authenticated;
revoke all on sequence public.ai_client_info_id_seq from anon, authenticated;
