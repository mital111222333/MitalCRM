// Входящие от бота JUMAVOY (supabase/functions/ai-bot → table crm_inbox). The bot cannot change the CRM state itself (it lives in
// this browser and in the owner's workspace), so it leaves requests and the owner's CRM applies them here:
//   atask — a task for an agent (Агенты → Задания агентам): payload { agent, title, text, due, notified }. notified = the bot has
//           already told the agent in Telegram, so the CRM does not send it a second time.
//   note  — a note / promise to pay on the client card: payload { client, text, promise?, sum? } (the same NOTES record as the card).
// Every 3 minutes while the CRM is open (or in «Режим офиса») and 15 s after start. Applied ids are kept in ext.botInbox, so a row
// whose «applied» mark did not reach the database is never applied twice.
const BOTIN = {
  busy: false,
  done() { const x = CRMLocal.ext(); return (x.botInbox ||= []); },
  async pull() {
    const owner = typeof BOTSNAP !== 'undefined' ? BOTSNAP.owner() : null;
    if (!owner || BOTIN.busy || window.CLOUD?.gate?.()) return 0;
    BOTIN.busy = true;
    try {
      const { data, error } = await AUTH.sb.from('crm_inbox').select('id, kind, payload, created_at').eq('owner_id', owner).is('applied_at', null).order('id').limit(50);
      if (error) throw error;
      if (!data?.length) return 0;
      const seen = new Set(BOTIN.done()), results = [];
      for (const r of data) {
        let res = 'уже было';
        if (!seen.has(r.id)) {
          try { res = await BOTIN.apply(r); } catch (e) { res = 'ошибка: ' + (e?.message || e); }
          BOTIN.done().push(r.id); seen.add(r.id);
        }
        results.push({ id: r.id, res });
      }
      CRMLocal.ext().botInbox = BOTIN.done().slice(-500);
      CRMLocal.touch();
      await CRMLocal.flush?.(); // saved before the rows are marked: nothing is lost if the page closes now
      for (const x of results) await AUTH.sb.from('crm_inbox').update({ applied_at: new Date().toISOString(), result: x.res }).eq('id', x.id);
      if (typeof AC !== 'undefined' && results.some(x => /задание/.test(x.res))) AC.publish({ force: true }).catch(() => {});
      toast(`JUMAVOY: внесено в CRM — ${results.length}`);
      return results.length;
    } catch (e) { console.warn('botinbox', e); return 0; } finally { BOTIN.busy = false; }
  },
  async apply(r) {
    const p = r.payload || {};
    if (r.kind === 'atask') {
      if (!p.agent || !p.title) return 'пропущено: нет агента или текста';
      const id = ATK.all().reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
      ATK.all().push({ id, agent: p.agent, kind: 'task', title: String(p.title).slice(0, 150), text: String(p.text || '').slice(0, 500), link: '', due: p.due || UI.localDate(Date.now()), created: r.created_at || new Date().toISOString(), status: 'open', done: null, back: null, by: 'JUMAVOY' });
      if (!p.notified) try { await ATK.notify(p.agent, `🆕 <b>Новое задание</b>\n${esc(p.title)}${p.text ? '\n' + esc(p.text) : ''}\nСрок: ${UI.dateRu(p.due)}`); } catch { /* Telegram not reachable */ }
      return 'задание добавлено';
    }
    if (r.kind === 'note') {
      if (!p.client) return 'пропущено: нет клиента';
      const n = { text: String(p.text || '') };
      if (p.promise) { n.promise = p.promise; n.sum = Number(p.sum) || 0; }
      NOTES.add(p.client, n);
      return p.promise ? 'обещание записано' : 'пометка записана';
    }
    return 'неизвестный тип';
  },
};

(() => {
  Promise.resolve(window.CRMLocal?.ready).then(() => setTimeout(() => BOTIN.pull(), 15000));
  setInterval(() => { if (document.visibilityState === 'visible' || (typeof AC !== 'undefined' && AC.office())) BOTIN.pull(); }, 3 * 60000);
})();
