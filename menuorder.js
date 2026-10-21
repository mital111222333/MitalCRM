// Menu order: «⇅ Порядок меню» at the bottom of the left menu.
// Sections and items can be moved up/down (buttons — work on the phone too) or dragged with the mouse,
// including moving an item into another section. The order is remembered in this browser.
// Loaded after static-api.js (EXT_MENU) and before app.js (which copies EXT_MENU into MENU).
(() => {
  const KEY = 'crm_menu_order_v2'; // v2: the menu was regrouped on 2026-10-21 — an order saved for the old menu is not applied
  const get = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
  const put = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
  if (!window.EXT_MENU) return;

  // the built-in menu, kept as the default and as the source of titles
  const DEF = Object.entries(window.EXT_MENU).map(([top, groups]) => [top, Object.values(groups).flat().map(([t, r]) => [t, r])]);
  const TITLE = {}; DEF.forEach(([, items]) => items.forEach(([t, r]) => { TITLE[r] = t; }));
  const toMenu = model => Object.fromEntries(model.map(([top, items]) => [top, { '': items.map(r => [TITLE[r], r]) }]));

  // saved order + anything new that appeared in the code later (goes to its own section, at the end)
  const build = () => {
    const saved = get(), seen = new Set(), model = [];
    if (saved) for (const [top, items] of saved) {
      if (typeof top !== 'string' || !Array.isArray(items)) continue;
      const list = items.filter(r => TITLE[r] && !seen.has(r)); list.forEach(r => seen.add(r));
      model.push([top, list]);
    }
    for (const [top, items] of DEF) {
      const fresh = items.map(([, r]) => r).filter(r => !seen.has(r)); if (!fresh.length && model.some(m => m[0] === top)) continue;
      let sec = model.find(m => m[0] === top); if (!sec) { sec = [top, []]; model.push(sec); }
      fresh.forEach(r => { sec[1].push(r); seen.add(r); });
    }
    return model.filter(([top, items]) => items.length || DEF.some(d => d[0] === top));
  };
  // apply before app.js builds its menu
  if (get()) { const m = toMenu(build()); for (const k of Object.keys(EXT_MENU)) delete EXT_MENU[k]; Object.assign(EXT_MENU, m); }

  // ---------- editor ----------
  const css = document.createElement('style');
  css.textContent = `.sidefoot { padding: 8px 12px 12px; border-top: 1px solid #ffffff12; display: flex; gap: 6px; }
.sidefoot button { flex: 1; background: #ffffff0d; border: 1px solid #ffffff1a; color: #c9d6e0; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 13px; cursor: pointer; }
.sidefoot button:hover { background: #ffffff1a; color: #fff; }
.sidefoot button.main { background: var(--oil); border-color: var(--oil); color: #1a1400; font-weight: 600; }
.mo-hint { font-size: 12px; color: #8ea4b5; padding: 10px 10px 0; line-height: 1.4; }
.mo-sec { margin-top: 12px; border-radius: 10px; padding: 2px 0 4px; }
.mo-sec.drop { background: #ffffff0a; outline: 1px dashed #ffffff33; }
.mo-row { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 6px; border-radius: 8px; font-size: 14px; color: #d6e1e9; user-select: none; }
.mo-row.sec { font-size: 12px; color: #f5bb36; font-weight: 600; text-transform: none; padding-top: 6px; }
.mo-row.item { background: #ffffff08; margin: 3px 0; cursor: grab; }
.mo-row.item:hover { background: #ffffff12; }
.mo-row.dragging { opacity: .4; }
.mo-row.before { box-shadow: inset 0 2px 0 var(--oil); } .mo-row.after { box-shadow: inset 0 -2px 0 var(--oil); }
.mo-row .grip { color: #5f7a8e; width: 14px; flex: none; font-size: 13px; }
.mo-row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-row button { flex: none; width: 28px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: #9fb4c4; cursor: pointer; font-size: 14px; line-height: 1; }
.mo-row button:hover:not(:disabled) { background: #ffffff1f; color: #fff; }
.mo-row button:disabled { opacity: .25; cursor: default; }
body.menuedit .tabbar { display: none; }`;
  document.head.appendChild(css);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = s => String(s).replace(/^[^\p{L}]+/u, '');
  const shown = r => (typeof canOpen !== 'function' || canOpen(r)) && !(window.MENU_HIDDEN && MENU_HIDDEN(r));
  let model = null, drag = null;

  const save = () => {
    put(model.map(([t, items]) => [t, items.slice()]));
    const m = toMenu(model); for (const k of Object.keys(MENU)) delete MENU[k]; Object.assign(MENU, m);
  };
  // move a visible item one step; at the edge of a section it jumps into the neighbouring section
  const step = (r, dir) => {
    const si = model.findIndex(([, it]) => it.includes(r)), items = model[si][1], vis = items.filter(shown), vi = vis.indexOf(r);
    items.splice(items.indexOf(r), 1);
    const nb = vis[vi + dir];
    if (nb) { const at = items.indexOf(nb); items.splice(dir < 0 ? at : at + 1, 0, r); return; }
    const ti = si + dir;
    if (!model[ti]) { items.splice(dir < 0 ? 0 : items.length, 0, r); return; }
    dir < 0 ? model[ti][1].push(r) : model[ti][1].unshift(r);
  };
  const stepSec = (i, dir) => { const j = i + dir; if (!model[j]) return; [model[i], model[j]] = [model[j], model[i]]; };

  const draw = () => {
    const nav = document.querySelector('.sidenav'); if (!nav) return;
    const firstVis = model.findIndex(([, it]) => it.some(shown)), lastVis = model.length - 1 - [...model].reverse().findIndex(([, it]) => it.some(shown));
    nav.innerHTML = `<div class="mo-hint">Перетащите раздел мышкой или двигайте стрелками ▲▼. Стрелка у края группы переносит раздел в соседнюю группу.</div>` + model.map(([top, items], si) => {
      const vis = items.filter(shown);
      return `<div class="mo-sec" data-s="${si}"><div class="mo-row sec"><span class="t">${esc(clean(top))}</span>
        <button data-su="${si}" title="Группу выше" aria-label="Группу «${esc(clean(top))}» выше"${si === 0 ? ' disabled' : ''}>▲</button><button data-sd="${si}" title="Группу ниже" aria-label="Группу «${esc(clean(top))}» ниже"${si === model.length - 1 ? ' disabled' : ''}>▼</button></div>
        ${vis.length ? vis.map((r, k) => `<div class="mo-row item" draggable="true" data-r="${r}"><span class="grip" aria-hidden="true">⠿</span><span class="t">${esc(clean(TITLE[r]))}</span>
          <button data-u="${r}" title="Выше" aria-label="«${esc(clean(TITLE[r]))}» выше"${si <= firstVis && k === 0 ? ' disabled' : ''}>▲</button><button data-d="${r}" title="Ниже" aria-label="«${esc(clean(TITLE[r]))}» ниже"${si >= lastVis && k === vis.length - 1 ? ' disabled' : ''}>▼</button></div>`).join('') : '<div class="mo-hint" style="padding:4px 10px">пусто — перетащите сюда</div>'}</div>`;
    }).join('');

    nav.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { step(b.dataset.u, -1); save(); draw(); focus(`[data-u="${b.dataset.u}"]`); });
    nav.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { step(b.dataset.d, 1); save(); draw(); focus(`[data-d="${b.dataset.d}"]`); });
    nav.querySelectorAll('[data-su]').forEach(b => b.onclick = () => { const i = +b.dataset.su; stepSec(i, -1); save(); draw(); focus(`[data-su="${i - 1}"]`); });
    nav.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => { const i = +b.dataset.sd; stepSec(i, 1); save(); draw(); focus(`[data-sd="${i + 1}"]`); });

    // drag and drop (mouse)
    const clear = () => nav.querySelectorAll('.before,.after,.drop').forEach(x => x.classList.remove('before', 'after', 'drop'));
    nav.querySelectorAll('.mo-row.item').forEach(row => {
      row.ondragstart = e => { drag = row.dataset.r; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag); } catch { /* old browsers */ } };
      row.ondragend = () => { drag = null; row.classList.remove('dragging'); clear(); };
    });
    nav.querySelectorAll('.mo-sec').forEach(sec => {
      sec.ondragover = e => {
        if (!drag) return; e.preventDefault(); clear();
        const row = e.target.closest('.mo-row.item');
        if (row && row.dataset.r !== drag) { const b = row.getBoundingClientRect(); row.classList.add(e.clientY < b.top + b.height / 2 ? 'before' : 'after'); } else sec.classList.add('drop');
      };
      sec.ondragleave = e => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop'); };
      sec.ondrop = e => {
        if (!drag) return; e.preventDefault();
        const row = e.target.closest('.mo-row.item'), r = drag, si = +sec.dataset.s;
        const before = row && row.classList.contains('before');
        clear(); if (row && row.dataset.r === r) return;
        model.forEach(([, it]) => { const i = it.indexOf(r); if (i >= 0) it.splice(i, 1); });
        const items = model[si][1];
        if (row) { const at = items.indexOf(row.dataset.r); items.splice(before ? at : at + 1, 0, r); } else items.push(r);
        save(); draw();
      };
    });
  };
  const focus = sel => { const b = document.querySelector('.sidenav ' + sel); if (b && !b.disabled) b.focus(); };

  const foot = () => {
    const side = document.getElementById('side'); if (!side) return;
    let f = side.querySelector('.sidefoot');
    if (!f) { f = document.createElement('div'); f.className = 'sidefoot'; side.appendChild(f); }
    const editing = document.body.classList.contains('menuedit');
    f.innerHTML = editing
      ? `<button class="main" id="moDone">✓ Готово</button><button id="moReset" title="Вернуть порядок как было изначально">Сбросить</button>`
      : `<button id="moEdit" title="Поменять разделы местами">⇅ Порядок меню</button>`;
    if (editing) {
      f.querySelector('#moDone').onclick = () => { document.body.classList.remove('menuedit'); model = null; render(); };
      f.querySelector('#moReset').onclick = () => {
        if (!confirm('Вернуть меню в исходный порядок?')) return;
        put(null); model = DEF.map(([t, items]) => [t, items.map(([, r]) => r)]); save(); put(null); draw();
      };
    } else f.querySelector('#moEdit').onclick = () => { model = build(); document.body.classList.add('menuedit'); foot(); draw(); };
  };

  // the app redraws the whole frame (render) — put the button back each time; a redraw ends editing
  addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app'); if (!app) return;
    new MutationObserver(() => {
      const side = document.getElementById('side'); if (!side || side.querySelector('.sidefoot')) return;
      document.body.classList.remove('menuedit'); model = null; foot();
    }).observe(app, { childList: true });
  });
})();
