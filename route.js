// Маршруты агентов (Агенты → Маршруты): a fixed weekly route per agent (Mon–Sat, a zone and an ordered list of clients per day),
// the plan of a route day (what to collect / sell at every stop), tasks for the day in one click, the result of a day
// (who paid / bought), the agent's week, and the route of the day inside the agent's Telegram report.
// Stored in the synced state: ext.routes[agent] = { days: { 1: { zone, clients: [name…] }, … 6: … } }.
window.EXT_PAGES = window.EXT_PAGES || {};

const ROUTE = {
  DAYS: ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  SHORT: ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  // day names as they are written in route files (uz / ru)
  NAMES: { dushanba: 1, понедельник: 1, seshanba: 2, вторник: 2, chorshanba: 3, среда: 3, payshanba: 4, четверг: 4, juma: 5, пятница: 5, shanba: 6, суббота: 6 },
  all: () => (CRMLocal.ext().routes ||= {}),
  of(agent) { const r = (ROUTE.all()[agent] ||= { days: {} }); for (let i = 1; i <= 6; i++) r.days[i] ||= { zone: '', clients: [] }; return r; },
  save: () => CRMLocal.touch(),
  // weekday of a date: 1 = Mon … 7 = Sun
  wd: date => ((new Date(date + 'T12:00:00').getDay() + 6) % 7) + 1,
  // the route day an agent works on `date` (Sunday → nothing)
  dayOf(agent, date) { const w = ROUTE.wd(date); if (w > 6) return null; const r = ROUTE.all()[agent]; return r && r.days[w] && r.days[w].clients.length ? { w, ...r.days[w] } : null; },
  // the date the Telegram report is about: today, or the next working day after 18:00 / on Sunday
  sendDate() {
    const now = new Date(); let t = UI.localDate(now.getTime());
    if (CRMLocal.ext().routeWhen === 'tomorrow' || (CRMLocal.ext().routeWhen !== 'today' && now.getHours() >= 18)) t = UI.localDate(now.getTime() + 864e5);
    if (ROUTE.wd(t) === 7) t = UI.localDate(Date.parse(t + 'T12:00:00') + 864e5);
    return t;
  },
  // compare names written in Latin and Cyrillic: everything is turned into Uzbek Latin without punctuation
  TR: { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ў: 'o', ҳ: 'h' },
  norm: s => String(s || '').toLowerCase().replace(/[ʻʼ'`’‘´"]/g, '').replace(/[а-яёқғўҳ]/g, ch => ROUTE.TR[ch] ?? ch).replace(/[^\p{L}\p{N}]+/gu, ''),
  // where a client is in the routes: [{agent, w}]
  index() { const m = new Map(); for (const [agent, r] of Object.entries(ROUTE.all())) for (const [w, day] of Object.entries(r.days || {})) for (const n of day.clients || []) (m.get(n) || m.set(n, []).get(n)).push({ agent, w: +w }); return m; },
  isNew(c, S = CRMLocal.engine.getState()) { const x = S.ag.clients[c.name || c]; return !!(x && x.added && !x.first && REP.days(x.added, REP.today()) <= 30); },

  // plan of a stop (variant A: everything that is left until the end of the plan period)
  stop(c, d) {
    const notes = NOTES.promises(d).filter(p => p.client === c.name && p.status !== 'kept');
    return { c, collect: Math.max(0, (c.pool || 0) - c.paid), sell: Math.max(0, (c.plan || 0) - c.sold), more: c.more_pool || 0, promise: notes[0] || null, tasks: d.tasks.filter(t => t.client === c.name && t.status !== 'done') };
  },
  stops(d, agent, w) {
    const r = ROUTE.of(agent), by = new Map(d.clients.map(c => [c.name, c]));
    return (r.days[w].clients || []).map(n => by.get(n) ? ROUTE.stop(by.get(n), d) : { missing: true, name: n });
  },
  // fact of a day: per client what was paid / bought on `date` (latest upload of that day vs the latest upload before it, same period)
  dayFact(date) {
    const S = CRMLocal.engine.getState(), ups = S.ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.id - b.id));
    const cur = ups.filter(u => u.taken_at === date).at(-1); if (!cur) return null;
    const prev = ups.filter(u => u.taken_at < date && u.period_from === cur.period_from).at(-1);
    const was = new Map(prev ? prev.rows.map(r => [r.client, r]) : []), out = new Map();
    for (const r of cur.rows) { const p = was.get(r.client) || { paid: 0, sold: 0 }; out.set(r.client, { paid: prev ? r.paid - p.paid : null, sold: prev ? r.sold - p.sold : null }); }
    return { map: out, partial: !prev, prevDate: prev?.taken_at || null };
  },

  // the block for the agent's Telegram report
  text(d, agent) {
    const date = ROUTE.sendDate(), day = ROUTE.dayOf(agent, date); if (!day) return '';
    const f = REP.money, st = ROUTE.stops(d, agent, day.w).filter(s => !s.missing);
    const col = st.reduce((a, s) => a + s.collect, 0), sell = st.reduce((a, s) => a + s.sell, 0);
    const L = [`<b>🗺 Маршрут: ${ROUTE.DAYS[day.w]}, ${UI.dateRu(date)}${day.zone ? ' — ' + esc(day.zone) : ''}</b>`, `${st.length} точек · собрать <b>${f(col)}</b> · продать <b>${f(sell)}</b>`];
    st.forEach((s, i) => {
      const c = s.c, bits = [];
      if (s.collect) bits.push(`собрать ${f(s.collect)}`); else if (c.debt >= 1) bits.push(`долг ${f(c.debt)}`);
      if (s.sell) bits.push(`продать ${f(s.sell)}`);
      if (s.promise) bits.push(`🤝 обещал ${UI.dm(s.promise.date)}${s.promise.sum ? ' ' + f(s.promise.sum) : ''}`);
      if (!bits.length && c.buyDays > 30) bits.push(`не брал ${c.buyDays} дн.`);
      L.push(`${i + 1}. ${esc(c.name)}${bits.length ? ' — ' + bits.join(', ') : ''}${s.tasks.length ? ` · задание: ${esc(s.tasks[0].kind)}${s.tasks[0].target ? ' ' + f(s.tasks[0].target) : ''}` : ''}`);
    });
    return L.join('\n');
  },
};

