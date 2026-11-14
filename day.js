// План агентов на день (Сегодня → Мой день → План агентов): for every agent — how much to sell and collect TODAY to close the period
// plan, what he did today, how many debtors of his queue he worked. In the morning every agent gets his plan in Telegram, in the
// evening — the result of the day; the supervisor gets one summary for the team.
// Sent automatically by the Google auto-loader (autolinko.gs dayPlan_) even when the CRM is closed: the CRM saves dayplan.json to the
// private data repository — { on, am, pm, sunday, end, agents: { [agent]: { chat, plan, pool, queue[] } }, owner: { [client]: agent } };
// the script takes fresh sales and payments from LINKO itself. «Отправить сейчас» sends the same texts straight from the CRM.
// Settings: ext.dayPlan = { on, am, pm, sunday }.
window.EXT_PAGES = window.EXT_PAGES || {};

const DAY = {
  FILE: 'dayplan.json',
  cfg: () => (CRMLocal.ext().dayPlan ||= { on: true, am: 8, pm: 19, sunday: false }),
  norm: s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(), // the same as instNorm_ in autolinko.gs
  m: v => '$' + UI.fmt0(Math.round(v || 0)),
  async rows(fresh = false) {
    const D = await (fresh ? MY.fresh() : MY.cached()); if (D.empty) return null;
    const d = D.d, t0 = REP.today(), tg = CRMLocal.ext().tg || {};
    const list = d.agents.filter(a => a.agent !== 'Без агента').map(a => {
      const q = D.rows.filter(c => c.agent === a.agent), worked = q.filter(c => c.doneToday), prom = worked.filter(c => c.last.r === 'promise');
      return { a, agent: a.agent, chat: tg.token && tg.chats?.[a.agent]?.id ? String(tg.chats[a.agent].id) : '', needS: a.need_sell_day || 0, needC: a.need_collect_day || 0, dS: a.d_sold, dC: a.d_paid,
        pS: a.plan > 0 ? a.sold / a.plan : null, pC: a.pool > 0 ? a.paid / a.pool : null, q, worked: worked.length, prom: prom.reduce((s, c) => s + (c.last.s || 0), 0), promN: prom.length, paidN: worked.filter(c => c.last.r === 'paid').length };
    });
    return { D, d, t0, list };
  },
  amText(r) {
    return [`☀️ <b>План на сегодня — ${UI.dateRu(REP.today())}</b>`, esc(r.agent), '', `🛒 Продать: <b>${DAY.m(r.needS)}</b>`, `💰 Собрать: <b>${DAY.m(r.needC)}</b>`,
      ...(r.q.length ? ['', '<b>Начните с этих должников:</b>', ...r.q.slice(0, 7).map((c, i) => `${i + 1}. ${esc(c.name)} — $${UI.fmt0(Math.round(c.debt))}${MY.whyText(c) ? ' · ' + MY.whyText(c) : ''}`)] : []),
      '', 'Результат по каждому отмечайте в кабинете: 💰 Сбор.'].join('\n');
  },
  pmText(r) {
    const ok = (f, p) => (f == null ? '' : f >= p ? ' ✅' : ' ⚠️'), pc = p => (p === null ? '—' : Math.round(p * 100) + '%');
    return [`🌙 <b>Итог дня — ${UI.dateRu(REP.today())}</b>`, esc(r.agent), '', `🛒 Продано: <b>${r.dS == null ? '—' : DAY.m(r.dS)}</b> из ${DAY.m(r.needS)}${ok(r.dS, r.needS)}`, `💰 Собрано: <b>${r.dC == null ? '—' : DAY.m(r.dC)}</b> из ${DAY.m(r.needC)}${ok(r.dC, r.needC)}`,
      `📞 Отработано должников: <b>${r.worked}</b> из ${r.q.length}${r.promN ? ` · обещаний ${r.promN} на ${DAY.m(r.prom)}` : ''}`, '', `С начала периода: продажи ${pc(r.pS)} плана, сбор ${pc(r.pC)}.`].join('\n');
  },
  teamText(R, pm) {
    const f = DAY.m;
    return [`${pm ? '🌙 <b>Итог дня' : '☀️ <b>План на день'} — ${UI.dateRu(R.t0)}</b>`, '', ...R.list.map(r => pm
      ? `${(r.dC ?? 0) >= r.needC && (r.dS ?? 0) >= r.needS ? '✅' : '⚠️'} <b>${esc(r.agent)}</b>: продал ${r.dS == null ? '—' : f(r.dS)} / ${f(r.needS)}, собрал ${r.dC == null ? '—' : f(r.dC)} / ${f(r.needC)}, должников ${r.worked}/${r.q.length}`
      : `<b>${esc(r.agent)}</b>: продать ${f(r.needS)}, собрать ${f(r.needC)}, в очереди ${r.q.length}`)].join('\n');
  },
  async sendNow(pm) {
    const R = await DAY.rows(); if (!R) throw new Error('Нет данных');
    const tg = CRMLocal.ext().tg || {}; if (!tg.token) throw new Error('Сначала подключите Telegram: Настройки → Telegram агентам');
    let ok = 0; const errs = [];
    for (const r of R.list) if (r.chat) { try { await TG.send(r.chat, pm ? DAY.pmText(r) : DAY.amText(r)); ok++; } catch (e) { errs.push(`${r.agent}: ${e.message}`); } }
    if (tg.me?.id) { try { await TG.send(tg.me.id, DAY.teamText(R, pm)); } catch (e) { errs.push('вам: ' + e.message); } }
    return { ok, errs, none: R.list.filter(r => !r.chat).map(r => r.agent) };
  },
  // the file for the auto-loader; written only when something changed
  async publish(force = false) {
    if (typeof AC === 'undefined' || typeof MY === 'undefined') return false;
    const c = AC.cloud(); if (!c) return false;
    const R = await DAY.rows(); if (!R) return false;
    const cf = DAY.cfg(), owner = {};
    for (const x of R.d.clients) if (x.agent && x.agent !== 'Без агента') owner[DAY.norm(x.name)] = x.agent;
    const agents = Object.fromEntries(R.list.map(r => [r.agent, { chat: r.chat, plan: Math.round(r.a.plan || 0), pool: Math.round(r.a.pool || 0), queue: r.q.filter(q => !q.doneToday).slice(0, 7).map(q => `${q.name} — $${UI.fmt0(Math.round(q.debt))}${MY.whyText(q) ? ' · ' + MY.whyText(q) : ''}`), qn: r.q.length }]));
    const text = JSON.stringify({ v: 1, on: !!cf.on, am: +cf.am || 8, pm: +cf.pm || 19, sunday: !!cf.sunday, end: R.d.forecast?.period_end || R.d.upload.period_to, agents, owner });
    let last = ''; try { last = localStorage.getItem('crm_dayplan') || ''; } catch { /* blocked */ }
    if (!force && last === text) return false;
    await AC.gh(c, 'PUT', DAY.FILE, { message: 'CRM: план на день', content: AC.b64(text) });
    try { localStorage.setItem('crm_dayplan', text); } catch { /* blocked */ }
    return true;
  },
};

