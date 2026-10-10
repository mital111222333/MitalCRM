// Quick upload: one screen for the files that are uploaded several times a day — the LINKO «Баланс клиентов» export
// and the stock of each warehouse. Today's date and the current plan period are filled in automatically;
// a repeated upload on the same day replaces the earlier one, so "за день" always compares with the previous day.
window.EXT_PAGES = window.EXT_PAGES || {};

// plan period: from the plan start day (1 = calendar month, 16 = 16.09–15.10, …) to the day before it next month
const PLAN = {
  day() {
    const x = CRMLocal.ext();
    if (x.planDay >= 1 && x.planDay <= 28) return x.planDay;
    const last = CRMLocal.engine.getState().ag.uploads.slice().sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0];
    return last ? +last.period_from.slice(8, 10) || 1 : 1;
  },
  // start of the plan period that contains `date`
  from(date, day = PLAN.day()) {
    let y = +date.slice(0, 4), m = +date.slice(5, 7);
    if (+date.slice(8, 10) < day) { m--; if (!m) { m = 12; y--; } }
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
  end(from) {
    const y = +from.slice(0, 4), m = +from.slice(5, 7), d = +from.slice(8, 10), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const x = new Date(Date.UTC(y, m, Math.min(d, dim))); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10);
  },
  label(from) { return from.endsWith('-01') ? REP.month(from) : `${UI.dm(from)}–${UI.dm(PLAN.end(from))}.${PLAN.end(from).slice(0, 4)}`; },
};
// date in the file name (LINKO: "balance - 2026-10-09T083731.536.xlsx"), otherwise today
const upFileDate = f => { const m = f.name.match(/(\d{4}-\d{2}-\d{2})/); const t = UI.localDate(Date.now()); return m && m[1] <= t ? m[1] : t; };

