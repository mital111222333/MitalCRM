// Сверка складов (Склад → Сверка складов): every morning the store keeper of each warehouse counts all goods in his cabinet (me.html,
// Telegram Mini App) without seeing the LINKO numbers. The auto-loader keeps LINKO «Всего» at the moment he presses «Начать сверку»,
// compares on «Отправить», messages the supervisor and saves the count to inbox/; this module pulls it (via ATK.pull → INBOX_HANDLERS)
// and shows only the discrepancies: shortage / surplus in units and in $ (cost from the stock uploads). «Пересчитать» sends chosen
// items back to the store keeper. Store keepers get their cabinet as agents/tg/<telegram id>.json (role 'store'); stores.json lists
// them for the auto-loader's reminder after the deadline.
// Stored in the synced state: ext.wcount = { deadline: '10:00', stores: { [telegram id]: { name, wh, on, tgAt } }, subs: [ … ] }.
window.EXT_PAGES = window.EXT_PAGES || {};
window.INBOX_HANDLERS = window.INBOX_HANDLERS || {};

const WC = {
  sel: null,
  cfg() { const x = CRMLocal.ext(); const c = (x.wcount ||= { deadline: '10:00', stores: {}, subs: [] }); c.stores ||= {}; c.subs ||= []; return c; },
  day: iso => UI.localDate(Date.parse(iso)),
  hm: iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  branchOf(wh) { const B = CRMLocal.ext().linkoBranch || {}; return Object.keys(B).find(b => B[b] === wh) || null; },
  // cost of one unit (from the newest stock upload of the warehouse) to show discrepancies in $
  costs(wh) {
    const S = CRMLocal.engine.getState(), u = (S.wh.uploads || []).filter(x => x.warehouse === wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0], m = new Map();
    for (const r of u?.rows || []) if (r.cost > 0) m.set(String(r.art), r.cost);
    return m;
  },
  view(sub) {
    const cost = WC.costs(sub.warehouse);
    const rows = sub.items.map(i => ({ ...i, d: i.fact - i.linko, moved: i.fact !== i.linko && i.fact === i.now, cost: cost.get(String(i.art)) || 0 }));
    const diff = rows.filter(i => i.fact !== i.linko && !i.moved);
    const short = diff.filter(i => i.d < 0), plus = diff.filter(i => i.d > 0);
    return { rows, diff, moved: rows.filter(i => i.moved), short, plus, shortSum: short.reduce((s, i) => s + -i.d * i.cost, 0), plusSum: plus.reduce((s, i) => s + i.d * i.cost, 0) };
  },

  // a count from inbox/: a full count is a new record; a recount updates the items of that warehouse's last count of the day
  apply(m) {
    const c = WC.cfg(), day = WC.day(m.at);
    if (m.partial) {
      const last = c.subs.filter(s => s.who === m.who && s.day === day && !s.partial).at(-1);
      if (last) {
        for (const it of m.items) { const i = last.items.findIndex(x => x.art === it.art); if (i >= 0) last.items[i] = it; else last.items.push(it); }
        last.status = 'new'; last.recount = []; last.recountAt = m.at; return true;
      }
    }
    c.subs.push({ id: Date.parse(m.at) + '-' + m.who, who: m.who, name: m.name, warehouse: m.warehouse, day, start_at: m.start_at, at: m.at, partial: !!m.partial, items: m.items, photo: m.photo || '', comment: m.comment || '', status: 'new', recount: [] });
    c.subs = c.subs.slice(-400);
    return true;
  },

  // the store keepers' cabinets + stores.json for the reminder
  async publish() {
    const c = WC.cfg(), cl = typeof AC !== 'undefined' ? AC.cloud() : null; if (!cl) return 0;
    const on = Object.entries(c.stores).filter(([, s]) => s.on && s.wh);
    const bot = CRMLocal.ext().tg?.token ? await AC.bot() : '';
    for (const [who, s] of on) {
      const last = c.subs.filter(x => x.who === who).at(-1), recount = last && last.status === 'recount' ? last.recount : [];
      const S = CRMLocal.engine.getState(), up = (S.wh.uploads || []).filter(u => u.warehouse === s.wh).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0];
      const items = (up?.rows || []).map(r => ({ art: String(r.art), name: r.name, brand: r.brand || '' })); // names only: the count is blind
      const file = { v: 1, role: 'store', who, name: s.name, warehouse: s.wh, branch: WC.branchOf(s.wh), deadline: c.deadline || '10:00', boss: AC.boss() || null, bot: bot || null, chat: typeof CHAT !== 'undefined' && CHAT.url ? CHAT.url() : null, at: new Date().toISOString(), recount: recount.map(a => ({ art: a, name: last.items.find(i => i.art === a)?.name || a })), items };
      await AC.gh(cl, 'PUT', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада', content: AC.b64(JSON.stringify(file)) });
    }
    await AC.gh(cl, 'PUT', 'stores.json', { message: 'CRM: склады и срок сверки', content: AC.b64(JSON.stringify({ deadline: c.deadline || '10:00', list: on.map(([who, s]) => ({ who, name: s.name, warehouse: s.wh })) })) });
    return on.length;
  },
  async connect(who) {
    const s = WC.cfg().stores[who], url = AC.miniUrl();
    await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: { type: 'web_app', text: 'Кабинет склада', web_app: { url } } });
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: `<b>Кабинет склада ${esc(s.wh)}</b>\nКаждое утро до ${esc(WC.cfg().deadline || '10:00')} пересчитайте товары и отправьте сверку — прямо здесь, в Telegram.`, reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } });
  },
  async notify(who, html) {
    const url = AC.web() ? AC.miniUrl() : '';
    await TG.call('sendMessage', { chat_id: Number(who), parse_mode: 'HTML', text: html, ...(url ? { reply_markup: { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url } }]] } } : {}) });
  },
};
INBOX_HANDLERS.count = m => WC.apply(m);

