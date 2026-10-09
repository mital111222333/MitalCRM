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