EXT_PAGES.up = async el => {
  await CRMLocal.ready;
  const S = CRMLocal.engine.getState(), t0 = UI.localDate(Date.now()), day = PLAN.day(), from = PLAN.from(t0, day);
  const whs = S.wh.list.slice().sort((a, b) => a.pos - b.pos);
  const lastAg = S.ag.uploads.slice().sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''))[0];
  const lastWh = n => S.wh.uploads.filter(u => u.warehouse === n).sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''))[0];
  const when = u => (u ? `последняя: ${UI.dateRu(u.taken_at)}${u.uploaded_at ? ', загружено ' + new Date(u.uploaded_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}` : 'ещё не загружали');
  el.innerHTML = `<div class="page-head"><div><h2>Загрузить данные</h2><div class="sub">Сегодня ${UI.dateRu(t0)} · просто перетащите файл в нужный блок (или нажмите на него) — дата и период подставятся сами. Повторная загрузка за день заменяет предыдущую.</div></div></div>
  <div class="grid">
    ${UI.panel('⚡ Из LINKO одной кнопкой', `<div id="lkBox"><p style="margin-top:0">Перетащите эту кнопку мышкой на <b>панель закладок</b> браузера (под адресной строкой):</p>
      <p><a class="btn bookmarklet" id="lkLink" href="#" title="Перетащите на панель закладок">⚡ В MITAL CRM</a></p>
      <p class="mut" style="margin-bottom:0">Дальше: откройте LINKO, войдите и нажмите эту закладку. CRM откроется сама, возьмёт баланс клиентов с ${UI.dateRu(from)} по сегодня и остатки всех складов и загрузит их — без скачивания файлов. Работает на компьютере.</p></div><div id="lkMsg" role="status" style="margin-top:8px"></div>
      <div class="bar" style="margin:10px 0 0"><button class="btn gray" id="lkProbe">🔍 Проверить, какие ещё данные есть в LINKO</button><span id="lkProbeMsg" class="mut"></span></div><div id="lkProbeRes"></div>`, { cls: 'w12', sub: 'Один раз поставить закладку — дальше обновление данных одним нажатием' })}
    ${UI.panel('⚡ Всё сразу', `<div class="dz big" id="upAll" tabindex="0" role="button"><b>Перетащите сюда все файлы из LINKO разом</b>баланс и остатки складов — CRM сама поймёт, где какой файл (или нажмите, чтобы выбрать несколько)</div><div id="upAllMsg" role="status" style="margin-top:10px"></div>`, { cls: 'w12', sub: 'Самый быстрый способ: выделите в папке «Загрузки» все скачанные файлы и перетащите их сюда' })}
    ${UI.panel('💰 Баланс клиентов', `<p class="mut" style="margin-top:0">Выгрузка из LINKO: продажи, оплаты, возвраты и долги по каждому клиенту.</p>
      <div class="dz" id="upAg" tabindex="0" role="button"><b>Файл «balance…»</b>перетащите или нажмите</div>
      <div class="form" style="margin-top:12px"><label>Период плана начинается с числа<select id="upDay">${Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option ${n === day ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Текущий период<input value="${UI.dateRu(from)} — ${UI.dateRu(PLAN.end(from))}" disabled></label></div>
      <p class="mut" style="margin-bottom:0">Выгружайте из LINKO баланс <b>с ${UI.dateRu(from)} по сегодня</b>. ${when(lastAg)}</p>
      <div id="upAgMsg" role="status" style="margin-top:8px"></div>`, { cls: 'w12' })}
    ${(() => {
      const next = PLAN.from(UI.localDate(Date.parse(PLAN.end(from) + 'T12:00:00') + 864e5), day), meta = CRMLocal.ext().clientPlansMeta || {}, CP = CRMLocal.ext().clientPlans || {};
      const info = per => { const P = CP[per]; if (!P) return 'план ещё не загружен'; const v = Object.values(P); return `загружен${meta[per] ? ' ' + new Date(meta[per].at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}: продажи $${UI.fmt0(v.reduce((a, e) => a + e.plan, 0))} (${v.filter(e => e.plan > 0).length} кл.), сбор $${UI.fmt0(v.reduce((a, e) => a + e.pool, 0))} (${v.filter(e => e.pool > 0).length} кл.)`; };
      return UI.panel('🎯 План по клиентам на период', `<p class="mut" style="margin-top:0">Файл с колонками <b>№, Клиент, Агент, План, Пул</b> (план продаж и план сбора денег в $). Загружайте 16-го числа на новый период — дальше отчёты сравнивают оплаты и продажи с этим планом. Повторная загрузка на тот же период заменяет план.</p>
        <div class="form"><label>План на период<select id="upPer"><option value="${from}">${UI.dateRu(from)} — ${UI.dateRu(PLAN.end(from))} (текущий)</option><option value="${next}">${UI.dateRu(next)} — ${UI.dateRu(PLAN.end(next))} (следующий)</option></select></label>
        <label>Шаблон<button class="btn gray" id="upTpl" type="button">⬇ Скачать шаблон с клиентами</button></label></div>
        <div class="dz sm" id="upPlan" tabindex="0" role="button" style="margin-top:12px"><b>Файл плана</b>перетащите или нажмите</div>
        <p class="mut" style="margin-bottom:0" id="upPlanInfo">Текущий период: ${info(from)}.</p><div id="upPlanMsg" role="status" style="margin-top:8px"></div>`, { cls: 'w12' });
    })()}
    ${whs.map((w, i) => UI.panel('📦 Склад ' + esc(w.name), `<div class="dz sm" data-wh="${i}" tabindex="0" role="button"><b>Остатки ${esc(w.name)}</b>перетащите или нажмите</div>
      <p class="mut" style="margin-bottom:0">${when(lastWh(w.name))}</p><div data-whmsg="${i}" role="status" style="margin-top:8px"></div>`, { cls: 'w4' })).join('')}
    ${UI.panel('Что дальше', `<div class="bar" style="margin:0"><a class="btn" href="#/rday">Отчёт дня</a><a class="btn gray" href="#/rdebt">Дебиторка</a><a class="btn gray" href="#/whlow">Что заканчивается на складе</a><a class="btn gray" href="#/ai">Спросить ИИ</a><a class="btn gray" href="#/tg">Отправить агентам</a></div>`, { cls: 'w12' })}
  </div>`;

  $('#upDay', el).onchange = e => { CRMLocal.ext().planDay = +e.target.value; CRMLocal.touch(); EXT_PAGES.up(el); };
  const show = (box, ok, html) => { box.className = ok ? 'pos' : 'neg'; box.innerHTML = html; };
  UI.bindDrop($('#upAg', el), async files => {
    const box = $('#upAgMsg', el);
    for (const f of files) {
      const date = upFileDate(f), pf = PLAN.from(date, day);
      box.className = 'mut'; box.textContent = `Загружаю ${f.name}…`;
      try {
        const d = await UI.rawUpload(`/api/ag/upload?file=${encodeURIComponent(f.name)}&date=${date}&from=${pf}&to=${date}`, f);
        if (d.error) { show(box, false, '✕ ' + esc(d.error)); continue; }
        show(box, true, `✓ ${f.name}: ${d.clients} клиентов на ${UI.dateRu(date)}, период ${UI.dateRu(pf)}–${UI.dateRu(date)}${d.created ? ` · новых клиентов ${d.created}` : ''}${d.agent_changes ? ` · сменился агент у ${d.agent_changes}` : ''}${d.replaced ? ' · заменила загрузку за этот день' : ''}. <a href="#/rday">Открыть отчёт дня →</a>`);
      } catch (e) { show(box, false, '✕ ' + esc(e.message)); }
    }
  });
  const perSel = $('#upPer', el);
  perSel.onchange = () => { const P = (CRMLocal.ext().clientPlans || {})[perSel.value]; $('#upPlanInfo', el).textContent = P ? `На этот период план уже загружен: ${Object.keys(P).length} клиентов. Новая загрузка его заменит.` : 'На этот период план ещё не загружен.'; };
  $('#upTpl', el).onclick = () => {
    const per = perSel.value, P = (CRMLocal.ext().clientPlans || {})[per] || {}, cl = Object.values(S.ag.clients).sort((a, b) => (a.agent || '').localeCompare(b.agent || '') || a.name.localeCompare(b.name));
    UI.csv(`план-${per}.csv`, [['№', 'Клиент', 'Агент (справка)', 'План', 'Пул'], ...cl.map(c => [c.num ?? '', c.name, c.agent || '', P[c.name]?.plan || '', P[c.name]?.pool || ''])]);
  };
  UI.bindDrop($('#upPlan', el), async files => {
    const box = $('#upPlanMsg', el), f = files[0], per = perSel.value;
    box.className = 'mut'; box.textContent = 'Загружаю план…';
    try {
      const d = await UI.rawUpload(`/api/ag/plan?period=${per}&file=${encodeURIComponent(f.name)}`, f);
      if (d.error) return show(box, false, '✕ ' + esc(d.error));
      const x = CRMLocal.ext(); (x.clientPlansMeta ||= {})[per] = { at: new Date().toISOString(), file: f.name }; CRMLocal.touch();
      show(box, true, `✓ План на ${UI.dateRu(per)} — ${UI.dateRu(PLAN.end(per))} загружен: продажи <b>$${UI.fmt0(d.plan)}</b> у ${d.with_plan} клиентов, сбор денег <b>$${UI.fmt0(d.pool)}</b> у ${d.with_pool} клиентов${d.replaced ? ' (прежний план на этот период заменён)' : ''}${d.cleared_agent_plans ? '. Планы агентов, введённые вручную, заменены планом по клиентам' : ''}.`
        + (d.missing_count ? `<br><span class="neg">Не найдено в CRM ${d.missing_count} клиентов с планом — их план не учтён. Проверьте номер (№) и название, или сначала загрузите свежий баланс: ${d.missing.slice(0, 10).map(esc).join(', ')}${d.missing_count > 10 ? '…' : ''}</span>` : '')
        + ` <a href="#/leaders">Открыть лидерборд →</a>`);
    } catch (e) { show(box, false, '✕ ' + esc(e.message)); }
  });
  UI.bindDrop($('#upAll', el), files => UPALL.run(files, $('#upAllMsg', el), day));
  LINKO.link().then(href => { const a = $('#lkLink', el); if (a) { a.href = href; a.onclick = e => { e.preventDefault(); toast('Не нажимайте здесь — перетащите кнопку на панель закладок, а нажимайте её на странице LINKO'); }; } });
  if (LINKO.pending) LINKO.show();
  const pb = $('#lkProbe', el), pm = $('#lkProbeMsg', el);
  const probeOn = () => { try { return !!localStorage.getItem('crm_linko_probe'); } catch { return false; } };
  if (probeOn()) pm.textContent = 'Включено: теперь откройте LINKO и нажмите закладку «⚡ В MITAL CRM».';
  pb.onclick = () => { try { localStorage.setItem('crm_linko_probe', '1'); } catch { /* ignore */ } pm.innerHTML = '<b>Включено.</b> Теперь откройте LINKO и нажмите закладку «⚡ В MITAL CRM». Проверка займёт 1–3 минуты.'; };
  LINKO.probeView($('#lkProbeRes', el));
  el.querySelectorAll('[data-wh]').forEach(z => UI.bindDrop(z, async files => {
    const w = whs[+z.dataset.wh], box = el.querySelector(`[data-whmsg="${z.dataset.wh}"]`), f = files[0], date = upFileDate(f);
    box.className = 'mut'; box.textContent = 'Загружаю…';
    try {
      const d = await UI.rawUpload(`/api/wh/upload?warehouse=${encodeURIComponent(w.name)}&date=${date}&file=${encodeURIComponent(f.name)}`, f);
      if (d.error) return show(box, false, '✕ ' + esc(d.error));
      show(box, true, `✓ ${d.items} товаров, ${UI.fmt0(d.total)} шт. (доступно ${UI.fmt0(d.available)})${d.diff ? ` · с ${UI.dm(d.diff.prev_date)}: +${UI.fmt0(d.diff.in)} / −${UI.fmt0(d.diff.out)}` : ''}${d.replaced ? ' · заменила загрузку за сегодня' : ''}`);
    } catch (e) { show(box, false, '✕ ' + esc(e.message)); }
  }));
};

// ---------- «Всё сразу»: recognise every file (balance / stock of which warehouse / plan) and load them in one go ----------
const UPALL = {
  async kind(file) {
    const sheets = await CRMEngine.readTableAsync(new Uint8Array(await file.arrayBuffer()), file.name);
    for (const sh of sheets) for (const row of sh.rows.slice(0, 15)) {
      const h = (row || []).map(v => String(v ?? '').trim().toLowerCase());
      if (h.includes('клиент') && h.some(x => x.startsWith('продано')) && h.some(x => x.startsWith('баланс'))) return { type: 'balance' };
      if (h.some(x => x === 'продукт' || x === 'товар' || x === 'наименование') && h.some(x => x.startsWith('всего товаров') || x.startsWith('доступн'))) {
        const ci = h.findIndex(x => x === 'продукт' || x === 'товар' || x === 'наименование'), ai = h.findIndex(x => x === 'aртикул' || x === 'артикул'), ti = h.findIndex(x => x.startsWith('всего товаров'));
        const map = new Map(); for (const r of sh.rows.slice(sh.rows.indexOf(row) + 1)) { const name = String(r?.[ci] ?? '').trim(); if (!name) continue; map.set(String(r?.[ai] ?? '').trim() || name, Number(r?.[ti]) || 0); }
        return { type: 'stock', map };
      }
      if (h.includes('клиент') && (h.includes('план') || h.includes('пул'))) return { type: 'plan' };
    }
    return { type: 'unknown' };
  },
  // which warehouse a stock file belongs to: the one whose latest stock is closest to the file
  guessWh(map, used) {
    const S = CRMLocal.engine.getState(), res = [];
    for (const w of S.wh.list) {
      const last = S.wh.uploads.filter(u => u.warehouse === w.name).sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id))[0];
      if (!last) continue;
      let diff = 0, tot = 0; const prev = new Map(last.rows.map(r => [r.art, r.total]));
      for (const art of new Set([...map.keys(), ...prev.keys()])) { const a = map.get(art) || 0, b = prev.get(art) || 0; diff += Math.abs(a - b); tot += Math.max(a, b); }
      res.push({ wh: w.name, score: tot ? diff / tot : 1 });
    }
    res.sort((a, b) => a.score - b.score);
    const best = res.find(r => !used.has(r.wh));
    return best && best.score < 0.5 ? best.wh : null;
  },
  async run(files, box, day) {
    box.className = 'mut'; box.textContent = 'Читаю файлы…';
    const items = [];
    for (const f of files) { try { items.push({ f, ...(await UPALL.kind(f)) }); } catch (e) { items.push({ f, type: 'error', error: e.message }); } }
    const used = new Set(), whs = CRMLocal.engine.getState().wh.list.map(w => w.name);
    const BR = (CRMLocal.ext().linkoBranch ||= {}), brOf = it => (it.f.name.match(/branch (\d+)/) || [])[1];
    for (const it of items.filter(i => i.type === 'stock' && brOf(i) && whs.includes(BR[brOf(i)]))) { it.wh = BR[brOf(it)]; used.add(it.wh); }
    for (const it of items.filter(i => i.type === 'stock' && !i.wh)) { it.wh = UPALL.guessWh(it.map, used); if (it.wh) used.add(it.wh); }
    const unsure = items.filter(i => i.type === 'stock' && !i.wh);
    if (unsure.length) {
      const ok = await new Promise(res => {
        const m = modal(`<h3>Какой это склад?</h3><p class="mut" style="margin-top:0">В файле остатков нет названия склада. Выберите один раз — дальше CRM будет узнавать склад сама по остаткам.</p>
          ${unsure.map((it, i) => `<label style="display:block;margin:8px 0">${esc(it.f.name.replace(/^stock LINKO branch (\d+)\.csv$/, 'Склад LINKO № $1'))} <small class="mut">(${UI.fmt0([...it.map.values()].reduce((a, b) => a + b, 0))} шт.)</small><select data-u="${i}" style="display:block;width:100%;margin-top:4px">${whs.map(w => `<option ${used.has(w) ? '' : ''}>${esc(w)}</option>`).join('')}<option value="">— не загружать —</option></select></label>`).join('')}
          <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="uX">Отмена</button><button class="btn" id="uOk">Загрузить</button></div>`);
        const free = whs.filter(w => !used.has(w)); m.el.querySelectorAll('select[data-u]').forEach((s, i) => { if (free[i]) s.value = free[i]; });
        m.el.querySelector('#uX').onclick = () => { m.close(); res(false); };
        m.el.querySelector('#uOk').onclick = () => { m.el.querySelectorAll('select[data-u]').forEach(s => { unsure[+s.dataset.u].wh = s.value || null; }); m.close(); res(true); };
      });
      if (!ok) { box.textContent = 'Загрузка отменена'; return; }
    }
    for (const it of items) if (it.type === 'stock' && it.wh && brOf(it)) BR[brOf(it)] = it.wh;
    CRMLocal.touch();
    const lines = [];
    // balance first, then stock
    for (const it of items.sort((a, b) => (a.type === 'balance' ? -1 : 0) - (b.type === 'balance' ? -1 : 0))) {
      const date = upFileDate(it.f);
      try {
        if (it.type === 'balance') {
          const pf = PLAN.from(date, day), d = await UI.rawUpload(`/api/ag/upload?file=${encodeURIComponent(it.f.name)}&date=${date}&from=${pf}&to=${date}`, it.f);
          lines.push(d.error ? `✕ ${esc(it.f.name)}: ${esc(d.error)}` : `✓ Баланс: ${d.clients} клиентов на ${UI.dateRu(date)}${d.created ? `, новых ${d.created}` : ''}`);
        } else if (it.type === 'stock') {
          if (!it.wh) { lines.push(`— ${esc(it.f.name)}: пропущен`); continue; }
          const d = await UI.rawUpload(`/api/wh/upload?warehouse=${encodeURIComponent(it.wh)}&date=${date}&file=${encodeURIComponent(it.f.name)}`, it.f);
          lines.push(d.error ? `✕ ${esc(it.f.name)}: ${esc(d.error)}` : `✓ Склад ${esc(it.wh)}: ${d.items} товаров, ${UI.fmt0(d.total)} шт.`);
        } else if (it.type === 'plan') lines.push(`ℹ ${esc(it.f.name)} — это план. Загрузите его в блок «План по клиентам», чтобы выбрать период.`);
        else lines.push(`✕ ${esc(it.f.name)}: ${esc(it.error || 'не похоже ни на баланс, ни на остатки склада')}`);
      } catch (e) { lines.push(`✕ ${esc(it.f.name)}: ${esc(e.message)}`); }
    }
    box.className = ''; box.innerHTML = lines.map(l => `<div class="${l.startsWith('✓') ? 'pos' : l.startsWith('✕') ? 'neg' : 'mut'}">${l}</div>`).join('') + (lines.some(l => l.startsWith('✓')) ? '<div style="margin-top:8px"><a class="btn" href="#/rday">Открыть отчёт дня</a></div>' : '');
  },
};