EXT_PAGES.wcount = async el => {
  await CRMLocal.ready;
  const c = WC.cfg(), f = UI.fmt0, t0 = UI.localDate(Date.now()), $$ = v => '$' + f(v), late = new Date().toTimeString().slice(0, 5) >= (c.deadline || '10:00');
  let whs = []; try { whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* none */ }
  const tg = CRMLocal.ext().tg || {}, chats = { ...(tg.seen || {}) }; for (const v of Object.values(tg.chats || {})) if (v?.id) chats[v.id] = v;
  const stores = Object.entries(c.stores);
  const todayOf = who => c.subs.filter(s => s.who === who && s.day === t0 && !s.partial).at(-1);
  if (!WC.sel || !c.subs.some(s => s.id === WC.sel)) WC.sel = (c.subs.filter(s => s.day === t0).at(-1) || c.subs.at(-1))?.id || null;
  const sub = c.subs.find(s => s.id === WC.sel), V = sub ? WC.view(sub) : null;
  const days = [...new Set(c.subs.map(s => s.day))].sort().reverse().slice(0, 14);
  const freq = new Map(); for (const s of c.subs.filter(x => days.includes(x.day))) for (const i of WC.view(s).diff) { const k = s.warehouse + '|' + i.art, e = freq.get(k) || freq.set(k, { wh: s.warehouse, name: i.name, n: 0, sum: 0 }).get(k); e.n++; e.sum += i.d; }
  const often = [...freq.values()].filter(e => e.n >= 2).sort((a, b) => b.n - a.n);
  const tiles = stores.length ? stores.map(([who, s]) => { const t = todayOf(who), v = t ? WC.view(t) : null; return UI.tile(esc(s.wh), t ? (v.diff.length ? `${v.diff.length} расх.` : '✓ сходится') : '✕ нет', { sub: t ? `сегодня в ${WC.hm(t.at)} · ${esc(s.name)}${t.status === 'recount' ? ' · ждём пересчёт' : t.status === 'ok' ? ' · принято' : ''}` : `сегодня не прислана · ${esc(s.name)}`, tone: !t ? (late ? 'bad' : 'warn') : v.diff.length ? 'warn' : 'good' }); }).join('') : UI.tile('Завскладов нет', '—', { sub: 'добавьте ниже' });
  el.innerHTML = `<div class="page-head"><div><h2>Сверка складов</h2><div class="sub">Завсклады каждое утро до ${esc(c.deadline || '10:00')} пересчитывают все товары в своём кабинете в Telegram — вслепую, не видя цифр LINKO. Здесь — только расхождения с «Всего» в LINKO на момент начала сверки.</div></div>
    <div class="actions"><button class="btn gray" id="wcPull">Проверить сверки</button></div></div>
    <div class="kpis">${tiles}</div>
    ${sub ? UI.panel(`${esc(sub.warehouse)} · ${UI.dateRu(sub.day)} ${WC.hm(sub.at)} · ${esc(sub.name)}`, `
      <div class="bar"><label class="mut">Сверка <select id="wcSel">${c.subs.slice().reverse().slice(0, 60).map(s => `<option value="${esc(s.id)}" ${s.id === sub.id ? 'selected' : ''}>${UI.dateRu(s.day)} · ${esc(s.warehouse)}${s.partial ? ' (пересчёт)' : ''}</option>`).join('')}</select></label>
        <span class="mut">посчитано позиций: ${f(sub.items.length)} · расхождений: <b>${f(V.diff.length)}</b> · недостача ${$$(V.shortSum)} · излишек ${$$(V.plusSum)}${sub.start_at ? '' : ' · ⚠ начало сверки не зафиксировано — сравнение с остатком на момент отправки'}</span></div>
      ${sub.comment ? `<p>💬 ${esc(sub.comment)}</p>` : ''}${sub.photo ? `<p><a href="#" data-ph="${esc(sub.photo)}">📷 фото со склада</a></p>` : ''}
      ${V.diff.length ? LX.table(['', 'Товар', '#По LINKO', '#Факт', '#Разница', '#В $'], V.diff.sort((a, b) => a.d * (a.cost || 1) - b.d * (b.cost || 1)).map(i => `<tr><td><input type="checkbox" data-rc="${esc(i.art)}" ${sub.recount?.includes(i.art) ? 'checked' : ''} aria-label="Пересчитать"></td><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td class="n">${f(i.linko)}</td><td class="n"><b>${f(i.fact)}</b></td><td class="n ${i.d < 0 ? 'neg' : 'pos'}"><b>${i.d > 0 ? '+' : ''}${f(i.d)}</b></td><td class="n">${i.cost ? (i.d < 0 ? '−' : '+') + $$(Math.abs(i.d) * i.cost) : '—'}</td></tr>`)) : '<p class="pos"><b>✓ Всё сходится с LINKO</b></p>'}
      ${V.moved.length ? `<details><summary class="mut">Сошлось с LINKO после отгрузки во время сверки (${V.moved.length})</summary><ul>${V.moved.map(i => `<li>${esc(i.name)}: на начало ${f(i.linko)}, после отгрузки ${f(i.now)}, факт ${f(i.fact)}</li>`).join('')}</ul></details>` : ''}
      <div class="bar needs-edit" style="margin-top:10px">${sub.status === 'recount' ? `<span class="mut">↻ Отправлено на пересчёт: ${sub.recount.length} поз.</span>` : ''}<span class="spacer"></span>${V.diff.length ? '<button class="btn gray" id="wcRc">↻ Пересчитать отмеченные</button>' : ''}<button class="btn" id="wcOk"${sub.status === 'ok' ? ' disabled' : ''}>${sub.status === 'ok' ? '✓ Принято' : '✓ Принять сверку'}</button></div>`, { cls: 'w12', sub: 'Отметьте позиции и нажмите «Пересчитать» — завсклад получит только их. «Разница» = факт − LINKO: минус — недостача, плюс — излишек.' }) : UI.empty('Сверок ещё нет', 'Добавьте завскладов ниже и подключите им кабинет склада в Telegram.')}
    <div class="grid">
    ${days.length ? UI.panel('По дням', `<div class="tscroll"><table><thead><tr><th>День</th>${stores.map(([, s]) => `<th class="n">${esc(s.wh)}</th>`).join('')}</tr></thead><tbody>${days.map(d => `<tr><td>${UI.dateRu(d)}</td>${stores.map(([who]) => { const s = c.subs.filter(x => x.who === who && x.day === d && !x.partial).at(-1); if (!s) return '<td class="n neg">нет</td>'; const v = WC.view(s); return `<td class="n ${v.diff.length ? 'neg' : 'pos'}">${v.diff.length ? v.diff.length + ' расх.' : '✓'} <small class="mut">${WC.hm(s.at)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`, { cls: 'w7', sub: 'Последние 14 дней: расхождения и время отправки' }) : ''}
    ${often.length ? UI.panel('Расходятся постоянно', LX.table(['Склад', 'Товар', '#Раз за 14 дней', '#Сумма разниц'], often.slice(0, 20).map(e => `<tr><td>${esc(e.wh)}</td><td>${esc(e.name)}</td><td class="n"><b>${e.n}</b></td><td class="n ${e.sum < 0 ? 'neg' : 'pos'}">${e.sum > 0 ? '+' : ''}${f(e.sum)}</td></tr>`)), { cls: 'w5', sub: 'Повторяющаяся недостача одного товара — повод разобраться' }) : ''}
    ${UI.panel('Завсклады', `<div class="bar"><label class="mut">Сверка до <input id="wcDl" type="time" value="${esc(c.deadline || '10:00')}" style="width:110px"></label><span class="mut">— после этого времени бот напомнит завскладу и сообщит вам, кто не прислал (по воскресеньям — нет)</span></div>
      ${stores.length ? LX.table(['Завсклад', 'Склад', 'Telegram', ''], stores.map(([who, s]) => `<tr><td>${esc(s.name)}</td><td>${esc(s.wh)}</td><td>${esc(chats[who]?.name || who)}${s.tgAt ? `<br><small class="mut">кабинет с ${UI.dateRu(s.tgAt.slice(0, 10))}</small>` : ''}</td><td><button class="btn sm" data-tgc="${esc(who)}">📦 ${s.tgAt ? 'Подключить заново' : 'Подключить в Telegram'}</button> <button class="btn gray sm" data-rm="${esc(who)}">Убрать</button></td></tr>`)) : '<p class="mut">Завскладов пока нет.</p>'}
      <div class="form" style="margin-top:10px"><label>Имя<input id="wcN" maxlength="60" placeholder="например: Ахмад"></label><label>Склад<select id="wcW">${whs.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
      <label>Его Telegram<select id="wcT"><option value="">— выберите —</option>${Object.values(chats).filter(ch => !c.stores[ch.id]).map(ch => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('')}</select><small class="mut">Нет в списке? Пусть нажмёт «Старт» в боте, затем «Обновить список» в «Telegram агентам».</small></label></div>
      <div class="bar"><span class="spacer"></span><button class="btn" id="wcAdd">Добавить завсклада</button></div>`, { cls: 'w12' })}
    </div>`;
  const re = () => EXT_PAGES.wcount(el), save = async () => { CRMLocal.touch(); try { await WC.publish(); } catch (e) { toast(e.message); } };
  $('#wcPull', el).onclick = async () => { try { const n = await ATK.pull(); toast(n ? `Новое: ${n}` : 'Новых сверок нет'); re(); } catch (e) { toast(e.message); } };
  const s1 = $('#wcSel', el); if (s1) s1.onchange = e => { WC.sel = e.target.value; re(); };
  const ok = $('#wcOk', el); if (ok) ok.onclick = async () => { sub.status = 'ok'; sub.recount = []; await save(); try { await WC.notify(sub.who, `✓ Сверка ${esc(sub.warehouse)} за ${UI.dateRu(sub.day)} принята`); } catch { /* Telegram not reachable */ } re(); };
  const rc = $('#wcRc', el); if (rc) rc.onclick = async () => {
    const arts = [...el.querySelectorAll('[data-rc]:checked')].map(b => b.dataset.rc); if (!arts.length) return toast('Отметьте позиции для пересчёта');
    sub.status = 'recount'; sub.recount = arts; await save();
    try { await WC.notify(sub.who, `↻ <b>Пересчитайте ${arts.length} поз.</b> на складе ${esc(sub.warehouse)}:\n${arts.map(a => '• ' + esc(sub.items.find(i => i.art === a)?.name || a)).join('\n')}`); toast('Отправлено на пересчёт'); } catch (e) { toast(e.message); } re();
  };
  $('#wcDl', el).onchange = async e => { if (!/^\d{2}:\d{2}$/.test(e.target.value)) { e.target.value = c.deadline || '10:00'; return toast('Время ЧЧ:ММ'); } c.deadline = e.target.value; await save(); toast('Срок сверки: ' + c.deadline); };
  $('#wcAdd', el).onclick = async () => {
    const name = $('#wcN', el).value.trim(), wh = $('#wcW', el).value, who = $('#wcT', el).value;
    if (!name || !wh || !who) return toast('Заполните имя, склад и Telegram');
    if (!WC.branchOf(wh)) toast(`Внимание: для склада ${wh} нет связи со складом LINKO — сверка начнёт сравнивать, когда автозагрузка его узнает`);
    c.stores[who] = { name: name.slice(0, 60), wh, on: true, tgAt: '' }; await save(); re();
  };
  el.querySelectorAll('[data-tgc]').forEach(b => b.onclick = async () => { const who = b.dataset.tgc; try { await WC.publish(); await WC.connect(who); c.stores[who].tgAt = new Date().toISOString(); CRMLocal.touch(); toast('Готово: у завсклада в боте кнопка «Кабинет склада»'); re(); } catch (e) { toast(e.message); } });
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const who = b.dataset.rm; if (!confirm(`Убрать ${c.stores[who].name} из завскладов? Кабинет склада у него закроется.`)) return;
    delete c.stores[who];
    try { const cl = AC.cloud(); if (cl) await AC.gh(cl, 'DELETE', 'agents/tg/' + who + '.json', { message: 'CRM: кабинет склада закрыт' }); await TG.call('setChatMenuButton', { chat_id: Number(who), menu_button: { type: 'default' } }); } catch { /* already closed */ }
    await save(); re();
  });
  el.querySelectorAll('[data-ph]').forEach(a => a.onclick = async e => { e.preventDefault(); try { const url = await ATK.photo(a.dataset.ph); const m = modal(`<img src="${url}" alt="Фото со склада" style="max-width:100%;border-radius:8px"><div class="bar"><span class="spacer"></span><button class="btn gray" id="phX">Закрыть</button></div>`); $('#phX', m.el).onclick = () => { URL.revokeObjectURL(url); m.close(); }; } catch (err) { toast(err.message); } });
};
