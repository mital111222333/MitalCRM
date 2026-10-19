// ИИ-помощник на каждой вкладке: кнопка ✨ справа внизу открывает панель.
// «Подсказки» считаются прямо в браузере (без ИИ, мгновенно и без лимитов) — долги >120 дн., обещания оплат,
// отстающие агенты, крупные должники, выпавшие из АКБ, просроченные задания, склад, конец периода.
// «Чат» — Gemini (ai.js): видит все данные CRM + то, что сейчас открыто на экране, и подсказки по разделу.
// Горячая клавиша: Ctrl+J (на компьютере). Разговор общий с разделом «Аналитика → ИИ-ассистент».
(() => {
  const PAGE_GROUP = {
    today: ['rday', 'signals', 'home', 'overview'],
    money: ['lxpay', 'debtprev', 'rdebt', 'lxage', 'ranalytics', 'balance', 'payments', 'cash'],
    sales: ['lxday', 'lxbrand', 'lxcross', 'lxord', 'lxprof', 'rsleep', 'orders', 'returns', 'rdays', 'rdyn'],
    agents: ['agents', 'agent', 'leaders', 'amap', 'aclients', 'atasks', 'aup', 'gps', 'lxwork', 'routes'],
    stock: ['wh', 'whstock', 'whlow', 'whmove', 'whup', 'whorder', 'lxrec', 'stock'],
    chat: ['chat', 'tg'],
  };
  const groupOf = r => Object.keys(PAGE_GROUP).find(g => PAGE_GROUP[g].includes(r)) || 'other';
  const route = () => location.hash.replace('#/', '').split('?')[0] || 'home';
  const title = () => document.getElementById('crumb')?.textContent || document.querySelector('#page h2')?.textContent || route();

  // быстрые вопросы под каждый раздел
  const QUICK = {
    today: [['☀ План на сегодня', 'Сделай утренний разбор: как идёт период у команды к плану с учётом прошедших дней, кто отстаёт, 3 главные проблемы и конкретный план на сегодня — на кого из агентов надавить и с какими клиентами работать первыми.'],
      ['📞 Кому звонить', 'Составь список из 15 клиентов, по которым сегодня нужно собрать деньги (крупный долг, давно не платили, обещали оплату). Сгруппируй по агентам, для каждого — сумма, дней без оплаты и что сказать.']],
    money: [['💰 Как собрать пул', 'Сколько команде ещё нужно собрать до конца периода и как это сделать? Распиши по агентам: сколько собрать, у каких конкретных клиентов, в каком порядке.'],
      ['⏰ Долги >120 дней', 'Разбери клиентов с долгом старше 120 дней (правило: таких быть не должно, кроме исключений). По каждому: агент, сумма, что делать — собрать, рассрочка, остановить отгрузку или записать в исключения.'],
      ['⚠ Риски дебиторки', 'Где растёт риск по дебиторке: у кого долг растёт, кто перестал платить, у каких агентов проблемная база? Что делать с каждым случаем?']],
    sales: [['📈 Где резерв роста', 'Где самые большие резервы роста продаж? Спящие клиенты, выпавшие из АКБ, клиенты, которые не берут часть брендов, слабые агенты. Дай 5 конкретных действий с именами клиентов и агентов.'],
      ['🎯 Что предложить', 'Каким клиентам и какие бренды/товары предложить на этой неделе, чтобы поднять средний чек? Опирайся на то, что клиент берёт и не берёт.'],
      ['😴 Вернуть спящих', 'Кто из клиентов перестал покупать и кого реально вернуть? Список по агентам с причиной и что предложить.']],
    agents: [['🏆 Разбор агентов', 'Сравни агентов: продажи и сбор к плану с учётом темпа, АКБ/ОКБ, дебиторка. Кто лучший, кто отстаёт и почему, что сказать каждому на планёрке.'],
      ['🗣 Что сказать агентам', 'Напиши короткие персональные сообщения каждому агенту на сегодня (по 3–4 строки): где он сейчас к плану, сколько нужно в день и с какими 3 клиентами работать. Готово для отправки в Telegram.'],
      ['✅ Задания агентам', '__TASKS__']],
    stock: [['📦 Что заказать', 'Каких товаров не хватает или скоро закончится? Что срочно заказать в Ташкенте и на сколько, учитывая продажи?'],
      ['🔗 Склад и продажи', 'Есть ли товары, которых нет на складе, но клиенты их берут? Как это влияет на продажи агентов и что сделать?']],
    chat: [['✍ Текст агентам', 'Напиши мотивирующее сообщение в группу агентов на сегодня: где команда к плану, кто лидер, сколько осталось собрать и продать. Коротко, по-деловому.']],
    other: [['☀ Главное сейчас', 'Что сейчас самое важное для меня как супервайзера? 5 пунктов с цифрами и именами.']],
  };
  const PAGE_Q = ['🔍 Разбери этот экран', 'Посмотри, что сейчас открыто у меня на экране. Дай 3–5 самых важных выводов именно по этому разделу и что мне конкретно сделать сегодня.'];

  const money = v => '$' + UI.fmt0(Math.round(v || 0));
  const st = { open: false, tab: 'tips', tips: [], d: null, busy: false };

  // ---------- подсказки (локально, без ИИ) ----------
  async function buildTips() {
    let d; try { d = await REP.load(); } catch { return []; }
    st.d = d; if (!d || d.empty) return [{ lvl: 'info', g: 'other', t: 'Загрузите данные', x: 'Без выгрузки «Баланс клиентов» помощнику нечего анализировать.', go: '#/up' }];
    const T = []; const fc = d.forecast || {}, pace = typeof agPace === 'function' ? agPace(d) : null, t0 = REP.today();
    const add = (lvl, g, t, x, extra = {}) => T.push({ lvl, g, t, x, ...extra });

    // 1. правило 120 дней
    if (typeof LX !== 'undefined' && LX.has()) {
      try {
        const ag = LX.aging(), ex = LX.agedEx(), crit = ag.rows.filter(r => r.b[3] > 0.5 && !ex[r.name]).sort((a, b) => b.b[3] - a.b[3]);
        if (crit.length) add('crit', 'money', `Долг ${ag.labels[3]}: ${crit.length} кл. на ${money(crit.reduce((s, r) => s + r.b[3], 0))}`,
          'По правилу таких быть не должно. Первые: ' + crit.slice(0, 3).map(r => `${r.name} (${r.agent || '—'}) ${money(r.b[3])}`).join(', '),
          { go: '#/lxage', ask: 'Разбери клиентов с долгом старше 120 дней: по каждому — агент, сумма и что делать (собрать, рассрочка, стоп-отгрузка или исключение с причиной).' });
      } catch { /* нет данных LINKO */ }
    }
    // 2. обещания оплат
    if (typeof NOTES !== 'undefined') {
      const pr = NOTES.promises(d), today = pr.filter(p => p.status === 'today'), late = pr.filter(p => p.status === 'overdue');
      if (today.length) add('warn', 'money', `Сегодня обещали оплатить: ${today.length} кл. на ${money(today.reduce((s, p) => s + p.sum, 0))}`, today.slice(0, 4).map(p => `${p.client} (${p.agent})`).join(', '), { client: today[0].client });
      if (late.length) add('crit', 'money', `Не выполнили обещание оплаты: ${late.length} кл.`, late.slice(0, 4).map(p => `${p.client} — обещал ${UI.dm(p.date)} ${money(p.sum)}`).join('; '), { client: late[0].client, ask: 'Кто из клиентов не выполнил обещание оплатить? Что делать с каждым и что сказать агенту?' });
    }
    // 3. отстающие агенты (темп)
    if (pace) {
      const lagS = d.agents.filter(a => a.plan > 0 && a.sold / a.plan < pace * 0.8), lagP = d.agents.filter(a => a.pool > 0 && a.paid / a.pool < pace * 0.8);
      if (lagS.length) add('warn', 'agents', `Отстают по продажам: ${lagS.length} из ${d.agents.length}`, lagS.map(a => `${a.agent} ${UI.pct(a.sold, a.plan)}% (нужно ${money(a.need_sell_day)}/день)`).join(', ') + ` · по графику должно быть ${Math.round(pace * 100)}%`, { go: '#/agents', ask: `Почему отстают по продажам ${lagS.map(a => a.agent).join(', ')}? Что каждому сделать, с какими клиентами?` });
      if (lagP.length) add('warn', 'money', `Отстают по сбору денег: ${lagP.length} из ${d.agents.length}`, lagP.map(a => `${a.agent} ${UI.pct(a.paid, a.pool)}% (нужно ${money(a.need_collect_day)}/день)`).join(', '), { go: '#/rdebt', ask: `Как поднять сбор у ${lagP.map(a => a.agent).join(', ')}? Каких клиентов собрать в первую очередь?` });
      const best = [...d.agents].filter(a => a.plan > 0).sort((a, b) => b.sold / b.plan - a.sold / a.plan)[0];
      if (best && best.sold / best.plan >= pace) add('good', 'agents', `Лидер периода: ${best.agent} — ${UI.pct(best.sold, best.plan)}% плана`, 'Похвалите в группе — это подтягивает остальных.', { go: '#/leaders' });
    }
    // 4. конец периода / 16-е число
    if (fc.projectable && fc.days_left <= 4) {
      const A = agTotals(d);
      add('crit', 'today', `До конца периода ${fc.days_left} ${UI.plural(fc.days_left, 'день', 'дня', 'дней')}`, `Осталось продать ${money(Math.max(0, A.plan - A.sold))}, собрать ${money(Math.max(0, A.pool - A.paid))}.`, { ask: 'До конца периода осталось несколько дней. Составь финишный план по каждому агенту: сколько продать и собрать, у каких клиентов.' });
    }
    if (t0.slice(8, 10) === '16') add('warn', 'money', 'Сегодня 16-е — дополнительный день сбора', 'Оплаты сегодня засчитываются в прошлый период. Дожмите должников по прошлому пулу.', { go: '#/debtprev' });
    // 5. крупные должники давно без оплаты
    const big = d.clients.filter(c => c.debt > 0 && (c.payDays ?? 0) > 30).sort((a, b) => b.score - a.score);
    if (big.length) add('warn', 'money', `Крупный долг и нет оплат >30 дн.: ${big.length} кл.`, big.slice(0, 4).map(c => `${c.name} ${money(c.debt)} (${c.agent}, ${c.payDays} дн.)`).join('; '), { client: big[0].name, go: '#/rdebt' });
    // 6. выпали из АКБ, спящие
    const lost = d.clients.filter(c => c.lost);
    if (lost.length) add('warn', 'sales', `Выпали из АКБ с прошлого периода: ${lost.length} кл.`, lost.slice(0, 5).map(c => `${c.name} (${c.agent})`).join(', '), { go: '#/rsleep', ask: 'Кто выпал из АКБ с прошлого периода? Как вернуть каждого — что предложить и какому агенту поручить?' });
    const sleep = d.clients.filter(c => c.lastBuy && c.buyDays > 30 && !c.lost);
    if (sleep.length) add('info', 'sales', `Не покупают больше 30 дней: ${sleep.length} кл.`, 'Это резерв роста продаж без поиска новых клиентов.', { go: '#/rsleep' });
    const T2 = agTotals(d); if (T2.okb && T2.akb / T2.okb < 0.6) add('info', 'sales', `АКБ всего ${UI.pct(T2.akb, T2.okb)}% базы (${T2.akb} из ${T2.okb})`, 'Каждый второй клиент без отгрузки — поставьте агентам цель по АКБ.', { go: '#/agents' });
    // 7. задания
    const od = (d.tasks || []).filter(t => t.status === 'overdue');
    if (od.length) add('warn', 'agents', `Просрочено заданий агентам: ${od.length}`, od.slice(0, 4).map(t => `${t.agent}: ${t.client}`).join('; '), { go: '#/atasks' });
    // 8. склад
    if (d.low) { const out = d.low.items.filter(i => i.status === 'out'), soon = d.low.items.filter(i => i.status === 'low' || i.status === 'soon');
      if (out.length) add('crit', 'stock', `Закончились на складе: ${out.length} поз.`, out.slice(0, 5).map(i => i.name).join(', '), { go: '#/whlow' });
      if (soon.length) add('warn', 'stock', `Скоро закончатся: ${soon.length} поз.`, soon.slice(0, 5).map(i => i.name).join(', '), { go: '#/whorder' }); }
    // 9. свежесть данных
    const age = REP.days((d.upload.taken_at || '').slice(0, 10), t0);
    if (age >= 1) add('info', 'today', `Данные устарели на ${age} ${UI.plural(age, 'день', 'дня', 'дней')}`, 'Обновите выгрузку из LINKO, чтобы подсказки были точными.', { go: '#/up' });
    return T;
  }

  // ---------- интерфейс ----------
  const css = document.createElement('style');
  css.textContent = `
#cpBtn{position:fixed;right:18px;bottom:18px;z-index:60;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;background:var(--oil,#f2b01e);color:#12202b;font-size:24px;box-shadow:0 6px 20px rgba(14,36,51,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}
#cpBtn:hover{transform:scale(1.07)} #cpBtn.pulse{animation:cpP 1.6s ease-in-out 3}
@keyframes cpP{50%{box-shadow:0 0 0 12px rgba(242,176,30,.25)}}
#cpBtn b{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:var(--bad,#d23);color:#fff;font:600 11px/20px var(--font,sans-serif);padding:0 5px}
#cpPanel{position:fixed;top:0;right:0;bottom:0;z-index:70;width:min(440px,100vw);background:var(--card,#fff);color:var(--text);box-shadow:-8px 0 30px rgba(14,36,51,.18);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .2s ease}
body.cpopen #cpPanel{transform:none}
#cpPanel header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}
#cpPanel header h3{margin:0;font-size:15px;flex:1} #cpPanel header small{display:block;font-weight:400;color:var(--muted)}
#cpPanel .cpx{background:none;border:0;font-size:22px;cursor:pointer;color:var(--text-2)}
#cpPanel nav{display:flex;gap:4px;padding:8px 14px 0}
#cpPanel nav button{flex:1;border:0;background:var(--card-2,#f2f4f6);color:var(--text);padding:8px;border-radius:8px 8px 0 0;cursor:pointer;font:inherit}
#cpPanel nav button.on{background:var(--oil-soft,#fdf3d8);font-weight:600}
#cpBody{flex:1;overflow:auto;padding:12px 14px}
.cpt{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:13px}
.cpt.crit{border-left-color:var(--bad,#d23)} .cpt.warn{border-left-color:var(--oil,#f2b01e)} .cpt.good{border-left-color:var(--ok,#2a7)}
.cpt b{display:block;margin-bottom:3px} .cpt p{margin:0;color:var(--text-2)} .cpt .cpa{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.cpt.here{background:var(--oil-soft,#fdf3d8)}
.cph{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:10px 0 6px}
.cpq{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px} .cpq button{font-size:12px}
.cpm{margin:0 0 10px;padding:9px 11px;border-radius:10px;font-size:13px;line-height:1.45}
.cpm.me{background:var(--brand-50,#eef4f8);margin-left:30px} .cpm.ai{background:var(--card-2,#f6f7f9)} .cpm.ai ul{padding-left:18px;margin:4px 0} .cpm p{margin:0 0 5px}
.cpm .mtools{display:flex;gap:6px;margin-top:6px}
#cpForm{display:flex;gap:6px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}
#cpForm textarea{flex:1;resize:none;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}
@media (max-width:900px){#cpBtn{bottom:calc(76px + env(safe-area-inset-bottom));right:12px;width:48px;height:48px;font-size:21px}}
@media print{#cpBtn,#cpPanel{display:none!important}}`;
  document.head.appendChild(css);

  let btn, panel;
  function mount() {
    if (!document.querySelector('nav.top')) { btn?.remove(); panel?.remove(); btn = panel = null; return; }
    if (btn && document.body.contains(btn)) return;
    btn = document.createElement('button'); btn.id = 'cpBtn'; btn.type = 'button'; btn.title = 'ИИ-помощник (Ctrl+J)'; btn.setAttribute('aria-label', 'ИИ-помощник'); btn.innerHTML = '✨';
    btn.onclick = () => toggle();
    panel = document.createElement('aside'); panel.id = 'cpPanel'; panel.setAttribute('aria-label', 'ИИ-помощник');
    document.body.append(btn, panel);
    try { const k = 'crm_cp_day', t = UI.localDate(Date.now()); if (localStorage.getItem(k) !== t) { btn.classList.add('pulse'); localStorage.setItem(k, t); } } catch { /* ignore */ }
    refreshBadge();
  }
  async function refreshBadge() {
    st.tips = await buildTips(); if (!btn) return;
    const n = st.tips.filter(t => t.lvl === 'crit').length;
    btn.querySelector('b')?.remove(); if (n) btn.insertAdjacentHTML('beforeend', `<b>${n}</b>`);
    if (st.open) draw();
  }
  function toggle(open = !st.open, tab) {
    st.open = open; if (tab) st.tab = tab;
    document.body.classList.toggle('cpopen', open);
    if (open) { btn?.classList.remove('pulse'); draw(); refreshBadge(); }
  }

  function draw() {
    if (!panel) return;
    const r = route(), g = groupOf(r);
    panel.innerHTML = `<header><h3>✨ ИИ-помощник<small>Раздел: ${esc(title())}</small></h3><button class="cpx" aria-label="Закрыть">×</button></header>
      <nav><button data-tab="tips" class="${st.tab === 'tips' ? 'on' : ''}">💡 Подсказки${st.tips.length ? ` (${st.tips.length})` : ''}</button><button data-tab="chat" class="${st.tab === 'chat' ? 'on' : ''}">💬 Спросить ИИ</button></nav>
      <div id="cpBody"></div>${st.tab === 'chat' ? `<form id="cpForm"><textarea id="cpIn" rows="2" placeholder="Вопрос по этому разделу, агентам, клиентам…" aria-label="Вопрос"></textarea><button class="btn" id="cpGo"${st.busy ? ' disabled' : ''}>➤</button></form>` : ''}`;
    panel.querySelector('.cpx').onclick = () => toggle(false);
    panel.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; draw(); });
    const body = panel.querySelector('#cpBody');
    st.tab === 'tips' ? drawTips(body, g) : drawChat(body, g);
  }

  function drawTips(body, g) {
    if (!st.tips.length) { body.innerHTML = '<p class="mut">Всё спокойно — критичных подсказок нет. 👍</p>'; return; }
    const order = { crit: 0, warn: 1, info: 2, good: 3 };
    const here = st.tips.filter(t => t.g === g).sort((a, b) => order[a.lvl] - order[b.lvl]), rest = st.tips.filter(t => t.g !== g).sort((a, b) => order[a.lvl] - order[b.lvl]);
    const card = (t, i) => `<div class="cpt ${t.lvl}${t.g === g ? ' here' : ''}"><b>${esc(t.t)}</b><p>${esc(t.x)}</p><div class="cpa">
      ${t.go && t.go !== '#/' + route() ? `<button class="btn gray sm" data-go="${i}">Открыть</button>` : ''}${t.client && typeof CARD !== 'undefined' ? `<button class="btn gray sm" data-cl="${i}">Карточка клиента</button>` : ''}
      <button class="btn gray sm" data-ask="${i}">Что делать? ✨</button></div></div>`;
    const all = [...here, ...rest];
    body.innerHTML = (here.length ? `<div class="cph">По этому разделу</div>${here.map(t => card(t, all.indexOf(t))).join('')}` : '') +
      (rest.length ? `<div class="cph">${here.length ? 'Другое важное' : 'Главное сейчас'}</div>${rest.map(t => card(t, all.indexOf(t))).join('')}` : '') +
      '<p class="mut" style="font-size:12px">Подсказки считаются по вашим данным сразу, без ИИ. Кнопка «Что делать?» спросит Gemini.</p>';
    body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = all[+b.dataset.go].go; if (matchMedia('(max-width:900px)').matches) toggle(false); });
    body.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => CARD.open(all[+b.dataset.cl].client));
    body.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => { const t = all[+b.dataset.ask]; st.tab = 'chat'; draw(); ask(t.ask || `Подсказка: «${t.t}. ${t.x}». Объясни, почему это важно, и что мне конкретно сделать — с именами агентов и клиентов.`); });
  }

  const chat = () => (typeof aiChat !== 'undefined' ? aiChat : (window._cpChat ||= []));
  function drawChat(body, g) {
    const hasKey = typeof AI !== 'undefined' && AI.key();
    if (!hasKey) { body.innerHTML = UI.empty('Нужен ключ Gemini', 'Бесплатно: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → вставьте в <a href="#/cloud">Данные → Синхронизация и настройки</a>.'); return; }
    const q = [PAGE_Q, ...(QUICK[g] || QUICK.other)], log = chat();
    body.innerHTML = `<div class="cpq">${q.map(([t], i) => `<button class="btn gray sm" data-q="${i}">${t}</button>`).join('')}${log.length ? '<button class="btn gray sm" id="cpNew">↺ Новый разговор</button>' : ''}</div>
      ${log.map((m, i) => `<div class="cpm ${m.role}">${m.role === 'ai' ? AI.md(m.text) + `<div class="mtools"><button class="btn gray sm" data-copy="${i}">Копировать</button>${TG?.conf?.().me && TG.conf().token ? `<button class="btn gray sm" data-tg="${i}">В Telegram себе</button>` : ''}</div>` : esc(m.text)}</div>`).join('') || '<p class="mut">Я вижу все данные CRM и то, что открыто на экране. Спросите, например: «Кому из клиентов Кувы позвонить сегодня?» или нажмите кнопку выше.</p>'}
      ${st.busy ? '<div class="cpm ai mut">Думаю…</div>' : ''}`;
    body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const p = q[+b.dataset.q][1]; if (p === '__TASKS__') return tasks(); ask(p); });
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(log[+b.dataset.copy].text); toast('Скопировано'); } catch { /* ignore */ } });
    body.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { try { await TG.send(TG.conf().me.id, esc(log[+b.dataset.tg].text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')); toast('Отправлено вам в Telegram'); } catch (e) { toast(e.message); } });
    const nw = body.querySelector('#cpNew'); if (nw) nw.onclick = () => { log.length = 0; draw(); };
    body.lastElementChild?.scrollIntoView({ block: 'end' });
    const form = panel.querySelector('#cpForm'), input = panel.querySelector('#cpIn');
    if (form) {
      form.onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ''; ask(v); };
      input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };
      if (!st.busy && !matchMedia('(pointer:coarse)').matches) input.focus();
    }
  }

  // что видно на экране (без панели помощника), коротко
  const screen = () => {
    const p = document.getElementById('page'); if (!p) return '';
    return (p.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 7000);
  };
  async function ask(q) {
    if (!q || !q.trim() || st.busy) return;
    const log = chat(); log.push({ role: 'me', text: q.trim() }); st.busy = true; draw();
    try {
      const d = st.d && !st.d.empty ? st.d : await REP.load();
      const tips = st.tips.map(t => `- ${t.t}: ${t.x}`).join('\n');
      const sys = AI.system(d) + `\n\nСЕЙЧАС СУПЕРВАЙЗЕР ОТКРЫЛ РАЗДЕЛ «${title()}» (#/${route()}). Если вопрос про «этот экран/эту страницу» — опирайся на этот текст экрана:\n${screen()}\n\nАВТОМАТИЧЕСКИЕ ПОДСКАЗКИ CRM:\n${tips || 'нет'}\n\nВ конце ответа, если уместно, предложи 1 следующий шаг в CRM (какой раздел открыть).`;
      log.push({ role: 'ai', text: await AI.ask(log.slice(-12), sys) });
    } catch (e) { log.pop(); toast(e.message); }
    st.busy = false; draw();
  }
  // задания агентам — делает страница ИИ-ассистента (там выбор и создание в один клик)
  function tasks() {
    toggle(false); location.hash = '#/ai';
    let n = 0; const t = setInterval(() => { const b = document.getElementById('aTasks'); if (b) { clearInterval(t); b.click(); b.scrollIntoView({ behavior: 'smooth' }); } else if (++n > 40) clearInterval(t); }, 150);
  }

  addEventListener('hashchange', () => { if (route() === 'ai') toggle(false); if (btn) btn.style.display = route() === 'ai' ? 'none' : ''; if (st.open) setTimeout(draw, 60); });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'о')) { e.preventDefault(); toggle(); } if (e.key === 'Escape' && st.open) toggle(false); });
  addEventListener('crm:refresh', refreshBadge); // кнопка «Обновить»
  addEventListener('DOMContentLoaded', () => { mount(); new MutationObserver(mount).observe(document.getElementById('app'), { childList: true }); });
  setInterval(() => { if (document.visibilityState === 'visible' && btn) refreshBadge(); }, 10 * 60 * 1000); // подсказки пересчитываются раз в 10 минут (без ИИ)
  window.COPILOT = { open: tab => toggle(true, tab), ask: q => { toggle(true, 'chat'); ask(q); }, refresh: refreshBadge };
})();