// ---------- LINKO bookmark: answers the bookmark running on app.linko.uz and imports what it sends ----------
const LINKO = {
  ORIGIN: /^https:\/\/[a-z0-9-]+\.linko\.uz$/,
  pending: null,
  async link() {
    const src = await (await fetch('linko.js', { cache: 'no-cache' })).text();
    const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace('__CRM_URL__', location.origin + location.pathname);
    return 'javascript:' + encodeURIComponent(code);
  },
  // the list of LINKO sections found by the bookmark check: names, record counts and field names only
  probeText(p) {
    const ok = p.items.filter(x => x.status === 200 && x.fields);
    return 'LINKO — найдено разделов с данными: ' + ok.length + ' (проверено ' + p.items.length + ')\n'
      + ok.map(x => x.path + ' | ' + (x.count === '' ? '?' : x.count) + ' | ' + x.fields).join('\n')
      + '\n\nДругие ответы: ' + p.items.filter(x => x.status !== 200).map(x => x.path + ' ' + x.status).join(', ')
      + '\n\nАдреса, которые открывал LINKO: ' + (p.calls || []).join(', ');
  },
  probeView(box) {
    const p = CRMLocal.ext().linkoProbe; if (!box || !p) return;
    const ok = p.items.filter(x => x.status === 200 && x.fields);
    box.innerHTML = `<p style="margin:12px 0 6px">✓ Проверка LINKO ${new Date(p.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: найдено <b>${ok.length}</b> разделов с данными.
      Нажмите кнопку и вставьте текст в чат Claude (Ctrl+V) — там только названия разделов и полей, без цифр и ключей.</p>
      <div class="bar" style="margin:0"><button class="btn" id="lkProbeCopy">📋 Скопировать список для Claude</button></div>`;
    box.querySelector('#lkProbeCopy').onclick = async () => { const t = LINKO.probeText(p).replace(/[0-9a-f]{40}/gi, '***'); try { await navigator.clipboard.writeText(t); toast('Скопировано — вставьте в чат Claude'); } catch { const m = modal(`<h3>Скопируйте текст</h3><textarea style="width:100%;height:50vh;font:12px monospace">${esc(t)}</textarea><div class="bar"><span class="spacer"></span><button class="btn" id="cx">Закрыть</button></div>`); m.el.querySelector('textarea').select(); m.el.querySelector('#cx').onclick = m.close; } };
  },
  show(text, cls = 'mut') {
    if (text !== undefined) LINKO.pending = { text, cls };
    const box = document.getElementById('lkMsg'); if (box && LINKO.pending) { box.className = LINKO.pending.cls; box.textContent = LINKO.pending.text; }
  },
};
addEventListener('message', async e => {
  if (!LINKO.ORIGIN.test(e.origin) || !e.data || typeof e.data !== 'object') return;
  await CRMLocal.ready;
  const d = e.data;
  if (d.type === 'mital-hello') {
    const t = UI.localDate(Date.now());
    let probe = false; try { probe = !!localStorage.getItem('crm_linko_probe'); } catch { /* ignore */ }
    const from = PLAN.from(t); await LX.load(); LINKO.run = { from, to: t, at: new Date().toISOString() };
    e.source.postMessage({ type: 'mital-ready', from, to: t, probe, jobs: (d.v >= 3 ? LX.jobs : []).map(j => ({ id: j.id, title: j.title, path: LX.fill(j.path, from, t) })) }, e.origin);
    if (probe && !(d.v >= 3)) setTimeout(() => toast('Для проверки нужна новая закладка: удалите старую «⚡ В MITAL CRM» и перетащите новую с этой страницы'), 3000);
    if (location.hash !== '#/up') location.hash = '#/up';
    LINKO.show('Получаю данные из LINKO…');
  } else if (d.type === 'mital-probe' && Array.isArray(d.items)) {
    const clean = v => String(v == null ? '' : v).slice(0, 900);
    CRMLocal.ext().linkoProbe = { at: new Date().toISOString(), items: d.items.slice(0, 400).map(x => ({ path: clean(x.path), status: Number(x.status) || 0, count: x.count === '' ? '' : Number(x.count) || 0, fields: clean(x.fields) })), calls: (d.calls || []).slice(0, 200).map(clean) };
    CRMLocal.touch(); try { localStorage.removeItem('crm_linko_probe'); } catch { /* ignore */ }
    const pm = document.getElementById('lkProbeMsg'); if (pm) pm.textContent = '';
    LINKO.probeView(document.getElementById('lkProbeRes'));
  } else if (d.type === 'mital-data' && typeof d.id === 'string') {
    if (!Array.isArray(d.rows) || !LX.jobs.some(j => j.id === d.id)) return;
    const r = LINKO.run || { from: PLAN.from(UI.localDate(Date.now())), to: UI.localDate(Date.now()) };
    LX.put(d.id, d.rows.slice(0, 60000), { from: r.from, to: r.to, at: r.at, error: d.error || '', src: 'bookmark' });
    if (d.id === LX.jobs[LX.jobs.length - 1].id) toast('Данные LINKO обновлены: заказы, товары, оплаты, долги, работа агентов');
  } else if (d.type === 'mital-progress') {
    LINKO.show(d.text, d.text.startsWith('✕') ? 'neg' : 'mut');
  } else if (d.type === 'mital-import' && Array.isArray(d.files)) {
    const okKey = typeof d.key === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(d.key);
    try { if (okKey) { localStorage.setItem('crm_linko_key', d.key); localStorage.removeItem('crm_linko_oldbm'); } else localStorage.setItem('crm_linko_oldbm', '1'); } catch { /* ignore */ } // the key is kept on this device only, for the auto-loader script
    if (location.hash !== '#/up') { location.hash = '#/up'; await new Promise(r => setTimeout(r, 400)); }
    LINKO.show(`Загружаю: ${d.files.length} файл(а) из LINKO…`);
    const files = d.files.filter(f => f && f.name && f.data).map(f => new File([f.data], String(f.name).slice(0, 120)));
    const box = document.getElementById('upAllMsg') || document.getElementById('lkMsg');
    await UPALL.run(files, box, PLAN.day());
    LINKO.pending = null; const lk = document.getElementById('lkMsg'); if (lk) lk.textContent = '';
    try { window.focus(); } catch { /* ignore */ }
  }
});

