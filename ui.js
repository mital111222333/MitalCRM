// Shared UI building blocks for the data sections (warehouse and agents).
// Uses globals from app.js at call time: api, token, branch, modal, toast, signOut, esc, can.
const UI = {
  fmt0: n => Math.round(Number(n) || 0).toLocaleString('ru-RU'),
  fmt1: n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('ru-RU'),
  sign: n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ru-RU'),
  pct: (a, b) => (b > 0 ? Math.round(a / b * 100) : null),
  dateRu: d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—'),
  dm: d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : ''),
  localDate: ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  plural: (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; },

  // up = good by default; pass inverse for "lower is better" (debt, returns)
  delta(v, { inverse = false, unit = '', title = 'К предыдущей загрузке', neutral = false } = {}) {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    if (Math.abs(v) < 0.5) return `<span class="delta flat" title="${title}">без изменений</span>`;
    const good = (v > 0) !== inverse;
    return `<span class="delta ${neutral ? 'flat' : good ? 'up' : 'down'}" title="${title}"><span aria-hidden="true">${v > 0 ? '▲' : '▼'}</span>${UI.sign(v).replace(/^[+−]/, '')}${unit}</span>`;
  },
  tile(label, value, { sub = '', delta = '', tone = '', spark = '', hero = false, hint = '' } = {}) {
    return `<div class="tile ${hero ? 'hero' : ''} ${tone ? 'tone-' + tone : ''}"${hint ? ` title="${esc(hint)}"` : ''}><div class="tl">${label}</div><div class="tv">${value}</div><div class="ts">${sub}</div>${delta || spark ? `<div class="tr">${delta}${spark}</div>` : ''}</div>`;
  },
  panel(title, body, { sub = '', cls = 'w12', tools = '' } = {}) {
    return `<section class="panel ${cls}"><div class="ph"><div><h4>${title}</h4>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="tools">${tools}${body.includes('class="tableview"') ? '<button class="twin" type="button" aria-pressed="false" title="Показать данные таблицей">Таблица</button>' : ''}</div></div>${body}</section>`;
  },
  pill(kind, text, icon = '') { return `<span class="pill ${kind}">${icon ? `<span aria-hidden="true">${icon}</span>` : ''}${esc(text)}</span>`; },
  csv(filename, rows) {
    const body = rows.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  empty(title, text, action = '') { return `<div class="empty-state"><h3>${title}</h3><p>${text}</p>${action}</div>`; },

  // drag & drop / click to choose, multiple files
  bindDrop(zone, onFiles) {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.xlsx,.csv,.txt'; input.hidden = true; zone.after(input);
    zone.onclick = () => input.click();
    zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('over'); }; zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); };
    input.onchange = () => { if (input.files.length) onFiles([...input.files]); input.value = ''; };
  },

  // POST a file body to the server (raw bytes); returns the parsed JSON (with .error on failure)
  async rawUpload(url, file) {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Branch': encodeURIComponent(branch), 'Content-Type': 'application/octet-stream' }, body: file });
    if (r.status === 401) { signOut(); throw new Error('auth'); }
    const d = await r.json().catch(() => ({ error: 'Сервер вернул неожиданный ответ' }));
    if (r.status === 403) toast(d.error || 'Недостаточно прав');
    return d;
  },

  // Generic multi-file upload dialog.
  // fields: [{key, label, type:'date'|'select', options?, value(file)->default}], url(file, vals) -> request URL,
  // summarize(result) -> text for the success line, onDone() called once the dialog closes after at least one success.
  uploadDialog({ title, intro, fields, url, summarize, onDone, files = [], batch = [] }) {
    const items = []; let done = 0, busy = false;
    const m = modal(`<h3>${title}</h3><p class="mut" style="margin:0 0 12px">${intro}</p>
      <div class="dz sm" id="udz" tabindex="0" role="button"><b>Перетащите файлы сюда</b>или нажмите, чтобы выбрать (можно сразу несколько)</div>
      ${batch.length ? `<div class="form">${batch.map(b => `<label>${b.label}<select data-b="${b.key}">${b.options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
      <div class="tscroll"><table class="upl" id="ulist"></table></div><div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="ux">Закрыть</button><button class="btn" id="ugo" disabled>Загрузить</button></div>`);
    m.el.classList.add('wide');
    const draw = () => {
      $('#ulist', m.el).innerHTML = items.length ? `<thead><tr><th>Файл</th>${fields.map(f => `<th>${f.label}</th>`).join('')}<th>Результат</th><th></th></tr></thead><tbody>${items.map((it, i) => `<tr><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(it.file.name)}">${esc(it.file.name)}</td>${fields.map(f => `<td>${f.type === 'select' ? `<select data-i="${i}" data-k="${f.key}" ${it.state ? 'disabled' : ''}>${f.options.map(o => `<option value="${esc(o)}" ${it.vals[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input type="date" data-i="${i}" data-k="${f.key}" value="${it.vals[f.key] || ''}" ${it.state ? 'disabled' : ''}>`}</td>`).join('')}<td class="${it.state === 'ok' ? 'ok' : it.state === 'err' ? 'err' : 'mut'}">${it.msg || ''}</td><td>${it.state ? '' : `<button class="btn gray sm" data-rm="${i}" aria-label="Убрать файл">×</button>`}</td></tr>`).join('')}</tbody>` : '';
      $('#ugo', m.el).disabled = busy || !items.some(i => !i.state);
      m.el.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { items[+el.dataset.i].vals[el.dataset.k] = el.value; });
      m.el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
    };
    const add = list => { for (const file of list) items.push({ file, vals: Object.fromEntries(fields.map(f => [f.key, f.value(file)])) }); draw(); };
    UI.bindDrop($('#udz', m.el), add);
    $('#ux', m.el).onclick = () => { m.close(); if (done) onDone(); };
    $('#ugo', m.el).onclick = async () => {
      busy = true; draw();
      const bv = Object.fromEntries([...m.el.querySelectorAll('[data-b]')].map(s => [s.dataset.b, s.value]));
      const order = items.filter(i => !i.state).sort((a, b) => String(a.vals.date || '').localeCompare(String(b.vals.date || ''))); // oldest first: "changes since previous" stay correct
      for (const it of order) {
        it.msg = 'загрузка…'; draw();
        try {
          const d = await UI.rawUpload(url(it.file, { ...bv, ...it.vals }), it.file);
          if (d.error) { it.state = 'err'; it.msg = '✕ ' + esc(d.error); } else { it.state = 'ok'; it.msg = '✓ ' + summarize(d); done++; }
        } catch (e) {
          it.state = 'err';
          it.msg = e.message === 'auth' ? '✕ Сессия истекла: войдите заново и повторите' : '✕ Нет связи с сервером. Запустите start.bat и не закрывайте его окно, затем повторите';
        }
        draw();
      }
      busy = false; draw();
      $('#ugo', m.el).textContent = 'Загрузить ещё'; if (done) toast(`Загружено файлов: ${done}`);
    };
    if (files.length) add(files);
    return m;
  },
};

