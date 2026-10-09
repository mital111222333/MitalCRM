// Client card (click any client name): debt, plan, day-by-day history, tasks, notes and promises to pay,
// one-tap call / message to the agent / new task. Notes live in the synced state (ext.notes) and are seen by the AI.
window.EXT_PAGES = window.EXT_PAGES || {};

const NOTES = {
  all: () => (CRMLocal.ext().notes ||= {}),
  of: name => (NOTES.all()[name] || []).slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')),
  add(name, n) { (NOTES.all()[name] ||= []).push({ at: new Date().toISOString(), ...n }); CRMLocal.touch(); },
  del(name, at) { const a = NOTES.all()[name] || []; NOTES.all()[name] = a.filter(x => x.at !== at); CRMLocal.touch(); },
  // promises to pay with their state: kept (a payment came after the note), overdue, today, future
  promises(d) {
    const t0 = REP.today(), byName = new Map(d.clients.map(c => [c.name, c])), out = [];
    for (const [name, list] of Object.entries(NOTES.all())) for (const n of list) {
      if (!n.promise) continue;
      const c = byName.get(name), made = (n.at || '').slice(0, 10);
      const kept = !!(c && c.lastPay && c.lastPay > made); // a payment arrived after the promise was written down
      out.push({ client: name, agent: c?.agent || '', debt: c?.debt || 0, date: n.promise, sum: n.sum || 0, text: n.text || '', at: n.at, status: kept ? 'kept' : n.promise < t0 ? 'overdue' : n.promise === t0 ? 'today' : 'future' });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};

const CARD = {
  // one point per day (the latest upload of the day): balance and what was sold / paid that day
  history(S, name) {
    const ups = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const byDay = new Map(); for (const u of ups) byDay.set(u.period_from + '|' + u.taken_at, u);
    const pts = [], prevPer = new Map();
    for (const u of [...byDay.values()].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1))) {
      const r = u.rows.find(x => x.client === name); if (!r) continue;
      const p = prevPer.get(u.period_from);
      pts.push({ date: u.taken_at, b1: r.b1, sold: r.sold, paid: r.paid, ds: p ? r.sold - p.sold : r.sold, dp: p ? r.paid - p.paid : r.paid, first: !p });
      prevPer.set(u.period_from, r);
    }
    return pts;
  },

  async open(name) {
    const d = await REP.load(); if (d.empty) return;
    const c = d.clients.find(x => x.name === name); if (!c) return toast('Клиент не найден в последней загрузке');
    const S = CRMLocal.engine.getState(), pts = CARD.history(S, name), f = UI.fmt0, end = d.forecast.period_end || d.upload.period_to;
    const tasks = d.tasks.filter(t => t.client === name), conf = (CRMLocal.ext().tg || {}), agentChat = conf.token && conf.chats?.[c.agent];
    const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
    const m = modal(`<div class="card-head"><div><h3 style="margin:0">${esc(c.name)}</h3>
        <div class="mut">${[c.type, c.landmark, c.zone].filter(Boolean).map(esc).join(' · ')}</div>
        <div style="margin-top:4px">Агент: <a class="clink" data-agent="${esc(c.agent)}">${esc(c.agent)}</a> · ${c.active ? UI.pill('good', 'АКБ', '✓') : UI.pill('muted', 'неактивен')}</div></div>
        <button class="btn gray sm" id="cX" aria-label="Закрыть">✕</button></div>
      <div class="bar" style="margin:12px 0">${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}${agentChat ? '<button class="btn gray" id="cTg">✈ Написать агенту</button>' : ''}<button class="btn gray" id="cTask">+ Задание агенту</button><button class="btn gray" id="cNote">📝 Заметка / обещание</button></div>
      <div class="kpis kpis-sm">
        ${UI.tile('Долг', '$' + f(c.debt), { sub: c.lastPay ? `последняя оплата ${UI.dateRu(c.lastPay)}` : `нет оплат с ${UI.dm(d.hist.since)}`, tone: c.debt ? 'warn' : '' })}
        ${UI.tile('Продано за период', '$' + f(c.sold), { sub: c.plan ? `план ${f(c.plan)} · ${pct(c.sold, c.plan)}` : 'план не задан' })}
        ${UI.tile('Оплачено за период', '$' + f(c.paid), { sub: c.pool ? `пул ${f(c.pool)} · ${pct(c.paid, c.pool)}` : 'пул не задан' })}
        ${UI.tile('Соберётся к ' + UI.dm(end), '$' + f(c.paid + (c.more_pool || 0)), { sub: `ещё соберёт ${f(c.more_pool || 0)}${c.pool ? ' · ' + pct(c.paid + (c.more_pool || 0), c.pool) + ' пула' : ''}` })}
      </div>
      <div id="cBody"></div>`);
    m.el.classList.add('wide');
    const draw = () => {
      const notes = NOTES.of(name), prom = NOTES.promises(d).filter(p => p.client === name);
      const P = pts.slice(-30);
      $('#cBody', m.el).innerHTML = `
        <h4 class="ch">По дням</h4>${P.length > 1 ? CH.columns(P.map(p => ({ label: UI.dm(p.date), values: [Math.max(0, p.ds), Math.max(0, p.dp)] })), [{ name: 'Купил', color: 'var(--c1)' }, { name: 'Оплатил', color: 'var(--c3)' }], { fmt: UI.fmt0, height: 200 }) : '<p class="mut">История появится после нескольких дней загрузок.</p>'}
        ${P.length ? `<div class="tscroll" style="max-height:220px"><table><thead><tr><th>День</th><th class="n">Купил</th><th class="n">Оплатил</th><th class="n">Баланс на конец дня</th></tr></thead><tbody>${P.slice().reverse().map(p => `<tr><td>${UI.dateRu(p.date)}${p.first ? ' <small class="mut">(с начала периода)</small>' : ''}</td><td class="n">${p.ds ? f(p.ds) : '—'}</td><td class="n">${p.dp ? `<b class="pos">${f(p.dp)}</b>` : '—'}</td><td class="n ${p.b1 < 0 ? 'neg' : ''}">${f(p.b1)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h4 class="ch">Заметки и обещания</h4>
        ${notes.length ? `<ul class="notes">${notes.map(n => { const pr = prom.find(p => p.at === n.at); return `<li><div><small class="mut">${new Date(n.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small> ${n.promise ? UI.pill(pr?.status === 'kept' ? 'good' : pr?.status === 'overdue' ? 'crit' : pr?.status === 'today' ? 'warn' : 'info', `обещал оплатить ${UI.dm(n.promise)}${n.sum ? ' $' + f(n.sum) : ''}${pr?.status === 'kept' ? ' · оплатил' : pr?.status === 'overdue' ? ' · просрочено' : ''}`) : ''}<div>${esc(n.text || '')}</div></div><button class="btn gray sm" data-ndel="${esc(n.at)}" aria-label="Удалить заметку">✕</button></li>`; }).join('')}</ul>` : '<p class="mut">Заметок нет. Запишите итог звонка или обещание оплатить — ИИ и сигналы будут это учитывать.</p>'}
        <h4 class="ch">Задания</h4>
        ${tasks.length ? `<ul class="notes">${tasks.map(t => `<li><div>${UI.pill(t.status === 'done' ? 'good' : t.status === 'overdue' ? 'crit' : 'info', t.status === 'done' ? 'выполнено' : t.status === 'overdue' ? 'просрочено' : 'в работе')} <b>${esc(t.kind)}</b>${t.target ? ' $' + f(t.target) : ''}${t.due ? ` до ${UI.dateRu(t.due)}` : ''}${t.fact ? ` · сделано $${f(t.fact)}` : ''}<div>${esc(t.text || '')}</div></div></li>`).join('')}</ul>` : '<p class="mut">Заданий по клиенту нет.</p>'}`;
      m.el.querySelectorAll('[data-ndel]').forEach(b => b.onclick = () => { if (confirm('Удалить заметку?')) { NOTES.del(name, b.dataset.ndel); draw(); } });
    };
    draw();
    $('#cX', m.el).onclick = m.close;
    m.el.addEventListener('click', e => { if (e.target.closest('[data-agent]')) m.close(); });
    $('#cNote', m.el).onclick = () => {
      const f2 = modal(`<h3>Заметка: ${esc(name)}</h3><div class="form"><label style="grid-column:1/-1">Что было (итог звонка, договорённость)<textarea id="nT" rows="3" style="font:inherit;padding:8px;border:1px solid var(--line-2);border-radius:8px"></textarea></label>
        <label>Обещал оплатить (дата)<input type="date" id="nD"></label><label>Сумма, $<input type="number" min="0" id="nS"></label></div>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="nX">Отмена</button><button class="btn" id="nOk">Сохранить</button></div>`);
      $('#nX', f2.el).onclick = f2.close;
      $('#nOk', f2.el).onclick = () => { const text = $('#nT', f2.el).value.trim(), promise = $('#nD', f2.el).value, sum = +$('#nS', f2.el).value || 0; if (!text && !promise) return toast('Напишите заметку или дату обещания'); NOTES.add(name, { text, ...(promise ? { promise, sum } : {}) }); f2.close(); draw(); toast('Заметка сохранена'); };
    };
    $('#cTask', m.el).onclick = () => {
      const kinds = d.kinds || ['Сбор оплаты', 'Продажа', 'Погашение долга', 'Другое'];
      const f2 = modal(`<h3>Задание агенту ${esc(c.agent)}</h3><p class="mut" style="margin-top:0">Клиент: ${esc(name)} · долг $${f(c.debt)}</p><div class="form">
        <label>Тип<select id="tK">${kinds.map(k => `<option>${esc(k)}</option>`).join('')}</select></label><label>Цель, $<input type="number" min="0" id="tT" value="${c.debt ? Math.round(Math.min(c.debt, 1000)) : ''}"></label>
        <label>Срок<input type="date" id="tD" value="${UI.localDate(Date.now() + 3 * 864e5)}"></label><label style="grid-column:1/-1">Что сделать<input id="tX" value="${c.debt ? 'Собрать оплату по долгу' : 'Взять заказ'}"></label></div>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="tCx">Отмена</button><button class="btn" id="tOk">Создать</button></div>`);
      $('#tCx', f2.el).onclick = f2.close;
      $('#tOk', f2.el).onclick = async () => { const r = await CRMLocal.request('POST', '/api/ag/tasks', { client: name, kind: $('#tK', f2.el).value, target: +$('#tT', f2.el).value || 0, due: $('#tD', f2.el).value, text: $('#tX', f2.el).value }); if (r.error) return toast(r.error); await CRMLocal.flush(); f2.close(); m.close(); toast('Задание создано'); CARD.open(name); };
    };
    const tg = $('#cTg', m.el);
    if (tg) tg.onclick = () => {
      const def = `По клиенту ${name}: долг $${f(c.debt)}${c.lastPay ? `, последняя оплата ${UI.dateRu(c.lastPay)}` : ', оплат не было'}${c.pool ? `, план сбора $${f(c.pool)} (собрано ${pct(c.paid, c.pool)})` : ''}. Свяжитесь с клиентом и сообщите результат.`;
      const f2 = modal(`<h3>Сообщение агенту ${esc(c.agent)}</h3><textarea id="gT" rows="5" style="width:100%;font:inherit;padding:8px;border:1px solid var(--line-2);border-radius:8px">${esc(def)}</textarea>
        <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="gX">Отмена</button><button class="btn" id="gOk">✈ Отправить</button></div>`);
      $('#gX', f2.el).onclick = f2.close;
      $('#gOk', f2.el).onclick = async () => { try { await TG.send(conf.chats[c.agent].id, esc($('#gT', f2.el).value)); f2.close(); toast('Отправлено агенту'); } catch (e) { toast(e.message); } };
    };
  },
};

// any client / agent name marked with data-client / data-agent opens its card / page
document.addEventListener('click', e => {
  const a = e.target.closest('[data-client],[data-agent]'); if (!a || e.target.closest('input,select,textarea')) return;
  e.preventDefault();
  if (a.dataset.client) CARD.open(a.dataset.client);
  else { AGP.agent = a.dataset.agent; if (location.hash === '#/agent') route(); else location.hash = '#/agent'; }
});
// windows close with Esc and when you go to another section
addEventListener('hashchange', () => document.querySelectorAll('.modal-bg').forEach(m => m.remove()));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const all = document.querySelectorAll('.modal-bg'); if (all.length) all[all.length - 1].remove(); } });
