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
        if (m && await ATK.applyMark(m)) n++;
        seen[path] = 1;
      }
      if (fresh.length) CRMLocal.autoTouch(); // marks pulled from the cabinets — not an edit of yours
      return n;
    } finally { ATK._busy = false; }
  },
  // one mark of an agent — from inbox/ (Google auto-loader) or from the database (agent signed in with his login, botinbox.js)
  async applyMark(m) {
    if (m.act === 'done') {
      const done = { at: m.at, comment: m.comment || '', photo: m.photo || '' };
      if (m.src === 'x') { const t = ATK.all().find(x => String(x.id) === String(m.id) && x.agent === m.agent); if (t && t.status !== 'closed') { t.status = 'done'; t.done = done; return true; } return false; }
      // a task JUMAVOY put straight into the agent's cabinet (src 'j' = its crm_inbox id) → the CRM task made from it
      if (m.src === 'j') { const t = ATK.all().find(x => String(x.inbox) === String(m.id) && x.agent === m.agent); if (t && t.status !== 'closed') { t.status = 'done'; t.done = done; return true; } return false; }
      if (m.src === 'ag') { await CRMLocal.request('POST', '/api/ag/tasks', { id: Number(m.id), agent_done: true }).catch(() => {}); ATK.marks()[m.id] = done; return true; }
      return false;
    }
    return window.INBOX_HANDLERS?.[m.act] ? !!(await INBOX_HANDLERS[m.act](m)) : false; // collect (my.js), absreq (disc.js), count (wcount.js)
  },
  async photo(path) {
    // a photo sent from the cabinet signed in with the agent's login: MITAL database storage, bucket agent-inbox
    if (String(path).startsWith('sb:')) {
      const { data, error } = await AUTH.sb.storage.from('agent-inbox').download(path.slice(3));
      if (error) throw new Error('Фото не получено: ' + error.message);
      return URL.createObjectURL(data);
    }
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
    // a client task of a closed period is not shown: its «fact» is counted in the current period, so the agent saw «$0 из $1 500»
    // and «просрочено» on October tasks in November (the supervisor still has them in the CRM)
    const from = d.upload?.period_from || '';
    const client = (d.tasks || []).filter(t => t.agent === agent && !(from && t.due && t.due < from) && (t.status !== 'done' || (marks[t.id]?.at || '').slice(0, 10) >= week)).map(t => ({
      src: 'ag', id: t.id, kind: 'client', title: `${t.kind} — ${t.client}`, text: t.text || '', link: '', due: t.due || '', status: t.status === 'done' ? (t.agent_done && !(t.pct >= 1) ? 'done' : 'closed') : 'open', overdue: t.status === 'overdue',
      progress: t.target > 0 && t.fact !== null ? `$${UI.fmt0(t.fact)} из $${UI.fmt0(t.target)}` : '' }));
    return [...own, ...client].sort((a, b) => (a.status === 'open' || a.status === 'returned' ? 0 : 1) - (b.status === 'open' || b.status === 'returned' ? 0 : 1) || (a.due || '9').localeCompare(b.due || '9'));
  },
};

// pull the agents' marks on start, then every 5 minutes while the CRM is open
(() => {
  const run = () => ATK.pull().then(n => { if (n) { toast(`Новые отметки агентов: ${n} — Агенты → Задания агентам`); if (typeof AC !== 'undefined') AC.publish({ force: true }).catch(() => {}); if (location.hash === '#/atk' || location.hash === '#/wcount') route(); } }).catch(e => console.warn('inbox', e));
  Promise.resolve(CRMLocal.ready).then(() => setTimeout(run, 8000));
  setInterval(() => { if (document.visibilityState === 'visible' || (typeof AC !== 'undefined' && AC.office())) run(); }, 5 * 60000);
})();

