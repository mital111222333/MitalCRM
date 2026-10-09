// Agent page (Агенты → Страница агента, or click any agent name): everything about one agent before a talk with him.
window.EXT_PAGES = window.EXT_PAGES || {};
const AGP = { agent: null };

EXT_PAGES.agent = async el => {
  const d = await REP.load();
  if (d.empty) { el.innerHTML = '<div class="page-head"><h2>Страница агента</h2></div>'; return REP.empty(el.appendChild(document.createElement('div'))); }
  const names = d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  if (!AGP.agent || !names.includes(AGP.agent)) AGP.agent = names[0];
  const a = d.agents.find(x => x.agent === AGP.agent), f = UI.fmt0, fc = d.forecast, pace = agPace(d), end = fc.period_end || d.upload.period_to;
  const mine = d.clients.filter(c => c.agent === a.agent), pct = (x, y) => (y > 0 ? Math.round(x / y * 100) : null);
  const rankS = [...d.agents].sort((x, y) => y.sold - x.sold).indexOf(a) + 1, rankM = [...d.agents].sort((x, y) => y.paid - x.paid).indexOf(a) + 1;
  const mp = a.more_pool || 0, pc = PREV.compare(d), was = pc && !pc.missing ? pc.agents[a.agent] : null;
  const days = REP.daily(CRMLocal.engine.getState()).slice(-30);
  const debtors = mine.filter(c => c.debt > 0).sort((x, y) => y.score - x.score);
  const sleeping = mine.filter(c => (c.lastBuy && c.buyDays > 30) || (!c.lastBuy && c.debt > 0)).sort((x, y) => (y.buyDays ?? 0) - (x.buyDays ?? 0));
  const prom = NOTES.promises(d).filter(p => p.agent === a.agent && p.status !== 'kept');
  const tasks = d.tasks.filter(t => t.agent === a.agent && t.status !== 'done');
  const sig = SIG.compute(d).filter(s => s.agent === a.agent);
  const conf = CRMLocal.ext().tg || {}, chat = conf.token && conf.chats?.[a.agent];
  const tone = p => (p === null ? '' : p >= 100 ? 'good' : pace !== null && p < pace * 60 ? 'bad' : pace !== null && p < pace * 90 ? 'warn' : '');
  const cl = c => `<a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>`;
  el.innerHTML = `<div class="page-head"><div><h2>Агент: ${esc(a.agent)}</h2><div class="sub">Данные на ${UI.dateRu(d.upload.taken_at)} · период ${UI.dateRu(d.upload.period_from)} — ${UI.dateRu(end)}${fc.projectable ? ` · осталось ${fc.days_left} дн.` : ''} · ${rankS}-е место по продажам, ${rankM}-е по сбору из ${d.agents.length}</div></div>
    <div class="actions"><select id="agpSel" aria-label="Агент">${names.map(n => `<option ${n === a.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${chat ? '<button class="btn gray" id="agpTg">✈ Отчёт агенту</button>' : ''}<button class="btn gray" id="agpAi">🤖 Разбор от ИИ</button></div></div>
    <div class="kpis">
      ${UI.tile('Продано', '$' + f(a.sold), { sub: a.plan ? `план ${f(a.plan)} · ${pct(a.sold, a.plan)}% · осталось ${f(Math.max(0, a.plan - a.sold))}` : 'план не задан', tone: tone(pct(a.sold, a.plan)), delta: UI.delta(a.d_sold, { title: 'За день' }) })}
      ${UI.tile('Собрано', '$' + f(a.paid), { sub: a.pool ? `пул ${f(a.pool)} · ${pct(a.paid, a.pool)}% · осталось ${f(Math.max(0, a.pool - a.paid))}` : 'пул не задан', tone: tone(pct(a.paid, a.pool)), delta: UI.delta(a.d_paid, { title: 'За день' }) })}
      ${UI.tile('Соберётся к ' + UI.dm(end), '$' + f(a.paid + mp), { sub: `ещё соберёт ${f(mp)}${a.pool ? ` · ${pct(a.paid + mp, a.pool)}% пула` : ''}` })}
      ${UI.tile('Долг клиентов', '$' + f(a.debt), { sub: `должников ${a.debtors}`, tone: 'warn' })}
      ${UI.tile('АКБ / ОКБ', `${a.akb} / ${a.okb}`, { sub: `активны ${pct(a.akb, a.okb) ?? 0}%` })}
      ${pc ? UI.tile(`К прошлому периоду, ${pc.n}-й день`, was ? `${PREV.chip(a.sold, was.sold) || '—'}` : '—', { sub: was ? `продажи тогда $${f(was.sold)}, сбор $${f(was.paid)} ${PREV.chip(a.paid, was.paid)}` : 'нет данных прошлого периода' }) : ''}
    </div>
    <div class="grid">
      ${sig.length ? UI.panel(`🚨 Сигналы (${sig.length})`, `<ul class="insights">${sig.slice(0, 8).map(SIG.item).join('')}</ul>`, { cls: 'w12' }) : ''}
      ${UI.panel('По дням: продано и собрано', days.length > 1 ? CH.columns(days.map(x => ({ label: UI.dm(x.date), values: [Math.max(0, x.agents[a.agent]?.sold || 0), Math.max(0, x.agents[a.agent]?.paid || 0)] })), [{ name: 'Продано', color: 'var(--c1)' }, { name: 'Собрано', color: 'var(--c3)' }], { fmt: UI.fmt0, height: 220 }) : '<p class="mut">Появится после нескольких дней загрузок.</p>', { cls: 'w12' })}
      ${UI.panel(`Должники (${debtors.length})`, debtors.length ? `<div class="scroll"><table><thead><tr><th>Клиент</th><th class="n">Долг</th><th class="n">Последняя оплата</th><th class="n">Пул / ещё</th></tr></thead><tbody>${debtors.slice(0, 40).map(c => `<tr><td>${cl(c)}</td><td class="n"><b>${f(c.debt)}</b></td><td class="n">${REP.pay(c)}</td><td class="n">${c.pool ? f(c.pool) : '—'} / ${c.more_pool ? f(c.more_pool) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Должников нет</p>', { cls: 'w7', sub: 'Самые срочные — вверху' })}
      ${UI.panel(`Обещания оплатить (${prom.length})`, prom.length ? `<ul class="notes">${prom.map(p => `<li><div>${UI.pill(p.status === 'overdue' ? 'crit' : p.status === 'today' ? 'warn' : 'info', `${UI.dm(p.date)}${p.sum ? ' $' + f(p.sum) : ''}${p.status === 'overdue' ? ' · просрочено' : p.status === 'today' ? ' · сегодня' : ''}`)} <a class="clink" data-client="${esc(p.client)}">${esc(p.client)}</a><div><small class="mut">${esc(p.text)}</small></div></div></li>`).join('')}</ul>` : '<p class="mut">Обещаний нет. Записывайте их в карточке клиента (кнопка «📝 Заметка»).</p>', { cls: 'w5' })}
      ${UI.panel(`Давно не покупали (${sleeping.length})`, sleeping.length ? `<div class="scroll" style="max-height:320px"><table><tbody>${sleeping.slice(0, 30).map(c => `<tr><td>${cl(c)}</td><td class="n">${REP.buy(c)}</td><td class="n">${c.debt ? '$' + f(c.debt) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Все клиенты покупают 👍</p>', { cls: 'w6', sub: 'Больше 30 дней без покупок' })}
      ${UI.panel(`Задания (${tasks.length})`, tasks.length ? `<ul class="notes">${tasks.map(t => `<li><div>${UI.pill(t.status === 'overdue' ? 'crit' : 'info', t.status === 'overdue' ? 'просрочено' : 'в работе')} <a class="clink" data-client="${esc(t.client)}">${esc(t.client)}</a> · ${esc(t.kind)}${t.target ? ' $' + f(t.target) : ''}${t.due ? ` до ${UI.dateRu(t.due)}` : ''}${t.fact ? ` · сделано $${f(t.fact)}` : ''}<div><small class="mut">${esc(t.text || '')}</small></div></div></li>`).join('')}</ul>` : '<p class="mut">Открытых заданий нет</p>', { cls: 'w6' })}
    </div>`;
  $('#agpSel', el).onchange = e => { AGP.agent = e.target.value; EXT_PAGES.agent(el); };
  const tg = $('#agpTg', el); if (tg) tg.onclick = async () => { if (!confirm(`Отправить ${a.agent} его отчёт в Telegram?`)) return; try { await TG.send(conf.chats[a.agent].id, REP.agentText(d, a.agent)); (conf.log ||= {})[a.agent] = new Date().toISOString(); CRMLocal.touch(); toast('Отправлено'); } catch (e) { toast(e.message); } };
  $('#agpAi', el).onclick = () => { window.AI_PENDING = `Сделай разбор по агенту ${a.agent}: как он идёт к плану продаж и сбора до ${UI.dateRu(end)}, кто из его клиентов главный риск, какие обещания и задания горят, и что конкретно сказать агенту на разговоре сегодня (5–7 пунктов с именами клиентов и суммами).`; location.hash = '#/ai'; };
};
