// XGRID: every table of the platform works like an Excel table, without rewriting each page.
// It watches the page; every new <table> gets: compact Excel look (grid lines, banded rows, frozen header and first column),
// a ▾ filter on each column (list of values with search, «Выделить все», text / number / date conditions, sort A→Z, Z→A),
// an «Итог» row at the bottom (click a total to choose Сумма / Среднее / Количество / Мин / Макс / Нет — like Excel's totals row),
// row selection (click, Shift+click, Ctrl+click) with the sum of the selection, Ctrl+C / «Копировать» to paste into Excel,
// and «⬇ Excel» to download exactly what is shown. Filters and sort survive a page redraw (same page + same columns).
// Tables that already have their own Excel grid (Деньги → Аналитика, «Кто недоплатил», Клиенты) are left alone.
// A table can opt out with class="noxg". Tables with their own sorting or with inputs inside get filters and totals only (rows are not moved).
const XGRID = (() => {
  const SKIP = 'table.xg, table.xltable, table.noxg, table.upl, table.matrix, table.plan2, .xgx-pop table, .modal table.small';
  const MEM = new Map();                 // filters + sort per page/columns, kept while the app is open
  const TOT_KEY = 'xgx-totals-v1';       // the chosen total functions are remembered in this browser
  let totPref = {}; try { totPref = JSON.parse(localStorage.getItem(TOT_KEY) || '{}') || {}; } catch { totPref = {}; }
  const saveTot = () => { try { localStorage.setItem(TOT_KEY, JSON.stringify(totPref)); } catch {} };
  const EMPTY = '(Пустые)';
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = n => { const v = Math.round((Number(n) || 0) * 100) / 100; return v.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
  const toast2 = m => (typeof toast === 'function' ? toast(m) : console.log(m));

  // ---------- reading cells ----------
  const textOf = td => {
    const f = td.querySelector('input:not([type=checkbox]):not([type=hidden]),select,textarea');
    const t = f ? (f.tagName === 'SELECT' ? f.options[f.selectedIndex]?.text || '' : f.value) : td.innerText ?? td.textContent;
    return String(t || '').replace(/[  ]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' · ').trim();
  };
  // «3 267,58», «$1 234», «-12», «45%», «1,234.5» → number; «—», «нет», «15.10.2026» → null
  const numOf = s => {
    if (!s) return null;
    let x = s.replace(/\s/g, '').replace(/^(≈|~|\+)/, '').replace(/^\$|\$$/g, '').replace(/(шт\.?|сум|дн\.?)$/i, '');
    if (/^[—–-]$/.test(x)) return null;
    if (/^-?\d+(,\d+)?%?$/.test(x)) return Number(x.replace('%', '').replace(',', '.'));
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) return Number(x.replace(/,/g, ''));
    if (/^-?\d+\.\d+$/.test(x) && !/^\d{1,2}\.\d{1,2}$/.test(x)) return Number(x); // 3267.58 (not 15.10 — that is a date)
    return null;
  };
  // «15.10.2026», «15.10.2026 · 5 дн. назад», «15.10» → '2026-10-15'
  const dateOf = s => {
    const m = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?(?!\d)/.exec(s || ''); if (!m) return null;
    const y = m[3] || String(new Date().getFullYear()); if (+m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return null;
    return `${y}-${m[2]}-${m[1]}`;
  };

  // ---------- styles ----------
  const css = () => {
    if (document.getElementById('xgxCss')) return;
    const st = document.createElement('style'); st.id = 'xgxCss';
    st.textContent = `
.xgx-wrap{max-height:70vh;overflow:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
.xgx-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 4px;font-size:12px;color:var(--muted)}
.xgx-bar .sp{flex:1}
.xgx-bar button{font:inherit;font-size:12px;padding:2px 8px;border:1px solid var(--line-2,var(--line));border-radius:4px;background:var(--card);color:var(--text);cursor:pointer}
.xgx-bar button:hover{border-color:var(--c1,#2a9d8f)}
.xgx-bar b{color:var(--text)}
table.xgx{border-collapse:separate;border-spacing:0;width:100%;font-size:12px;box-shadow:none;border:0;border-radius:0;overflow:visible}
table.xgx th,table.xgx td{padding:3px 7px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);line-height:1.3;vertical-align:middle;background:var(--card)}
table.xgx td{white-space:nowrap}
table.xgx td small{font-size:10.5px}
table.xgx tbody tr:nth-child(even of :not(.xgx-h)) td{background:color-mix(in srgb,var(--text) 3.5%,var(--card))}
table.xgx tbody tr:hover td{background:color-mix(in srgb,var(--c1,#2a9d8f) 10%,var(--card))}
table.xgx tbody tr.xgx-sel td{background:color-mix(in srgb,var(--c1,#2a9d8f) 22%,var(--card))!important}
table.xgx tbody tr.xgx-h{display:none}
table.xgx thead th{position:sticky;top:0;z-index:4;background:color-mix(in srgb,var(--text) 10%,var(--card));color:var(--text);font-size:11.5px;font-weight:600;white-space:normal;vertical-align:bottom;border-bottom:2px solid var(--line-2,var(--line));user-select:none}
table.xgx thead th.xgx-f{cursor:pointer;padding-right:24px;position:sticky}
table.xgx thead th.xgx-f:hover{background:color-mix(in srgb,var(--text) 17%,var(--card))}
table.xgx thead th .xgx-b{position:absolute;right:4px;bottom:3px;width:16px;height:16px;line-height:15px;text-align:center;border:1px solid var(--line-2,var(--line));border-radius:3px;background:var(--card);font-size:10px;font-style:normal;color:var(--text-2,var(--muted))}
table.xgx thead th.xgx-on .xgx-b{background:var(--c1,#2a9d8f);border-color:var(--c1,#2a9d8f);color:#fff}
table.xgx thead th .xgx-s{font-size:9px;color:var(--c1,#2a9d8f);margin-left:2px}
table.xgx th:first-child,table.xgx td:first-child{position:sticky;left:0;z-index:2;box-shadow:2px 0 0 var(--line-2,var(--line))}
table.xgx thead th:first-child{z-index:6}
table.xgx tfoot td{position:sticky;bottom:0;z-index:3;font-weight:700;background:color-mix(in srgb,var(--text) 10%,var(--card))!important;border-top:2px solid var(--line-2,var(--line));white-space:nowrap}
table.xgx tfoot td:first-child{z-index:5}
table.xgx tfoot td.xgx-t{cursor:pointer;text-align:right;font-variant-numeric:tabular-nums}
table.xgx tfoot td.xgx-t:hover{outline:1px solid var(--c1,#2a9d8f);outline-offset:-1px}
table.xgx tfoot td.xgx-t small{font-weight:400;color:var(--muted);margin-right:3px}
.xgx-pop{position:fixed;z-index:400;width:264px;background:var(--card);color:var(--text);border:1px solid var(--line-2,var(--line));border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13px;padding:4px 0}
.xgx-pop .i{padding:5px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.xgx-pop .i:hover{background:color-mix(in srgb,var(--c1,#2a9d8f) 16%,var(--card))}
.xgx-pop .i.dis{opacity:.4;pointer-events:none}
.xgx-pop .i.sub{padding-left:26px}
.xgx-pop .i.on{font-weight:700}
.xgx-pop .s{border-top:1px solid var(--line);margin:4px 0}
.xgx-pop .q{display:block;width:calc(100% - 20px);margin:4px 10px;box-sizing:border-box;padding:4px 8px;font-size:12px}
.xgx-pop .l{max-height:210px;overflow:auto;border:1px solid var(--line);margin:4px 10px;padding:2px 0}
.xgx-pop .l label{display:flex;gap:6px;align-items:center;padding:2px 8px;cursor:pointer;font-size:12px}
.xgx-pop .l label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xgx-pop .l label:hover{background:color-mix(in srgb,var(--c1,#2a9d8f) 12%,var(--card))}
.xgx-pop .l small{margin-left:auto;color:var(--muted)}
.xgx-pop .b{display:flex;gap:8px;justify-content:flex-end;padding:6px 10px 4px}
.xgx-pop .c{padding:4px 10px;display:grid;gap:6px}
.xgx-pop .c input,.xgx-pop .c select{width:100%;box-sizing:border-box;font-size:12px;padding:3px 6px}
@media print{.xgx-wrap{max-height:none;overflow:visible}.xgx-bar,table.xgx .xgx-b{display:none}}`;
    document.head.appendChild(st);
  };

  // ---------- popup ----------
  let POP = null;
  const outside = e => { if (POP && !POP.contains(e.target)) close(); };
  const onEsc = e => { if (e.key === 'Escape') close(); };
  const close = () => { if (POP) { POP.remove(); POP = null; } document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onEsc, true); };
  const open = (pop, anchor) => {
    close(); POP = pop; pop.className = 'xgx-pop'; document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(6, Math.min(r.left, innerWidth - w - 8)) + 'px';
    pop.style.top = Math.max(6, r.bottom + h + 8 > innerHeight ? Math.min(r.top - h - 2, innerHeight - h - 8) : r.bottom + 2) + 'px';
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onEsc, true); }, 0);
  };

  const TXT = [['has', 'Содержит'], ['nhas', 'Не содержит'], ['eq', 'Равно'], ['ne', 'Не равно'], ['sw', 'Начинается с'], ['ew', 'Заканчивается на'], ['empty', 'Пусто'], ['nonempty', 'Не пусто']];
  const NUM = [['eq', 'Равно'], ['ne', 'Не равно'], ['gt', 'Больше'], ['ge', 'Больше или равно'], ['lt', 'Меньше'], ['le', 'Меньше или равно'], ['bw', 'Между'], ['top', 'Первые 10'], ['avg+', 'Выше среднего'], ['avg-', 'Ниже среднего'], ['empty', 'Пусто'], ['nonempty', 'Не пусто']];
  const DAT = [['eq', 'Равно'], ['lt', 'До'], ['gt', 'После'], ['bw', 'Между'], ['today', 'Сегодня'], ['week', 'За последние 7 дней'], ['month', 'В этом месяце'], ['empty', 'Пусто'], ['nonempty', 'Не пусто']];
  const NOARG = ['empty', 'nonempty', 'top', 'avg+', 'avg-', 'today', 'week', 'month'];
  const FN = [['none', 'Нет'], ['sum', 'Сумма'], ['avg', 'Среднее'], ['count', 'Количество'], ['cnum', 'Количество чисел'], ['min', 'Минимум'], ['max', 'Максимум']];
  const FNS = { sum: 'Σ', avg: 'ср.', count: 'кол.', cnum: 'кол.', min: 'мин', max: 'макс' };
  const pN = s => numOf(String(s ?? '').trim()) ?? (String(s ?? '').trim() === '' ? NaN : Number(String(s).replace(/\s/g, '').replace(',', '.')));
  const pD = s => dateOf(String(s ?? '').trim()) || (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- one table ----------
  function enhance(t) {
    t.dataset.xgx = '1';
    const head = t.tHead; if (!head || head.rows.length !== 1) return;
    const ths = [...head.rows[0].cells];
    if (ths.some(th => th.colSpan > 1)) return;
    const body = t.tBodies[0]; if (!body) return;
    const nC = ths.length;
    css();
    const ownSort = !!t.querySelector('th[data-s], th.sort');
    const inputs = !!body.querySelector('input:not([type=checkbox]),select,textarea');
    const fixed = ownSort || inputs;     // do not move rows — the page owns their order
    // a scroll box: the existing one (.scroll / .tscroll / any overflow box), otherwise our own
    let box = t.parentElement;
    const scrolls = el => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) || el.classList.contains('scroll') || el.classList.contains('tscroll') || el.classList.contains('tableview'); };
    if (!box || !scrolls(box)) { const w = document.createElement('div'); w.className = 'xgx-wrap'; t.before(w); w.appendChild(t); box = w; }
    else if (box.classList.contains('tscroll') && !box.style.maxHeight) box.style.maxHeight = '70vh';
    if (box.classList.contains('tscroll')) box.style.overflow = 'auto';
    t.classList.add('xgx');

    const heads = ths.map((th, i) => (th.innerText || th.textContent || '').replace(/[▲▼▾]/g, '').replace(/\s+/g, ' ').trim() || `Столбец ${i + 1}`);
    const key = (location.hash || '') + '|' + heads.join('|');
    const S = MEM.get(key) || { f: {}, sort: null }; MEM.set(key, S);
    const TP = totPref[key] || (totPref[key] = {});
    let rows = [], cols = [], extra = [], sel = new Set(), anchor = null, busy = false;

    const read = () => {
      rows = []; extra = [];
      for (const tr of [...body.rows]) {
        const cells = [...tr.cells];
        if (cells.length !== nC || cells.some(c => c.colSpan > 1)) { extra.push(tr); continue; }
        rows.push({ tr, v: cells.map(td => { const s = textOf(td); return { s, n: numOf(s) ?? (s.includes(' · ') ? numOf(s.split(' · ')[0]) : null), d: dateOf(s) }; }) });
      }
      cols = heads.map((h, i) => {
        const vs = rows.map(r => r.v[i]).filter(x => x.s && !/^[—–-]$/.test(x.s));
        const nn = vs.filter(x => x.n !== null).length, nd = vs.filter(x => x.d).length;
        const kind = vs.length && nd >= vs.length * 0.7 ? 'date' : vs.length && (nn >= vs.length * 0.7 || (ths[i].classList.contains('n') && nn >= vs.length * 0.5)) ? 'num' : 'text';
        const pct = vs.some(x => /%$/.test(x.s));
        const noSum = pct || /^\s*(дн|дней|дни)|дней без|дн\. назад|%|№|дата|ср\.|средн|цена|доля|ранг|место|хватит|в день|время|телефон|рейтинг|динамик|возраст|номер|балл/i.test(h);
        const box1 = !!ths[i].querySelector('input,select'), action = !h.trim() || /^Столбец \d+$/.test(h) && !vs.length;
        return { h, i, kind, dflt: kind === 'num' && !noSum ? 'sum' : 'none', filt: !box1 && !action && rows.length > 1 };
      });
    };
    const kOf = (c, r) => { const x = r.v[c.i]; if (!x.s || /^[—–-]$/.test(x.s)) return EMPTY; return x.s.length > 90 ? x.s.slice(0, 90) + '…' : x.s; };
    const svOf = (c, r) => { const x = r.v[c.i]; if (c.kind === 'num') return x.n; if (c.kind === 'date') return x.d; return x.s && !/^[—–-]$/.test(x.s) ? x.s.toLowerCase() : null; };
    const statsOf = (c, list) => { const ns = list.map(r => r.v[c.i].n).filter(n => n !== null); return { avg: ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0, top: ns.slice().sort((a, b) => b - a)[Math.min(9, ns.length - 1)] }; };
    const cond = (c, r, cd, st) => {
      const op = cd.op;
      if (op === 'empty') return svOf(c, r) === null; if (op === 'nonempty') return svOf(c, r) !== null;
      if (c.kind === 'num') {
        const v = r.v[c.i].n; if (v === null) return false; const a = pN(cd.a), b = pN(cd.b);
        return { eq: v === a, ne: v !== a, gt: v > a, ge: v >= a, lt: v < a, le: v <= a, bw: v >= Math.min(a, b) && v <= Math.max(a, b), top: st && v >= st.top, 'avg+': st && v > st.avg, 'avg-': st && v < st.avg }[op] ?? true;
      }
      if (c.kind === 'date') {
        const v = r.v[c.i].d; if (!v) return false; const a = pD(cd.a), b = pD(cd.b), t0 = today();
        const wk = new Date(Date.parse(t0) - 6 * 864e5).toISOString().slice(0, 10);
        return { eq: v === a, lt: v < a, gt: v > a, bw: v >= (a < b ? a : b) && v <= (a < b ? b : a), today: v === t0, week: v >= wk && v <= t0, month: v.slice(0, 7) === t0.slice(0, 7) }[op] ?? true;
      }
      const v = r.v[c.i].s.toLowerCase(), a = String(cd.a ?? '').toLowerCase();
      return { eq: v === a, ne: v !== a, sw: v.startsWith(a), ew: v.endsWith(a), has: v.includes(a), nhas: !v.includes(a) }[op] ?? true;
    };
    const passes = (r, skip) => {
      for (const [k, st] of Object.entries(S.f)) {
        const c = cols[+k]; if (!c || +k === skip) continue;
        if (st.sel && !st.sel.includes(kOf(c, r))) return false;
        if (st.cond && !cond(c, r, st.cond, st.cond.st)) return false;
      }
      return true;
    };
    let shown = [];
    const apply = () => {
      busy = true;
      // conditions that depend on all values (top 10, above average) are measured on the rows passing the other filters
      for (const [k, st] of Object.entries(S.f)) if (st.cond && ['top', 'avg+', 'avg-'].includes(st.cond.op)) st.cond.st = statsOf(cols[+k], rows.filter(r => passes(r, +k)));
      shown = rows.filter(r => passes(r));
      const vis = new Set(shown);
      for (const r of rows) r.tr.classList.toggle('xgx-h', !vis.has(r));
      if (!fixed) {
        let order = rows.slice();
        if (S.sort && cols[S.sort.i]) {
          const c = cols[S.sort.i], d = S.sort.dir;
          order.sort((a, b) => { const x = svOf(c, a), y = svOf(c, b); if (x === y) return 0; if (x === null) return 1; if (y === null) return -1; return (typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y) * d; });
        } else order.sort((a, b) => a.o - b.o);
        const frag = document.createDocumentFragment(); order.forEach(r => frag.appendChild(r.tr)); extra.forEach(tr => frag.appendChild(tr)); body.appendChild(frag);
        shown = order.filter(r => vis.has(r));
      }
      ths.forEach((th, i) => {
        th.classList.toggle('xgx-on', !!S.f[i]);
        const s = th.querySelector('.xgx-s'); if (s) s.textContent = S.sort && S.sort.i === i ? (S.sort.dir > 0 ? '▲' : '▼') : '';
      });
      totals(); status();
      mo && mo.takeRecords(); busy = false;
    };

    // ----- totals row -----
    let tf = null;
    const fnOf = c => TP[c.i] || c.dflt;
    const calc = (c, fn) => {
      const ns = shown.map(r => r.v[c.i].n).filter(n => n !== null);
      if (fn === 'sum') return fmt(ns.reduce((a, b) => a + b, 0));
      if (fn === 'avg') return ns.length ? fmt(ns.reduce((a, b) => a + b, 0) / ns.length) : '—';
      if (fn === 'count') return String(shown.filter(r => svOf(c, r) !== null).length);
      if (fn === 'cnum') return String(ns.length);
      if (fn === 'min') return ns.length ? fmt(Math.min(...ns)) : '—';
      if (fn === 'max') return ns.length ? fmt(Math.max(...ns)) : '—';
      return '';
    };
    const totals = () => {
      if (t.tFoot && !tf) return; // the page has its own totals
      if (rows.length < 2) { if (tf) { tf.remove(); tf = null; } return; }
      if (!tf) { tf = t.createTFoot(); tf.dataset.xgx = '1'; tf.insertRow(); tf.rows[0].innerHTML = cols.map((c, i) => `<td class="${i ? 'xgx-t' : ''}" data-i="${i}"></td>`).join(''); }
      const cells = tf.rows[0].cells;
      cols.forEach((c, i) => {
        if (!i) { cells[0].textContent = `Итог · ${shown.length}`; return; }
        const fn = fnOf(c), v = calc(c, fn);
        cells[i].innerHTML = fn === 'none' ? '' : `<small>${FNS[fn]}</small>${esc(v)}`;
        cells[i].title = 'Нажмите — выбрать итог: сумма, среднее, количество, мин, макс';
      });
    };

    // ----- status bar -----
    const bar = document.createElement('div'); bar.className = 'xgx-bar';
    // the bar sits right above the scroll box (inside it for a chart's «Таблица» view, so it hides together with the table)
    if (box.classList.contains('tableview')) { box.querySelectorAll(':scope > .xgx-bar').forEach(x => x.remove()); t.before(bar); }
    else { const prev = box.previousElementSibling; if (prev && prev.classList.contains('xgx-bar')) prev.remove(); box.before(bar); }
    const status = () => {
      const nf = Object.keys(S.f).length, sr = rows.filter(r => sel.has(r) && !r.tr.classList.contains('xgx-h'));
      let ss = '';
      if (sr.length) { const c = cols.find(x => x.kind === 'num' && x.dflt === 'sum') || cols.find(x => x.kind === 'num'); ss = ` · выделено <b>${sr.length}</b>${c ? ` · Σ «${esc(c.h)}»: <b>${fmt(sr.reduce((a, r) => a + (r.v[c.i].n || 0), 0))}</b>` : ''}`; }
      bar.innerHTML = rows.length > 1 ? `<span>Строк: <b>${shown.length}</b>${shown.length !== rows.length ? ` из ${rows.length}` : ''}${ss}</span><span class="sp"></span>${nf || S.sort ? `<button data-a="reset" type="button">✕ Снять фильтры</button>` : ''}<button data-a="copy" type="button" title="Скопировать показанные (или выделенные) строки — вставьте в Excel через Ctrl+V">📋 Копировать</button><button data-a="xl" type="button" title="Скачать то, что сейчас показано, в Excel">⬇ Excel</button>` : '';
    };
    const tsv = list => [heads, ...list.map(r => r.v.map((x, i) => (cols[i].kind === 'num' && x.n !== null ? String(x.n).replace('.', ',') : x.s)))].map(l => l.map(v => String(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    const copy = async () => {
      const list = shown.filter(r => !sel.size || sel.has(r));
      try { await navigator.clipboard.writeText(tsv(list)); toast2(`Скопировано строк: ${list.length} — вставьте в Excel (Ctrl+V)`); } catch { toast2('Не удалось скопировать'); }
    };
    const toXl = () => {
      if (typeof XL === 'undefined') return toast2('Обновите страницу');
      const list = shown.filter(r => !sel.size || sel.has(r));
      const xc = cols.map((c, i) => ({ h: c.h, t: c.kind === 'num' ? 'm' : c.kind === 'date' ? 'd' : 's', w: Math.min(45, Math.max(8, c.h.length + 3, ...list.slice(0, 300).map(r => r.v[i].s.length + 2))), total: i === 0 ? 'label' : fnOf(c) === 'sum' ? 'sum' : undefined }));
      const data = list.map(r => r.v.map((x, i) => (cols[i].kind === 'num' ? x.n ?? (x.s && !/^[—–-]$/.test(x.s) ? x.s : '') : cols[i].kind === 'date' ? (x.d && /\d{4}/.test(x.s) ? x.d : x.s) : x.s)));
      const title = (t.closest('.panel,.widget,section')?.querySelector('h4,h3')?.innerText || document.querySelector('#page h2')?.innerText || 'таблица').replace(/\s*\(\d+\)\s*$/, '').trim();
      const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      XL.download(`${title.slice(0, 60)}-${stamp}`, { name: title.slice(0, 31), cols: xc, rows: data, totals: list.length > 1 });
    };
    bar.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'reset') { S.f = {}; S.sort = null; apply(); } else if (a === 'copy') copy(); else if (a === 'xl') toXl();
    };

    // ----- filter popup -----
    const filterPop = (i, th) => {
      const c = cols[i], st = S.f[i] || {};
      const src = rows.filter(r => passes(r, i)), mp = new Map();
      for (const r of src) { const k = kOf(c, r), o = mp.get(k) || { sv: svOf(c, r), n: 0 }; o.n++; mp.set(k, o); }
      const keys = [...mp.entries()].sort((x, y) => { const a = x[1].sv, b = y[1].sv; if (a === b) return 0; if (a === null) return 1; if (b === null) return -1; return typeof a === 'string' ? a.localeCompare(b, 'ru') : a - b; });
      const chosen = new Set(st.sel || keys.map(k => k[0]));
      const ops = c.kind === 'num' ? NUM : c.kind === 'date' ? DAT : TXT, nm = c.kind === 'num' ? 'Числовые фильтры' : c.kind === 'date' ? 'Фильтры по дате' : 'Текстовые фильтры';
      const pop = document.createElement('div');
      pop.innerHTML = `${fixed ? '' : `<div class="i" data-a="asc">${c.kind === 'text' ? 'Сортировка от А до Я' : c.kind === 'date' ? 'От старых к новым' : 'По возрастанию'}</div><div class="i" data-a="desc">${c.kind === 'text' ? 'Сортировка от Я до А' : c.kind === 'date' ? 'От новых к старым' : 'По убыванию'}</div><div class="i ${S.sort ? '' : 'dis'}" data-a="nosort">Исходный порядок</div><div class="s"></div>`}
        <div class="i ${S.f[i] ? '' : 'dis'}" data-a="clear">Снять фильтр с «${esc(c.h)}»</div><div class="s"></div>
        <div class="i" data-a="cond">${nm}<span>▸</span></div><div data-sub hidden>${ops.map(([o, n]) => `<div class="i sub ${st.cond?.op === o ? 'on' : ''}" data-op="${o}">${n}${NOARG.includes(o) ? '' : '…'}</div>`).join('')}</div>
        <div class="c" data-cf hidden></div><div class="s"></div>
        <input class="q" placeholder="Поиск" autocomplete="off"><div class="l"><label><input type="checkbox" data-all> <span>(Выделить все)</span></label>${keys.map(([k, o], j) => `<label data-s="${esc(k.toLowerCase())}"><input type="checkbox" data-j="${j}"> <span title="${esc(k)}">${esc(k)}</span><small>${o.n}</small></label>`).join('')}</div>
        <div class="b"><button class="btn sm" data-a="ok" type="button">OK</button><button class="btn gray sm" data-a="cancel" type="button">Отмена</button></div>`;
      open(pop, th); pop.dataset.for = i;
      const boxes = [...pop.querySelectorAll('input[data-j]')], all = pop.querySelector('input[data-all]'), q = pop.querySelector('.q'), ok = pop.querySelector('[data-a=ok]');
      const vis = () => boxes.filter(b => b.closest('label').style.display !== 'none');
      const ref = () => { const v = vis(); all.checked = v.length > 0 && v.every(b => b.checked); all.indeterminate = !all.checked && v.some(b => b.checked); ok.disabled = !boxes.some(b => b.checked); };
      boxes.forEach((b, j) => { b.checked = chosen.has(keys[j][0]); b.onchange = ref; });
      all.onchange = () => { vis().forEach(b => { b.checked = all.checked; }); ref(); };
      q.oninput = () => { const w = q.value.trim().toLowerCase(); pop.querySelectorAll('label[data-s]').forEach(l => { l.style.display = !w || l.dataset.s.includes(w) ? '' : 'none'; }); if (w) vis().forEach(b => { b.checked = true; }); ref(); };
      q.onkeydown = e => { if (e.key === 'Enter') ok.click(); };
      ref(); if (matchMedia('(pointer:fine)').matches) q.focus();
      const setF = patch => { const n = { sel: null, cond: null, ...(S.f[i] || {}), ...patch }; if (!n.sel && !n.cond) delete S.f[i]; else S.f[i] = n; close(); apply(); };
      const condForm = op => {
        const box2 = pop.querySelector('[data-cf]'), old = st.cond?.op === op ? st.cond : {}, tp = c.kind === 'date' ? 'date' : 'text';
        const val = v => (c.kind === 'date' ? pD(v) || '' : v ?? '');
        box2.hidden = false;
        box2.innerHTML = `<b style="font-size:12px">${esc(ops.find(o => o[0] === op)[1])}</b><input data-ca type="${tp}" ${c.kind === 'num' ? 'inputmode="decimal"' : ''} placeholder="значение" value="${esc(val(old.a))}">${op === 'bw' ? `<input data-cb type="${tp}" placeholder="и" value="${esc(val(old.b))}">` : ''}<button class="btn sm" data-a="cok" type="button">Применить</button>`;
        const a = box2.querySelector('[data-ca]'); a.focus();
        box2.onkeydown = e => { if (e.key === 'Enter') box2.querySelector('[data-a=cok]').click(); };
        box2.querySelector('[data-a=cok]').onclick = ev => {
          ev.stopPropagation();
          const av = a.value.trim(), bv = box2.querySelector('[data-cb]')?.value.trim() ?? '';
          if (!av || (op === 'bw' && !bv)) return toast2('Впишите значение');
          if (c.kind === 'num' && (Number.isNaN(pN(av)) || (op === 'bw' && Number.isNaN(pN(bv))))) return toast2('Впишите число');
          setF({ cond: { op, a: av, b: bv } });
        };
      };
      pop.onclick = e => {
        const it = e.target.closest('[data-a],[data-op]'); if (!it) return;
        if (it.dataset.op) { const op = it.dataset.op; if (NOARG.includes(op)) setF({ cond: { op } }); else condForm(op); return; }
        const a = it.dataset.a;
        if (a === 'asc' || a === 'desc') { S.sort = { i, dir: a === 'asc' ? 1 : -1 }; close(); apply(); }
        else if (a === 'nosort') { S.sort = null; close(); apply(); }
        else if (a === 'clear') { delete S.f[i]; close(); apply(); }
        else if (a === 'cond') pop.querySelector('[data-sub]').hidden = !pop.querySelector('[data-sub]').hidden;
        else if (a === 'cancel') close();
        else if (a === 'ok') { const pick = keys.filter((_, j) => boxes[j].checked).map(k => k[0]); setF({ sel: pick.length === keys.length ? null : pick }); }
      };
    };
    const totPop = (i, td) => {
      const c = cols[i], cur = fnOf(c), pop = document.createElement('div');
      pop.style.width = '200px';
      pop.innerHTML = `<div class="i dis" style="opacity:.7;font-size:12px">Итог «${esc(c.h)}»</div>` + FN.filter(([k]) => c.kind === 'num' || ['none', 'count'].includes(k)).map(([k, n]) => `<div class="i ${k === cur ? 'on' : ''}" data-fn="${k}">${n}${k === cur ? '<span>✓</span>' : ''}</div>`).join('');
      open(pop, td);
      pop.onclick = e => { const it = e.target.closest('[data-fn]'); if (!it) return; TP[i] = it.dataset.fn; saveTot(); close(); totals(); };
    };

    // ----- header buttons, clicks, selection, Ctrl+C -----
    const setupHead = () => {
      ths.forEach((th, i) => {
        th.querySelectorAll('.xgx-b,.xgx-s').forEach(x => x.remove());
        th.classList.remove('xgx-f');
        if (!cols[i]?.filt) return;
        th.classList.add('xgx-f'); th.title = 'Нажмите — фильтр и сортировка, как в Excel';
        const s = document.createElement('span'); s.className = 'xgx-s'; th.appendChild(s);
        const b = document.createElement('i'); b.className = 'xgx-b'; b.textContent = '▾'; th.appendChild(b);
      });
    };
    head.addEventListener('click', e => {
      const th = e.target.closest('th'); if (!th || e.target.closest('input,select,a,button')) return;
      const i = ths.indexOf(th); if (i < 0 || !cols[i]?.filt) return;
      if (ownSort && !e.target.closest('.xgx-b')) return; // the page sorts on header click; our ▾ opens the filter
      e.stopPropagation();
      if (POP && POP.dataset.for === String(i)) return close();
      filterPop(i, th);
    }, true);
    t.addEventListener('click', e => {
      const td = e.target.closest('tfoot td.xgx-t'); if (td && tf && tf.contains(td)) return totPop(+td.dataset.i, td);
      const tr = e.target.closest('tbody tr'); if (!tr || e.target.closest('a,button,input,select,textarea,label,.clink,[data-client],[data-agent]')) return;
      const r = rows.find(x => x.tr === tr); if (!r) return;
      if (e.shiftKey && anchor) { const vis = shown, a = vis.indexOf(anchor), b = vis.indexOf(r); if (a >= 0 && b >= 0) { if (!e.ctrlKey && !e.metaKey) sel.clear(); vis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => sel.add(x)); } }
      else if (e.ctrlKey || e.metaKey) { sel.has(r) ? sel.delete(r) : sel.add(r); anchor = r; }
      else { const only = sel.size === 1 && sel.has(r); sel.clear(); if (!only) sel.add(r); anchor = r; }
      rows.forEach(x => x.tr.classList.toggle('xgx-sel', sel.has(x))); status();
    });
    t.tabIndex = -1;
    t.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && sel.size && !getSelection().toString()) { e.preventDefault(); copy(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && document.activeElement === t) { e.preventDefault(); shown.forEach(r => sel.add(r)); rows.forEach(x => x.tr.classList.toggle('xgx-sel', sel.has(x))); status(); }
    });

    // ----- the page may redraw rows of this same table: read them again and re-apply filters -----
    const rebuild = () => {
      read(); rows.forEach((r, o) => { r.o = o; });
      for (const k of Object.keys(S.f)) if (!cols[+k]?.filt) delete S.f[k];
      sel = new Set(); anchor = null; setupHead(); apply();
    };
    let pend = 0, mo = null;
    mo = new MutationObserver(() => { if (busy || pend) return; pend = requestAnimationFrame(() => { pend = 0; if (t.isConnected) rebuild(); else mo.disconnect(); }); });
    rebuild();
    mo.observe(body, { childList: true, subtree: true, characterData: true });
    t._xgx = { head, body, mo };
  }

  // ---------- watch the whole app ----------
  const scan = root => {
    // a page that rewrote the whole table (new header and rows in the same <table>) gets it set up again
    for (const t of (root || document).querySelectorAll('table[data-xgx="1"]')) {
      const x = t._xgx; if (!x || (t.tHead === x.head && t.tBodies[0] === x.body)) continue;
      x.mo.disconnect(); if (t.tFoot && t.tFoot.dataset.xgx) t.tFoot.remove(); delete t.dataset.xgx;
    }
    for (const t of (root || document).querySelectorAll('table:not([data-xgx])')) {
      if (t.matches(SKIP) || t.closest('.xg-wrap, .scroll.xl, .xf-pop, .xgx-pop, .no-xg')) { t.dataset.xgx = 'skip'; continue; }
      try { enhance(t); } catch (e) { t.dataset.xgx = 'err'; console.warn('XGRID', e); }
    }
  };
  let q = 0;
  const start = () => {
    scan();
    new MutationObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; scan(); }); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('hashchange', close);
  return { scan, numOf, dateOf };
})();
