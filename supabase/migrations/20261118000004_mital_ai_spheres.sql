-- Mital AI as a personal assistant: every memory record and reminder belongs to a sphere of life,
-- and personal money (who owes whom) is kept apart from the CRM debts of MITAL clients.
-- work = MITAL (CRM, clients, agents); personal; family; friends; ideas = business ideas.
-- Existing rows were all about work, so the default is 'work'.
alter table public.ai_memory add column sphere text not null default 'work'
  check (sphere in ('work', 'personal', 'family', 'friends', 'ideas'));
alter table public.ai_reminders add column sphere text not null default 'work'
  check (sphere in ('work', 'personal', 'family', 'friends', 'ideas'));

-- personal debts: one row per event. amount > 0 = the person owes me more (I lent / I paid back what I owed),
-- amount < 0 = I owe the person more (I borrowed / they paid me back). The balance of a person = sum(amount) per currency.
create table public.ai_ledger (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  sphere text not null default 'personal' check (sphere in ('work', 'personal', 'family', 'friends', 'ideas')),
  person text not null check (length(person) between 1 and 100),
  amount numeric(16, 2) not null check (amount <> 0),
  currency text not null default 'USD' check (currency in ('USD', 'UZS', 'RUB', 'EUR')),
  action text not null check (action in ('i_lent', 'i_borrowed', 'they_returned', 'i_returned')),
  note text check (length(note) <= 500),
  due date,
  created_at timestamptz not null default now()
);
create index ai_ledger_chat_idx on public.ai_ledger (chat_id, person);

-- only the Edge Function (service role) reads it: CRM pages and agents never see the owner's money
alter table public.ai_ledger enable row level security;
revoke all on public.ai_ledger from anon, authenticated;
revoke all on sequence public.ai_ledger_id_seq from anon, authenticated;
