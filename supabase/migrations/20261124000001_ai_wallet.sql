-- JUMAVOY wallet (👛 Hamyon): the owner's own money — expenses and income, by category, sphere and trip
-- (business trips: «komandirovka Namangan»). Written from the chat («benzinga 200 ming ketdi») and from the Telegram
-- Mini App wallet.html (history, edit, add), which talks to <function url>/wallet signed with Telegram initData.
-- Not the CRM (client payments) and not personal debts (ai_ledger: who owes whom).
create table if not exists public.ai_wallet (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null default 'UZS' check (currency in ('UZS', 'USD', 'RUB', 'EUR')),
  category text not null default 'Прочее' check (length(category) between 1 and 40),
  sphere text not null default 'personal' check (sphere in ('work', 'personal', 'family', 'friends', 'ideas')),
  trip text check (length(trip) <= 80),
  note text not null default '' check (length(note) <= 500),
  day date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_wallet_day_idx on public.ai_wallet (chat_id, day desc, id desc);
alter table public.ai_wallet enable row level security; -- no policies: service role only
revoke all on public.ai_wallet from anon, authenticated;
revoke all on sequence public.ai_wallet_id_seq from anon, authenticated;