// ---- tooltips (hover and keyboard focus), crosshair for line charts, chart <-> table toggle ----
(() => {
  const tt = document.createElement('div'); tt.id = 'tt'; tt.setAttribute('role', 'tooltip'); document.body.appendChild(tt);
  let cur = null;
  const place = (x, y) => {
    const w = tt.offsetWidth, h = tt.offsetHeight;
    tt.style.left = Math.max(8, Math.min(x + 14, innerWidth - w - 8)) + 'px';
    tt.style.top = Math.max(8, y + 16 + h > innerHeight ? y - h - 12 : y + 16) + 'px';
  };
  const cross = (el, on) => {
    const svg = el.ownerSVGElement; if (!svg || !el.classList.contains('hit')) return;
    const xh = svg.querySelector('.xh'); if (xh) { xh.setAttribute('x1', el.dataset.x); xh.setAttribute('x2', el.dataset.x); xh.style.visibility = on ? 'visible' : 'hidden'; }
    svg.querySelectorAll(`.hd[data-i="${el.dataset.i}"]`).forEach(d => { d.style.visibility = on ? 'visible' : 'hidden'; });
  };
  const hide = () => { if (cur) cross(cur, false); cur = null; tt.classList.remove('on'); };
  const show = (el, x, y) => { if (cur && cur !== el) cross(cur, false); cur = el; tt.innerHTML = el.dataset.tip; tt.classList.add('on'); place(x, y); cross(el, true); };
  document.addEventListener('mouseover', e => { const el = e.target.closest?.('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
  document.addEventListener('mousemove', e => { if (cur) place(e.clientX, e.clientY); });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) hide(); }); // pointer left the window
  document.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.twin'); if (!b) return;
    const box = b.closest('.panel, .widget'), on = box.classList.toggle('show-table');
    b.textContent = on ? 'График' : 'Таблица'; b.setAttribute('aria-pressed', String(on)); hide();
  });
})();