// ---------- automatic loading: a Google Apps Script takes LINKO data every 5 minutes and leaves it in the data repository
// (linko-latest.json); whichever device opens the CRM first imports it — the phone needs nothing else ----------
window.LINKO_AUTO = {
  busy: false, lastTry: 0,
  // orders, products, payments, debts by age, agents' day… — written by the script every 30 minutes
  async extra() {
    let changed = false;
    const snap = await CLOUD.readJson('linko-extra.json').catch(() => null), cur = CRMLocal.ext().lx;
    if (snap && snap.at && snap.data && !(cur && cur.at >= snap.at)) { await LX.load(); changed = LX.importSnap(snap) || changed; }
    // payments: every 5 minutes, in their own file
    const fast = await CLOUD.readJson('linko-fast.json').catch(() => null), c2 = CRMLocal.ext().lx;
    if (fast && fast.at && fast.data && !(c2 && c2.from === fast.from && ((c2.fastAt && c2.fastAt >= fast.at) || c2.at >= fast.at))) { await LX.load(); changed = LX.importFast(fast) || changed; }
    if (changed && /^#\/lx/.test(location.hash) && !document.querySelector('.modal-bg') && typeof route === 'function') route();
  },
  async check() {
    if (LINKO_AUTO.busy || Date.now() - LINKO_AUTO.lastTry < 60000 || !window.CLOUD?.on()) return;
    LINKO_AUTO.lastTry = Date.now(); LINKO_AUTO.busy = true;
    try {
      const snap = await CLOUD.readJson('linko-latest.json'); if (!snap || !snap.at || !Array.isArray(snap.files)) return await LINKO_AUTO.extra();
      const x = CRMLocal.ext(); x.linkoAuto = { ...(x.linkoAuto || {}), seenAt: snap.at, error: snap.error || '' };
      if (snap.error || (x.linkoAuto.importedAt && x.linkoAuto.importedAt >= snap.at)) return await LINKO_AUTO.extra();
      const bin = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
      const files = snap.files.map(f => new File([bin(f.b64)], f.name));
      const box = document.createElement('div');
      await UPALL.run(files, box, PLAN.day());
      { const S = CRMLocal.engine.getState(), last = (S.ag.uploads || []).slice().sort((a, b) => b.id - a.id)[0]; if (last && Date.now() - Date.parse(last.uploaded_at || 0) < 10 * 60000) last.snap_at = snap.at; } // when LINKO gave this balance (for card payments by time)
      x.linkoAuto.importedAt = snap.at; x.linkoAuto.result = box.textContent.replace(/Открыть отчёт дня/, '').trim().slice(0, 300); CRMLocal.touch();
      if (box.textContent.includes('✓')) { toast(`Данные из LINKO обновлены (${new Date(snap.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`); const ae = document.activeElement, typing = ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable) || document.querySelector('.modal-bg, dialog[open]'); if (!typing && typeof route === 'function') route(); }
      await LINKO_AUTO.extra();
    } catch (e) { console.warn('LINKO auto', e); }
    finally { LINKO_AUTO.busy = false; }
  },
};
addEventListener('load', () => setTimeout(() => LINKO_AUTO.check(), 4000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => LINKO_AUTO.check(), 1500); });
setInterval(() => { if (document.visibilityState === 'visible') LINKO_AUTO.check(); }, 2 * 60000); // the script writes every 5 minutes; an open CRM picks it up within ~2 minutes
