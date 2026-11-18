-- Mital AI: расписание (напоминания, утренний план, вечерний итог, тревоги).
-- Выполнить ОДИН раз в Supabase → SQL Editor, после миграции 20261118000001_mital_ai.sql.
-- Замените ВАШ_TG_SECRET на тот же пароль, что в секрете TG_SECRET функции ai-bot.
-- Пароль хранится в Supabase Vault (зашифрован), в тексте задачи его нет.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('ВАШ_TG_SECRET', 'mital_ai_secret', 'пароль ai-bot для вызова по расписанию');

-- раз в минуту: функция сама решает, что пора отправить (напоминания — сразу, утро/вечер — в свой час, один раз в день)
select cron.schedule('mital-ai-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://oxchgcfyzszemqlvdjjr.supabase.co/functions/v1/ai-bot?cron=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mital-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'mital_ai_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);

-- проверить:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 5;
-- выключить:   select cron.unschedule('mital-ai-tick');
-- сменить пароль: select vault.update_secret((select id from vault.secrets where name = 'mital_ai_secret'), 'НОВЫЙ_ПАРОЛЬ');
