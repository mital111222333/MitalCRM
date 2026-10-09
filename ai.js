// AI assistant on Google Gemini (free API key from aistudio.google.com). It gets a compact snapshot of the CRM data
// (agents, every client with debt and days without payment/purchase, monthly dynamics, tasks, warehouse shortages)
// and answers questions, writes the morning review and proposes tasks that can be created in one click.
window.EXT_PAGES = window.EXT_PAGES || {};

const AI = {
  BASE: 'https://generativelanguage.googleapis.com/v1beta',
  key: () => CRMLocal.ext().ai?.key || '',
  async models(key = AI.key()) {
    let r;
    try { r = await fetch(`${AI.BASE}/models?pageSize=200&key=${encodeURIComponent(key)}`); } catch { throw new Error('Нет связи с Google Gemini'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Ключ Gemini неверный' : d.error?.message || 'Ошибка Gemini ' + r.status);
    return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini/.test(m.name) && !/embed|tts|image|audio|live|vision|robotics|computer/.test(m.name)).map(m => m.name.slice(7));
  },
  // newest stable "flash" model: fast and inside the free limits
  pick(models) {
    const ver = n => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const score = n => ver(n) * 10 - (/preview|exp/.test(n) ? 3 : 0) - (/lite/.test(n) ? 2 : 0) - (/-\d{3}$|latest/.test(n) ? 0.5 : 0);
    const flash = models.filter(n => /flash/.test(n) && !/thinking/.test(n));
    return (flash.length ? flash : models).slice().sort((a, b) => score(b) - score(a))[0] || 'gemini-2.5-flash';
  },
  async model() {
    const x = CRMLocal.ext().ai || {};
    if (x.model) return x.model;
    if (!AI._auto) { try { AI._auto = AI.pick(await AI.models()); } catch { AI._auto = 'gemini-2.5-flash'; } }
    return AI._auto;
  },
  async ask(history, system, { json = false } = {}) {
    if (!AI.key()) throw new Error('Добавьте ключ Gemini в «Данные → Синхронизация и настройки»');
    const model = await AI.model();
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: history.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] })), generationConfig: { temperature: 0.4, ...(json ? { responseMimeType: 'application/json' } : {}) } };
    let r;
    try { r = await fetch(`${AI.BASE}/models/${model}:generateContent?key=${encodeURIComponent(AI.key())}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Нет связи с Google Gemini'); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 429) throw new Error('Бесплатный лимит Gemini на эту минуту исчерпан — подождите минуту и повторите');
    if (!r.ok) throw new Error(d.error?.message || 'Ошибка Gemini ' + r.status);
    const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini не ответил (возможно, сработал фильтр). Переформулируйте вопрос.');
    return text;
  },

  // the data the model sees (plain text, numbers rounded)
  context(d) {
    const r = Math.round, T = agTotals(d), fc = d.forecast, L = [];
    L.push(`История загрузок начинается с ${UI.dateRu(d.hist.since)} — «дни без оплаты/покупки» не могут быть больше этого срока.`);
    L.push(`Сегодня ${UI.dateRu(REP.today())}. Последняя выгрузка на ${UI.dateRu(d.upload.taken_at)}, период ${UI.dateRu(d.upload.period_from)}–${UI.dateRu(d.upload.period_to)}${d.prev ? `, предыдущая загрузка ${UI.dateRu(d.prev.taken_at)}` : ''}. Все суммы в долларах США.`);
    if (fc.projectable) L.push(`Прошло ${fc.elapsed} из ${fc.month_days} дней месяца, осталось ${fc.days_left}.`);
    L.push(`Команда: продано ${r(T.sold)} из плана ${r(T.plan)}; собрано ${r(T.paid)} из плана сбора (пул) ${r(T.pool)}; возвраты ${r(T.ret)}; долг клиентов ${r(T.debt)} (${T.debtors} должников); АКБ ${T.akb} из ОКБ ${T.okb} (правило АКБ: ${d.settings.akb === 'paid' ? 'оплатили за период' : d.settings.akb === 'sold' ? 'покупали за период' : 'платили или покупали'}).`);
    L.push('', 'АГЕНТЫ (агент; продано; план продаж; собрано; план сбора; долг клиентов; должников; АКБ/ОКБ; продано за последний день; собрано за последний день; нужно продавать в день; нужно собирать в день; прогноз продаж на месяц):');
    for (const a of d.agents) L.push([a.agent, r(a.sold), r(a.plan), r(a.paid), r(a.pool), r(a.debt), a.debtors, `${a.akb}/${a.okb}`, a.d_sold ?? '-', a.d_paid ?? '-', a.need_sell_day !== undefined ? r(a.need_sell_day) : '-', a.need_collect_day !== undefined ? r(a.need_collect_day) : '-', a.proj_sold !== undefined ? r(a.proj_sold) : '-'].join('; '));
    L.push('', 'КЛИЕНТЫ (клиент; агент; продано за период; оплачено за период; возврат; долг (0 если нет); дней без оплаты (н — нет оплат за всё время загруженных данных); дней без покупки (н — нет покупок за всё время загруженных данных); активен в периоде; выпал из АКБ относительно прошлого месяца; план продаж; план сбора; заметка):');
    for (const c of d.clients) L.push([c.name, c.agent, r(c.sold), r(c.paid), r(c.ret), r(c.debt), c.lastPay ? c.payDays : 'н', c.lastBuy ? c.buyDays : 'н', c.active ? 'да' : 'нет', c.lost ? 'да' : '', r(c.plan), r(c.pool), (c.note || '').slice(0, 60)].join('; '));
    const M = d.hist.months.slice(-6);
    if (M.length > 1) { L.push('', 'ПО МЕСЯЦАМ (месяц; агент; продано; собрано; долг на конец; АКБ):'); for (const m of M) for (const [a, v] of Object.entries(m.agents)) L.push([m.label, a, r(v.sold), r(v.paid), r(v.debt), v.akb].join('; ')); }
    const tasks = d.tasks.filter(t => t.status !== 'done');
    if (tasks.length) { L.push('', 'ОТКРЫТЫЕ ЗАДАНИЯ (клиент; агент; тип; что сделать; цель $; срок; сделано $; статус):'); for (const t of tasks) L.push([t.client, t.agent, t.kind, t.text, r(t.target), t.due || '-', t.fact === null ? '-' : r(t.fact), t.status === 'overdue' ? 'просрочено' : 'в работе'].join('; ')); }
    if (d.low) { const items = d.low.items.filter(i => i.status !== 'ok').slice(0, 40); if (items.length) { L.push('', 'СКЛАД — заканчивается (товар; бренд; доступно; дней хватит; статус):'); for (const i of items) L.push([i.name, i.brand || '-', r(i.available), i.days_left === null ? '-' : r(i.days_left), { out: 'закончился', blocked: 'всё в резерве', low: 'ниже минимума', soon: 'скоро закончится' }[i.status]].join('; ')); } }
    return L.join('\n');
  },
  system(d) {
    return `Ты — аналитик по продажам и помощник супервайзера компании MITAL (дистрибуция моторных масел и смазок: Mitanol, Liman OIL, MATTEX, DELPIN, ECO FILTER; Ферганская долина, Узбекистан). Супервайзер руководит торговыми агентами; его цель — поднять продажи и сбор денег (дебиторку).
Правила ответа:
- Отвечай по-русски, коротко и по делу, как опытный коммерческий директор.
- Опирайся только на данные ниже. Называй конкретных агентов, клиентов и суммы. Не выдумывай цифры.
- Деньги пиши как $1 234. Не используй таблицы — только короткие абзацы и списки через «- ».
- Если для ответа не хватает данных (например, продаж по товарам или закупок), прямо скажи, какую выгрузку нужно загрузить в CRM.
- «Долг» — сколько клиент должен компании. «АКБ» — активные клиенты, «ОКБ» — все клиенты агента. «Пул» — план сбора денег.

ДАННЫЕ CRM:
${AI.context(d)}`;
  },
  md(text) {
    const lines = esc(text).split('\n'), out = []; let list = false;
    for (let l of lines) {
      l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
      const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${m[1]}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      const h = l.match(/^#{1,4}\s+(.*)$/);
      out.push(h ? `<p><b>${h[1]}</b></p>` : l.trim() ? `<p>${l}</p>` : '');
    }
    if (list) out.push('</ul>');
    return out.join('');
  },
};

const AI_QUICK = [
  ['☀ Утренний разбор', 'Сделай утренний разбор для супервайзера: 1) как идёт месяц у команды (продажи и сбор к плану с учётом прошедших дней); 2) кто из агентов отстаёт и насколько — с цифрами; 3) три главные проблемы; 4) конкретный план действий на сегодня: на кого из агентов надавить и с какими клиентами им работать в первую очередь.'],
  ['📞 Кому звонить сегодня', 'Составь список из 15 клиентов, по которым сегодня нужно собрать деньги: крупный долг и давно не платили. Для каждого: агент, сумма долга, сколько дней без оплаты и что сказать или сделать. Сгруппируй по агентам.'],
  ['📈 Как поднять продажи', 'Где самые большие резервы роста продаж? Посмотри спящих клиентов, клиентов которые выпали из АКБ, агентов с низкой долей АКБ и динамику по месяцам. Дай 5 конкретных действий с названиями клиентов и агентов.'],
  ['⚠ Риски по долгам', 'Оцени риски по дебиторке: у кого из клиентов долг растёт, кто перестал платить, у каких агентов проблемная база. Что делать с каждым случаем?'],
];
const aiChat = []; // {role:'me'|'ai', text}

EXT_PAGES.ai = async el => {
  const d = await REP.load(), hasKey = !!AI.key();
  el.innerHTML = `<div class="page-head"><div><h2>ИИ-ассистент</h2><div class="sub">${d.empty ? 'Загрузите данные — ассистенту нечего анализировать' : `Видит данные на ${UI.dateRu(d.upload.taken_at)}: ${d.agents.length} агентов, ${d.clients.length} клиентов${d.hist.months.length > 1 ? `, ${d.hist.months.length} мес. истории` : ''}${d.low ? ', склад' : ''}`}</div></div>
    <div class="actions">${aiChat.length ? '<button class="btn gray" id="aClear">Новый разговор</button>' : ''}</div></div>
    ${!hasKey ? UI.empty('Нужен ключ Gemini', 'Он бесплатный: зайдите на <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, нажмите «Create API key» и вставьте ключ в разделе <a href="#/cloud">Данные → Синхронизация и настройки</a>. Ключ сохранится вместе с данными и будет работать на всех устройствах.') : d.empty ? UI.empty('Нет данных', 'Загрузите выгрузку «Баланс клиентов» в <a href="#/aup">Агенты → Загрузки</a>.') : `
    <div class="aiq">${AI_QUICK.map(([t], i) => `<button class="btn gray" data-q="${i}">${t}</button>`).join('')}<button class="btn gray" id="aTasks">✅ Предложить задания агентам</button></div>
    <div class="aichat" id="aLog">${aiChat.map(m => `<div class="msg ${m.role}">${m.role === 'ai' ? AI.md(m.text) : esc(m.text)}</div>`).join('') || '<div class="mut aihint">Спросите что угодно о продажах, агентах, клиентах и долгах. Например: «Почему у Собирова низкий сбор?», «Какие клиенты Кувы давно не брали товар?», «Сравни агентов по АКБ».</div>'}</div>
    <form class="aiask" id="aForm"><textarea id="aIn" rows="2" placeholder="Ваш вопрос…" aria-label="Вопрос ассистенту"></textarea><button class="btn" id="aGo">Спросить</button></form>
    <div id="aTaskBox"></div>`}`;
  if (!hasKey || d.empty) return;
  const log = $('#aLog', el), input = $('#aIn', el), go = $('#aGo', el), system = AI.system(d);
  const draw = () => { log.innerHTML = aiChat.map((m, i) => `<div class="msg ${m.role}">${m.role === 'ai' ? AI.md(m.text) + `<div class="mtools"><button class="btn gray sm" data-copy="${i}">Копировать</button>${TG.conf().me && TG.conf().token ? `<button class="btn gray sm" data-tg="${i}">В Telegram себе</button>` : ''}</div>` : esc(m.text)}</div>`).join(''); bind(); log.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const bind = () => {
    log.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(aiChat[+b.dataset.copy].text); toast('Скопировано'); } catch { /* ignore */ } });
    log.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { try { await TG.send(TG.conf().me.id, esc(aiChat[+b.dataset.tg].text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')); toast('Отправлено вам в Telegram'); } catch (e) { toast(e.message); } });
  };
  bind();
  const ask = async q => {
    if (!q.trim()) return;
    aiChat.push({ role: 'me', text: q.trim() }); draw();
    log.insertAdjacentHTML('beforeend', '<div class="msg ai thinking" id="aWait">Думаю…</div>'); go.disabled = true;
    try { aiChat.push({ role: 'ai', text: await AI.ask(aiChat.slice(-12), system) }); }
    catch (e) { aiChat.pop(); toast(e.message); input.value = q; }
    go.disabled = false; draw();
  };
  $('#aForm', el).onsubmit = e => { e.preventDefault(); const q = input.value; input.value = ''; ask(q); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); $('#aForm', el).requestSubmit(); } };
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(AI_QUICK[+b.dataset.q][1]));
  const clr = $('#aClear', el); if (clr) clr.onclick = () => { aiChat.length = 0; EXT_PAGES.ai(el); };

  $('#aTasks', el).onclick = async () => {
    const box = $('#aTaskBox', el), btn = $('#aTasks', el);
    btn.disabled = true; box.innerHTML = '<p class="mut">Подбираю задания…</p>';
    const kinds = d.kinds || ['Сбор оплаты', 'Продажа', 'Погашение долга', 'Другое'];
    const prompt = `Предложи 10–15 самых полезных заданий агентам на ближайшую неделю, чтобы поднять продажи и сбор денег. Не дублируй открытые задания. Ответ — только JSON-массив объектов: {"client": точное имя клиента из данных, "kind": одно из ${JSON.stringify(kinds)}, "text": что сделать (коротко), "target": цель в долларах (число, 0 если нет), "days": срок в днях (число 1–14), "why": почему (коротко)}.`;
    try {
      const raw = await AI.ask([{ role: 'me', text: prompt }], system, { json: true });
      const known = CRMLocal.engine.getState().ag.clients;
      const list = (JSON.parse(raw.replace(/^```json|```$/g, '')) || []).filter(t => t && known[t.client]).map(t => ({ ...t, kind: kinds.includes(t.kind) ? t.kind : 'Другое', target: Math.max(0, Math.round(+t.target || 0)), days: Math.min(30, Math.max(1, Math.round(+t.days || 7))), agent: known[t.client].agent }));
      if (!list.length) throw new Error('ИИ не предложил подходящих заданий — попробуйте ещё раз');
      box.innerHTML = UI.panel('Предложенные задания', `<div class="scroll" style="max-height:none"><table><thead><tr><th><input type="checkbox" id="tAll" checked aria-label="Все"></th><th>Клиент</th><th>Агент</th><th>Задание</th><th class="n">Цель</th><th class="n">Срок</th><th>Почему</th></tr></thead><tbody>${list.map((t, i) => `<tr><td><input type="checkbox" data-t="${i}" checked aria-label="Выбрать"></td><td>${esc(t.client)}</td><td>${esc(t.agent)}</td><td>${UI.pill('info', t.kind)}<br>${esc(t.text)}</td><td class="n">${t.target ? '$' + UI.fmt0(t.target) : '—'}</td><td class="n">${t.days} дн.</td><td><small>${esc(t.why || '')}</small></td></tr>`).join('')}</tbody></table></div>
        <div class="bar" style="margin-top:12px"><button class="btn" id="tMake">Создать выбранные задания</button><span class="mut">Появятся в «Агенты → Задания агентам» и в отчётах агентам в Telegram</span></div>`, { cls: 'w12' });
      $('#tAll', box).onchange = e => box.querySelectorAll('[data-t]').forEach(c => c.checked = e.target.checked);
      $('#tMake', box).onclick = async () => {
        const chosen = [...box.querySelectorAll('[data-t]')].filter(c => c.checked).map(c => list[+c.dataset.t]);
        for (const t of chosen) await CRMLocal.request('POST', '/api/ag/tasks', { client: t.client, kind: t.kind, text: t.text, target: t.target, due: UI.localDate(Date.now() + t.days * 864e5) });
        await CRMLocal.flush(); toast(`Создано заданий: ${chosen.length}`); box.innerHTML = `<p class="pos">✓ Создано заданий: ${chosen.length}. <a href="#/atasks">Открыть задания</a></p>`;
      };
    } catch (e) { box.innerHTML = `<p class="neg">${esc(e.message)}</p>`; }
    btn.disabled = false;
  };
};