// keep dayplan.json fresh while the CRM is open
addEventListener('DOMContentLoaded', () => {
  const run = () => { if (typeof CRMLocal === 'undefined') return; CRMLocal.ready.then(() => DAY.publish()).catch(e => console.warn('day plan', e)); };
  setTimeout(run, 25000); setInterval(run, 15 * 60000);
});

EXT_PAGES.dayplan = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>План агентов на день</h2><div class="sub">Загружаю…</div></div></div>';
  const R = await DAY.rows(true); if (!el.isConnected) return;
  if (!R) { el.innerHTML = `<div class="page-head"><div><h2>План агентов на день</h2></div></div>${UI.empty('Данных пока нет', 'План на день считается из выгрузки LINKO «Баланс клиентов» и планов агентов.', '<a class="btn" href="#/up">Загрузить данные</a>')}`; return; }
  const cf = DAY.cfg(), m = DAY.m, sum = k => R.list.reduce((s, r) => s + (r[k] || 0), 0), hasPlan = R.list.some(r => r.a.plan > 0 || r.a.pool > 0);
  const cell = (fact, need) => `<td class="n">${fact == null ? '<span class="mut">—</span>' : `<b class="${fact >= need && need > 0 ? 'pos' : ''}">${m(fact)}</b>`}</td><td class="n">${m(need)}</td><td>${need > 0 ? `<div class="lbbar" style="min-width:70px;margin:0"><i style="width:${Math.min(1, (fact || 0) / need) * 100}%;background:${(fact || 0) >= need ? '#30d158' : (fact || 0) >= need * 0.6 ? '#ff9f0a' : '#ff453a'}"></i></div>` : '<span class="pill good">план закрыт</span>'}</td>`;
  const hours = (v, a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i).map(h => `<option value="${h}" ${+v === h ? 'selected' : ''}>${h}:00</option>`).join('');
  const cloud = typeof AC !== 'undefined' && AC.cloud(), tgOn = !!CRMLocal.ext().tg?.token, noChat = R.list.filter(r => !r.chat).map(r => r.agent);
  el.innerHTML = `<div class="page-head"><div><h2>План агентов на день</h2><div class="sub">${UI.dateRu(R.t0)} · сколько каждому продать и собрать сегодня, чтобы закрыть план периода · факт — с прошлой выгрузки LINKO</div></div>
      <div class="actions"><button class="btn gray" id="dpAm" type="button">Отправить план сейчас</button><button class="btn" id="dpPm" type="button">Отправить итог сейчас</button></div></div>
    ${hasPlan ? '' : '<div class="lbnote warn">Планы агентов на период не заданы — задайте их в «Продажи → Клиенты и план», иначе план на день будет нулевым.</div>'}
    <div class="kpis">${UI.tile('Команде продать сегодня', m(sum('needS')), { sub: sum('dS') ? `уже продано ${m(sum('dS'))}` : 'продаж за день пока нет' })}
      ${UI.tile('Команде собрать сегодня', m(sum('needC')), { sub: sum('dC') ? `уже собрано ${m(sum('dC'))}` : 'оплат за день пока нет' })}
      ${UI.tile('Отработано должников', `${sum('worked')}`, { sub: `из ${R.list.reduce((s, r) => s + r.q.length, 0)} в очереди`, tone: sum('worked') ? 'good' : 'warn' })}
      ${UI.tile('Взято обещаний сегодня', sum('promN') ? m(sum('prom')) : '—', { sub: sum('promN') ? `${sum('promN')} ${UI.plural(sum('promN'), 'клиент', 'клиента', 'клиентов')}` : 'пока нет' })}</div>
    <div class="scroll"><table class="noxg"><thead><tr><th>Агент</th><th class="n">Продал сегодня</th><th class="n">План дня</th><th></th><th class="n">Собрал сегодня</th><th class="n">План дня</th><th></th><th class="n">Должников отработал</th><th class="n">Обещаний</th><th>Telegram</th></tr></thead><tbody>
      ${R.list.map(r => `<tr><td><a href="#" data-agent="${esc(r.agent)}" style="color:var(--text);text-decoration:none"><b>${esc(r.agent)}</b></a></td>${cell(r.dS, r.needS)}${cell(r.dC, r.needC)}<td class="n"><b>${r.worked}</b> из ${r.q.length}${r.paidN ? ` · ✅ ${r.paidN}` : ''}</td><td class="n">${r.promN ? `${r.promN} · ${m(r.prom)}` : '—'}</td><td>${r.chat ? '<span class="pill good">подключён</span>' : '<span class="pill warn">нет чата</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid" style="margin-top:14px">${UI.panel('Автоотправка в Telegram', `<p class="mut" style="margin-top:0">Утром каждый агент получает свой план на день и первых должников из очереди, вечером — итог: продал, собрал, скольких должников отработал. Вам приходит сводка по команде. Работает и при закрытой CRM.</p>
      <div class="bar"><label class="chk"><input type="checkbox" id="dpOn" ${cf.on ? 'checked' : ''}> Включить</label><label class="mut">Утром в <select id="dpA">${hours(cf.am, 7, 11)}</select></label><label class="mut">Вечером в <select id="dpP">${hours(cf.pm, 16, 21)}</select></label><label class="chk"><input type="checkbox" id="dpSun" ${cf.sunday ? 'checked' : ''}> и в воскресенье</label><button class="btn" id="dpSave" type="button">Сохранить</button></div>
      ${!cloud ? '<p class="neg">Нужна синхронизация: <a href="#/cloud">Настройки → Синхронизация</a>.</p>' : ''}${!tgOn ? '<p class="neg">Подключите Telegram-бота: <a href="#/tg">Настройки → Telegram агентам</a>.</p>' : ''}${noChat.length ? `<p class="mut">Нет чата в Telegram: ${noChat.map(esc).join(', ')} — им сообщения не придут.</p>` : ''}
      <p class="mut" style="margin-bottom:0">Чтобы заработала автоотправка и отметки агентов из кабинета, один раз обновите скрипт автозагрузки: <a href="#/cloud">Настройки → Синхронизация</a> → «📋 Скопировать готовый скрипт» → вставить в script.google.com → «Развернуть» заново.</p>`, { cls: 'w12' })}</div>`;
  const act = async (b, pm) => { b.disabled = true; try { const r = await DAY.sendNow(pm); toast(`${pm ? 'Итог' : 'План'} отправлен: ${r.ok}${r.none.length ? ` · нет чата: ${r.none.join(', ')}` : ''}${r.errs.length ? ` · ошибки: ${r.errs.join('; ')}` : ''}`); } catch (e) { toast(e.message); } b.disabled = false; };
  $('#dpAm', el).onclick = e => act(e.currentTarget, false); $('#dpPm', el).onclick = e => act(e.currentTarget, true);
  $('#dpSave', el).onclick = async () => { Object.assign(cf, { on: $('#dpOn', el).checked, am: +$('#dpA', el).value, pm: +$('#dpP', el).value, sunday: $('#dpSun', el).checked }); CRMLocal.touch(); try { const w = await DAY.publish(true); toast(w ? 'Сохранено — скрипт автозагрузки увидит настройки в течение 5 минут' : 'Сохранено. Для автоотправки включите синхронизацию'); } catch (e) { toast('Сохранено, но файл для скрипта не записан: ' + e.message); } };
};
