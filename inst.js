// Рассрочка и договоры (Деньги → 📅 Рассрочка и договоры).
// Every order of a client automatically gets a schedule: N parts (4 by default) due 7, 14, 21 days after the order and the last
// on the term day (30). The Google auto-loader (autolinko.gs, inst_) does the counting every 5 minutes, even when the CRM is
// closed: what is paid of each order follows from the client's current LINKO debt (payments close the oldest orders first),
// and every morning it sends each agent his clients with a part due today or overdue, and you the summary of all agents.
// Contracts: a client (one or more LINKO accounts — the contract card and the «spets» card) buys for $X a month for N months;
// the page and the reminders show how much was bought each month against that.
// The CRM sends the rules to the auto-loader as inst-rules.json and shows its result inst-state.json.
// Stored in the synced state: ext.inst = { on, days, parts, hour, agents, sunday, clients: { [name]: { days?, parts?, ex? } },
//   contracts: [{ id, title, accounts: [names], monthly (usual sum), months, plan: [$ of each month], start, agent, days?, parts? }], publishedAt }.
window.EXT_PAGES = window.EXT_PAGES || {};

const INST = {
  view: 'due', agent: '', who: '', q: '', open: new Set(),
  RULES: 'inst-rules.json', STATE: 'inst-state.json',
  cfg() { const x = CRMLocal.ext(); const c = (x.inst ||= { on: false, days: 30, parts: 4, hour: 9, agents: true, sunday: false, clients: {}, contracts: [] }); c.clients ||= {}; c.contracts ||= []; c.orders ||= {}; return c; },
  cloud() { const c = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null; return c && c.token ? c : null; },
  // the account of the same shop: «doston gulnoz spes» ↔ «doston gulnoz»
  base: n => LX.norm(String(n || '').replace(/\b(spe?t?s|спец)\b/gi, '')),
  spec: n => /\b(spe?t?s|спец)\b/i.test(String(n || '')),
  clientNames() {
    const S = CRMLocal.engine.getState(), set = new Set(Object.keys(S.ag.clients || {}));
    for (const d of LX.d('debtors')) if (d['client.name']) set.add(d['client.name']);
    return [...set].sort((a, b) => a.localeCompare(b));
  },
  agentOfClient: n => CRMLocal.engine.getState().ag.clients?.[n]?.agent || '',

  rules() {
    const c = INST.cfg(), S = CRMLocal.engine.getState(), tg = CRMLocal.ext().tg || {};
    const agentOf = {}; for (const [n, v] of Object.entries(S.ag.clients || {})) if (v.agent) agentOf[n] = v.agent;
    // LINKO user names (as in the orders) → the agent names of the CRM, for clients the balance file does not know yet
    const alias = {}; for (const o of LX.d('orders')) { const u = LX.person(o, 'user'); if (u && !alias[u]) { const a = LX.agentName(u); if (a && a !== u) alias[u] = a; } }
    const chats = {}; for (const [a, ch] of Object.entries(tg.chats || {})) if (ch?.id) chats[a] = String(ch.id);
    return { v: 1, on: !!c.on, days: Number(c.days) || 30, parts: Number(c.parts) || 4, hour: Number(c.hour ?? 9), agents: c.agents !== false, sunday: !!c.sunday, meXlsx: c.meXlsx !== false,
      me: tg.me?.id ? String(tg.me.id) : '', chats, agentOf, alias, clients: c.clients, contracts: c.contracts, orders: c.orders, crm: location.origin + location.pathname };
  },
  // inst-rules.json next to the synced data (same repository and key as «Синхронизация»)
  async publish() {
    const cc = INST.cloud(); if (!cc) return { off: true };
    const url = `https://api.github.com/repos/${encodeURIComponent(cc.owner)}/${encodeURIComponent(cc.repo)}/contents/${INST.RULES}`, h = { Authorization: 'Bearer ' + cc.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const text = JSON.stringify({ ...INST.rules(), at: new Date().toISOString() });
    const cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' });
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const r = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'CRM: правила рассрочки и договоры', content: btoa(bin), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub не принял правила рассрочки: ' + r.status);
    INST.cfg().publishedAt = new Date().toISOString(); CRMLocal.autoTouch();
    return { ok: true };
  },
  changed(msg = 'Правила рассрочки отправлены автозагрузке') { CRMLocal.touch(); clearTimeout(INST._t); INST._t = setTimeout(() => INST.publish().then(r => { if (!r.off) toast(msg); }).catch(e => toast(e.message)), 1200); },
  async state() { try { return await CLOUD.readJson(INST.STATE); } catch { return null; } },

  // ---------- a client's contracts in the client card (card.js «📄 Договор») ----------
  // the client is one of the contract's LINKO cards, or the other card of the same shop (contract ↔ spets)
  contractsOf(name) { const b = INST.base(name); return INST.cfg().contracts.filter(k => (k.accounts || []).some(a => a === name || INST.base(a) === b)); },
  // scans of the signed contract (photo / PDF) live in the private data repository: contracts/<id>/<file>;
  // the contract keeps files: [{ path, name, type, size, at }]
  gh(path) {
    const cc = INST.cloud(); if (!cc) throw new Error('Включите «Синхронизацию», чтобы хранить сканы договоров');
    return { url: `https://api.github.com/repos/${encodeURIComponent(cc.owner)}/${encodeURIComponent(cc.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, h: { Authorization: 'Bearer ' + cc.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  },
  async putFile(k, file) {
    if (file.size > 25e6) throw new Error(`«${file.name}» больше 25 МБ — уменьшите файл`);
    const b64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(new Error('Не удалось прочитать файл')); r.readAsDataURL(file); });
    const safe = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'file', path = `contracts/${k.id}/${Date.now().toString(36)}-${safe}`, { url, h } = INST.gh(path);
    const r = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'CRM: скан договора ' + (k.title || k.id), content: b64 }) });
    if (!r.ok) throw new Error('GitHub не принял файл: ' + r.status);
    (k.files ||= []).push({ path, name: file.name, type: file.type || '', size: file.size, at: new Date().toISOString() }); CRMLocal.touch();
  },
  async openFile(f) {
    const w = window.open('', '_blank'); // opened right on the click, otherwise the browser blocks the window
    if (w) w.document.write('<p style="font:16px system-ui;padding:20px">Загружаю договор…</p>');
    try {
      const { url, h } = INST.gh(f.path), r = await fetch(url, { headers: { ...h, Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
      if (!r.ok) throw new Error('Файл не найден в хранилище: ' + r.status);
      const blob = new Blob([await r.blob()], { type: f.type || 'application/octet-stream' }), u = URL.createObjectURL(blob);
      if (w) w.location.href = u; else { const a = document.createElement('a'); a.href = u; a.download = f.name; a.click(); }
      setTimeout(() => URL.revokeObjectURL(u), 120000);
    } catch (e) { if (w) w.close(); toast(e.message); }
  },
  async delFile(k, f) {
    const { url, h } = INST.gh(f.path), cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' });
    if (cur.ok) { const r = await fetch(url, { method: 'DELETE', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'CRM: удалён скан договора', sha: (await cur.json()).sha }) }); if (!r.ok) throw new Error('GitHub не удалил файл: ' + r.status); }
    k.files = (k.files || []).filter(x => x.path !== f.path); CRMLocal.touch();
  },
  async cardDialog(name) {
    const list = INST.contractsOf(name), f = INST.money, t0 = UI.localDate(Date.now());
    const m = modal(`<div class="card-head"><div><h3 style="margin:0">Договоры: ${esc(name)}</h3><div class="mut">${list.length} ${UI.plural(list.length, 'договор', 'договора', 'договоров')}</div></div><button class="btn gray sm" id="kX" aria-label="Закрыть">✕</button></div><div id="kB"><p class="mut">Загружаю…</p></div>`);
    m.el.classList.add('wide'); $('#kX', m.el).onclick = m.close;
    const st = INST.cfg().on && INST.cloud() ? await INST.state() : null, got = new Map((st?.contracts || []).map(k => [k.id, k])), canFiles = !!INST.cloud();
    const draw = () => {
      $('#kB', m.el).innerHTML = list.map(k => {
        const s = got.get(k.id), P = INST.planOf(k), total = P.reduce((a, v) => a + v, 0), files = k.files || [];
        const end = s?.end || UI.localDate(new Date(Number(k.start.slice(0, 4)), Number(k.start.slice(5, 7)) - 1 + P.length, Number(k.start.slice(8, 10)) - 1).getTime());
        const state = t0 < k.start ? UI.pill('info', 'ещё не начался') : t0 > end ? UI.pill('muted', 'закончился') : UI.pill('good', 'действует');
        const pct = (v, of, ok) => `${f(v)} ${UI.pill(ok ? 'good' : 'warn', Math.round(v / Math.max(1, of) * 100) + '%')}`;
        return `<section style="border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0">
          <div class="bar" style="margin:0 0 8px"><b style="font-size:16px">${esc(k.title || k.accounts.join(' + '))}</b> ${state}<span class="spacer"></span><button class="btn gray sm" data-kpr="${esc(k.id)}" type="button">🖨 Договор</button><button class="btn gray sm" data-kedit="${esc(k.id)}" type="button">Изменить условия</button></div>
          <div class="kpis kpis-sm">
            ${UI.tile('Срок', `${UI.dm(k.start)} — ${UI.dm(end)}`, { sub: `${P.length} мес. · с ${UI.dateRu(k.start)}` })}
            ${UI.tile('План в месяц', P.every(v => v === P[0]) ? f(P[0]) : `${f(Math.min(...P))}–${f(Math.max(...P))}`, { sub: `всего по договору ${f(total)}` })}
            ${s && s.bought != null ? UI.tile('С начала договора', f(s.paid), { sub: `взял ${f(s.bought)} · оплатил ${f(s.paid)}`, tone: s.paid >= (s.list || []).reduce((a, x) => a + x.plan, 0) - 0.5 ? 'good' : 'warn' }) : ''}
            ${UI.tile('Агент', esc(k.agent || '—'), { sub: 'карточки: ' + k.accounts.map(esc).join(', ') })}
          </div>
          <div class="scroll"><table><thead><tr><th>Месяц</th><th class="n">План</th><th class="n">Взял</th><th class="n">Оплатил</th></tr></thead><tbody>${P.map((v, i) => { const x = s?.list?.[i]; return `<tr><td>${INST.monthName(k.start, i)}</td><td class="n">${f(v)}</td><td class="n">${x?.fact != null ? pct(x.fact, v, x.fact >= v) : '<span class="mut">—</span>'}</td><td class="n">${x?.paid != null ? pct(x.paid, v, x.paid >= v - 0.5) : '<span class="mut">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>
          ${!st ? '<p class="mut" style="margin:6px 0 0;font-size:12px">«Взял» и «Оплатил» считает автозагрузка — включите её в «Рассрочка и договоры → Настройки».</p>' : ''}
          <div style="margin-top:12px"><b>📎 Документ договора</b>
            ${files.length ? `<div style="display:grid;gap:6px;margin-top:8px">${files.map(x => `<div class="bar" style="margin:0"><button class="btn sm" data-kopen="${esc(k.id)}|${esc(x.path)}" type="button">${/pdf/i.test(x.type) || /\.pdf$/i.test(x.name) ? '📄' : '🖼'} Открыть: ${esc(x.name)}</button><span class="mut" style="font-size:12px">${UI.dateRu(x.at.slice(0, 10))} · ${Math.max(1, Math.round(x.size / 1024))} КБ</span><span class="spacer"></span><button class="btn gray sm" data-kdel="${esc(k.id)}|${esc(x.path)}" type="button" aria-label="Удалить файл">🗑</button></div>`).join('')}</div>` : '<p class="mut" style="margin:6px 0">Скан договора ещё не прикреплён.</p>'}
            ${canFiles ? `<label class="btn gray sm" style="margin-top:8px;cursor:pointer">＋ Прикрепить скан или PDF<input type="file" data-kadd="${esc(k.id)}" accept="image/*,application/pdf" multiple hidden></label>` : '<p class="mut" style="font-size:12px">Чтобы прикреплять сканы, включите <a href="#/cloud">Синхронизацию</a>.</p>'}
          </div></section>`;
      }).join('');
      const byId = id => list.find(k => k.id === id), fileOf = v => { const [id, path] = v.split('|'), k = byId(id); return [k, (k?.files || []).find(x => x.path === path)]; };
      m.el.querySelectorAll('[data-kpr]').forEach(b => b.onclick = () => INST.ctPreview(byId(b.dataset.kpr)));
      m.el.querySelectorAll('[data-kedit]').forEach(b => b.onclick = () => { m.close(); INST.contractDialog(byId(b.dataset.kedit)); });
      m.el.querySelectorAll('[data-kopen]').forEach(b => b.onclick = () => { const [, x] = fileOf(b.dataset.kopen); if (x) INST.openFile(x); });
      m.el.querySelectorAll('[data-kdel]').forEach(b => b.onclick = async () => { const [k, x] = fileOf(b.dataset.kdel); if (!x || !confirm(`Удалить файл «${x.name}»?`)) return; b.disabled = true; try { await INST.delFile(k, x); toast('Файл удалён'); } catch (e) { toast(e.message); } draw(); });
      m.el.querySelectorAll('[data-kadd]').forEach(inp => inp.onchange = async () => { const k = byId(inp.dataset.kadd), fs = [...inp.files]; if (!fs.length) return; toast('Загружаю…'); let ok = 0; for (const file of fs) { try { await INST.putFile(k, file); ok++; } catch (e) { toast(e.message); } } if (ok) toast(`Прикреплено файлов: ${ok}`); draw(); });
    };
    draw();
  },

  // ---------- views ----------
  money: v => '$' + UI.fmt0(Math.round(v || 0)),
  typeTag: c => (c.type === 'contract' ? ' <span class="pill info">договор</span>' : c.type === 'spec' ? ' <span class="pill warn">спец</span>' : ''),
  partTag(p) {
    const k = { paid: ['good', ' ✓'], late: ['crit', ' · просрочена'], today: ['warn', ' · сегодня'], wait: ['', ''] }[p.st] || ['', ''];
    return `<span class="pill ${k[0]}">${UI.dm(p.d)} · ${INST.money(p.s)}${k[1]}</span>`;
  },
  rowHtml(c) {
    const own = INST.cfg().clients[c.name] || {}, open = INST.open.has(c.name);
    const det = `<tr${open ? '' : ' hidden'}><td colspan="7">
      ${c.orders.map(o => `<div style="margin:4px 0"><b>№${esc(o.id)}</b> от ${UI.dm(o.d)} на ${INST.money(o.s)} · оплачено ${INST.money(o.paid)} · осталось <b>${INST.money(o.left)}</b><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${o.parts.map(INST.partTag).join('')}</div></div>`).join('')}
      ${c.old > 0.5 ? `<div class="neg" style="margin:4px 0">Старый долг (заказы старше 180 дней): ${INST.money(c.old)} — весь считается просроченным</div>` : ''}
      <div class="mut" style="margin-top:6px">График: ${c.days} дн., ${c.parts} ч.${own.days || own.parts ? ' (свой для клиента)' : ''}${c.phone ? ' · ☎ ' + esc(c.phone) : ''}
        <button class="btn gray sm" data-own="${esc(c.name)}" type="button" style="margin-left:8px">Свой срок / не напоминать</button></div></td></tr>`;
    return `<tr data-row="${esc(c.name)}" style="cursor:pointer"><td>${open ? '▾' : '▸'} ${esc(c.name)}${INST.typeTag(c)}</td><td>${esc(c.agent)}</td><td class="num">${INST.money(c.debt)}</td>
      <td class="num ${c.late > 0.5 ? 'neg' : ''}">${c.late > 0.5 ? INST.money(c.late) : '—'}</td><td class="num">${c.today > 0.5 ? `<b>${INST.money(c.today)}</b>` : '—'}</td>
      <td>${c.next ? UI.dm(c.next.d) + ' · ' + INST.money(c.next.s) : '—'}</td><td class="num">${c.orders.length}</td></tr>` + det;
  },
  ownDialog(name) {
    const c = INST.cfg(), o = c.clients[name] || {};
    const m = modal(`<h3 style="margin:0 0 6px">${esc(name)}</h3><p class="mut" style="margin:0 0 10px">Свой график для этого клиента. Пусто — как у всех (${c.days} дн., ${c.parts} ч.).</p>
      <div class="form"><label>Срок, дней<input id="ioD" type="number" min="1" max="365" value="${o.days || ''}" placeholder="${c.days}"></label><label>Частей<input id="ioP" type="number" min="1" max="12" value="${o.parts || ''}" placeholder="${c.parts}"></label>
      <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><input type="checkbox" id="ioX" ${o.ex ? 'checked' : ''}> Не напоминать об этом клиенте</label></div>
      <div class="bar"><span class="spacer"></span><button class="btn gray" id="ioC">Отмена</button><button class="btn" id="ioS">Сохранить</button></div>`);
    $('#ioC', m.el).onclick = m.close;
    $('#ioS', m.el).onclick = () => {
      const v = { days: Number($('#ioD', m.el).value) || undefined, parts: Number($('#ioP', m.el).value) || undefined, ex: $('#ioX', m.el).checked || undefined };
      if (v.days || v.parts || v.ex) c.clients[name] = JSON.parse(JSON.stringify(v)); else delete c.clients[name];
      m.close(); INST.changed('Сохранено — автозагрузка пересчитает график за 5 минут'); route();
    };
  },
  contractDialog(ct) {
    const c = INST.cfg(), isNew = !ct, x = ct ? { ...ct } : { id: 'c' + Date.now().toString(36), title: '', accounts: [], monthly: 1000, months: 6, start: UI.localDate(Date.now()), agent: '' };
    const names = INST.clientNames(), D = INST.docOf(x);
    const m = modal(`<h3 style="margin:0 0 6px">${isNew ? 'Новый договор' : 'Договор'}</h3>
      <p class="mut" style="margin:0 0 10px">Клиент обязуется закупать товар на определённую сумму каждый месяц в течение срока договора — сумма может быть разной по месяцам. Укажите все его карточки в LINKO — договорную и «spets», если он работает по обеим: закупки сложатся.</p>
      <datalist id="icNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="form">
        <label style="grid-column:1/-1">Название<input id="icT" value="${esc(x.title)}" placeholder="например: Abdulaziz mustang — договор №12"></label>
        <label style="grid-column:1/-1">Карточки клиента в LINKO <span class="mut">(выберите из списка или Enter)</span>
          <div id="icAcc" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0"></div><input id="icA" list="icNames" placeholder="начните вводить название клиента"></label>
        <label>Срок, месяцев<input id="icN" type="number" min="1" max="60" list="icTerms" value="${x.months}"><datalist id="icTerms">${[3, 6, 12, 13, 18, 20, 24].map(n => `<option value="${n}">`).join('')}</datalist></label>
        <label>Начало<input id="icS" type="date" value="${esc(x.start)}"></label>
        <label>Обычная сумма в месяц, $<input id="icM" type="number" min="0" step="50" value="${x.monthly}"></label>
        <div style="display:flex;align-items:end;gap:6px;flex-wrap:wrap"><button class="btn gray sm" id="icAll" type="button">Всем месяцам эту сумму</button><button class="btn gray sm" id="icStep" type="button">↗ Нарастающая…</button></div>
        <div style="grid-column:1/-1"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b>План по месяцам, $</b><span id="icSum" class="mut"></span></div>
          <div id="icPlan" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;margin-top:6px;max-height:240px;overflow-y:auto;overflow-x:hidden"></div></div>
        <label><b>Итого по договору, $</b><input id="icTot" type="number" min="0" step="100" style="font-weight:700"></label>
        <div class="mut" style="display:flex;align-items:end;font-size:13px">Сумма всех месяцев. Введите свою — она разложится поровну по месяцам.</div>
        <label>Агент<input id="icG" value="${esc(x.agent)}" placeholder="кому напоминать"></label>
        <label>Рассрочка по договору, дней<input id="icD" type="number" min="1" value="${x.days || ''}" placeholder="${c.days} (как у всех)"></label>
        <label>Частей<input id="icP" type="number" min="1" max="12" value="${x.parts || ''}" placeholder="${c.parts}"></label>
      </div>
      <details ${isNew || !x.doc ? 'open' : ''} style="margin:10px 0 0;border:1px solid var(--line);border-radius:12px;padding:8px 12px"><summary><b>📄 Шартнома — бумажный договор</b> <span class="mut">(что будет напечатано)</span></summary>
      <div class="form" style="margin-top:8px">
        <label>Шартнома №<input id="idNo" value="${esc(D.no)}"></label>
        <label>Дата договора<input id="idDt" type="date" value="${esc(D.date)}"></label>
        <label>Мижоз (магазин)<input id="idShop" value="${esc(D.shop)}" placeholder="как в шапке договора"></label>
        <label>Ф.И.Ш. (полное имя)<input id="idFio" value="${esc(D.fio)}" placeholder="фамилия, имя"></label>
        <label>Шахар / туман<input id="idCity" value="${esc(D.city)}" placeholder="в углу листа"></label>
        <label>Скидка от прайса, %<input id="idDisc" type="number" min="0" max="100" step="0.5" value="${esc(D.disc)}"></label>
        <label>Махсулот — по строке<textarea id="idGoods" rows="4" style="width:100%;box-sizing:border-box;font-family:inherit">${esc(D.goods)}</textarea></label>
        <label>Изох<textarea id="idNote" rows="4" style="width:100%;box-sizing:border-box;font-family:inherit" placeholder="пусто — строка останется для руки">${esc(D.note)}</textarea></label>
        <label style="grid-column:1/-1">Мукофот (что даём после полной оплаты)<input id="idRew" value="${esc(D.reward)}" placeholder="например: 3750$ берилганда 1500$ беради"></label>
        <label>Гувох 1<input id="idW1" value="${esc(D.w1)}"></label>
        <label>Гувох 2<input id="idW2" value="${esc(D.w2)}"></label>
      </div><p class="mut" style="font-size:12px;margin:4px 0 0">График в договоре — из «План по месяцам»: дата сдачи каждого месяца = начало + 1, 2, 3… мес. Колонки «Сумма» и «Мижоз имзо» остаются пустыми — для руки.</p></details>
      <div class="bar">${isNew ? '' : '<button class="btn gray" id="icDel">Удалить</button>'}<span class="spacer"></span><button class="btn gray" id="icC">Отмена</button><button class="btn gray" id="icOk">Сохранить</button><button class="btn" id="icOkPr">Сохранить и 🖨 договор</button></div>`);
    const acc = [...x.accounts];
    const draw = () => {
      $('#icAcc', m.el).innerHTML = acc.map((a, i) => `<span class="pill ${INST.spec(a) ? 'warn' : 'info'}">${esc(a)} <a href="#" data-rm="${i}" title="убрать">✕</a></span>`).join('') || '<span class="mut">пока нет</span>';
      m.el.querySelectorAll('[data-rm]').forEach(b => b.onclick = e => { e.preventDefault(); acc.splice(+b.dataset.rm, 1); draw(); });
    };
    const add = v => {
      v = String(v || '').trim(); if (!v || acc.some(a => LX.norm(a) === LX.norm(v))) return;
      acc.push(v);
      // the other card of the same shop (contract ↔ spets) is offered at once
      const twin = names.find(n => n !== v && INST.base(n) === INST.base(v) && !acc.includes(n));
      if (twin && confirm(`У этого клиента есть ещё карточка «${twin}». Добавить её в договор?`)) acc.push(twin);
      if (!$('#icG', m.el).value) $('#icG', m.el).value = INST.agentOfClient(v);
      if (!$('#icT', m.el).value) $('#icT', m.el).value = v.replace(/\s*\b(spe?t?s|спец)\b\s*/gi, ' ').trim() + ' — договор';
      if (!$('#idShop', m.el).value) $('#idShop', m.el).value = v.replace(/\s*\b(spe?t?s|спец)\b\s*/gi, ' ').trim();
      if (!$('#idCity', m.el).value && window.INVO) $('#idCity', m.el).value = INVO.cityOf({ agent: $('#icG', m.el).value });
      draw();
    };
    // the plan of every month: starts from the usual sum, any month can be changed by hand (kept when the term or start changes)
    const plan = INST.planOf(x).slice(), hand = new Set(x.plan ? plan.map((v, i) => i) : []);
    const drawPlan = () => {
      const n = Math.max(1, Math.min(60, Number($('#icN', m.el).value) || 1)), def = Number($('#icM', m.el).value) || 0, start = $('#icS', m.el).value || UI.localDate(Date.now());
      for (let i = 0; i < n; i++) if (!hand.has(i) || plan[i] == null) plan[i] = def;
      plan.length = n;
      $('#icPlan', m.el).innerHTML = plan.map((v, i) => `<label style="font-size:12px;margin:0">${i + 1}. ${esc(INST.monthName(start, i))}<input data-pm="${i}" type="number" min="0" step="50" value="${v}" style="width:100%;min-width:0;box-sizing:border-box;${hand.has(i) && v !== def ? 'border-color:var(--c4,#e9a23b)' : ''}"></label>`).join('');
      sums();
      m.el.querySelectorAll('[data-pm]').forEach(e => e.oninput = () => { const i = +e.dataset.pm; plan[i] = Number(e.value) || 0; hand.add(i); sums(); });
    };
    const sums = () => {
      const t = plan.reduce((a, v) => a + v, 0);
      $('#icSum', m.el).textContent = `Всего по договору: ${INST.money(t)} за ${plan.length} мес.`;
      if (document.activeElement !== $('#icTot', m.el)) $('#icTot', m.el).value = Math.round(t * 100) / 100;
    };
    // a total typed by hand: split evenly over the months in whole dollars, the rounding rest goes to the last month
    $('#icTot', m.el).onchange = () => {
      const t = Math.max(0, Number($('#icTot', m.el).value) || 0), n = plan.length, each = Math.floor(t / n);
      plan.forEach((v, i) => { plan[i] = i === n - 1 ? Math.round((t - each * (n - 1)) * 100) / 100 : each; hand.add(i); });
      $('#icM', m.el).value = each; drawPlan();
    };
    $('#icN', m.el).oninput = drawPlan; $('#icS', m.el).oninput = drawPlan; $('#icM', m.el).oninput = drawPlan;
    $('#icAll', m.el).onclick = () => { hand.clear(); drawPlan(); };
    // 2 months by 1000, 2 by 1250, 2 by 1500…: how many months per step and how much more each step
    $('#icStep', m.el).onclick = () => {
      const every = Number(prompt('Сколько месяцев на каждой ступени?', '2')); if (!(every > 0)) return;
      const plus = Number(prompt('На сколько $ больше каждая следующая ступень?', '250')); if (!(plus >= 0)) return;
      const def = Number($('#icM', m.el).value) || 0;
      plan.forEach((v, i) => { plan[i] = def + Math.floor(i / every) * plus; hand.add(i); });
      drawPlan();
    };
    drawPlan();
    const inp = $('#icA', m.el);
    inp.onchange = () => { if (names.includes(inp.value)) { add(inp.value); inp.value = ''; } };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(inp.value); inp.value = ''; } };
    draw();
    $('#icC', m.el).onclick = m.close;
    if (!isNew) $('#icDel', m.el).onclick = () => { if (!confirm('Удалить договор «' + (x.title || '') + '»?')) return; c.contracts = c.contracts.filter(k => k.id !== x.id); m.close(); INST.changed('Договор удалён'); route(); };
    const save = andPrint => {
      if (inp.value.trim()) add(inp.value);
      const d = Number($('#icD', m.el).value), p = Number($('#icP', m.el).value), v = id => $(id, m.el).value.trim();
      const doc = { no: v('#idNo'), date: v('#idDt'), shop: v('#idShop'), fio: v('#idFio'), city: v('#idCity'), disc: v('#idDisc'), goods: v('#idGoods'), note: v('#idNote'), reward: v('#idRew'), w1: v('#idW1'), w2: v('#idW2') };
      const y = { id: x.id, title: $('#icT', m.el).value.trim(), accounts: acc, monthly: Number($('#icM', m.el).value) || 0, months: plan.length, plan: plan.slice(), start: $('#icS', m.el).value, agent: $('#icG', m.el).value.trim(), ...(d ? { days: d } : {}), ...(p ? { parts: p } : {}), ...(x.files?.length ? { files: x.files } : {}), doc };
      if (!y.accounts.length || !y.plan.some(v => v > 0) || !y.start) { toast('Заполните карточки клиента, план по месяцам и дату начала'); return; }
      const i = c.contracts.findIndex(k => k.id === y.id); if (i >= 0) c.contracts[i] = y; else c.contracts.push(y);
      m.close(); INST.changed('Договор сохранён — автозагрузка посчитает закупки за 5 минут'); route();
      if (andPrint) INST.ctPreview(y);
    };
    $('#icOk', m.el).onclick = () => save(false);
    $('#icOkPr', m.el).onclick = () => save(true);
  },
  // the plan of each month of a contract; contracts saved before the per-month plan have one sum for every month
  planOf: k => Array.from({ length: Math.max(1, Number(k.months) || 1) }, (_, i) => (Array.isArray(k.plan) && k.plan[i] != null ? Number(k.plan[i]) : Number(k.monthly) || 0)),
  monthName(start, i) { const d = new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + i, 1); return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }).replace(' г.', ''); },
  // ---------- the paper contract (шартнома), exactly like the printed MITAL form: one A4 sheet ----------
  ctKey: k => [k.title, k.agent, k.doc?.no, k.doc?.fio, k.doc?.shop, ...(k.accounts || [])].join(' ').toLowerCase(),
  // what goes on the paper; a new contract takes the goods, discount and witnesses of the last one and the next number
  docOf(x) {
    const c = INST.cfg(), d = x.doc || {}, last = [...c.contracts].reverse().find(k => k.doc && k.id !== x.id)?.doc || {};
    const nums = c.contracts.map(k => parseInt(k.doc?.no, 10)).filter(n => n > 0);
    const shop = String(x.accounts?.[0] || '').replace(/\s*\b(spe?t?s|спец)\b\s*/gi, ' ').trim();
    let city = ''; try { if (window.INVO && x.agent) city = INVO.cityOf({ agent: x.agent }); } catch { /* no regions yet */ }
    return { no: d.no ?? (nums.length ? String(Math.max(...nums) + 1) : ''), date: d.date ?? UI.localDate(Date.now()), shop: d.shop ?? shop, fio: d.fio ?? '', city: d.city ?? city,
      disc: d.disc ?? last.disc ?? '10', goods: d.goods ?? last.goods ?? 'ECO FILTER\nMATTEX\nMITANOL\nDELPIN', note: d.note ?? '', reward: d.reward ?? '', w1: d.w1 ?? last.w1 ?? '', w2: d.w2 ?? last.w2 ?? '' };
  },
  A4: 1047, // px: 277 mm — the sheet without its 10 mm margins
  ctCss: () => `.kdoc{box-sizing:border-box;width:190mm;background:#fff!important;color:#111!important;font:13px/1.5 Arial,Helvetica,sans-serif;position:relative;overflow:hidden;text-align:left;border-radius:0;box-shadow:none}
.kdoc *{box-sizing:border-box;color:#111;background:transparent;text-shadow:none}
.kdoc .k-fit{padding:5mm 7mm 4mm}
.kdoc .k-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:8px}
.kdoc .k-city{font-size:14px;padding-top:4px}
.kdoc .k-logo{font:700 50px/1 Georgia,'Times New Roman',serif;letter-spacing:5px;text-align:center;color:#2b2b2b}
.kdoc .k-no{text-align:right;font-size:15px;padding-top:4px}
.kdoc .k-ink,.kdoc .k-u,.kdoc .k-city,.kdoc .k-no{color:#1d3c8f!important}
.kdoc .k-t{text-align:center;font-size:15px;letter-spacing:.6px;margin:8px 0 6px}
.kdoc .k-u{display:inline-block;min-width:24mm;border-bottom:1px solid #111;padding:0 4px;text-align:center;font-weight:600;line-height:1.35;vertical-align:baseline}
.kdoc .k-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:2px 0 6px}
.kdoc .k-p{text-indent:14mm;margin:4px 0 6px;text-align:justify}
.kdoc .k-ln{margin:4px 0 4px 14mm}
.kdoc .k-p2{margin:10px 0 6px;line-height:1.9}
.kdoc .k-sg{margin:10px 0 4px;line-height:1.9}
.kdoc .k-sg small{font-size:12px;margin:0 8px 0 2px}
.kdoc table{width:100%;border-collapse:collapse;border:0;border-radius:0;box-shadow:none;overflow:visible;background:#fff;margin:8px 0 0}
.kdoc table tr>th,.kdoc table tr>td{border:1px solid #444;padding:2px 8px;vertical-align:top;text-align:left;font-weight:normal;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#111;white-space:normal;position:static;background:#fff;height:auto}
.kdoc table tr>th{font-size:12.5px;font-weight:600;background:#fff}
.kdoc .k-gd tr>th{border:0;padding:2px 8px 1px}
.kdoc .k-gd tr>td{height:22mm}
.kdoc .k-gd tr>*:nth-child(1){width:26%}
.kdoc .k-gd tr>*:nth-child(2){width:24%}
.kdoc .k-gd .k-big{font-size:20px;vertical-align:middle;text-align:center}
.kdoc .k-pl{margin-top:14px}
.kdoc .k-pl tr>td{height:7mm;vertical-align:middle}
.kdoc .k-pl tr>*:nth-child(1){width:10%}
.kdoc .k-pl tr>*:nth-child(2){width:12%}
.kdoc .k-pl tr>*:nth-child(3){width:21%}
.kdoc .k-pl tr>*:nth-child(4){width:25%}
.kdoc .k-pl tr.k-tot>td{font-weight:700}`,
  ctDoc(k) {
    const D = INST.docOf(k), P = INST.planOf(k), tot = P.reduce((a, v) => a + v, 0), parts = Number(k.parts || INST.cfg().parts) || 4;
    const dt = s => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(2, 4)}` : ''), due = i => INVO.addMonths(k.start, i + 1), n = v => String(Math.round(v * 100) / 100);
    const u = (v, w) => `<span class="k-u" style="min-width:${w}">${esc(v || '') || '&nbsp;'}</span>`;
    const goods = String(D.goods || '').split('\n').map(s => s.trim()).filter(Boolean), disc = String(D.disc || '').trim().replace(/^-/, '').replace('.', ',');
    const empty = Math.max(2, 16 - P.length), blank = '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
    return `<section class="kdoc no-xg"><div class="k-fit">
      <div class="k-top"><div class="k-city">${esc(D.city)}</div><div class="k-logo">MITAL</div><div class="k-no">${D.no ? '№' + esc(D.no) : ''}</div></div>
      <div class="k-t">ШАРТНОМА №${u(D.no, '16mm')}</div>
      <div class="k-row"><div>${u(dt(D.date), '30mm')} й.</div><div>Мижоз ${u(D.shop, '64mm')}</div></div>
      <p class="k-p">Ушбу шартнома ООО “MITAL” ва мижоз орасидаги келишув асосида мижоз томонидан олинган махсулотни прайс нархидан арзон сотмасликка, хамда олинган махсулотни куйида белгиланганидака йопиб беришни, яни олган махсулотларни ${parts} га булиб хар хафтада карзни тулик копланишини тасдиклайди:</p>
      <div class="k-ln">(Ф.И.Ш.) ${u(D.fio, '105mm')}</div>
      <div class="k-ln">Шартнома муддати ${u(dt(k.start), '26mm')} дан ${u(dt(due(P.length - 1)), '26mm')} гача.</div>
      <table class="noxg k-gd"><thead><tr><th>Махсулот</th><th>Амалдаги прайсдан чегирма %</th><th>Изох</th></tr></thead>
        <tbody><tr><td class="k-ink">${goods.map(esc).join('<br>')}</td><td class="k-ink k-big">${disc ? '-' + esc(disc) + '%' : ''}</td><td class="k-ink">${esc(D.note).replace(/\n/g, '<br>')}</td></tr></tbody></table>
      <table class="noxg k-pl"><thead><tr><th>Ой</th><th>План</th><th>Топширилган сана</th><th>Сумма</th><th>Мижоз имзо</th></tr></thead><tbody>
        ${P.map((v, i) => `<tr><td class="k-ink">${i + 1}</td><td class="k-ink">${n(v)}</td><td class="k-ink">${dt(due(i))}</td><td></td><td></td></tr>`).join('')}
        <tr class="k-tot"><td>Жами:</td><td class="k-ink">${n(tot)}$</td><td></td><td></td><td></td></tr>${blank.repeat(empty)}</tbody></table>
      <p class="k-p2">Ушбу шартнома асосида мажбуриятлар тулик копланиб, карздорлик колмаганидан сунг, ООО “MITAL” томонидан мукофот сифатида ${u(D.reward, '80mm')} берилади.</p>
      <div class="k-sg">Гувохлар ${u(D.w1, '52mm')}<small>(ИМЗО)</small> ${u(D.w2, '52mm')}<small>(ИМЗО)</small></div>
      <p class="k-p2">Келишув шартлари тулик бажарилмаса, ушбу шартнома уз кучини йокотишига розиман.</p>
      <div class="k-sg">${u('', '75mm')} &nbsp; ${u('', '30mm')}<small>(ИМЗО)</small></div>
    </div></section>`;
  },
  // a long contract (many months) is shrunk to fit one sheet, like the special offer fits its half
  ctFit(doc) {
    const fit = doc.querySelector('.k-fit'); if (!fit) return;
    fit.style.cssText = ''; doc.style.height = '';
    if (fit.offsetHeight <= INST.A4) return;
    const tall = s => { fit.style.cssText = `width:${100 / s}%;transform:scale(${s});transform-origin:0 0`; return fit.offsetHeight * s > INST.A4; };
    let lo = 0.3, hi = 1; for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (tall(m)) hi = m; else lo = m; }
    tall(lo); doc.style.height = Math.min(INST.A4, Math.ceil(fit.offsetHeight * lo)) + 'px';
  },
  ctPrint(html, copies) {
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(fr);
    const d = fr.contentDocument; d.open();
    d.write(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Шартнома</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .sheet{width:210mm;height:296mm;padding:10mm;overflow:hidden;page-break-after:always;break-after:page}.sheet:last-child{page-break-after:auto;break-after:auto}${INST.ctCss()}</style></head><body>${Array.from({ length: copies }, () => `<div class="sheet">${html}</div>`).join('')}</body></html>`);
    d.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { toast('Не удалось открыть печать — скачайте картинкой'); } }, 350);
    setTimeout(() => fr.remove(), 120000);
  },
  ctFile(k) { const D = INST.docOf(k); return ('Шартнома-' + (D.no || k.id) + '-' + String(D.shop || k.title || '').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30) + '.png').replace(/_\.png$/, '.png'); },
  // the preview with the same buttons as the special offer: print, picture, send, copy
  async ctPreview(k) {
    if (!k) return;
    try { await INVO.loadRegions(); } catch { /* the city is only a hint */ }
    const D = INST.docOf(k), canShare = !!(navigator.canShare && navigator.share);
    const m = modal(`<h3 style="margin:0 0 8px">📄 Шартнома №${esc(D.no || '—')} · ${esc(D.shop || k.title || '')}</h3><style>${INST.ctCss()}</style>
      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="kpTwo"> 2 экземпляра (клиенту и нам)</label><span class="spacer"></span>
        <button class="btn" id="kpPr" type="button">🖨 Печать</button><button class="btn gray" id="kpPng" type="button">🖼 Скачать картинкой</button>${canShare ? '<button class="btn gray" id="kpSh" type="button">📤 Отправить (Telegram…)</button>' : ''}<button class="btn gray" id="kpCp" type="button">📋 Копировать картинку</button><button class="btn gray" id="kpEd" type="button">Изменить</button><button class="btn gray" id="kpX" type="button">Закрыть</button></div>
      <div style="max-height:70vh;overflow:auto"><div style="display:inline-block;max-width:100%;overflow:auto;border:1px solid var(--line-2,#ccc)">${INST.ctDoc(k)}</div></div>
      <p class="mut" style="font-size:12px;margin:6px 0 0">Договор на одном листе А4: распечатайте, подпишите и прикрепите скан в карточке клиента. Картинку можно сразу отправить в Telegram.</p>`);
    m.el.classList.add('wide');
    const doc = m.el.querySelector('.kdoc'); INST.ctFit(doc);
    const blob = async () => { try { return await INVO.png(doc, INST.ctCss()); } catch (e) { toast('Не получилось сделать картинку: ' + (e.message || e) + '. Нажмите «Печать» → «Сохранить как PDF»'); return null; } };
    $('#kpX', m.el).onclick = m.close;
    $('#kpEd', m.el).onclick = () => { m.close(); INST.contractDialog(INST.cfg().contracts.find(x => x.id === k.id) || k); };
    $('#kpPr', m.el).onclick = () => INST.ctPrint(doc.outerHTML, $('#kpTwo', m.el).checked ? 2 : 1);
    $('#kpPng', m.el).onclick = async () => { const bl = await blob(); if (!bl) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = INST.ctFile(k); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); toast('Картинка сохранена'); };
    const sh = $('#kpSh', m.el); if (sh) sh.onclick = async () => { const bl = await blob(); if (!bl) return; const file = new File([bl], INST.ctFile(k), { type: 'image/png' }); try { if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Шартнома №' + (D.no || '') }); else toast('Это устройство не умеет отправлять файлы — скачайте картинкой'); } catch (e) { if (e.name !== 'AbortError') toast('Не получилось отправить: ' + (e.message || e)); } };
    $('#kpCp', m.el).onclick = async () => { const bl = await blob(); if (!bl) return; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]); toast('Картинка скопирована — вставьте в Telegram (Ctrl+V)'); } catch { toast('Браузер не дал скопировать — нажмите «Скачать картинкой»'); } };
  },
  // the buttons of the contracts list (on «Договоры» and on «Рассрочка → Договоры»)
  ctWire(main) {
    const c = INST.cfg(), byId = id => c.contracts.find(k => k.id === id);
    const nb = $('#icNew', main); if (nb) nb.onclick = () => INST.contractDialog(null);
    main.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => INST.contractDialog(byId(b.dataset.ct)));
    main.querySelectorAll('[data-ctpr]').forEach(b => b.onclick = () => INST.ctPreview(byId(b.dataset.ctpr)));
    const q = $('#icQ', main), cnt = $('#icQn', main);
    if (q) q.oninput = () => { INST.q = q.value; const v = q.value.trim().toLowerCase(); let k = 0; main.querySelectorAll('[data-kq]').forEach(tr => { const on = !v || tr.dataset.kq.includes(v); tr.hidden = !on; if (on) k++; }); cnt.textContent = v ? 'найдено: ' + k : ''; };
  },
  // contracts as the CRM knows them, joined with what the auto-loader counted
  ctView(st, q = '') {
    const c = INST.cfg(), got = new Map((st?.contracts || []).map(k => [k.id, k])), t0 = UI.localDate(Date.now());
    if (!c.contracts.length) return UI.empty('Договоров пока нет', 'Добавьте договор: клиент, его карточки в LINKO, сколько он должен закупать в месяц и на сколько месяцев.', '<button class="btn" id="icNew" type="button">＋ Договор</button>');
    const bar = (v, of, label) => { const p = of > 0 ? Math.min(100, Math.round(v / of * 100)) : v > 0 ? 100 : 0; return `<div style="font-size:13px">${label}</div><div style="height:6px;background:var(--line,#ddd);border-radius:3px;margin:3px 0 6px"><div style="width:${p}%;height:6px;border-radius:3px;background:${p >= 100 ? 'var(--good,#22c55e)' : 'var(--c4,#e9a23b)'}"></div></div>`; };
    const lbl = x => UI.dm(x.from || x.m + '-01');
    const ql = q.trim().toLowerCase(), list = c.contracts;
    return `<div class="bar" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><button class="btn" id="icNew" type="button">＋ Договор</button><input id="icQ" type="search" placeholder="🔎 клиент, № договора, агент" value="${esc(q)}" style="min-width:240px"><span class="mut" id="icQn"></span></div><div class="scroll"><table><thead><tr><th>Договор</th><th>Агент</th><th class="num">План в месяц</th><th>Этот месяц</th><th>По месяцам</th><th class="num">С начала договора</th><th></th></tr></thead><tbody>
      ${list.map(k => {
        const s = got.get(k.id), cur = s?.cur, run = x => x.from ? x.from <= t0 && t0 <= x.to : x.m === t0.slice(0, 7);
        const state = !s ? '<span class="mut">считается…</span>' : !s.active ? (t0 < k.start ? '<span class="pill info">ещё не начался</span>' : '<span class="pill">закончился</span>') : s.daysLeft <= 30 ? `<span class="pill warn">осталось ${s.daysLeft} дн.</span>` : '';
        const kq = INST.ctKey(k);
        return `<tr data-kq="${esc(kq)}"${ql && !kq.includes(ql) ? ' hidden' : ''}><td style="min-width:170px"><b>${esc(k.title || k.accounts.join(' + '))}</b>${k.doc?.no ? ` <span class="mut">№${esc(k.doc.no)}</span>` : ''} ${state}${(() => { const t = String(k.title || '').trim().toLowerCase(), cards = k.accounts.filter(a => a.trim().toLowerCase() !== t); return cards.length ? `<div class="ct-sub">🗂 ${cards.map(a => esc(a) + (INST.spec(a) ? ' <span class="pill warn">спец</span>' : '')).join(', ')}</div>` : k.accounts.some(a => INST.spec(a)) ? ' <span class="pill warn">спец</span>' : ''; })()}<div class="ct-sub">📅 ${UI.dateRu(k.start)} → ${s ? UI.dateRu(s.end) : '…'} · ${k.months} мес.</div></td><td>${esc(k.agent || '—')}</td>
          <td class="num">${(() => { const P = INST.planOf(k), same = P.every(v => v === P[0]); return same ? INST.money(P[0]) : `${INST.money(Math.min(...P))}–${INST.money(Math.max(...P))}`; })()}<div class="ct-sub">всего ${INST.money(INST.planOf(k).reduce((a, v) => a + v, 0))}</div></td>
          <td style="min-width:150px">${cur && cur.fact != null ? `${cur.from ? `<div class="ct-sub" style="margin:0 0 2px">${UI.dm(cur.from)}–${UI.dm(cur.to)}</div>` : ''}${bar(cur.fact, cur.plan, `Взял ${INST.money(cur.fact)} из ${INST.money(cur.plan)}`)}${bar(cur.paid || 0, cur.plan, `Оплатил <b>${INST.money(cur.paid || 0)}</b> из ${INST.money(cur.plan)}`)}` : '—'}</td>
          <td>${(() => { const L = s?.list || []; if (!L.length) return '<span class="mut">—</span>'; const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'], mon = x => MON[Number((x.from || x.m + '-01').slice(5, 7)) - 1];
            const cell = (x, v, paid) => { if (v == null) return `<i class="ctm-c" title="${lbl(x)}: данные ещё загружаются">·</i>`; const p = Math.round(v / Math.max(1, x.plan) * 100), tone = (paid ? v >= x.plan - 0.5 : v >= x.plan) ? 'good' : run(x) ? 'warn' : t0 < (x.from || x.m + '-01') ? '' : 'crit'; return `<i class="ctm-c ${tone}${run(x) ? ' now' : ''}" title="${lbl(x)}${x.to ? '–' + UI.dm(x.to) : ''}: ${paid ? 'оплатил' : 'взял'} ${INST.money(v)} из ${INST.money(x.plan)} (${p}%)">${p}</i>`; };
            return `<div class="ctm" style="--n:${L.length}"><span></span>${L.map(x => `<b class="ctm-h${run(x) ? ' now' : ''}" title="${lbl(x)}${x.to ? '–' + UI.dm(x.to) : ''}">${mon(x)}</b>`).join('')}<span class="ctm-l">Взял</span>${L.map(x => cell(x, x.fact, false)).join('')}<span class="ctm-l">Оплатил</span>${L.map(x => cell(x, x.paid, true)).join('')}</div>`; })()}</td>
          <td class="num" style="font-size:13px">${s && s.bought != null ? (() => { const due = (s.list || []).reduce((a, x) => a + x.plan, 0), left = due - s.paid; return `взял ${INST.money(s.bought)}<br>оплатил <b>${INST.money(s.paid)}</b> из ${INST.money(due)}<br><span class="${left > 0.5 ? 'neg' : 'pos'}">${left > 0.5 ? 'не доплатил ' + INST.money(left) : 'оплачено по плану ✓'}</span>`; })() : '—'}</td>
          <td class="ct-act"><button class="btn gray sm" data-ct="${esc(k.id)}" type="button" title="Изменить договор">✏️</button><button class="btn gray sm" data-ctpr="${esc(k.id)}" type="button" title="Договор на печать / картинкой">🖨</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
  },
  setView(st) {
    const c = INST.cfg(), tg = CRMLocal.ext().tg || {}, linked = Object.keys(tg.chats || {}).filter(a => tg.chats[a]?.id);
    const agents = Object.keys(st?.texts?.agents || {});
    return `<div class="grid">${UI.panel('Настройки', `<div class="form">
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><input type="checkbox" id="isOn" ${c.on ? 'checked' : ''}> <b>Включить рассрочку по каждому заказу и напоминания</b></label>
        <label>Срок рассрочки, дней<input id="isD" type="number" min="1" max="365" value="${c.days}"></label>
        <label>Частей<input id="isP" type="number" min="1" max="12" value="${c.parts}"></label>
        <label>Присылать каждое утро в<select id="isH">${Array.from({ length: 14 }, (_, i) => i + 7).map(h => `<option value="${h}" ${h === Number(c.hour) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="isA" ${c.agents !== false ? 'checked' : ''}> Каждому агенту — его клиенты</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="isSun" ${c.sunday ? 'checked' : ''}> И в воскресенье</label>
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><input type="checkbox" id="isX" ${c.meXlsx !== false ? 'checked' : ''}> Вам — один Excel-файл с полным отчётом вместо длинного списка</label></div>
      <p class="mut">В файле: сводка и цифры по каждому агенту, кому платить сегодня, долгая просрочка (30+ дней) с подсказкой «что делать», все заказы в долг по частям, продажи и товары-лидеры, оплаты вчера и сегодня, что заканчивается на складе, договоры.</p>
      <p class="mut">Части: через 7, 14, 21 день после заказа и последняя — в день срока (при 30 днях и 4 частях: 7-й, 14-й, 21-й и 30-й день), каждая по ¼ суммы заказа. Утром приходят клиенты, у которых сегодня срок части или есть просрочка. Договоры попадают в напоминание, когда до конца месяца 10 дней и меньше, а закупка не выбрана, и за 30 дней до конца договора.</p>
      <p class="mut">Telegram: ${tg.token ? `бот подключён · ваш чат ${tg.me?.id ? '✓' : '<b class="neg">не выбран</b>'} · агентов с чатом: ${linked.length}` : '<b class="neg">бот не подключён</b>'} — <a href="#/tg">Telegram агентам</a>.</p>
      <details><summary><b>Чтобы приходило само, даже когда CRM закрыта</b> (один раз)</summary><ol class="steps"><li><a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт».</li><li>В script.google.com откройте файл автозагрузки, сотрите всё, вставьте, 💾.</li><li>Запустите <b>setup</b>. Первый раз скрипт возьмёт из LINKO заказы за 180 дней.</li></ol></details>
      <div class="bar"><button class="btn" id="isSave" type="button">Сохранить</button><span class="mut">${c.publishedAt ? 'Правила отправлены автозагрузке ' + new Date(c.publishedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span></div>`, { cls: 'w6' })}
      ${UI.panel('Как выглядит напоминание', st?.texts ? `<label class="mut">Кому <select id="isWho"><option value="">Вам (руководителю)</option>${agents.map(a => `<option ${a === INST.who ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <div class="tgprev" id="isPrev" style="white-space:pre-wrap;margin-top:8px">${esc(INST.who && st.texts.agents[INST.who] ? st.texts.agents[INST.who] : st.texts.me)}</div>
        <div class="bar" style="margin-top:8px;flex-wrap:wrap"><button class="btn gray" id="isSend" type="button">✈ Отправить сейчас всем</button>${c.meXlsx !== false ? '<button class="btn gray" id="isRep" type="button">📊 Прислать мне Excel-отчёт сейчас</button>' : ''}</div>` : '<p class="mut">Появится, когда автозагрузка первый раз посчитает графики (до 5 минут после включения).</p>', { cls: 'w6' })}</div>`;
  },
  async sendNow(st) {
    const tg = CRMLocal.ext().tg || {}, c = INST.cfg(); if (!tg.token) throw new Error('Сначала подключите бота: Telegram агентам');
    let n = 0;
    if (c.agents !== false) for (const [a, t] of Object.entries(st.texts.agents || {})) { const ch = tg.chats?.[a]?.id; if (ch) { await TG.send(ch, esc(t)); n++; } }
    if (tg.me?.id) { if (c.meXlsx !== false) { await INST.report(); n++; } else { await TG.send(tg.me.id, esc(st.texts.me)); n++; } }
    return n ? `Отправлено: ${n}` : 'Некому отправить: привяжите чаты в «Telegram агентам»';
  },
  // the Excel report is made by the auto-loader (it has all the LINKO data): its web app (the «🔄 Обновить» button's address) sends it now
  async report() {
    const w = window.LINKO_AUTO?.web?.(); if (!w) throw new Error('Для отчёта сейчас нужна кнопка «Обновить» из LINKO: Синхронизация и настройки → «⚡ Кнопка «Обновить»». Утром отчёт придёт и без неё.');
    let j; try { const r = await fetch(w.url + (w.url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(w.key) + '&report=1&t=' + Date.now(), { redirect: 'follow', cache: 'no-store' }); j = await r.json(); }
    catch { throw new Error('Скрипт Google не ответил — попробуйте через минуту'); }
    if (j.error) throw new Error(/ключ кнопки/.test(j.error) ? 'Скрипт Google старый — скопируйте его заново (Синхронизация и настройки) и разверните новую версию веб-приложения' : j.error);
    return j;
  },
};

EXT_PAGES.inst = async el => {
  await CRMLocal.ready; await LX.load();
  el.innerHTML = `<div class="page-head"><div><h2>📅 Рассрочка и договоры</h2><div class="sub">Каждый заказ — график оплаты по частям; каждое утро агенту в Telegram — его клиенты, у кого сегодня срок или просрочка</div></div></div><div id="instBody"><p class="mut">Загружаю…</p></div>`;
  const body = $('#instBody', el), c = INST.cfg();
  if (!INST.cloud()) { body.innerHTML = UI.empty('Нужна синхронизация', 'Графики считает скрипт автозагрузки, он работает через приватный репозиторий данных. Включите <a href="#/cloud">Синхронизация и настройки</a>.'); return; }
  const st = c.on ? await INST.state() : null;
  if (!el.isConnected) return;
  const all = st?.clients || [], agents = [...new Set(all.map(x => x.agent))].sort((a, b) => a.localeCompare(b)), pick = l => l.filter(x => !INST.agent || x.agent === INST.agent);
  const mine = pick(all), due = mine.filter(x => x.late > 0.5 || x.today > 0.5), list = INST.view === 'all' ? mine : due, f = INST.money;
  const ctNeed = (st?.contracts || []).filter(k => k.active && ((k.cur && k.cur.fact != null && (k.cur.fact < k.cur.plan || (k.cur.paid || 0) < k.cur.plan)) || k.daysLeft <= 30));
  const tabs = [['due', `Сегодня и просрочка (${due.length})`], ['all', `Все с долгом (${mine.length})`], ['ct', `Договоры (${c.contracts.length})`], ['set', '⚙ Настройки']];
  const head = !c.on ? `<div class="panel" style="margin-bottom:12px"><b>Пока выключено.</b> Откройте «⚙ Настройки», включите и сохраните — через 5 минут автозагрузка посчитает графики по всем заказам за 180 дней.</div>`
    : !st ? `<div class="panel" style="margin-bottom:12px"><b>Графики ещё не посчитаны.</b> Автозагрузка делает это каждые 5 минут. Если прошло больше 10 минут — обновите скрипт в Google (⚙ Настройки → «Чтобы приходило само»).</div>`
    : `<div class="kpis">${UI.tile('Сегодня срок', f(mine.reduce((a, x) => a + x.today, 0)), { sub: mine.filter(x => x.today > 0.5).length + ' кл.', tone: 'warn' })}
        ${UI.tile('Просрочено', f(mine.reduce((a, x) => a + x.late, 0)), { sub: mine.filter(x => x.late > 0.5).length + ' кл.', tone: mine.some(x => x.late > 0.5) ? 'bad' : 'good' })}
        ${UI.tile('Долг всего', f(mine.reduce((a, x) => a + x.debt, 0)), { sub: mine.length + ' кл. с долгом' })}
        ${UI.tile('Договоры: внимание', String(ctNeed.length), { sub: 'план месяца не выбран или скоро конец', tone: ctNeed.length ? 'warn' : '' })}</div>
      <p class="mut" style="margin:6px 0 10px">Расчёт автозагрузки: ${new Date(st.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · оплаченное по заказам считается от долга клиента в LINKO (оплаты закрывают самые старые заказы)</p>`;
  body.innerHTML = head + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><nav class="tabs">${tabs.map(([k, t]) => `<a href="#" data-tab="${k}" class="${INST.view === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
      ${(INST.view === 'due' || INST.view === 'all') && agents.length ? `<label class="mut">Агент <select id="instAg"><option value="">Все</option>${agents.map(a => `<option ${a === INST.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>` : ''}</div>
    <div id="instMain"></div>`;
  const main = $('#instMain', body);
  if (INST.view === 'ct') main.innerHTML = INST.ctView(st, INST.q);
  else if (INST.view === 'set') main.innerHTML = INST.setView(st);
  else if (st) main.innerHTML = list.length ? `<div class="scroll"><table><thead><tr><th>Клиент</th><th>Агент</th><th class="num">Долг</th><th class="num">Просрочено</th><th class="num">Сегодня</th><th>Следующая часть</th><th class="num">Заказов</th></tr></thead><tbody>${list.map(INST.rowHtml).join('')}</tbody></table></div>`
    : UI.empty(INST.view === 'due' ? 'Сегодня никто не должен платить, просрочек нет' : 'Клиентов с долгом нет', '');

  body.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); INST.view = a.dataset.tab; EXT_PAGES.inst(el); });
  const ag = $('#instAg', body); if (ag) ag.onchange = () => { INST.agent = ag.value; EXT_PAGES.inst(el); };
  main.querySelectorAll('[data-row]').forEach(tr => tr.onclick = () => { const n = tr.dataset.row; if (INST.open.has(n)) INST.open.delete(n); else INST.open.add(n); EXT_PAGES.inst(el); });
  main.querySelectorAll('[data-own]').forEach(b => b.onclick = e => { e.stopPropagation(); INST.ownDialog(b.dataset.own); });
  INST.ctWire(main);
  const sv = $('#isSave', main);
  if (sv) sv.onclick = () => {
    Object.assign(c, { on: $('#isOn', main).checked, days: Number($('#isD', main).value) || 30, parts: Number($('#isP', main).value) || 4, hour: Number($('#isH', main).value), agents: $('#isA', main).checked, sunday: $('#isSun', main).checked, meXlsx: $('#isX', main).checked });
    INST.changed(c.on ? 'Включено — автозагрузка посчитает графики за 5 минут' : 'Выключено'); EXT_PAGES.inst(el);
  };
  const who = $('#isWho', main); if (who) who.onchange = () => { INST.who = who.value; $('#isPrev', main).textContent = INST.who ? st.texts.agents[INST.who] : st.texts.me; };
  const rp = $('#isRep', main); if (rp) rp.onclick = async () => { rp.disabled = true; rp.textContent = 'Собираю отчёт…'; try { await INST.report(); toast('Отчёт отправлен вам в Telegram'); } catch (e) { toast(e.message); } finally { rp.disabled = false; rp.textContent = '📊 Прислать мне Excel-отчёт сейчас'; } };
  const sn = $('#isSend', main); if (sn) sn.onclick = async () => { if (!confirm('Отправить напоминания в Telegram сейчас — вам и агентам?')) return; sn.disabled = true; try { toast(await INST.sendNow(st)); } catch (e) { toast(e.message); } finally { sn.disabled = false; } };
};

// the client → agent list and the Telegram chats change over time: the rules are sent again once a day when the CRM is open
addEventListener('load', () => setTimeout(async () => {
  try { await CRMLocal.ready; const c = INST.cfg(); if (!c.on || !INST.cloud()) return; if (Date.now() - Date.parse(c.publishedAt || 0) > 864e5) { await LX.load(); await INST.publish(); } }
  catch (e) { console.warn('inst publish', e); }
}, 15000));

// quick access from the menu (Деньги → Договоры): only the contracts, with search, «＋ Договор» and the paper contract
EXT_PAGES.contracts = async el => {
  await CRMLocal.ready; await LX.load();
  el.innerHTML = `<div class="page-head"><div><h2>📄 Договоры</h2><div class="sub">План закупок по месяцам, что взял и оплатил клиент; бумажный договор (шартнома) — на печать или картинкой</div></div></div><div id="ctBody"><p class="mut">Загружаю…</p></div>`;
  const body = $('#ctBody', el), c = INST.cfg(), st = c.on && INST.cloud() ? await INST.state() : null;
  if (!el.isConnected) return;
  body.innerHTML = (!st && c.contracts.length ? '<p class="mut" style="margin:0 0 8px">«Взял» и «Оплатил» считает автозагрузка — включите её в <a href="#/inst">Рассрочка → ⚙ Настройки</a>.</p>' : '') + INST.ctView(st, INST.q);
  INST.ctWire(body);
  const q = $('#icQ', body); if (q && INST.q) q.oninput();
};