let rtState = { agent: '', tab: 'edit', date: '' };
EXT_PAGES.amap = async el => {
  const d = await REP.load(), S = CRMLocal.engine.getState();
  el.innerHTML = `<div class="page-head"><div><h2>Маршруты агентов</h2><div class="sub">Постоянный маршрут на неделю: зона и клиенты по дням. План дня считается из остатка пула и плана продаж клиента до конца периода.</div></div></div><div id="rtBody"></div>`;
  const body = $('#rtBody', el);
  if (d.empty) return REP.empty(body);
  const st = rtState, agents = d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  if (!agents.includes(st.agent)) st.agent = agents[0];
  if (!st.date) st.date = ROUTE.wd(REP.today()) === 7 ? UI.localDate(Date.now() + 864e5) : REP.today();
  const idx = ROUTE.index(), newOnes = d.clients.filter(c => ROUTE.isNew(c, S) && !idx.has(c.name));
  body.innerHTML = `<div class="bar"><select id="rtAg" aria-label="Агент">${agents.map(a => `<option ${a === st.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <nav class="tabs" style="margin:0;border:0">${[['edit', '✏ Маршрут'], ['day', '📋 День маршрута'], ['week', '📊 Неделя']].map(([k, t]) => `<a href="#" data-rt="${k}" class="${st.tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav></div>
    ${newOnes.length ? `<div class="newbox">🆕 <b>Новые клиенты, которых нет ни в одном маршруте (${newOnes.length}):</b> ${newOnes.map(c => `<a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a> <small class="mut">(${esc(c.agent)}, с ${UI.dm(S.ag.clients[c.name].added)})</small>`).join(', ')}</div>` : ''}
    <div id="rtTab"></div>`;
  $('#rtAg', body).onchange = e => { st.agent = e.target.value; EXT_PAGES.amap(el); };
  body.querySelectorAll('[data-rt]').forEach(a => a.onclick = e => { e.preventDefault(); st.tab = a.dataset.rt; EXT_PAGES.amap(el); });
  const tab = $('#rtTab', body);
  if (st.tab === 'edit') RT.edit(tab, d, st.agent, () => EXT_PAGES.amap(el));
  else if (st.tab === 'day') RT.day(tab, d, st, () => EXT_PAGES.amap(el));
  else RT.week(tab, d, st.agent);
};

const RT = {
  // ---------- editor ----------
  edit(box, d, agent, redraw) {
    const R = ROUTE.of(agent), S = CRMLocal.engine.getState(), f = UI.fmt0, idx = ROUTE.index();
    const by = new Map(d.clients.map(c => [c.name, c])), mine = d.clients.filter(c => c.agent === agent);
    const inRoute = new Set(Object.values(R.days).flatMap(x => x.clients));
    const notIn = mine.filter(c => !inRoute.has(c.name)).sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));
    const dup = new Set([...idx.entries()].filter(([, l]) => l.filter(x => x.agent === agent).length > 1).map(([n]) => n));
    const opts = `<datalist id="rtAll">${[...mine, ...d.clients.filter(c => c.agent !== agent)].map(c => `<option value="${esc(c.name)}">${c.agent !== agent ? esc(c.agent) : ''}</option>`).join('')}</datalist>`;
    box.innerHTML = `${opts}<div class="bar"><button class="btn gray" id="rtImp">⬆ Загрузить маршрут из Excel</button><input type="file" id="rtFile" accept=".xlsx,.csv" hidden><button class="btn gray" id="rtExp">⬇ Выгрузить в Excel</button><button class="btn gray" id="rtTg">✈ Отправить маршрут недели агенту</button>
        <span class="mut">${inRoute.size} точек в маршруте · ${mine.length} клиентов у агента · не в маршруте: <b>${notIn.length}</b>${dup.size ? ` · <span class="neg">дважды в маршруте: ${dup.size}</span>` : ''}</span></div>
      <div class="rtgrid">${[1, 2, 3, 4, 5, 6].map(w => {
        const day = R.days[w], col = day.clients.reduce((a, n) => a + Math.max(0, (by.get(n)?.pool || 0) - (by.get(n)?.paid || 0)), 0), sell = day.clients.reduce((a, n) => a + Math.max(0, (by.get(n)?.plan || 0) - (by.get(n)?.sold || 0)), 0);
        return `<section class="panel rtday" data-w="${w}"><div class="rthead"><b>${ROUTE.DAYS[w]}</b><input class="rtzone" data-zone="${w}" value="${esc(day.zone || '')}" placeholder="зона (например, Кува)"></div>
          <div class="mut rtsum">${day.clients.length} точек · собрать $${f(col)} · продать $${f(sell)}</div>
          <ol class="rtlist">${day.clients.map((n, i) => { const c = by.get(n); return `<li class="${!c ? 'miss' : ''}" draggable="true" data-w="${w}" data-i="${i}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="rtn">${c ? `<a class="clink" data-client="${esc(n)}">${esc(n)}</a>` : `<span title="Клиента нет в последней загрузке">${esc(n)} ⚠</span>`}${c && c.agent !== agent ? ` <small class="neg">(${esc(c.agent)})</small>` : ''}${dup.has(n) ? ' <small class="pill warn">2×</small>' : ''}${c && ROUTE.isNew(c, S) ? ' <small class="pill info">новый</small>' : ''}<br><small class="mut">${c ? [c.debt >= 1 ? 'долг ' + f(c.debt) : '', c.pool ? `пул ${f(c.pool)}` : '', c.plan ? `план ${f(c.plan)}` : ''].filter(Boolean).join(' · ') : ''}</small></span>
            <span class="rtbtns"><button class="btn gray sm" data-up="${w}:${i}" aria-label="Выше">↑</button><button class="btn gray sm" data-dn="${w}:${i}" aria-label="Ниже">↓</button><select class="sm" data-mv="${w}:${i}" aria-label="Перенести в другой день"><option value="">→</option>${[1, 2, 3, 4, 5, 6].filter(x => x !== w).map(x => `<option value="${x}">${ROUTE.SHORT[x]}</option>`).join('')}</select><button class="btn gray sm" data-rm="${w}:${i}" aria-label="Убрать">✕</button></span></li>`; }).join('')}</ol>
          <div class="rtadd"><input list="rtAll" data-add="${w}" placeholder="+ добавить клиента (начните вводить)"></div></section>`;
      }).join('')}</div>
      ${UI.panel(`Клиенты агента не в маршруте (${notIn.length})`, notIn.length ? `<div class="scroll" style="max-height:360px"><table><thead><tr><th>Клиент</th><th class="n">Долг</th><th class="n">Пул / план</th><th>Добавить в день</th></tr></thead><tbody>${notIn.map(c => `<tr><td><a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${ROUTE.isNew(c, S) ? ' <span class="pill info">новый</span>' : ''}${c.landmark ? `<br><small class="mut">${esc(c.landmark)}</small>` : ''}</td><td class="n">${c.debt ? f(c.debt) : '—'}</td><td class="n">${c.pool ? f(c.pool) : '—'} / ${c.plan ? f(c.plan) : '—'}</td><td>${[1, 2, 3, 4, 5, 6].map(w => `<button class="btn gray sm" data-put="${w}" data-name="${esc(c.name)}">${ROUTE.SHORT[w]}</button>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Все клиенты агента стоят в маршруте 👍</p>', { cls: 'w12', sub: 'Новые клиенты из LINKO появляются здесь с пометкой «новый» — добавьте их в нужный день' })}`;
    const at = k => k.split(':').map(Number), list = w => R.days[w].clients;
    const done = () => { ROUTE.save(); redraw(); };
    box.querySelectorAll('[data-zone]').forEach(i => i.onchange = () => { R.days[+i.dataset.zone].zone = i.value.trim(); ROUTE.save(); });
    box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const [w, i] = at(b.dataset.up), l = list(w); if (i > 0) { [l[i - 1], l[i]] = [l[i], l[i - 1]]; done(); } });
    box.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const [w, i] = at(b.dataset.dn), l = list(w); if (i < l.length - 1) { [l[i + 1], l[i]] = [l[i], l[i + 1]]; done(); } });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const [w, i] = at(b.dataset.rm); list(w).splice(i, 1); done(); });
    box.querySelectorAll('[data-mv]').forEach(s => s.onchange = () => { if (!s.value) return; const [w, i] = at(s.dataset.mv), n = list(w).splice(i, 1)[0]; list(+s.value).push(n); done(); });
    box.querySelectorAll('[data-put]').forEach(b => b.onclick = () => { list(+b.dataset.put).push(b.dataset.name); done(); });
    box.querySelectorAll('[data-add]').forEach(inp => inp.onchange = () => {
      const v = inp.value.trim(); if (!v) return;
      const name = by.has(v) ? v : d.clients.find(c => ROUTE.norm(c.name) === ROUTE.norm(v))?.name;
      if (!name) { toast('Такого клиента нет в CRM — выберите из списка'); return; }
      const l = list(+inp.dataset.add); if (l.includes(name)) return toast('Клиент уже в этом дне');
      l.push(name); done();
    });
    // drag & drop between days (computer)
    let drag = null;
    box.querySelectorAll('.rtlist li').forEach(li => { li.ondragstart = () => { drag = [+li.dataset.w, +li.dataset.i]; li.classList.add('drag'); }; li.ondragend = () => li.classList.remove('drag'); });
    box.querySelectorAll('.rtday').forEach(sec => {
      sec.ondragover = e => { e.preventDefault(); sec.classList.add('over'); }; sec.ondragleave = () => sec.classList.remove('over');
      sec.ondrop = e => {
        e.preventDefault(); sec.classList.remove('over'); if (!drag) return;
        const [w, i] = drag, to = +sec.dataset.w, li = e.target.closest('li'), n = list(w).splice(i, 1)[0];
        let pos = li && +li.dataset.w === to ? +li.dataset.i : list(to).length; if (w === to && i < pos) pos--;
        list(to).splice(pos, 0, n); drag = null; done();
      };
    });
    // Excel
    const file = $('#rtFile', box);
    $('#rtImp', box).onclick = () => file.click();
    file.onchange = async () => { const fl = file.files[0]; file.value = ''; if (fl) RT.importDialog(fl, d, agent, redraw); };
    $('#rtExp', box).onclick = () => { const rows = [['День', 'Зона', '№', 'Клиент', 'Долг', 'Пул', 'План']]; for (let w = 1; w <= 6; w++) R.days[w].clients.forEach((n, i) => { const c = by.get(n); rows.push([ROUTE.DAYS[w], i ? '' : R.days[w].zone, i + 1, n, c ? Math.round(c.debt) : '', c?.pool || '', c?.plan || '']); }); UI.csv(`маршрут-${agent}.csv`, rows); };
    $('#rtTg', box).onclick = async () => {
      const conf = CRMLocal.ext().tg || {}; if (!conf.token || !conf.chats?.[agent]) return toast('Агент не привязан к Telegram (Отчёты → Telegram агентам)');
      const text = [`<b>🗺 Ваш маршрут на неделю, ${esc(agent)}</b>`, ...[1, 2, 3, 4, 5, 6].filter(w => R.days[w].clients.length).map(w => `\n<b>${ROUTE.DAYS[w]}${R.days[w].zone ? ' — ' + esc(R.days[w].zone) : ''}</b>\n` + R.days[w].clients.map((n, i) => `${i + 1}. ${esc(n)}`).join('\n'))].join('\n');
      if (!confirm(`Отправить ${agent} маршрут на неделю?`)) return;
      try { await TG.send(conf.chats[agent].id, text); toast('Маршрут отправлен'); } catch (e) { toast(e.message); }
    };
  },

  async importDialog(file, d, agent, redraw) {
    const raw = new Uint8Array(await file.arrayBuffer());
    let sheets; try { sheets = await CRMEngine.readTableAsync(raw, file.name); } catch (e) { return toast('Не удалось прочитать файл: ' + e.message); }
    // find day headers anywhere; rows below them: number, client, (zone) in the next columns
    const found = {}; // w -> {zone, names[]}
    for (const sh of sheets) {
      const cols = {}; // column -> current weekday
      for (const row of sh.rows) {
        (row || []).forEach((v, ci) => { const w = ROUTE.NAMES[String(v ?? '').trim().toLowerCase()]; if (w) { cols[ci] = w; found[w] ||= { zone: '', names: [] }; } });
        for (const [ci, w] of Object.entries(cols)) {
          const c = +ci, num = row?.[c], name = String(row?.[c + 1] ?? '').trim(), zone = String(row?.[c + 2] ?? '').trim();
          if (ROUTE.NAMES[String(num ?? '').trim().toLowerCase()]) continue;
          if (name && (typeof num === 'number' || /^\d+$/.test(String(num ?? '').trim()))) { found[w].names.push(name); if (zone && !found[w].zone) found[w].zone = zone; }
        }
      }
    }
    const days = Object.keys(found).map(Number).sort();
    if (!days.length) return toast('В файле не найдены дни недели (Dushanba / Понедельник …)');
    // match names: exact → normalized → closest among the agent's clients, then everyone
    const mine = d.clients.filter(c => c.agent === agent), allC = d.clients, normMap = new Map(allC.map(c => [ROUTE.norm(c.name), c.name]));
    const sim = (a, b) => { a = ROUTE.norm(a); b = ROUTE.norm(b); if (!a || !b) return 0; if (a === b) return 1; if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.95 + 0.04; const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return 1 - m[a.length][b.length] / Math.max(a.length, b.length); };
    const memo = (CRMLocal.ext().routeAlias ||= {});
    const match = n => {
      if (memo[n] && allC.some(c => c.name === memo[n])) return { name: memo[n], how: 'saved' };
      const ex = normMap.get(ROUTE.norm(n)); if (ex) return { name: ex, how: 'exact' };
      let best = null; for (const c of [...mine, ...allC]) { const s = sim(n, c.name) + (c.agent === agent ? 0.05 : 0); if (!best || s > best.s) best = { s, name: c.name }; }
      return best && best.s >= 0.72 ? { name: best.name, how: 'guess', s: best.s } : { name: '', how: 'none' };
    };
    const items = days.flatMap(w => found[w].names.map((n, i) => ({ w, i, src: n, ...match(n) })));
    const m = modal(`<h3>Загрузка маршрута: ${esc(agent)}</h3><p class="mut" style="margin-top:0">Найдено дней: ${days.length}, точек: ${items.length}. Проверьте сопоставление — жёлтым отмечены похожие имена, красным не найденные. Выбор запомнится для следующих загрузок.</p>
      <div class="tscroll" style="max-height:55vh"><table><thead><tr><th>День</th><th>В файле</th><th>Клиент в CRM</th></tr></thead><tbody>${items.map((it, k) => `<tr class="${it.how === 'guess' ? 'mguess' : it.how === 'none' ? 'mnone' : ''}"><td>${ROUTE.SHORT[it.w]} ${it.i + 1}</td><td>${esc(it.src)}</td><td><input list="rtAll2" data-k="${k}" value="${esc(it.name)}" placeholder="не найден — выберите или оставьте пустым" style="width:100%"></td></tr>`).join('')}</tbody></table></div>
      <datalist id="rtAll2">${allC.map(c => `<option value="${esc(c.name)}">${esc(c.agent)}</option>`).join('')}</datalist>
      <div class="bar" style="margin-top:12px"><label class="mut"><input type="checkbox" id="rtRepl" checked> заменить эти дни целиком</label><span class="spacer"></span><button class="btn gray" id="rX">Отмена</button><button class="btn" id="rOk">Сохранить маршрут</button></div>`);
    m.el.classList.add('wide');
    $('#rX', m.el).onclick = m.close;
    $('#rOk', m.el).onclick = () => {
      const R = ROUTE.of(agent), repl = $('#rtRepl', m.el).checked, names = new Set(allC.map(c => c.name));
      if (repl) for (const w of days) R.days[w].clients = [];
      for (const w of days) if (found[w].zone) R.days[w].zone = found[w].zone;
      let skipped = 0;
      m.el.querySelectorAll('input[data-k]').forEach(inp => {
        const it = items[+inp.dataset.k], v = inp.value.trim();
        if (!v || !names.has(v)) { skipped++; return; }
        if (it.how !== 'exact' && v !== it.src) memo[it.src] = v;
        if (!R.days[it.w].clients.includes(v)) R.days[it.w].clients.push(v);
      });
      ROUTE.save(); m.close(); toast(`Маршрут сохранён${skipped ? ` · пропущено: ${skipped}` : ''}`); redraw();
    };
  },

  // ---------- one route day ----------
  day(box, d, st, redraw) {
    const agent = st.agent, w = ROUTE.wd(st.date), f = UI.fmt0, R = ROUTE.of(agent);
    if (w === 7) { st.date = UI.localDate(Date.parse(st.date + 'T12:00:00') + 864e5); return RT.day(box, d, st, redraw); }
    const stops = ROUTE.stops(d, agent, w), ok = stops.filter(s => !s.missing), fact = st.date <= d.upload.taken_at ? ROUTE.dayFact(st.date) : null;
    const sum = k => ok.reduce((a, s) => a + s[k], 0), col = sum('collect'), sell = sum('sell'), more = sum('more');
    const prom = ok.filter(s => s.promise), tasks = ok.reduce((a, s) => a + s.tasks.length, 0), debt = ok.reduce((a, s) => a + s.c.debt, 0);
    const F = fact ? ok.map(s => ({ s, x: fact.map.get(s.c.name) || { paid: 0, sold: 0 } })) : [];
    const paidPts = F.filter(o => o.x.paid > 0.5).length, soldPts = F.filter(o => o.x.sold > 0.5).length, paidSum = F.reduce((a, o) => a + Math.max(0, o.x.paid || 0), 0), soldSum = F.reduce((a, o) => a + Math.max(0, o.x.sold || 0), 0);
    const conf = CRMLocal.ext().tg || {};
    box.innerHTML = `<div class="bar"><label class="mut">Дата <input type="date" id="rdD" value="${st.date}"></label>
        ${[1, 2, 3, 4, 5, 6].map(x => `<button class="btn ${x === w ? '' : 'gray'} sm" data-wd="${x}">${ROUTE.SHORT[x]}</button>`).join('')}
        <span class="spacer"></span><button class="btn gray" id="rdTask">✅ Дать задания на день</button>${conf.token && conf.chats?.[agent] ? '<button class="btn" id="rdTg">✈ Отправить агенту</button>' : ''}</div>
      <h3 style="margin:4px 0 12px">${ROUTE.DAYS[w]}, ${UI.dateRu(st.date)}${R.days[w].zone ? ' — ' + esc(R.days[w].zone) : ''}</h3>
      ${!stops.length ? UI.empty('В этот день маршрута нет', 'Добавьте клиентов на вкладке «✏ Маршрут».') : `
      <div class="kpis">
        ${UI.tile('Точек', String(ok.length), { sub: `долг на маршруте $${f(debt)}` })}
        ${UI.tile('Собрать', '$' + f(col), { sub: `остаток пула клиентов дня${more ? ` · обещано «ещё» $${f(more)}` : ''}`, tone: 'warn' })}
        ${UI.tile('Продать', '$' + f(sell), { sub: 'остаток плана продаж клиентов дня' })}
        ${UI.tile('Обещания / задания', `${prom.length} / ${tasks}`, { sub: prom.length ? prom.map(s => esc(s.c.name)).slice(0, 2).join(', ') : '' })}
        ${fact ? UI.tile('Итог дня', `${paidPts} из ${ok.length}`, { sub: `оплатили · собрано $${f(paidSum)}${col ? ` (${Math.round(paidSum / col * 100)}% плана дня)` : ''}<br>купили ${soldPts} · продано $${f(soldSum)}${fact.partial ? '<br><small>нет загрузки предыдущего дня — это всё с начала периода</small>' : ''}`, tone: paidPts ? 'good' : 'bad' }) : ''}
      </div>
      <div class="scroll" style="max-height:none"><table><thead><tr><th>№</th><th>Клиент</th><th class="n">Долг</th><th class="n">Посл. оплата</th><th class="n">Собрать</th><th class="n">Продать</th><th class="n">Посл. покупка</th><th>Обещание / задание</th>${fact ? '<th class="n">Факт дня</th>' : ''}</tr></thead><tbody>
        ${stops.map((s, i) => s.missing ? `<tr><td>${i + 1}</td><td colspan="${fact ? 8 : 7}"><span class="neg">${esc(s.name)} — нет в последней загрузке</span></td></tr>` : (() => { const c = s.c, x = fact?.map.get(c.name); return `<tr><td>${i + 1}</td><td><a class="clink" data-client="${esc(c.name)}">${esc(c.name)}</a>${c.phone ? `<br><small><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></small>` : ''}</td><td class="n">${c.debt >= 1 ? `<b>${f(c.debt)}</b>` : '—'}</td><td class="n">${c.debt >= 1 ? REP.pay(c) : '—'}</td><td class="n">${s.collect ? `<b>${f(s.collect)}</b>${c.pool ? `<br><small>из ${f(c.pool)}</small>` : ''}` : '—'}</td><td class="n">${s.sell ? `<b>${f(s.sell)}</b><br><small>из ${f(c.plan)}</small>` : '—'}</td><td class="n">${REP.buy(c)}</td><td>${s.promise ? UI.pill(s.promise.status === 'overdue' ? 'crit' : 'warn', `🤝 ${UI.dm(s.promise.date)}${s.promise.sum ? ' $' + f(s.promise.sum) : ''}`) + ' ' : ''}${s.tasks.map(t => UI.pill(t.status === 'overdue' ? 'crit' : 'info', `${t.kind}${t.target ? ' $' + f(t.target) : ''}`)).join(' ')}</td>${fact ? `<td class="n">${x && x.paid > 0.5 ? `<b class="pos">+${f(x.paid)}</b>` : '<span class="mut">нет оплаты</span>'}${x && x.sold > 0.5 ? `<br><small>купил ${f(x.sold)}</small>` : ''}</td>` : ''}</tr>`; })()).join('')}
      </tbody><tfoot><tr><td></td><td><b>Итого</b></td><td class="n"><b>${f(debt)}</b></td><td></td><td class="n"><b>${f(col)}</b></td><td class="n"><b>${f(sell)}</b></td><td></td><td></td>${fact ? `<td class="n"><b>${f(paidSum)}</b></td>` : ''}</tr></tfoot></table></div>
      <p class="mut">«Собрать» — сколько осталось собрать с клиента до конца периода (пул − оплачено), «Продать» — план продаж − продано. ${fact ? '«Факт дня» — что клиент оплатил и купил в этот день по загрузкам.' : 'Факт дня появится после загрузки баланса за этот день.'}</p>`}`;
    $('#rdD', box).onchange = e => { st.date = e.target.value || REP.today(); redraw(); };
    box.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { const cur = ROUTE.wd(st.date); st.date = UI.localDate(Date.parse(st.date + 'T12:00:00') + (+b.dataset.wd - cur) * 864e5); redraw(); });
    const tg = $('#rdTg', box);
    if (tg) tg.onclick = async () => {
      const text = [`<b>${esc(agent)}</b>`, RT.dayText(d, agent, st.date)].join('\n');
      if (!confirm(`Отправить ${agent} маршрут на ${UI.dateRu(st.date)}?`)) return;
      try { await TG.send(conf.chats[agent].id, text); toast('Отправлено'); } catch (e) { toast(e.message); }
    };
    const tb = $('#rdTask', box);
    if (tb) tb.onclick = () => RT.taskDialog(d, agent, st.date, ok, redraw);
  },
  dayText(d, agent, date) { const keep = ROUTE.sendDate; ROUTE.sendDate = () => date; try { return ROUTE.text(d, agent); } finally { ROUTE.sendDate = keep; } },
  taskDialog(d, agent, date, ok, redraw) {
    const f = UI.fmt0, kinds = d.kinds || ['Сбор оплаты', 'Продажа', 'Погашение долга', 'Другое'];
    const sug = ok.filter(s => !s.tasks.length).map(s => {
      const c = s.c;
      if (s.promise) return { s, kind: 'Сбор оплаты', target: Math.round(s.promise.sum || s.collect || Math.min(c.debt, 1000)), text: `Забрать обещанную оплату (${UI.dm(s.promise.date)})` };
      if (s.collect > 0) return { s, kind: 'Сбор оплаты', target: Math.round(s.collect), text: 'Собрать оплату по плану' };
      if (c.debt > 0 && c.payDays > 14) return { s, kind: 'Погашение долга', target: Math.round(Math.min(c.debt, 1000)), text: `Долг без оплаты ${c.payDays} дн.` };
      if (s.sell > 0) return { s, kind: 'Продажа', target: Math.round(s.sell), text: 'Взять заказ по плану' };
      if (!c.lastBuy || c.buyDays > 30) return { s, kind: 'Продажа', target: 0, text: 'Вернуть клиента: взять заказ' };
      return null;
    }).filter(Boolean);
    if (!sug.length) return toast('Предложить нечего: у всех точек уже есть задания или нет долга и плана');
    const m = modal(`<h3>Задания на ${ROUTE.DAYS[ROUTE.wd(date)].toLowerCase()}, ${UI.dateRu(date)} — ${esc(agent)}</h3><p class="mut" style="margin-top:0">Предложено по маршруту дня. Поправьте суммы и уберите лишнее. Срок — этот день.</p>
      <div class="tscroll" style="max-height:55vh"><table><thead><tr><th><input type="checkbox" id="tAll" checked aria-label="Все"></th><th>Клиент</th><th>Тип</th><th class="n">Цель, $</th><th>Что сделать</th></tr></thead><tbody>${sug.map((x, i) => `<tr><td><input type="checkbox" data-t="${i}" checked aria-label="Выбрать"></td><td>${esc(x.s.c.name)}<br><small class="mut">долг ${f(x.s.c.debt)}</small></td><td><select data-k="${i}">${kinds.map(k => `<option ${k === x.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></td><td class="n"><input type="number" min="0" data-g="${i}" value="${x.target || ''}" style="width:100px;text-align:right"></td><td><input data-x="${i}" value="${esc(x.text)}" style="width:100%"></td></tr>`).join('')}</tbody></table></div>
      <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="tX">Отмена</button><button class="btn" id="tOk">Создать задания</button></div>`);
    m.el.classList.add('wide');
    $('#tAll', m.el).onchange = e => m.el.querySelectorAll('[data-t]').forEach(c => c.checked = e.target.checked);
    $('#tX', m.el).onclick = m.close;
    $('#tOk', m.el).onclick = async () => {
      let n = 0;
      for (const cb of m.el.querySelectorAll('[data-t]')) { if (!cb.checked) continue; const i = +cb.dataset.t; await CRMLocal.request('POST', '/api/ag/tasks', { client: sug[i].s.c.name, kind: m.el.querySelector(`[data-k="${i}"]`).value, target: +m.el.querySelector(`[data-g="${i}"]`).value || 0, due: date, text: m.el.querySelector(`[data-x="${i}"]`).value }); n++; }
      await CRMLocal.flush(); m.close(); toast(`Создано заданий: ${n}`); redraw();
    };
  },

  // ---------- the agent's week: route day by day, plan vs fact ----------
  week(box, d, agent) {
    const f = UI.fmt0, R = ROUTE.of(agent), today = REP.today();
    const monday = UI.localDate(Date.parse(today + 'T12:00:00') - (ROUTE.wd(today) - 1) * 864e5);
    const weeks = [0, -7].map(off => UI.localDate(Date.parse(monday + 'T12:00:00') + off * 864e5));
    const rows = wk => [1, 2, 3, 4, 5, 6].map(w => {
      const date = UI.localDate(Date.parse(wk + 'T12:00:00') + (w - 1) * 864e5), names = R.days[w].clients, fact = date <= d.upload.taken_at ? ROUTE.dayFact(date) : null;
      const by = new Map(d.clients.map(c => [c.name, c]));
      const plan = names.reduce((a, n) => a + Math.max(0, (by.get(n)?.pool || 0) - (by.get(n)?.paid || 0)), 0);
      let pts = 0, paid = 0, sold = 0, allPaid = 0;
      if (fact) { for (const n of names) { const x = fact.map.get(n); if (x && x.paid > 0.5) { pts++; paid += x.paid; } if (x && x.sold > 0.5) sold += x.sold; } for (const [cl, x] of fact.map) if (by.get(cl)?.agent === agent && x.paid > 0) allPaid += x.paid; }
      return { w, date, zone: R.days[w].zone, n: names.length, plan, fact, pts, paid, sold, allPaid };
    });
    box.innerHTML = weeks.map((wk, k) => { const list = rows(wk); return UI.panel(k ? 'Прошлая неделя' : 'Эта неделя', `<div class="scroll" style="max-height:none"><table><thead><tr><th>День</th><th>Зона</th><th class="n">Точек</th><th class="n">Остаток к сбору</th><th class="n">Точек с оплатой</th><th class="n">Собрано на маршруте</th><th class="n">Продано на маршруте</th><th class="n">Собрано всего за день</th></tr></thead><tbody>${list.map(r => `<tr><td>${ROUTE.SHORT[r.w]} ${UI.dm(r.date)}${r.date === today ? ' <span class="pill info">сегодня</span>' : ''}</td><td>${esc(r.zone || '')}</td><td class="n">${r.n}</td><td class="n">${f(r.plan)}</td><td class="n">${r.fact && !r.fact.partial ? `${r.pts} из ${r.n}` : '<span class="mut">—</span>'}</td><td class="n">${r.fact && !r.fact.partial ? `<b>${f(r.paid)}</b>` : '<span class="mut">—</span>'}</td><td class="n">${r.fact && !r.fact.partial ? f(r.sold) : '<span class="mut">—</span>'}</td><td class="n">${r.fact && !r.fact.partial ? f(r.allPaid) : '<span class="mut">—</span>'}</td></tr>`).join('')}</tbody></table></div>`, { cls: 'w12', sub: `${UI.dateRu(wk)} — ${UI.dateRu(UI.localDate(Date.parse(wk + 'T12:00:00') + 5 * 864e5))}` }); }).join('') +
      '<p class="mut">Факт по дням появляется, когда баланс загружен и в этот день, и в предыдущий. «Собрано всего» — все оплаты клиентов агента в этот день, включая клиентов не из маршрута дня. «Остаток к сбору» — на сегодня.</p>';
  },
};
