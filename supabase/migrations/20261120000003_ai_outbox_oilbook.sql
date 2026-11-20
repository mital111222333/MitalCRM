-- JUMAVOY ↔ OilBook: действие в админке OilBook (продлить подписку, подтвердить чек, одобрить заявку…) — такой же черновик
-- в ai_outbox, как сообщение агенту: выполняется только после кнопки «✅ Выполнить» (ai-bot → onButton → sendDraft).
alter table public.ai_outbox drop constraint if exists ai_outbox_kind_check;
alter table public.ai_outbox add constraint ai_outbox_kind_check check (kind in ('agent_msg', 'crm_task', 'oilbook'));
