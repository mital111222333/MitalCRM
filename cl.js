// Агенты → Клиенты и долги: the plan (План — sales, Пул — money to collect) is edited like in Excel —
// arrows / Enter / Tab move between cells, a block copied from Excel is pasted in one go, Ctrl+D fills down —
// and a whole plan file can be uploaded here for the current plan period.
window.EXT_PAGES = window.EXT_PAGES || {};

let clState = { q: '', agent: '', status: '', sort: 'b1', dir: 1 };
const CL_EDIT = ['plan', 'pool', 'note']; // editable columns, left to right

EXT_PAGES.aclients = async el => {
  const d = await agLoad(), body = agShell(el, 'aclients', d);
  if (d.empty) return agEmpty(body);
  const S = clState, agents = [...new Set(d.clients.map(c => c.agent))].sort((a, b) => a.localeCompare(b));
  const per = d.upload.period_from, perEnd = d.forecast.period_end || d.upload.period_to;
  const STAT = { '': 'Все клиенты', plan: 'С планом или пулом', noplan: 'Без плана и пула', active: 'АКБ (активные)', idle: 'Неактивные', debt: 'Должники', idledebt: 'Должники без покупок', noagent: 'Без агента' };
  body.innerHTML = `<div class="bar"><input type="search" id="q" placeholder="Поиск клиента" style="flex:1;min-width:200px" value="${esc(S.q)}"><select id="ag"><option value="">Все агенты</option>${agents.map(a => `<option ${a === S.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    <select id="st">${Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === S.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="planbar">
      <div><b>План на период ${UI.dm(per)}–${UI.dm(perEnd)}</b><div class="mut" id="planSum"></div></div>
      <span class="spacer"></span>
      <button class="btn needs-edit" id="plUp">⬆ Загрузить план из Excel</button><input type="file" id="plFile" accept=".xlsx,.csv" hidden>
      <button class="btn gray" id="plTpl">⬇ Шаблон / выгрузить в Excel</button>
    </div>
    <div class="bar needs-edit" id="bulk" hidden><b id="bcnt"></b><select id="bag">${agents.filter(a => a !== 'Без агента').map(a => `<option>${esc(a)}</option>`).join('')}</select><button class="btn sm" id="bgo">Назначить агента выбранным</button></div>
    <p class="mut" id="sum" style="margin:0 2px 10px"></p>
    <div class="scroll xl"><table id="ct" class="xltable"></table></div>
    <p class="mut" style="margin:10px 2px">Ввод как в Excel: <b>Enter</b> или <b>↓</b> — ячейка ниже, <b>↑</b> — выше, <b>Tab</b> — вправо, <b>Esc</b> — отменить. Можно скопировать столбец или блок из Excel и вставить (<b>Ctrl+V</b>) — значения разойдутся по строкам. <b>Ctrl+D</b> — скопировать значение из ячейки выше. Всё сохраняется сразу. План и Пул — на текущий период плана, в долларах.</p>`;

  let list = [];
  const selected = new Set();
  const COLS = [['name', 'Клиент', 'l'], ['agent', 'Агент', 'l'], ['b0', 'Начало'], ['sold', 'Продано'], ['ret', 'Возврат'], ['paid', 'Оплачено'], ['b1', 'Баланс'], ['plan', 'План, $'], ['pool', 'Пул, $'], ['done', 'Выполнение'], ['note', 'Заметки', 'l']];
  const pctTxt = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '');
  const tone = (a, b) => (b > 0 ? (a / b >= 1 ? 'good' : agPace(d) !== null && a / b < agPace(d) * 0.6 ? 'crit' : a / b < (agPace(d) ?? 0.6) * 0.9 ? 'warn' : 'info') : '');
  const doneCell = c => `${c.plan > 0 ? `<span class="pill ${tone(c.sold, c.plan)}" title="Продано от плана">П ${pctTxt(c.sold, c.plan)}</span>` : ''} ${c.pool > 0 ? `<span class="pill ${tone(c.paid, c.pool)}" title="Оплачено от пула">С ${pctTxt(c.paid, c.pool)}</span>` : ''}`;

  const sums = () => {
    const sp = list.reduce((a, c) => a + (c.plan || 0), 0), sl = list.reduce((a, c) => a + (c.pool || 0), 0);
    const sold = list.filter(c => c.plan > 0).reduce((a, c) => a + c.sold, 0), paid = list.filter(c => c.pool > 0).reduce((a, c) => a + c.paid, 0);
    $('#planSum', body).innerHTML = `Продажи: <b>$${UI.fmt0(sp)}</b> у ${list.filter(c => c.plan > 0).length} кл.${sp ? ` · выполнено ${pctTxt(sold, sp)}` : ''} &nbsp;·&nbsp; Сбор денег: <b>$${UI.fmt0(sl)}</b> у ${list.filter(c => c.pool > 0).length} кл.${sl ? ` · собрано ${pctTxt(paid, sl)}` : ''}${S.agent || S.q || S.status ? ' <span class="mut">(по показанным клиентам)</span>' : ''}`;
    const f = $('#ct tfoot', body);
    if (f) f.innerHTML = `<tr><td class="needs-edit"></td><td><b>Итого (${list.length})</b></td><td></td><td class="n">${UI.fmt0(list.reduce((a, c) => a + c.b0, 0))}</td><td class="n"><b>${UI.fmt0(list.reduce((a, c) => a + c.sold, 0))}</b></td><td class="n">${UI.fmt0(list.reduce((a, c) => a + c.ret, 0))}</td><td class="n"><b>${UI.fmt0(list.reduce((a, c) => a + c.paid, 0))}</b></td><td class="n">${UI.fmt0(list.reduce((a, c) => a + c.b1, 0))}</td><td class="n"><b>${UI.fmt0(sp)}</b></td><td class="n"><b>${UI.fmt0(sl)}</b></td><td></td><td></td><td></td></tr>`;
  };

  const draw = () => {
    S.q = $('#q', body).value; S.agent = $('#ag', body).value; S.status = $('#st', body).value;
    const q = S.q.toLowerCase();
    list = d.clients.filter(c => (!q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)) && (!S.agent || c.agent === S.agent) && (!S.status || (S.status === 'active' ? c.active : S.status === 'idle' ? !c.active : S.status === 'debt' ? c.b1 < 0 : S.status === 'idledebt' ? c.b1 < 0 && c.sold <= 0 : S.status === 'noagent' ? c.agent === 'Без агента' : S.status === 'noplan' ? !(c.plan > 0) && !(c.pool > 0) : c.plan > 0 || c.pool > 0)));
    const key = S.sort === 'done' ? (c => (c.plan > 0 ? c.sold / c.plan : -1)) : (c => c[S.sort]);
    list.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0)) * S.dir; });
    $('#sum', body).innerHTML = `Показано <b>${list.length}</b> из ${d.clients.length} · долг: <b class="neg">$${UI.fmt0(list.reduce((s, c) => s + (c.b1 < 0 ? -c.b1 : 0), 0))}</b> · продано: <b>$${UI.fmt0(list.reduce((s, c) => s + c.sold, 0))}</b> · оплачено: <b>$${UI.fmt0(list.reduce((s, c) => s + c.paid, 0))}</b>`;
    const cell = (c, i, f) => f === 'note'
      ? `<td class="xc"><input class="xi txt" data-f="note" data-i="${i}" value="${esc(c.note || '')}" aria-label="Заметка: ${esc(c.name)}"></td>`
      : `<td class="xc n"><input class="xi" inputmode="decimal" data-f="${f}" data-i="${i}" value="${c[f] ? Math.round(c[f] * 100) / 100 : ''}" aria-label="${f === 'plan' ? 'План' : 'Пул'}: ${esc(c.name)}"></td>`;
    $('#ct', body).innerHTML = `<thead><tr><th class="needs-edit"><input type="checkbox" id="all" aria-label="Выбрать всех"></th>${COLS.map(([k, t, cl]) => `<th class="sort ${cl === 'l' ? '' : 'n'} ${CL_EDIT.includes(k) ? 'xlh' : ''}" data-s="${k}">${t}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th>Статус</th></tr></thead>
      <tbody>${list.length ? list.map((c, i) => `<tr data-row="${i}"><td class="needs-edit"><input type="checkbox" data-sel="${i}" ${selected.has(c.name) ? 'checked' : ''} aria-label="Выбрать"></td><td style="min-width:200px">${esc(c.name)}${c.landmark || c.phone ? `<br><small>${esc([c.landmark, c.phone].filter(Boolean).join(' · '))}</small>` : ''}</td><td><select data-ag="${i}" style="max-width:160px" aria-label="Агент">${[...new Set([...agents, c.agent])].map(a => `<option ${a === c.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></td><td class="n">${UI.fmt0(c.b0)}</td><td class="n">${UI.fmt0(c.sold)}</td><td class="n">${UI.fmt0(c.ret)}</td><td class="n">${UI.fmt0(c.paid)}${c.d_paid ? `<br><small class="pos">${UI.sign(c.d_paid)}</small>` : ''}</td><td class="n ${c.b1 < 0 ? 'neg' : ''}">${UI.fmt0(c.b1)}</td>${cell(c, i, 'plan')}${cell(c, i, 'pool')}<td class="n" data-done="${i}">${doneCell(c)}</td>${cell(c, i, 'note')}<td>${c.active ? UI.pill('good', 'АКБ', '✓') : UI.pill('muted', 'неактивен')}</td></tr>`).join('') : `<tr><td colspan="${COLS.length + 2}" class="empty">Ничего не найдено</td></tr>`}</tbody><tfoot></tfoot>`;
    sums();
    body.querySelectorAll('[data-s]').forEach(th => th.onclick = () => { const k = th.dataset.s; S.dir = S.sort === k ? -S.dir : (k === 'name' || k === 'agent' || k === 'note' ? 1 : -1); S.sort = k; draw(); });
    body.querySelectorAll('select[data-ag]').forEach(s => s.onchange = async () => { const c = list[+s.dataset.ag], r = await api('/api/ag/client', { method: 'POST', body: { name: c.name, agent: s.value } }); if (r.error) { toast(r.error); s.value = c.agent; } else { c.agent = s.value; toast('Агент изменён'); } });
    const sync = () => { $('#bulk', body).hidden = !selected.size; $('#bcnt', body).textContent = `Выбрано: ${selected.size}`; };
    body.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => { const c = list[+cb.dataset.sel]; cb.checked ? selected.add(c.name) : selected.delete(c.name); sync(); });
    const all = $('#all', body); if (all) all.onchange = () => { list.forEach(c => (all.checked ? selected.add(c.name) : selected.delete(c.name))); draw(); sync(); };
    sync();
  };

  // ---------- Excel-like editing ----------
  const parseNum = v => { const s = String(v ?? '').replace(/\s| |\$/g, '').replace(',', '.'); if (!s) return 0; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : NaN; };
  const inputAt = (i, f) => body.querySelector(`input.xi[data-i="${i}"][data-f="${f}"]`);
  async function save(inp, raw, { quiet = false } = {}) {
    const c = list[+inp.dataset.i], f = inp.dataset.f;
    const v = f === 'note' ? String(raw).trim() : parseNum(raw);
    if (f !== 'note' && Number.isNaN(v)) { inp.classList.add('bad'); toast('Нужно число не меньше 0'); inp.value = c[f] || ''; setTimeout(() => inp.classList.remove('bad'), 1200); return false; }
    if ((f === 'note' ? (c.note || '') : (c[f] || 0)) === v) { inp.value = f === 'note' ? v : (v || ''); return true; }
    const r = await api('/api/ag/client', { method: 'POST', body: { name: c.name, [f]: v } });
    if (r.error) { toast(r.error); inp.value = c[f] || ''; return false; }
    c[f] = v; inp.value = f === 'note' ? v : (v ? Math.round(v * 100) / 100 : '');
    inp.classList.add('ok'); setTimeout(() => inp.classList.remove('ok'), 700);
    const dc = body.querySelector(`[data-done="${inp.dataset.i}"]`); if (dc) dc.innerHTML = doneCell(c);
    if (!quiet) sums();
    return true;
  }
  const move = (inp, di, dc) => {
    const i = +inp.dataset.i + di, col = CL_EDIT.indexOf(inp.dataset.f) + dc;
    const next = col >= 0 && col < CL_EDIT.length ? inputAt(i, CL_EDIT[col]) : null;
    if (next) { next.focus(); next.select(); }
  };
  body.addEventListener('focusin', e => { const t = e.target; if (!t.classList?.contains('xi')) return; t.dataset.orig = t.value; t.closest('tr')?.classList.add('xrow'); });
  body.addEventListener('focusout', e => {
    const t = e.target; if (!t.classList?.contains('xi')) return;
    t.closest('tr')?.classList.remove('xrow');
    if (t.value !== t.dataset.orig) save(t, t.value);
  });
  body.addEventListener('keydown', e => {
    const t = e.target; if (!t.classList?.contains('xi')) return;
    const atStart = t.selectionStart === 0 && t.selectionEnd === 0, atEnd = t.selectionStart === t.value.length;
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); move(t, e.shiftKey && e.key === 'Enter' ? -1 : 1, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(t, -1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); move(t, 0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'ArrowRight' && (atEnd || t.selectionStart !== t.selectionEnd && t.selectionEnd === t.value.length)) { e.preventDefault(); move(t, 0, 1); }
    else if (e.key === 'ArrowLeft' && (atStart || t.selectionStart === 0 && t.selectionEnd === t.value.length)) { e.preventDefault(); move(t, 0, -1); }
    else if (e.key === 'Escape') { t.value = t.dataset.orig ?? t.value; t.blur(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'в')) { e.preventDefault(); const up = inputAt(+t.dataset.i - 1, t.dataset.f); if (up) { t.value = up.value; save(t, t.value); t.dataset.orig = t.value; } }
  });
  // paste a column or a block copied from Excel
  body.addEventListener('paste', async e => {
    const t = e.target; if (!t.classList?.contains('xi')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // a single value: normal paste
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'));
    const i0 = +t.dataset.i, c0 = CL_EDIT.indexOf(t.dataset.f); let n = 0, bad = 0;
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < rows[r].length; k++) {
      const f = CL_EDIT[c0 + k], inp = f && inputAt(i0 + r, f); if (!inp) continue;
      if (f !== 'note' && Number.isNaN(parseNum(rows[r][k]))) { bad++; continue; }
      if (await save(inp, rows[r][k], { quiet: true })) n++;
    }
    sums(); toast(`Вставлено значений: ${n}${bad ? ` · пропущено нечисловых: ${bad}` : ''}`);
  });

  ['q', 'ag', 'st'].forEach(id => $('#' + id, body).addEventListener('input', draw));
  $('#bgo', body).onclick = async () => { const r = await api('/api/ag/clients/bulk', { method: 'POST', body: { names: [...selected], agent: $('#bag', body).value } }); if (r.error) return toast(r.error); toast(`Назначено клиентов: ${r.updated}`); route(); };

  // plan file for the current period
  const file = $('#plFile', body);
  $('#plUp', body).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    if (!confirm(`Загрузить план из «${f.name}» на период ${UI.dateRu(per)} — ${UI.dateRu(perEnd)}?\nТекущий план этого периода будет заменён планом из файла.`)) return;
    const r = await UI.rawUpload(`/api/ag/plan?period=${per}&file=${encodeURIComponent(f.name)}`, f);
    if (r.error) return toast(r.error);
    const x = CRMLocal.ext(); (x.clientPlansMeta ||= {})[per] = { at: new Date().toISOString(), file: f.name }; CRMLocal.touch();
    alert(`План загружен.\nПродажи: $${UI.fmt0(r.plan)} у ${r.with_plan} клиентов\nСбор денег: $${UI.fmt0(r.pool)} у ${r.with_pool} клиентов${r.missing_count ? `\n\nНе найдено в CRM (${r.missing_count}): ${r.missing.slice(0, 15).join(', ')}${r.missing_count > 15 ? '…' : ''}` : ''}`);
    route();
  };
  $('#plTpl', body).onclick = () => UI.csv(`план-${per}.csv`, [['№', 'Клиент', 'Агент (справка)', 'План', 'Пул', 'Продано', 'Оплачено', 'Баланс', 'Заметки'], ...list.map(c => [c.num ?? '', c.name, c.agent, c.plan || '', c.pool || '', Math.round(c.sold), Math.round(c.paid), Math.round(c.b1), c.note || ''])]);
  draw();
};
