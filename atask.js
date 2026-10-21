// Задания агентам (Агенты → Задания агентам): tasks without a client — a lesson of MITAL Akademiya, any instruction — given to one or
// several agents. The agent sees them in his cabinet (me.html, Telegram Mini App) and presses «Выполнено» with a comment and an optional
// photo; the auto-loader (doPost) saves that to inbox/ in the private data repository and messages the supervisor at once.
// This module pulls inbox/ every few minutes: a mark on one of these tasks makes it «выполнено агентом», a mark on a client task
// (ag.tasks) sets its agent_done. The supervisor accepts it or sends it back with a comment; the agent gets a Telegram message.
// Stored in the synced state: ext.atasks = [{ id, agent, kind: 'academy'|'task', title, text, link, due, created, status, done, back }],
// ext.inboxSeen = { [inbox path]: 1 }, ext.taskMarks = { [client task id]: { at, comment, photo } }.
window.EXT_PAGES = window.EXT_PAGES || {};

const ATK = {
  ACADEMY: 'https://mital111222333.github.io/academy/',
  view: 'done', agent: '',
  all() { const x = CRMLocal.ext(); return (x.atasks ||= []); },
  seen() { const x = CRMLocal.ext(); return (x.inboxSeen ||= {}); },
  marks() { const x = CRMLocal.ext(); return (x.taskMarks ||= {}); },
  ST: { open: ['info', 'в работе'], done: ['warn', 'выполнено агентом — проверьте'], returned: ['crit', 'возвращено агенту'], closed: ['good', '✓ принято'] },
  cloud() { return typeof AC !== 'undefined' ? AC.cloud() : null; },
  head(c, accept = 'application/vnd.github+json') { return { Authorization: 'Bearer ' + c.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }; },
  api(c, path) { return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${path}`; },

  // tell the agent in Telegram, with a button that opens his cabinet (Mini App)
  async notify(agent, html) {
    const chat = typeof AC !== 'undefined' && AC.chatOf(agent); if (!chat) return false;
    const url = AC.web() ? AC.miniUrl() : '';
    await TG.call('sendMessage', { chat_id: Number(chat), parse_mode: 'HTML', text: html, ...(url ? { reply_markup: { inline_keyboard: [[{ text: '📱 Открыть задания', web_app: { url } }]] } } : {}) });
    return true;
  },

  // new marks of the agents from inbox/
  async pull() {
    const c = ATK.cloud(); if (!c || ATK._busy) return 0;
    ATK._busy = true;
    try {
      const r = await fetch(ATK.api(c, 'git/trees/HEAD?recursive=1') + '&t=' + Date.now(), { headers: ATK.head(c), cache: 'no-store' });
      if (!r.ok) return 0;
      const seen = ATK.seen(), fresh = ((await r.json()).tree || []).filter(t => t.type === 'blob' && /^inbox\/\d{4}-\d{2}-\d{2}\/[\w-]+\.json$/.test(t.path) && !seen[t.path]).map(t => t.path).sort();
      let n = 0;
      for (const path of fresh.slice(0, 50)) {
        const f = await fetch(ATK.api(c, 'contents/' + path) + '?t=' + Date.now(), { headers: ATK.head(c, 'application/vnd.github.raw'), cache: 'no-store' });
        if (!f.ok) continue;
        const m = await f.json().catch(() => null);
        if (m && m.act === 'done') {
          const done = { at: m.at, comment: m.comment || '', photo: m.photo || '' };
          if (m.src === 'x') { const t = ATK.all().find(x => String(x.id) === String(m.id) && x.agent === m.agent); if (t && t.status !== 'closed') { t.status = 'done'; t.done = done; n++; } }
          if (m.src === 'ag') { await CRMLocal.request('POST', '/api/ag/tasks', { id: Number(m.id), agent_done: true }).catch(() => {}); ATK.marks()[m.id] = done; n++; }
        }
        seen[path] = 1;
      }
      if (fresh.length) CRMLocal.touch();
      return n;
    } finally { ATK._busy = false; }
  },
  async photo(path) {
    const c = ATK.cloud(); if (!c) throw new Error('Синхронизация не настроена');
    const r = await fetch(ATK.api(c, 'contents/' + path), { headers: ATK.head(c, 'application/vnd.github.raw'), cache: 'no-store' });
    if (!r.ok) throw new Error('Фото не получено: ' + r.status);
    return URL.createObjectURL(await r.blob());
  },

  // the agent's tasks for his cabinet (agentcab.js snapshot): these tasks + his client tasks
  forAgent(agent, d) {
    const week = UI.localDate(Date.now() - 7 * 864e5), t0 = UI.localDate(Date.now()), marks = ATK.marks();
    const own = ATK.all().filter(t => t.agent === agent && (t.status !== 'closed' || (t.closedAt || '').slice(0, 10) >= week)).map(t => ({
      src: 'x', id: t.id, kind: t.kind, title: (t.kind === 'academy' ? '🎓 ' : '') + t.title, text: t.text || '', link: t.link || '', due: t.due || '', status: t.status, overdue: t.status === 'open' && !!t.due && t.due < t0, back: t.back?.comment || '' }));
    const client = (d.tasks || []).filter(t => t.agent === agent && (t.status !== 'done' || (marks[t.id]?.at || '').slice(0, 10) >= week)).map(t => ({
      src: 'ag', id: t.id, kind: 'client', title: `${t.kind} — ${t.client}`, text: t.text || '', link: '', due: t.due || '', status: t.status === 'done' ? (t.agent_done && !(t.pct >= 1) ? 'done' : 'closed') : 'open', overdue: t.status === 'overdue',
      progress: t.target > 0 && t.fact !== null ? `$${UI.fmt0(t.fact)} из $${UI.fmt0(t.target)}` : '' }));
    return [...own, ...client].sort((a, b) => (a.status === 'open' || a.status === 'returned' ? 0 : 1) - (b.status === 'open' || b.status === 'returned' ? 0 : 1) || (a.due || '9').localeCompare(b.due || '9'));
  },
};

// pull the agents' marks on start, then every 5 minutes while the CRM is open
(() => {
  const run = () => ATK.pull().then(n => { if (n) { toast(`Новые отметки агентов: ${n} — Агенты → Задания агентам`); if (typeof AC !== 'undefined') AC.publish({ force: true }).catch(() => {}); if (location.hash === '#/atk') route(); } }).catch(e => console.warn('inbox', e));
  Promise.resolve(CRMLocal.ready).then(() => setTimeout(run, 8000));
  setInterval(() => { if (document.visibilityState === 'visible' || (typeof AC !== 'undefined' && AC.office())) run(); }, 5 * 60000);
})();

EXT_PAGES.atk = async el => {
  await CRMLocal.ready;
  const d = await REP.load(), f = UI.fmt0, t0 = UI.localDate(Date.now());
  const names = d.empty ? [] : d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  const L = ATK.all().slice().sort((a, b) => b.id - a.id);
  const cnt = k => L.filter(t => t.status === k).length;
  const list = L.filter(t => (ATK.view === 'all' || t.status === ATK.view) && (!ATK.agent || t.agent === ATK.agent));
  const marks = ATK.marks(), clientDone = (d.tasks || []).filter(t => marks[t.id] && t.agent_done && (marks[t.id].at || '').slice(0, 10) >= UI.localDate(Date.now() - 7 * 864e5));
  const when = v => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="page-head"><div><h2>Задания агентам</h2><div class="sub">Агент видит задания в своём кабинете в Telegram и отмечает «Выполнено» с комментарием и фото. Вам сразу приходит сообщение, а здесь задание ждёт проверки.</div></div>
    <div class="actions"><button class="btn gray" id="atPull">Проверить отметки</button></div></div>
    <div class="kpis">${UI.tile('Ждут проверки', f(cnt('done')), { sub: 'агент отметил «Выполнено»', tone: cnt('done') ? 'warn' : '' })}${UI.tile('В работе', f(cnt('open')), { sub: `просрочено ${f(L.filter(t => t.status === 'open' && t.due && t.due < t0).length)}` })}${UI.tile('Возвращено', f(cnt('returned')), { sub: 'на доработку' })}${UI.tile('Принято', f(cnt('closed')), { sub: 'всего', tone: 'good' })}</div>
    ${UI.panel('Новое задание', `<div class="form">
      <label>Кому<select id="atWho" multiple size="${Math.min(6, Math.max(3, names.length))}">${names.map(n => `<option>${esc(n)}</option>`).join('')}</select><small class="mut">Ctrl или долгое нажатие — несколько</small></label>
      <label>Тип<select id="atKind"><option value="academy">🎓 Урок академии</option><option value="task">Задание</option></select></label>
      <label>Что сделать<input id="atTitle" maxlength="150" placeholder="например: Урок 2 — работа с возражениями"></label>
      <label>Срок<input id="atDue" type="date" value="${UI.localDate(Date.now() + 3 * 864e5)}"></label>
      <label style="grid-column:1/-1">Подробнее (необязательно)<input id="atText" maxlength="500" placeholder="что именно и как отчитаться"></label>
      <label style="grid-column:1/-1">Ссылка (необязательно)<input id="atLink" type="url" value="${ATK.ACADEMY}" placeholder="https://…"></label></div>
      <small id="atErr" class="neg" role="alert"></small><div class="bar"><span class="spacer"></span><button class="btn" id="atAdd">Дать задание и сообщить в Telegram</button></div>`, { cls: 'w12', sub: 'Агенту сразу придёт сообщение с кнопкой «Открыть задания».' })}
    <div class="bar"><select id="atV" aria-label="Статус">${[['done', `Ждут проверки (${cnt('done')})`], ['open', `В работе (${cnt('open')})`], ['returned', `Возвращено (${cnt('returned')})`], ['closed', `Принято (${cnt('closed')})`], ['all', 'Все']].map(([k, n]) => `<option value="${k}" ${ATK.view === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="atA" aria-label="Агент"><option value="">Все агенты</option>${names.map(n => `<option ${n === ATK.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    ${UI.panel('Задания', list.length ? `<ul class="notes">${list.map(t => `<li><div>${UI.pill(...ATK.ST[t.status])} <b>${t.kind === 'academy' ? '🎓 ' : ''}${esc(t.title)}</b> — ${LX.ag(t.agent)} <span class="mut">· до ${UI.dateRu(t.due)}${t.status === 'open' && t.due && t.due < t0 ? ' · <b class="neg">просрочено</b>' : ''}</span></div>
      ${t.text ? `<div class="mut">${esc(t.text)}</div>` : ''}
      ${t.done ? `<div>💬 ${esc(t.done.comment || 'без комментария')} <span class="mut">· ${when(t.done.at)}</span>${t.done.photo ? ` · <a href="#" data-ph="${esc(t.done.photo)}">📷 фото</a>` : ''}</div>` : ''}
      ${t.back ? `<div class="neg">↩ ${esc(t.back.comment)}</div>` : ''}
      <div class="needs-edit">${t.status === 'done' ? `<button class="btn sm" data-ok="${t.id}">✓ Принять</button> <button class="btn gray sm" data-back="${t.id}">↩ Вернуть</button> ` : ''}${t.status !== 'closed' ? `<button class="btn gray sm" data-del="${t.id}">Удалить</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="mut">Пусто.</p>', { cls: 'w12' })}
    ${clientDone.length ? UI.panel('Задания по клиентам, отмеченные агентами (7 дней)', `<ul class="notes">${clientDone.map(t => `<li><div>${UI.pill('good', '✓ агент выполнил')} <b>${esc(t.kind)}</b> — ${LX.cl(t.client)} · ${LX.ag(t.agent)}</div><div>💬 ${esc(marks[t.id].comment || 'без комментария')}${marks[t.id].photo ? ` · <a href="#" data-ph="${esc(marks[t.id].photo)}">📷 фото</a>` : ''}</div></li>`).join('')}</ul>`, { cls: 'w12', sub: 'Задания по клиентам дают «Спящие клиенты», ИИ-ассистент и карточка клиента; агент отмечает их в своём кабинете.' }) : ''}`;
  const re = () => EXT_PAGES.atk(el), save = () => { CRMLocal.touch(); if (typeof AC !== 'undefined') AC.publish({ force: true }).catch(() => {}); };
  $('#atV', el).onchange = e => { ATK.view = e.target.value; re(); };
  $('#atA', el).onchange = e => { ATK.agent = e.target.value; re(); };
  $('#atKind', el).onchange = e => { const l = $('#atLink', el); if (e.target.value === 'academy' && !l.value) l.value = ATK.ACADEMY; if (e.target.value === 'task' && l.value === ATK.ACADEMY) l.value = ''; };
  $('#atPull', el).onclick = async () => { try { const n = await ATK.pull(); toast(n ? `Новые отметки: ${n}` : 'Новых отметок нет'); if (n) { save(); re(); } } catch (e) { toast(e.message); } };
  $('#atAdd', el).onclick = async () => {
    const who = [...$('#atWho', el).selectedOptions].map(o => o.value), title = $('#atTitle', el).value.trim(), due = $('#atDue', el).value, link = $('#atLink', el).value.trim(), err = $('#atErr', el);
    if (!who.length) return (err.textContent = 'Выберите агента');
    if (!title) return (err.textContent = 'Напишите, что сделать');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < t0) return (err.textContent = 'Срок: сегодня или позже');
    if (link && !/^https:\/\//.test(link)) return (err.textContent = 'Ссылка должна начинаться с https://');
    const kind = $('#atKind', el).value, text = $('#atText', el).value.trim();
    let id = ATK.all().reduce((m, t) => Math.max(m, t.id || 0), 0), sent = 0;
    for (const agent of who) {
      ATK.all().push({ id: ++id, agent, kind, title: title.slice(0, 150), text: text.slice(0, 500), link, due, created: new Date().toISOString(), status: 'open', done: null, back: null });
      try { if (await ATK.notify(agent, `🆕 <b>Новое задание</b>\n${kind === 'academy' ? '🎓 ' : ''}${esc(title)}${text ? '\n' + esc(text) : ''}\nСрок: ${UI.dateRu(due)}`)) sent++; } catch (e) { toast(e.message); }
    }
    save(); toast(`Задание дано: ${who.length} агентам${sent < who.length ? ` · в Telegram ушло ${sent}` : ''}`); re();
  };
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    const t = ATK.all().find(x => x.id === +b.dataset.ok); t.status = 'closed'; t.closedAt = new Date().toISOString(); save();
    try { await ATK.notify(t.agent, `✓ Задание принято: <b>${esc(t.title)}</b>`); } catch { /* Telegram not reachable */ } re();
  });
  el.querySelectorAll('[data-back]').forEach(b => b.onclick = async () => {
    const t = ATK.all().find(x => x.id === +b.dataset.back), why = prompt('Что доделать? Агент получит это сообщение.', ''); if (!why || !why.trim()) return;
    t.status = 'returned'; t.back = { at: new Date().toISOString(), comment: why.trim().slice(0, 500) }; save();
    try { await ATK.notify(t.agent, `↩ <b>Задание возвращено</b>: ${esc(t.title)}\n${esc(why.trim())}`); } catch (e) { toast(e.message); } re();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (!confirm('Удалить задание?')) return; CRMLocal.ext().atasks = ATK.all().filter(x => x.id !== +b.dataset.del); save(); re(); });
  el.querySelectorAll('[data-ph]').forEach(a => a.onclick = async e => { e.preventDefault(); try { const url = await ATK.photo(a.dataset.ph); const m = modal(`<img src="${url}" alt="Фото агента" style="max-width:100%;border-radius:8px"><div class="bar"><span class="spacer"></span><button class="btn gray" id="phX">Закрыть</button></div>`); $('#phX', m.el).onclick = () => { URL.revokeObjectURL(url); m.close(); }; } catch (err) { toast(err.message); } });
};
