// Кредитный контроль (Деньги → Кредитный контроль): a client is on stop when its debt is over its limit or part of the debt is
// older than the chosen LINKO age bucket. Orders created for clients on stop are listed as violations, by agent.
// The same rules are saved as credit-rules.json in the private data repository, so the Google auto-loader (autolinko.gs, stop_)
// checks every new order within 5 minutes and sends a Telegram message even when the CRM is closed.
// Stored in the synced state: ext.credit = { limit: 0, age: 2, minOld: 5, clients: { [name]: { limit?, ex? } }, publishedAt }.
window.EXT_PAGES = window.EXT_PAGES || {};

const CR = {
  view: 'stop', agent: '',
  FILE: 'credit-rules.json',
  cfg() { const x = CRMLocal.ext(); return (x.credit ||= { limit: 0, age: 2, minOld: 5, clients: {} }); },
  // «старше 60 дн.» for the age choice i (1..3): the upper bound of the LINKO bucket before it
  ageText(i) { const c = (LX.d('debtcfg')[0] || {}).config || {}, p = [c.first_debt_period, c.second_debt_period, c.third_debt_period].map(Number)[i - 1]; return p > 0 ? `старше ${p} дн.` : ['старше 1-го срока', 'старше 2-го срока', 'старше 3-го срока'][i - 1]; },
  closed: s => /cancel|reject|return|отмен|отклон|возвр/i.test(String(s)),

  // status of every debtor from LINKO «Должники по срокам» (buckets already capped by the real balance in LX.aging)
  model() {
    const { labels, rows } = LX.aging(), c = CR.cfg(), age = Math.min(3, Math.max(1, Number(c.age) || 2)), minOld = Number(c.minOld) || 0;
    const list = rows.map(r => {
      const own = c.clients[r.name] || {}, limit = own.limit ?? (Number(c.limit) || 0), old = r.b.slice(age).reduce((a, v) => a + v, 0);
      const why = [];
      if (old >= minOld && old > 0.005) why.push(`долг ${CR.ageText(age)}: ${LX.money(old, r.cur)}`);
      if (limit > 0 && r.total > limit) why.push(`долг ${LX.money(r.total, r.cur)} больше лимита ${LX.money(limit, r.cur)}`);
      const st = own.ex ? 'ex' : why.length ? 'stop' : limit > 0 && r.total >= limit * 0.8 ? 'near' : 'ok';
      return { ...r, limit, ownLimit: own.limit ?? null, ex: own.ex || '', old, why, st };
    });
    const by = new Map(list.map(r => [r.name, r]));
    const M = LX.model(), hits = M.ords.filter(o => o.client && by.get(o.client)?.st === 'stop' && !CR.closed(o.status)).map(o => ({ ...o, info: by.get(o.client) })).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return { labels, age, list, hits, cur: rows[0]?.cur || '' };
  },

  // rules for the auto-loader: only what it needs, no client data besides names with their own limit / exception
  rules() {
    const c = CR.cfg(), age = Math.min(3, Math.max(1, Number(c.age) || 2));
    const clients = {}; for (const [n, v] of Object.entries(c.clients || {})) if (v.limit != null || v.ex) clients[n] = { ...(v.limit != null ? { limit: v.limit } : {}), ...(v.ex ? { ex: 1 } : {}) };
    return { v: 1, on: true, limit: Number(c.limit) || 0, age, minOld: Number(c.minOld) || 0, ageLabel: CR.ageText(age), clients, crm: location.origin + location.pathname };
  },
  // save credit-rules.json next to the synced data (same repository and key as «Синхронизация»)
  async publish() {
    const cc = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null;
    if (!cc || !cc.token || !cc.owner || !cc.repo) return { off: true };
    const url = `https://api.github.com/repos/${encodeURIComponent(cc.owner)}/${encodeURIComponent(cc.repo)}/contents/${CR.FILE}`, h = { Authorization: 'Bearer ' + cc.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const text = JSON.stringify({ ...CR.rules(), at: new Date().toISOString() }, null, 1);
    const cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' });
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const r = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'CRM: правила стоп-отгрузки', content: btoa(bin), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub не принял правила: ' + r.status);
    CR.cfg().publishedAt = new Date().toISOString(); CRMLocal.touch();
    return { ok: true };
  },
  changed() { CRMLocal.touch(); clearTimeout(CR._t); CR._t = setTimeout(() => CR.publish().then(r => { if (r.off) return; toast('Правила стоп-отгрузки отправлены автозагрузке'); }).catch(e => toast(e.message)), 1500); },
};

EXT_PAGES.credit = async el => {
  await CRMLocal.ready; await LX.load();
  el.innerHTML = `<div class="page-head"><div><h2>Кредитный контроль</h2><div class="sub">Стоп-отгрузка: долг больше лимита клиента или есть старый долг. Заказы таким клиентам — нарушение.</div></div></div><div id="crBody"></div>`;
  const body = $('#crBody', el);
  if (!LX.has() || !LX.d('debtors').length) { body.innerHTML = UI.empty('Нет данных о долгах из LINKO', 'Нужен раздел «Должники по срокам» из автозагрузки (<a href="#/cloud">Данные → Синхронизация и настройки</a>).'); return; }
  const c = CR.cfg(), m = CR.model(), f = UI.fmt0, $$ = v => LX.money(v, m.cur), t0 = UI.localDate(Date.now());
  const cloudOn = typeof CLOUD !== 'undefined' && CLOUD.cfg && CLOUD.cfg()?.token, tg = CRMLocal.ext().tg || {};
  const stop = m.list.filter(r => r.st === 'stop'), near = m.list.filter(r => r.st === 'near'), ex = m.list.filter(r => r.st === 'ex');
  const hitsToday = m.hits.filter(h => h.date === t0);
  const agents = LX.agentsOf(m.list), byAg = agents.map(a => ({ a, stop: stop.filter(r => r.agent === a).length, debt: stop.filter(r => r.agent === a).reduce((s, r) => s + r.total, 0), hits: m.hits.filter(h => h.agent === a).length, sum: m.hits.filter(h => h.agent === a).reduce((s, h) => s + h.sum, 0) })).filter(x => x.stop || x.hits).sort((a, b) => b.hits - a.hits || b.debt - a.debt);
  const pool = (CR.view === 'near' ? near : CR.view === 'ex' ? ex : stop).filter(r => !CR.agent || r.agent === CR.agent).sort((a, b) => b.old - a.old || b.total - a.total);
  const ST = { stop: ['crit', '🛑 стоп'], near: ['warn', 'близко к лимиту'], ex: ['muted', 'исключение'], ok: ['good', 'ок'] };
  body.innerHTML = `<div class="kpis">
    ${UI.tile('Клиентов на стопе', f(stop.length), { sub: 'долг ' + $$(stop.reduce((s, r) => s + r.total, 0)), tone: stop.length ? 'bad' : 'good' })}
    ${UI.tile('Заказы клиентам на стопе', f(m.hits.length), { sub: hitsToday.length ? `сегодня: ${hitsToday.length}` : 'за период', tone: m.hits.length ? 'bad' : 'good' })}
    ${UI.tile('Близко к лимиту', f(near.length), { sub: '80% лимита и больше', tone: near.length ? 'warn' : '' })}
    ${UI.tile('Исключения', f(ex.length), { sub: 'отгружаем, несмотря на долг' })}</div>
    <div class="bar"><label class="mut">Старый долг — <select id="crAge">${[1, 2, 3].map(i => `<option value="${i}" ${m.age === i ? 'selected' : ''}>${esc(CR.ageText(i))}</option>`).join('')}</select></label>
    <label class="mut">не считать, если меньше $ <input id="crMin" type="number" min="0" step="1" value="${Number(c.minOld) || 0}" style="width:64px"></label>
    <label class="mut">Лимит долга по умолчанию, $ <input id="crLim" type="number" min="0" step="100" value="${Number(c.limit) || 0}" style="width:90px"></label><span class="mut">0 — без общего лимита</span></div>
    <p class="mut">${cloudOn ? (tg.token && tg.me ? `Сигнал в Telegram: автозагрузка проверяет новые заказы каждые 5 минут и пишет вам. Чтобы это заработало, один раз заново скопируйте скрипт: <a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт» и вставьте его в Google вместо старого.${c.publishedAt ? ` Правила отправлены ${new Date(c.publishedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}` : 'Для сигнала в Telegram подключите бота и выберите свой чат: <a href="#/tg">Данные → Telegram агентам</a> → «Я (руководитель)».') : 'Сигнал в Telegram работает при включённой синхронизации (<a href="#/cloud">Синхронизация и настройки</a>). Пока нарушения видны только здесь.'}</p>
    <div class="grid">
    ${UI.panel(`Заказы клиентам на стопе (${f(m.hits.length)})`, m.hits.length ? LX.table(['Дата', 'Клиент', 'Агент', '#Заказ', 'Статус', 'Почему стоп'], m.hits.slice(0, 300).map(h => `<tr><td>${UI.dateRu(h.date)}${h.time ? ' ' + h.time : ''}${h.date === t0 ? ' <span class="pill crit">сегодня</span>' : ''}</td><td>${LX.cl(h.client)}</td><td>${LX.ag(h.agent)}</td><td class="n">${$$(h.sum)}</td><td>${esc(LX.st2(h.status))}</td><td><small>${h.info.why.map(esc).join('; ')}</small></td></tr>`), { max: '420px' }) : '<p class="mut">Заказов клиентам на стопе нет 👍</p>', { cls: 'w12', sub: 'Заказы этого периода из LINKO клиентам, которые сейчас на стопе (отменённые не считаются)' })}
    ${UI.panel('По агентам', byAg.length ? LX.table(['Агент', '#Клиентов на стопе', '#Их долг', '#Заказов на стоп', '#На сумму'], byAg.map(x => `<tr><td>${LX.ag(x.a)}</td><td class="n">${f(x.stop)}</td><td class="n">${$$(x.debt)}</td><td class="n ${x.hits ? 'neg' : ''}"><b>${f(x.hits)}</b></td><td class="n">${$$(x.sum)}</td></tr>`)) : '<p class="mut">Нет клиентов на стопе.</p>', { cls: 'w12' })}
    ${UI.panel('Клиенты', `<div class="bar"><select id="crV" aria-label="Список"><option value="stop" ${CR.view === 'stop' ? 'selected' : ''}>На стопе (${stop.length})</option><option value="near" ${CR.view === 'near' ? 'selected' : ''}>Близко к лимиту (${near.length})</option><option value="ex" ${CR.view === 'ex' ? 'selected' : ''}>Исключения (${ex.length})</option></select>
      <select id="crA" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === CR.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
      ${pool.length ? LX.table(['Клиент', 'Агент', '#Долг', '#Старый долг', '#Лимит', 'Статус', 'Почему', ''], pool.slice(0, 400).map(r => `<tr><td>${LX.cl(r.name)}</td><td>${LX.ag(r.agent)}</td><td class="n">${$$(r.total)}</td><td class="n">${r.old > 0.005 ? $$(r.old) : '—'}</td><td class="n"><input type="number" min="0" step="100" data-lim="${esc(r.name)}" value="${r.ownLimit ?? ''}" placeholder="${Number(c.limit) || '—'}" style="width:80px" aria-label="Свой лимит клиента"></td><td>${UI.pill(ST[r.st][0], ST[r.st][1])}</td><td><small>${r.ex ? 'исключение: ' + esc(r.ex) : r.why.map(esc).join('; ')}</small></td><td><button class="btn gray sm needs-edit" data-ex="${esc(r.name)}">${r.ex ? 'Снять исключение' : 'Исключение…'}</button></td></tr>`), { max: '520px' }) : '<p class="mut">Пусто.</p>'}`, { cls: 'w12', sub: 'Свой лимит клиента — в столбце «Лимит» (пусто — общий). Исключение: клиенту отгружаем, несмотря на долг, с причиной.' })}
    </div>`;
  const num = v => { if (String(v).trim() === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : NaN; };
  const re = () => EXT_PAGES.credit(el);
  $('#crAge', body).onchange = e => { c.age = Number(e.target.value); CR.changed(); re(); };
  $('#crMin', body).onchange = e => { const v = num(e.target.value); if (v === null || Number.isNaN(v)) { e.target.value = Number(c.minOld) || 0; return toast('Сумма от 0'); } c.minOld = v; CR.changed(); re(); };
  $('#crLim', body).onchange = e => { const v = num(e.target.value); if (v === null || Number.isNaN(v)) { e.target.value = Number(c.limit) || 0; return toast('Лимит от 0'); } c.limit = v; CR.changed(); re(); };
  $('#crV', body).onchange = e => { CR.view = e.target.value; re(); };
  $('#crA', body).onchange = e => { CR.agent = e.target.value; re(); };
  body.querySelectorAll('input[data-lim]').forEach(i => i.onchange = () => {
    const v = num(i.value), n = i.dataset.lim, own = (c.clients[n] ||= {});
    if (Number.isNaN(v)) { i.value = own.limit ?? ''; return toast('Лимит от 0'); }
    if (v === null) delete own.limit; else own.limit = v;
    if (!Object.keys(own).length) delete c.clients[n];
    CR.changed(); re();
  });
  body.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
    const n = b.dataset.ex, own = (c.clients[n] ||= {});
    if (own.ex) delete own.ex;
    else { const why = prompt(`Почему «${n}» отгружаем, несмотря на долг?`, ''); if (!why || !why.trim()) { if (!Object.keys(own).length) delete c.clients[n]; return; } own.ex = why.trim().slice(0, 200); }
    if (!Object.keys(own).length) delete c.clients[n];
    CR.changed(); re();
  });
};
