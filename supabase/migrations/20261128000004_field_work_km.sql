-- «Пульс»: working mileage for fuel — drives between 07:00 and 22:00 (a drive across the edge counts by its part inside),
-- and when the agent left home (his first drive) and came back home (the last stop within 300 m of where he spent the night,
-- before 22:00). km stays the whole day (00:00–24:00) as the GPS platform counts it. Filled by field-watch ?history=<day>.
alter table public.field_days add column if not exists work_km real;
alter table public.field_days add column if not exists home_out timestamptz;
alter table public.field_days add column if not exists home_in timestamptz;
notify pgrst, 'reload schema';
