// Напоминания об обещанных оплатах (столбец «Ещё оплатит»): что клиент обещал заплатить сегодня, завтра (напоминание за день)
// и что не заплатил в обещанный день. Каждое утро в выбранный час это присылает Google-скрипт автозагрузки (remind.gs),
// даже когда CRM закрыта; кнопка «Отправить сейчас» шлёт то же самое прямо из CRM.
// Settings live in the synced state (ext.payRemind) so the script reads the same ones.
const REMIND = {
  conf: () => (CRMLocal.ext().payRemind ||= { on: true, hour: 9, agents: false, fmt: 'xlsx' }),
  plus: (d, n) => UI.localDate(Date.parse(d + 'T12:00:00') + n * 864e5),
  // when each client last paid (a growth of «Оплачено» between two snapshots of the same period) and the current debt
  facts(S) {
    const ups = (S.ag.uploads || []).slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const prev = new Map(), last = new Map();
    for (const u of ups) for (const r of u.rows || []) { const k = u.period_from + '|' + r.client; if ((r.paid || 0) > (prev.get(k) || 0) + 0.005) last.set(r.client, u.taken_at); prev.set(k, r.paid || 0); }
    const latest = ups[ups.length - 1], debt = new Map((latest?.rows || []).map(r => [r.client, (r.b1 || 0) < 0 ? -r.b1 : 0]));
    return { last, debt, hasDebt: !!latest };
  },
  // { today:[], tomorrow:[], late:[] } of {client, agent, d, s, debt, paid}
  lists(today = UI.localDate(Date.now())) {
    const S = CRMLocal.engine.getState(), P = CRMLocal.ext().payPlan || {}, F = REMIND.facts(S), tm = REMIND.plus(today, 1), weekAgo = REMIND.plus(today, -7);
    const out = { today: [], tomorrow: [], late: [] };
    for (const [client, list] of Object.entries(P)) {
      const debt = F.debt.has(client) ? F.debt.get(client) : null; if (F.hasDebt && debt !== null && debt < 0.5) continue; // the debt is closed
      const lp = F.last.get(client) || '', agent = S.ag.clients[client]?.agent || 'Без агента';
      for (const x of list || []) {
        const it = { client, agent, d: x.d, s: x.s, debt, paid: lp >= x.d };
        if (x.d === today) out.today.push(it); else if (x.d === tm) out.tomorrow.push(it); else if (x.d < today && x.d >= weekAgo && !it.paid) out.late.push(it);
      }
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.agent.localeCompare(b.agent) || b.s - a.s);
    return out;
  },
  text(L, agent, today = UI.localDate(Date.now())) {
    const f = UI.fmt0, pick = a => a.filter(x => !agent || x.agent === agent), T = pick(L.today), M = pick(L.tomorrow), Lt = pick(L.late);
    if (!T.length && !M.length && !Lt.length) return '';
    const row = x => `• ${esc(x.client)}${agent ? '' : ` <i>(${esc(x.agent)})</i>`} — <b>$${f(x.s)}</b>${x.debt ? ` · долг $${f(x.debt)}` : ''}`;
    const sum = a => f(a.reduce((s, x) => s + x.s, 0)), out = [`🔔 <b>Обещанные оплаты — ${UI.dateRu(today)}</b>${agent ? `\n${esc(agent)}` : ''}`];
    if (T.length) out.push('', `<b>Сегодня (${T.length}) — ждём $${sum(T)}</b>`, ...T.map(x => row(x) + (x.paid ? ' ✅ уже платил сегодня' : '')));
    if (M.length) out.push('', `<b>Завтра, ${UI.dm(REMIND.plus(today, 1))} (${M.length}) — $${sum(M)}</b>`, ...M.map(row));
    if (Lt.length) out.push('', `<b>⚠️ Не заплатили в обещанный день (${Lt.length})</b>`, ...Lt.map(x => row(x) + ` · обещал ${UI.dm(x.d)}`));
    return out.join('\n');
  },
  caption(L, agent, today = UI.localDate(Date.now())) {
    const f = UI.fmt0, pick = a => a.filter(x => !agent || x.agent === agent), T = pick(L.today), M = pick(L.tomorrow), Lt = pick(L.late), s = a => f(a.reduce((x, y) => x + y.s, 0));
    return [`🔔 <b>Обещанные оплаты — ${UI.dm(today)}</b>${agent ? ' · ' + esc(agent) : ''}`, `Сегодня: ${T.length ? `<b>${T.length} — $${s(T)}</b>` : 'нет'}`, `Завтра: ${M.length ? `${M.length} — $${s(M)}` : 'нет'}`, ...(Lt.length ? [`⚠️ Не заплатили в обещанный день: ${Lt.length} — $${s(Lt)}`] : [])].join('\n');
  },
  // Excel file (SheetJS, loaded on first use)
  async xlsx(L, agent, today = UI.localDate(Date.now())) {
    if (!window.XLSX) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('Не удалось загрузить модуль Excel (нет интернета?)')); document.head.appendChild(sc); });
    const pick = a => a.filter(x => !agent || x.agent === agent), head = ['№', 'Когда', 'Дата', 'Клиент', ...(agent ? [] : ['Агент']), 'Обещал, $', 'Долг сейчас, $', 'Статус'], rows = [head];
    for (const [name, list] of [['Сегодня', pick(L.today)], ['Завтра', pick(L.tomorrow)], ['Не заплатили в обещанный день', pick(L.late)]]) {
      if (!list.length) continue; let i = 0, tot = 0;
      for (const x of list) { i++; tot += x.s; const late = REP.days(x.d, today); rows.push([i, name, UI.dm(x.d), x.client, ...(agent ? [] : [x.agent]), x.s, x.debt ?? '', x.d === today ? (x.paid ? 'уже платил сегодня' : 'ждём сегодня') : x.d > today ? 'напомнить' : `не заплатил · ${late} дн.`]); }
      rows.push(['', 'Итого: ' + name.toLowerCase(), '', i + ' кл.', ...(agent ? [] : ['']), Math.round(tot * 100) / 100, '', '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [4, 22, 7, 32, ...(agent ? [] : [24]), 11, 13, 22].map(w => ({ wch: w })); ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Оплаты ' + UI.dm(today));
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  },
  async sendDoc(chat, blob, name, caption) {
    const fd = new FormData(); fd.append('chat_id', chat); fd.append('document', blob, name); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
    const r = await fetch(`https://api.telegram.org/bot${TG.conf().token}/sendDocument`, { method: 'POST', body: fd }).catch(() => null), d = r ? await r.json().catch(() => ({})) : {};
    if (!d.ok) throw new Error(d.description || 'Не удалось отправить файл в Telegram');
  },
  async sendNow() {
    const c = REMIND.conf(), tg = TG.conf(), L = REMIND.lists(); let n = 0;
    if (!tg.token) throw new Error('Сначала подключите бота: Отчёт дня → Telegram агентам');
    const me = REMIND.text(L);
    if (!me) return 'Сегодня, завтра и просроченных обещанных оплат нет — отправлять нечего';
    const t0 = UI.localDate(Date.now()), send = async (chat, agent, text) => { if (c.fmt !== 'text') return REMIND.sendDoc(chat, await REMIND.xlsx(L, agent), `Оплаты_${UI.dm(t0).replace('.', '-')}${agent ? '_' + agent.split(' ')[0] : ''}.xlsx`, REMIND.caption(L, agent)); return TG.send(chat, text); };
    if (tg.me?.id) { await send(tg.me.id, '', me); n++; }
    if (c.agents) for (const a of new Set([...L.today, ...L.tomorrow, ...L.late].map(x => x.agent))) { const ch = tg.chats?.[a], t = REMIND.text(L, a); if (ch?.id && t) { await send(ch.id, a, t); n++; } }
    return n ? `Отправлено сообщений: ${n}` : 'Некому отправить: привяжите свой чат («Я, руководитель») в «Telegram агентам»';
  },
  // how a promised date looks in a cell: today / tomorrow / passed
  tag(d, paid) {
    const t = UI.localDate(Date.now());
    if (d === t) return paid ? '<small class="pos">сегодня ✓</small>' : '<small style="color:var(--c4,#e9a23b);font-weight:700">сегодня</small>';
    if (d === REMIND.plus(t, 1)) return '<small style="color:var(--c4,#e9a23b)">завтра</small>';
    if (d < t) return paid ? '<small class="pos">оплатил ✓</small>' : '<small class="neg">не оплатил</small>';
    return '';
  },
  dialog() {
    const c = REMIND.conf(), tg = TG.conf(), L = REMIND.lists(), f = UI.fmt0, s = a => f(a.reduce((x, y) => x + y.s, 0));
    const m = modal(`<h3 style="margin:0 0 4px">🔔 Напоминания об оплатах</h3>
      <p class="mut" style="margin:0 0 12px">Каждое утро бот присылает: кто обещал заплатить <b>сегодня</b>, кто <b>завтра</b> (напоминание за день) и кто <b>не заплатил</b> в обещанный день. Берётся из столбца «Ещё оплатит».</p>
      <div style="display:grid;gap:10px">
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rmOn" ${c.on !== false ? 'checked' : ''}> Присылать каждое утро</label>
        <label style="display:flex;gap:8px;align-items:center">Во сколько <select id="rmH">${Array.from({ length: 14 }, (_, i) => i + 7).map(h => `<option value="${h}" ${h === (c.hour ?? 9) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <label style="display:flex;gap:8px;align-items:center">Как присылать <select id="rmF"><option value="xlsx" ${c.fmt !== 'text' ? 'selected' : ''}>Excel-таблица + короткая сводка</option><option value="text" ${c.fmt === 'text' ? 'selected' : ''}>Обычным текстом</option></select></label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rmAg" ${c.agents ? 'checked' : ''}> Ещё и каждому агенту — список по его клиентам</label>
      </div>
      <div class="mut" style="margin:12px 0;font-size:13px">Сейчас: сегодня ${L.today.length} на $${s(L.today)} · завтра ${L.tomorrow.length} на $${s(L.tomorrow)} · не заплатили ${L.late.length}<br>
        ${tg.token ? (tg.me?.id ? '✓ Бот подключён, ваш чат привязан' : '⚠️ Привяжите свой чат «Я (руководитель)» в Отчёт дня → Telegram агентам') : '⚠️ Бот не подключён: Отчёт дня → Telegram агентам'}</div>
      <details style="font-size:13px;margin-bottom:10px"><summary><b>Чтобы приходило само, даже когда CRM закрыта</b> (один раз)</summary>
        <ol class="steps" style="margin:8px 0 0"><li>Откройте ваш проект Google Apps Script с автозагрузкой из LINKO.</li><li>Слева «＋» → «Скрипт», назовите <b>remind</b>, вставьте содержимое файла <b>remind.gs</b> и сохраните.</li><li>Вверху выберите функцию <b>setupRemind</b> → «Выполнить». Придёт тестовое сообщение — значит, всё работает.</li></ol>
        <p class="mut" style="margin:6px 0 0">Ключи вписывать не нужно: скрипт берёт их из файла автозагрузки. Настройки выше он читает из CRM.</p></details>
      <div class="bar"><button class="btn gray" id="rmSend">✈ Отправить сейчас</button><span class="spacer"></span><button class="btn gray" id="rmX">Закрыть</button><button class="btn" id="rmOk">Сохранить</button></div>`);
    $('#rmX', m.el).onclick = () => m.close();
    const save = () => { c.on = $('#rmOn', m.el).checked; c.hour = +$('#rmH', m.el).value; c.agents = $('#rmAg', m.el).checked; c.fmt = $('#rmF', m.el).value; CRMLocal.touch(); };
    $('#rmOk', m.el).onclick = () => { save(); m.close(); toast(c.on ? `Напоминания каждый день в ${String(c.hour).padStart(2, '0')}:00` : 'Напоминания выключены'); };
    $('#rmSend', m.el).onclick = async () => { save(); try { toast(await REMIND.sendNow()); } catch (e) { toast(e.message); } };
  },
};
