-- Mital AI: how many Gemini requests the bot spent, per day and model (for /limits and the 80% warning).
-- The day is the Pacific-time date, because Google resets the free daily quota at midnight Pacific time.
-- Only the Edge Function (service role) writes and reads it.

create table public.ai_usage (
  day date not null,
  model text not null,
  requests integer not null default 0,
  limited integer not null default 0,   -- answers «429: limit exhausted»
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, model)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- atomic «+1»: two answers at the same moment never lose a count; returns the day's total for the model
create function public.ai_usage_add(p_day date, p_model text, p_req integer, p_limited integer, p_in bigint, p_out bigint)
returns integer language sql set search_path = '' as $$
  insert into public.ai_usage as u (day, model, requests, limited, tokens_in, tokens_out)
  values (p_day, p_model, p_req, p_limited, p_in, p_out)
  on conflict (day, model) do update set
    requests = u.requests + excluded.requests, limited = u.limited + excluded.limited,
    tokens_in = u.tokens_in + excluded.tokens_in, tokens_out = u.tokens_out + excluded.tokens_out, updated_at = now()
  returning requests;
$$;
revoke execute on function public.ai_usage_add(date, text, integer, integer, bigint, bigint) from public, anon, authenticated;