// ---------- the page: tabs «Проверить» / «В работе» / «Принято» / «Все», agent chips, task cards, «+ Новое задание» in a window ----------
ATK.due = (d, t0) => { if (!d) return ['', 'без срока']; const n = Math.round((Date.parse(d) - Date.parse(t0)) / 864e5); return n < 0 ? ['wk-neg', `просрочено ${-n} дн.`] : n === 0 ? ['wk-neg', 'срок сегодня'] : n === 1 ? ['', 'срок завтра'] : ['', `срок ${UI.dm(d)} · через ${n} дн.`]; };
ATK.newTask = (names, t0, onDone) => {
  const plus = n => UI.localDate(Date.now() + n * 864e5), pick = new Set(ATK.agent ? [ATK.agent] : []);
  const m = modal(`<h3>Новое задание</h3><div class="wk-form">
    <label>Кому <span class="chips" id="ntWho"><button type="button" class="wk-chip" data-all>Всем агентам</button>${names.map(n => `<button type="button" class="wk-chip${pick.has(n) ? ' on' : ''}" data-who="${esc(n)}">${esc(n)}</button>`).join('')}</span></label>
    <label>Тип <span class="chips"><button type="button" class="wk-chip on" data-kind="task">📋 Задание</button><button type="button" class="wk-chip" data-kind="academy">🎓 Урок академии</button></span></label>
    <label>Что сделать<input id="ntTitle" maxlength="150" placeholder="например: собрать долг у 3 клиентов из списка" autocomplete="off"></label>
    <label>Срок <span class="chips">${[[0, 'Сегодня'], [1, 'Завтра'], [3, '3 дня'], [7, 'Неделя']].map(([n, t]) => `<button type="button" class="wk-chip${n === 3 ? ' on' : ''}" data-due="${plus(n)}">${t}</button>`).join('')}<input id="ntDue" type="date" value="${plus(3)}" min="${t0}" style="width:auto"></span></label>
    <label><span>Подробнее <span class="mut" style="font-weight:400">(необязательно)</span></span><textarea id="ntText" maxlength="500" rows="3" placeholder="что именно сделать и как отчитаться (фото, комментарий)"></textarea></label>
    <label id="ntLinkW" hidden>Ссылка на урок<input id="ntLink" type="url" value="${ATK.ACADEMY}" placeholder="https://…"></label>
    <small id="ntErr" class="neg" role="alert"></small></div>
    <div class="bar"><button class="btn gray" id="ntX" type="button">Отмена</button><span class="spacer"></span><button class="btn" id="ntOk" type="button">Дать задание</button></div>`);
  const $m = s => m.el.querySelector(s); let kind = 'task';
  const paint = () => { m.el.querySelectorAll('[data-who]').forEach(b => b.classList.toggle('on', pick.has(b.dataset.who))); $m('[data-all]').classList.toggle('on', names.length > 0 && pick.size === names.length); $m('#ntOk').textContent = pick.size > 1 ? `Дать задание ${pick.size} агентам` : 'Дать задание'; };
  m.el.querySelectorAll('[data-who]').forEach(b => b.onclick = () => { pick.has(b.dataset.who) ? pick.delete(b.dataset.who) : pick.add(b.dataset.who); paint(); });
  $m('[data-all]').onclick = () => { if (pick.size === names.length) pick.clear(); else names.forEach(n => pick.add(n)); paint(); };
  m.el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; m.el.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b)); $m('#ntLinkW').hidden = kind !== 'academy'; });
  m.el.querySelectorAll('[data-due]').forEach(b => b.onclick = () => { $m('#ntDue').value = b.dataset.due; m.el.querySelectorAll('[data-due]').forEach(x => x.classList.toggle('on', x === b)); });
  $m('#ntDue').oninput = () => m.el.querySelectorAll('[data-due]').forEach(x => x.classList.toggle('on', x.dataset.due === $m('#ntDue').value));
  $m('#ntX').onclick = m.close; paint(); setTimeout(() => $m('#ntTitle').focus(), 50);
  $m('#ntOk').onclick = async () => {
    const who = names.filter(n => pick.has(n)), title = $m('#ntTitle').value.trim(), due = $m('#ntDue').value, link = kind === 'academy' ? $m('#ntLink').value.trim() : '', text = $m('#ntText').value.trim(), err = $m('#ntErr');
    if (!who.length) return (err.textContent = 'Выберите, кому — хотя бы одного агента');
    if (!title) { err.textContent = 'Напишите, что сделать'; return $m('#ntTitle').focus(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < t0) return (err.textContent = 'Срок: сегодня или позже');
    if (link && !/^https:\/\//.test(link)) return (err.textContent = 'Ссылка должна начинаться с https://');
    $m('#ntOk').disabled = true;
    let id = ATK.all().reduce((x, t) => Math.max(x, t.id || 0), 0), sent = 0;
    for (const agent of who) {
      ATK.all().push({ id: ++id, agent, kind, title: title.slice(0, 150), text: text.slice(0, 500), link, due, created: new Date().toISOString(), status: 'open', done: null, back: null });
      try { if (await ATK.notify(agent, `🆕 <b>Новое задание</b>\n${kind === 'academy' ? '🎓 ' : ''}${esc(title)}${text ? '\n' + esc(text) : ''}\nСрок: ${UI.dateRu(due)}`)) sent++; } catch { /* Telegram not reachable */ }
    }
    m.close(); toast(`Задание дано: ${who.length} ${UI.plural(who.length, 'агенту', 'агентам', 'агентам')}${sent < who.length ? ` · в Telegram ушло ${sent} — у остальных Telegram не подключён` : ' · сообщили в Telegram'}`); onDone();
  };
};

EXT_PAGES.atk = async el => {
  await CRMLocal.ready;
  const d = await REP.load(), t0 = UI.localDate(Date.now());
  const names = d.empty ? [] : d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  const L = ATK.all().slice().sort((a, b) => b.id - a.id), mineA = t => !ATK.agent || t.agent === ATK.agent;
  const G = { done: t => t.status === 'done', work: t => t.status === 'open' || t.status === 'returned', closed: t => t.status === 'closed', all: () => true };
  const late = t => (t.status === 'open' || t.status === 'returned') && t.due && t.due < t0;
  const n = k => L.filter(t => mineA(t) && G[k](t)).length;
  if (!ATK._v) ATK._v = n('done') ? 'done' : 'work';
  const v = G[ATK._v] ? ATK._v : 'work';
  // to check first, then overdue, then by due date
  const list = L.filter(t => mineA(t) && G[v](t)).sort((a, b) => (b.status === 'done') - (a.status === 'done') || late(b) - late(a) || (v === 'closed' ? String(b.closedAt || '').localeCompare(String(a.closedAt || '')) : String(a.due || '9').localeCompare(String(b.due || '9'))));
  const marks = ATK.marks(), clientDone = (d.tasks || []).filter(t => marks[t.id] && t.agent_done && (marks[t.id].at || '').slice(0, 10) >= UI.localDate(Date.now() - 7 * 864e5) && mineA(t));
  const when = x => new Date(x).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const active = a => L.filter(t => t.agent === a && t.status !== 'closed').length;
  const card = t => { const [dc, dt] = ATK.due(t.due, t0), st = ATK.ST[t.status];
    return `<div class="wk-item ${t.status === 'done' ? 'need' : t.status === 'closed' ? 'done' : late(t) || t.status === 'returned' ? 'late' : ''}" data-t="${t.id}">
      <div class="h"><div><div class="nm">${t.kind === 'academy' ? '🎓 ' : ''}${esc(t.title)}</div><small>${LX.ag(t.agent)} · <span class="${t.status === 'closed' ? '' : dc}">${t.status === 'closed' ? 'принято ' + (t.closedAt ? UI.dm(t.closedAt.slice(0, 10)) : '') : dt}</span> · дано ${UI.dm(String(t.created || '').slice(0, 10))}</small></div>
        <div class="num">${UI.pill(st[0], st[1])}</div></div>
      ${t.text ? `<div class="txt">${esc(t.text)}</div>` : ''}${t.link ? `<div class="row2"><a href="${esc(t.link)}" target="_blank" rel="noopener">🔗 ${t.kind === 'academy' ? 'Урок' : 'Ссылка'}</a></div>` : ''}
      ${t.done ? `<div class="rep">💬 ${esc(t.done.comment || 'без комментария')} <span class="mut">· ${when(t.done.at)}</span>${t.done.photo ? ` · <a href="#" data-ph="${esc(t.done.photo)}">📷 фото</a>` : ''}</div>` : ''}
      ${t.back ? `<div class="back">↩ Вы вернули: ${esc(t.back.comment)} <span class="mut">· ${when(t.back.at)}</span></div>` : ''}
      <div class="row2 needs-edit">${t.status === 'done' ? `<button class="btn sm" data-ok="${t.id}">✓ Принять</button><button class="btn gray sm" data-back="${t.id}">↩ Вернуть на доработку</button>` : ''}
        ${t.status === 'open' || t.status === 'returned' ? `<button class="btn gray sm" data-nudge="${t.id}">🔔 Напомнить</button>` : ''}
        <span class="spacer"></span>${t.status !== 'closed' ? `<button class="btn gray sm" data-del="${t.id}" title="Удалить задание">🗑</button>` : ''}</div>
      <div class="wk-form" data-bf="${t.id}" hidden style="margin-top:10px"><textarea maxlength="500" rows="2" placeholder="Что доделать? Агент получит это в Telegram"></textarea><div class="row2"><button class="btn gray sm" data-bx>Отмена</button><button class="btn sm" data-bs="${t.id}">Отправить агенту</button></div></div>
    </div>`; };
  const tabs = [['done', 'Проверить', n('done'), true], ['work', 'В работе', n('work')], ['closed', 'Принято', n('closed')], ['all', 'Все', 0]];
  el.innerHTML = `<div class="page-head"><div><h2>Задания агентам</h2><div class="sub">Агент получает задание в Telegram, отмечает «Выполнено» с комментарием и фото — вы проверяете здесь.</div></div>
    <div class="actions"><button class="btn gray" id="atPull">🔄 Проверить</button><button class="btn needs-edit" id="atNew">+ Новое задание</button></div></div>
    <div class="wk-seg" role="tablist">${tabs.map(([k, t, c, hot]) => `<button type="button" role="tab" data-v="${k}" class="${v === k ? 'on' : ''}" aria-selected="${v === k}">${t}${c ? ` <span class="wk-badge${hot ? '' : ' soft'}">${c}</span>` : ''}</button>`).join('')}</div>
    ${names.length ? `<div class="wk-tools"><button type="button" class="wk-chip${!ATK.agent ? ' on' : ''}" data-a="">Все агенты</button>${names.map(a => `<button type="button" class="wk-chip${ATK.agent === a ? ' on' : ''}" data-a="${esc(a)}">${esc(a)}${active(a) ? ` <span class="wk-badge soft">${active(a)}</span>` : ''}</button>`).join('')}</div>` : ''}
    ${v === 'work' && list.some(late) ? `<div class="wk-banner bad">⏰ Просрочено: <b>${list.filter(late).length}</b> — нажмите «🔔 Напомнить», агенту придёт сообщение.</div>` : ''}
    ${v === 'done' && list.length > 1 ? `<div class="wk-tools needs-edit"><span class="mut">Ждут проверки: ${list.length}</span><span class="spacer"></span><button class="btn gray sm" id="atOkAll">✓ Принять все (${list.length})</button></div>` : ''}
    ${list.length ? `<div class="wk-list">${list.map(card).join('')}</div>` : `<div class="wk-empty"><b>${v === 'done' ? '✓ Проверять нечего' : v === 'work' ? 'Активных заданий нет' : 'Пусто'}</b>${v === 'done' ? 'Когда агент отметит «Выполнено», задание появится здесь.' : '<button class="btn needs-edit" data-new style="margin-top:10px">+ Дать задание</button>'}</div>`}
    ${v === 'done' && clientDone.length ? `<h3 style="margin:20px 4px 8px">Задания по клиентам — отметки агентов за 7 дней</h3><div class="wk-list">${clientDone.map(t => `<div class="wk-item done"><div class="h"><div><div class="nm">${esc(t.kind)} — ${LX.cl(t.client)}</div><small>${LX.ag(t.agent)}${t.text ? ' · ' + esc(t.text) : ''}</small></div><div class="num">${UI.pill('good', '✓ агент выполнил')}</div></div><div class="rep">💬 ${esc(marks[t.id].comment || 'без комментария')}${marks[t.id].photo ? ` · <a href="#" data-ph="${esc(marks[t.id].photo)}">📷 фото</a>` : ''}</div></div>`).join('')}</div><p class="mut" style="margin:8px 4px">Задания по клиентам — во вкладке «Задания по клиентам» выше.</p>` : ''}`;
  const re = () => EXT_PAGES.atk(el), save = () => { CRMLocal.touch(); if (typeof AC !== 'undefined') AC.publish({ force: true }).catch(() => {}); };
  const byId = id => ATK.all().find(x => x.id === +id);
  el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ATK._v = b.dataset.v; re(); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { ATK.agent = b.dataset.a; re(); });
  el.querySelectorAll('#atNew, [data-new]').forEach(b => b.onclick = () => ATK.newTask(names, t0, () => { save(); ATK._v = 'work'; re(); }));
  $('#atPull', el).onclick = async () => { try { const k = await ATK.pull(); toast(k ? `Новые отметки: ${k}` : 'Новых отметок нет'); if (k) { save(); ATK._v = 'done'; re(); } } catch (e) { toast(e.message); } };
  const accept = async t => { t.status = 'closed'; t.closedAt = new Date().toISOString(); try { await ATK.notify(t.agent, `✓ Задание принято: <b>${esc(t.title)}</b>`); } catch { /* Telegram not reachable */ } };
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { b.disabled = true; await accept(byId(b.dataset.ok)); save(); toast('✓ Принято'); re(); });
  { const all = $('#atOkAll', el); if (all) all.onclick = async () => { if (!confirm(`Принять все ${list.length} заданий? Каждому агенту придёт «Задание принято».`)) return; all.disabled = true; for (const t of list) await accept(t); save(); toast(`✓ Принято: ${list.length}`); re(); }; }
  el.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { const f = el.querySelector(`[data-bf="${b.dataset.back}"]`); f.hidden = false; f.querySelector('textarea').focus(); });
  el.querySelectorAll('[data-bx]').forEach(b => b.onclick = () => { b.closest('[data-bf]').hidden = true; });
  el.querySelectorAll('[data-bs]').forEach(b => b.onclick = async () => {
    const t = byId(b.dataset.bs), why = b.closest('[data-bf]').querySelector('textarea').value.trim(); if (!why) return toast('Напишите, что доделать');
    b.disabled = true; t.status = 'returned'; t.back = { at: new Date().toISOString(), comment: why.slice(0, 500) }; save();
    try { await ATK.notify(t.agent, `↩ <b>Задание возвращено</b>: ${esc(t.title)}\n${esc(why)}`); } catch (e) { toast(e.message); } toast('↩ Возвращено агенту'); re();
  });
  el.querySelectorAll('[data-nudge]').forEach(b => b.onclick = async () => {
    const t = byId(b.dataset.nudge), dt = ATK.due(t.due, t0)[1].replace(/\.$/, ''); b.disabled = true;
    try { const ok = await ATK.notify(t.agent, `🔔 <b>Напоминание</b>: ${t.kind === 'academy' ? '🎓 ' : ''}${esc(t.title)}\n${dt.charAt(0).toUpperCase() + dt.slice(1)}. Когда сделаете — отметьте «Выполнено» в кабинете.`); t.nudged = new Date().toISOString(); save(); toast(ok ? '🔔 Напомнили в Telegram' : 'У агента не подключён Telegram — позвоните'); } catch (e) { toast(e.message); }
    b.textContent = '🔔 Напомнили';
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (!confirm('Удалить задание?')) return; CRMLocal.ext().atasks = ATK.all().filter(x => x.id !== +b.dataset.del); save(); re(); });
  el.querySelectorAll('[data-ph]').forEach(a => a.onclick = async e => { e.preventDefault(); try { const url = await ATK.photo(a.dataset.ph); const m = modal(`<img src="${url}" alt="Фото агента" style="max-width:100%;border-radius:8px"><div class="bar"><span class="spacer"></span><button class="btn gray" id="phX">Закрыть</button></div>`); $('#phX', m.el).onclick = () => { URL.revokeObjectURL(url); m.close(); }; } catch (err) { toast(err.message); } });
};
