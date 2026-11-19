-- Store keepers (завсклад) get their own CRM login: role 'store'. Like an agent, a store keeper belongs to a supervisor and sees only
-- his own cabinet (me.html → the daily blind stock count). «Имя в LINKO» of a store keeper is the name of his warehouse.
-- The value must be committed before it is used, so it is a migration of its own.
alter type public.app_role add value if not exists 'store';
