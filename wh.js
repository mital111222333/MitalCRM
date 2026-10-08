// Warehouse section: overview, stock matrix, what is running out, movement analysis, uploads.
// Data comes from /api/wh/*. Every upload is a dated snapshot; movement = difference between consecutive snapshots.
window.EXT_PAGES = window.EXT_PAGES || {};

const WH_TABS = [['wh', 'Обзор'], ['whstock', 'Остатки'], ['whlow', 'Что заканчивается'], ['whmove', 'Движение'], ['whup', 'Загрузки']];
const WH_STATUS = { out: ['crit', '✕', 'Закончился'], blocked: ['serious', '⊘', 'Всё в резерве'], low: ['warn', '▼', 'Мало'], soon: ['warn', '◔', 'Скоро закончится'], ok: ['good', '✓', 'В норме'] };
const whPill = s => UI.pill(WH_STATUS[s][0], WH_STATUS[s][2], WH_STATUS[s][1]);
const whEnc = encodeURIComponent;
// "хватит на" makes no sense for items that are already out or fully reserved
const whDays = i => (i.days_left != null && !['out', 'blocked'].includes(i.status) ? Math.round(i.days_left) + ' дн.' : '—');
const whLatest = st => st.warehouses.map(w => w.upload?.taken_at).filter(Boolean).sort().at(-1) || null;

function whShell(el, tab, sub, actions = '') {
  el.innerHTML = `<div class="page-head"><div><h2>Склад</h2><div class="sub">${sub}</div></div><div class="actions">${actions}<button class="btn needs-edit" id="whUpBtn">⬆ Загрузить остатки</button></div></div>
    <nav class="tabs" aria-label="Разделы склада">${WH_TABS.map(([r, t]) => `<a href="#/${r}" class="${r === tab ? 'on' : ''}">${t}</a>`).join('')}</nav><div id="whBody"></div>`;
  $('#whUpBtn', el).onclick = () => whUploadDialog(() => route());
  return $('#whBody', el);
}

async function whUploadDialog(onDone, warehouse = '', files = []) {
  const whs = await api('/api/wh/warehouses');
  if (!Array.isArray(whs) || !whs.length) return toast('Сначала создайте склад на вкладке «Загрузки»');
  const names = whs.map(w => w.name);
  return UI.uploadDialog({
    title: 'Загрузка остатков склада',
    intro: 'Выгрузка остатков из LINKO (.xlsx или .csv). Дата берётся из даты файла: поправьте её, если выгрузка относится к другому дню. Каждая загрузка сохраняется, по ним строится движение склада.',
    fields: [{ key: 'warehouse', label: 'Склад', type: 'select', options: names, value: () => (names.includes(warehouse) ? warehouse : names[0]) }, { key: 'date', label: 'Остаток на дату', type: 'date', value: f => UI.localDate(f.lastModified) }],
    url: (f, v) => `/api/wh/upload?warehouse=${whEnc(v.warehouse)}&date=${v.date}&file=${whEnc(f.name)}`,
    summarize: d => `${d.items} поз., ${UI.fmt0(d.total)} шт.${d.replaced ? ' (заменена загрузка за эту дату)' : ''}${d.diff ? ` · с ${UI.dm(d.diff.prev_date)}: изменилось ${d.diff.changed} поз.${d.diff.added ? `, новых ${d.diff.added}` : ''}, +${UI.fmt0(d.diff.in)} / −${UI.fmt0(d.diff.out)}` : ''}`,
    onDone, files,
  });
}

function whEmpty(el, st) {
  el.innerHTML = UI.empty('Остатков пока нет', 'Загрузите выгрузку остатков из LINKO в карточку склада. Можно сразу несколько файлов за разные даты: так сразу появится анализ движения.', '<div class="dz needs-edit" id="whEmptyDz" tabindex="0" role="button"><b>Перетащите файлы сюда</b>или нажмите, чтобы выбрать</div>');
  const dz = $('#whEmptyDz', el); if (dz) UI.bindDrop(dz, files => whUploadDialog(() => route(), '', files));
}

// ---------- product details ----------
async function whProductModal(art, name, onChange) {
  const [h, st, low] = await Promise.all([api('/api/wh/history?art=' + whEnc(art)), api('/api/wh/stock'), api('/api/wh/low')]);
  const it = st.items.find(i => i.art === art), lo = low.items.find(i => i.art === art);
  const dates = [...new Set(h.map(r => r.date))].sort(), whs = [...new Set(h.map(r => r.warehouse))];
  const series = whs.map((w, i) => { let last = 0; return { name: w, color: CH.colors[i % 8], values: dates.map(d => { const r = h.find(x => x.warehouse === w && x.date === d); if (r) last = r.total; return last; }) }; });
  const rows = dates.slice().reverse().map(d => `<tr><td>${UI.dateRu(d)}</td>${whs.map(w => { const r = h.find(x => x.warehouse === w && x.date === d), prev = h.filter(x => x.warehouse === w && x.date < d).at(-1); return `<td class="n">${r ? UI.fmt0(r.total) + (prev ? ` <small>${UI.sign(r.total - prev.total)}</small>` : '') : '—'}</td>`; }).join('')}</tr>`).join('');
  const m = modal(`<h3>${esc(name)}</h3><p class="mut" style="margin:-6px 0 12px">${esc(art)}${it?.brand ? ' · ' + esc(it.brand) : ''}${it?.type ? ' · ' + esc(it.type) : ''}</p>
    <div class="kpis">${UI.tile('Доступно сейчас', UI.fmt0(it?.sum.available ?? 0), { sub: `в резерве ${UI.fmt0(it?.sum.reserved ?? 0)}` })}
      ${UI.tile('Расход в день', lo?.rate != null ? UI.fmt1(lo.rate) : '—', { sub: lo?.rate != null ? `за последние ${low.window?.days || 30} дн.` : 'нужно ≥ 2 загрузки' })}
      ${UI.tile('Хватит на', lo?.days_left != null ? Math.round(lo.days_left) + ' дн.' : '—', { tone: lo && ['out', 'blocked', 'low', 'soon'].includes(lo.status) ? 'warn' : '', sub: lo ? WH_STATUS[lo.status][2] : '' })}</div>
    ${dates.length > 1 ? CH.area(dates.map(UI.dm), series, { height: 220, unit: ' шт.' }) : '<div class="empty">Одна загрузка: график появится после следующей</div>'}
    <div class="tscroll"><table style="margin-top:12px"><thead><tr><th>Дата</th>${whs.map(w => `<th class="n">${esc(w)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="form" style="margin-top:14px"><label>Минимальный остаток для этого товара (пусто — общий порог ${st.settings.low})<input id="pmin" type="number" min="0" value="${it?.min ?? ''}" ${can('stock.edit') ? '' : 'disabled'}></label></div>
    <div class="bar"><span class="spacer"></span><button class="btn gray" id="px">Закрыть</button><button class="btn needs-edit" id="psave">Сохранить минимум</button></div>`);
  m.el.classList.add('wide');
  $('#px', m.el).onclick = m.close;
  $('#psave', m.el).onclick = async () => {
    const v = $('#pmin', m.el).value, d = await api('/api/wh/min', { method: 'POST', body: { art, min: v === '' ? null : Number(v) } });
    if (d.error) return toast(d.error);
    m.close(); onChange?.();
  };
}

// ---------- overview ----------
EXT_PAGES.wh = async el => {
  const [st, low] = await Promise.all([api('/api/wh/stock'), api('/api/wh/low')]);
  const latest = whLatest(st);
  const body = whShell(el, 'wh', latest ? `Данные на ${UI.dateRu(latest)} · складов: ${st.warehouses.filter(w => w.upload).length} из ${st.warehouses.length}` : 'Нет загруженных остатков');
  if (!latest) return whEmpty(body, st);
  const from = (() => { const d = new Date(latest + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 90); return d.toISOString().slice(0, 10); })();
  const mv = await api(`/api/wh/movement?from=${from}&to=${latest}`);
  const S = k => st.items.reduce((a, i) => a + i.sum[k], 0), inStock = st.items.filter(i => i.sum.total > 0).length, c = low.counts || {};
  const moved = mv.snapshots >= 2 && mv.series.length >= 2;
  const att = low.items.filter(i => i.status !== 'ok').slice(0, 8);
  const typeMap = {}, brandMap = {};
  st.items.forEach(i => { if (i.sum.total > 0) { typeMap[i.type || 'Без типа'] = (typeMap[i.type || 'Без типа'] || 0) + i.sum.total; brandMap[i.brand || 'Без бренда'] = (brandMap[i.brand || 'Без бренда'] || 0) + i.sum.total; } });
  const sorted = o => Object.entries(o).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const value = S('value');
  body.innerHTML = `<div class="kpis">
      ${UI.tile('Позиций в наличии', UI.fmt0(inStock), { sub: `из ${UI.fmt0(st.items.length)} в каталоге` })}
      ${UI.tile('Всего единиц', UI.fmt0(S('total')), { sub: `доступно ${UI.fmt0(S('available'))} · резерв ${UI.fmt0(S('reserved'))}`, hint: 'Всего товаров по всем складам' })}
      ${value > 0 ? UI.tile('Стоимость остатка', UI.fmt0(value), { sub: 'по себестоимости' }) : ''}
      ${UI.tile('Закончилось', c.out || 0, { tone: c.out ? 'bad' : '', sub: c.blocked ? `ещё ${c.blocked} — всё в резерве` : 'товары без остатка' })}
      ${UI.tile('Мало', c.low || 0, { tone: c.low ? 'warn' : '', sub: `остаток ≤ ${low.settings.low} шт.` })}
      ${UI.tile('Скоро закончатся', c.soon || 0, { tone: c.soon ? 'warn' : '', sub: `хватит менее ${low.settings.cover} дн.` })}
      ${moved ? UI.tile('Расход за период', UI.fmt0(mv.totals.out), { sub: `приход ${UI.fmt0(mv.totals.in)} · снимков ${mv.snapshots}` }) : ''}</div>
    <div class="grid">
      ${UI.panel('Требует внимания', att.length ? `<div class="scroll" style="max-height:none"><table><thead><tr><th>Статус</th><th>Товар</th><th class="n">Доступно</th><th class="n">Хватит на</th><th class="n">Заказать</th></tr></thead><tbody>${att.map(i => `<tr class="row" data-art="${esc(i.art)}" data-name="${esc(i.name)}"><td>${whPill(i.status)}</td><td>${esc(i.name)}<br><small>${esc(i.brand)}</small></td><td class="n">${UI.fmt0(i.available)}</td><td class="n">${whDays(i)}</td><td class="n">${i.reorder ? UI.fmt0(i.reorder) : '—'}</td></tr>`).join('')}</tbody></table></div><p style="margin:10px 0 0"><a href="#/whlow">Все товары, которые заканчиваются →</a></p>` : '<div class="empty">Всё в порядке: нет товаров с низким остатком 🎉</div>', { cls: 'w7', sub: 'Сначала самое срочное' })}
      ${UI.panel('Состояние запасов', CH.stack([['out', 'var(--st-crit)'], ['blocked', 'var(--st-serious)'], ['low', 'var(--st-warn)'], ['soon', '#f3d27a'], ['ok', 'var(--st-good)']].map(([k, color]) => ({ label: WH_STATUS[k][2], value: c[k] || 0, color }))), { cls: 'w5', sub: 'Позиций каждого статуса' })}
      ${UI.panel('Динамика остатка', moved ? CH.area(mv.series.map(s => UI.dm(s.date)), [{ name: 'Единиц на складах', color: 'var(--c1)', values: mv.series.map(s => s.units) }], { unit: ' шт.' }) : '<div class="empty">Загрузите остатки за ещё одну дату, и здесь появится динамика.</div>', { cls: 'w7', sub: 'Суммарный остаток по снимкам' })}
      ${UI.panel('Приход и расход', moved ? CH.columns(mv.series.slice(1).map(s => ({ label: UI.dm(s.date), values: [s.in, s.out] })), [{ name: 'Приход', color: 'var(--c3)' }, { name: 'Расход', color: 'var(--c2)' }], { height: 220 }) : '<div class="empty">Нужно минимум две загрузки одного склада.</div>', { cls: 'w5', sub: 'Между соседними загрузками' })}
      ${UI.panel('По складам', CH.hbars(st.warehouses.map(w => w.upload ? { label: w.name, sub: `на ${UI.dateRu(w.upload.taken_at)}`, segs: [{ name: 'Доступно', value: w.upload.available, color: 'var(--c1)' }, { name: 'В резерве', value: w.upload.reserved, color: 'var(--c2)' }], text: UI.fmt0(w.upload.total) } : { label: w.name, sub: 'нет загрузок', value: 0, text: '—' }), { unit: ' шт.' }), { cls: 'w4', sub: 'Доступно и в резерве' })}
      ${UI.panel('По типам товара', CH.donut(sorted(typeMap), { unit: ' шт.', center: 'единиц' }), { cls: 'w4' })}
      ${UI.panel('По брендам', CH.hbars(sorted(brandMap), { color: 'var(--c1)', unit: ' шт.', fmt: UI.fmt0, share: true }), { cls: 'w4' })}
    </div>`;
  body.querySelectorAll('tr[data-art]').forEach(tr => tr.onclick = () => whProductModal(tr.dataset.art, tr.dataset.name, () => route()));
};

// ---------- stock matrix ----------
let whStockState = { q: '', brand: '', type: '', status: '', zero: false };
EXT_PAGES.whstock = async el => {
  const [st, low] = await Promise.all([api('/api/wh/stock'), api('/api/wh/low')]);
  const latest = whLatest(st), body = whShell(el, 'whstock', latest ? `Данные на ${UI.dateRu(latest)}` : 'Нет загруженных остатков');
  if (!latest) return whEmpty(body, st);
  const stat = new Map(low.items.map(i => [i.art, i])), uniq = k => [...new Set(st.items.map(i => i[k]).filter(Boolean))].sort();
  const S = whStockState;
  body.innerHTML = `<div class="bar"><input type="search" id="q" placeholder="Поиск по названию или артикулу" style="flex:1;min-width:200px" value="${esc(S.q)}">
    <select id="brand"><option value="">Все бренды</option>${uniq('brand').map(b => `<option ${b === S.brand ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
    <select id="type"><option value="">Все типы</option>${uniq('type').map(b => `<option ${b === S.type ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
    <select id="stt"><option value="">Любой статус</option>${Object.entries(WH_STATUS).map(([k, v]) => `<option value="${k}" ${k === S.status ? 'selected' : ''}>${v[2]}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" id="zero" ${S.zero ? 'checked' : ''}> Показать без остатка</label><button class="btn gray" id="csv">Скачать CSV</button></div>
    <div class="scroll"><table id="mx"></table></div><p class="mut" style="margin:10px 2px">Жёлтая метка — остаток не больше порога («мало», сейчас ≤ ${st.settings.low} шт.; порог меняется на вкладке «Что заканчивается» или у каждого товара отдельно). Под числом — резерв.</p>`;
  let list = [];
  const draw = () => {
    S.q = $('#q', body).value; S.brand = $('#brand', body).value; S.type = $('#type', body).value; S.status = $('#stt', body).value; S.zero = $('#zero', body).checked;
    const q = S.q.toLowerCase();
    list = st.items.filter(i => (!q || (i.name + i.art).toLowerCase().includes(q)) && (!S.brand || i.brand === S.brand) && (!S.type || i.type === S.type) && (S.zero || i.sum.total > 0 || stat.get(i.art)?.status === 'out') && (!S.status || stat.get(i.art)?.status === S.status));
    $('#mx', body).innerHTML = `<thead><tr><th>Товар</th>${st.warehouses.map(w => `<th class="n">${esc(w.name)}<br><small>${w.upload ? UI.dateRu(w.upload.taken_at) : 'нет данных'}</small></th>`).join('')}<th class="n">Всего доступно</th><th>Статус</th></tr></thead><tbody>${list.length ? list.map((i, k) => {
      const s = stat.get(i.art), min = i.min ?? st.settings.low;
      return `<tr class="row" data-k="${k}"><td>${esc(i.name)}<br><small>${esc(i.art)} · ${esc(i.brand)}${i.type ? ' · ' + esc(i.type) : ''}</small></td>${st.warehouses.map(w => {
        const c = i.cells[w.name]; if (!c) return `<td class="n mut">${w.upload ? '0' : '—'}</td>`;
        if (c.total === 0) return '<td class="n mut">0</td>';
        const cls = c.available <= 0 ? 'crit' : c.available <= min ? 'warn' : '';
        return `<td class="n">${cls ? UI.pill(cls, UI.fmt0(c.available), c.available <= 0 ? '⊘' : '▼') : UI.fmt0(c.available)}${c.reserved ? `<br><small>резерв ${UI.fmt0(c.reserved)}</small>` : ''}${c.transit ? `<br><small>в пути ${UI.fmt0(c.transit)}</small>` : ''}</td>`;
      }).join('')}<td class="n"><b>${UI.fmt0(i.sum.available)}</b></td><td>${s ? whPill(s.status) : '<span class="mut">нет в наличии</span>'}</td></tr>`;
    }).join('') : `<tr><td colspan="${st.warehouses.length + 3}" class="empty">Ничего не найдено. Измените фильтры.</td></tr>`}</tbody>`;
    body.querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => { const i = list[+tr.dataset.k]; whProductModal(i.art, i.name, () => route()); });
  };
  ['q', 'brand', 'type', 'stt', 'zero'].forEach(id => $('#' + id, body).addEventListener('input', draw));
  $('#csv', body).onclick = () => UI.csv(`stock_${latest}.csv`, [['Товар', 'Артикул', 'Бренд', 'Тип', ...st.warehouses.flatMap(w => [w.name + ' — доступно', w.name + ' — резерв']), 'Всего доступно'], ...list.map(i => [i.name, i.art, i.brand, i.type, ...st.warehouses.flatMap(w => [i.cells[w.name]?.available ?? '', i.cells[w.name]?.reserved ?? '']), i.sum.available])]);
  draw();
};

// ---------- what is running out ----------
let whLowState = { showOk: false, status: '' };
EXT_PAGES.whlow = async el => {
  const low = await api('/api/wh/low'), body = whShell(el, 'whlow', low.window ? `Расход считается по загрузкам за последние ${low.window.days} дней · данные на ${UI.dateRu(low.window.to)}` : 'Нет загруженных остатков');
  if (!low.window) return whEmpty(body, low);
  const S = whLowState, c = low.counts, cfg = low.settings;
  const noRate = low.window.snapshots < 2;
  body.innerHTML = `<div class="kpis">${['out', 'blocked', 'low', 'soon', 'ok'].map(k => `<button class="tile" data-f="${k}" style="text-align:left;cursor:pointer;${S.status === k ? 'border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-100)' : ''}"><div class="tl">${whPill(k)}</div><div class="tv">${c[k] || 0}</div><div class="ts">${S.status === k ? 'нажмите, чтобы снять фильтр' : 'позиций'}</div></button>`).join('')}</div>
    <div class="bar"><label class="chk">Мало, если остаток ≤ <input type="number" id="s_low" value="${cfg.low}" min="0" style="width:80px"></label>
      <label class="chk">Скоро — если хватит менее <input type="number" id="s_cover" value="${cfg.cover}" min="1" style="width:70px"> дн.</label>
      <label class="chk">Запас на <input type="number" id="s_target" value="${cfg.target}" min="1" style="width:70px"> дн. (для расчёта «заказать»)</label>
      <button class="btn needs-edit" id="s_save">Применить</button><span class="spacer"></span><label class="chk"><input type="checkbox" id="ok" ${S.showOk ? 'checked' : ''}> Показать и товары в норме</label><button class="btn gray" id="csv">Скачать «Что заказать»</button></div>
    ${noRate ? '<div class="insights" style="margin-bottom:14px"><li class="warn"><span>ℹ</span><span>Загружена только одна дата, поэтому расход в день и «хватит на» не считаются. Загрузите остатки за другие даты — и приложение покажет, на сколько дней хватит каждого товара.</span></li></div>' : ''}
    <div class="grid">${UI.panel('На сколько дней хватит запаса', CH.hbars(low.items.filter(i => i.days_left !== null && i.status !== 'out').sort((a, b) => a.days_left - b.days_left).slice(0, 12).map(i => ({ label: i.name, sub: `доступно ${UI.fmt0(i.available)} · ${UI.fmt1(i.rate)}/день`, value: i.days_left, text: Math.round(i.days_left) + ' дн.' })), { color: 'var(--c1)', empty: noRate ? 'Нужно минимум две загрузки' : 'Нет товаров с известным расходом' }), { cls: 'w12', sub: '12 самых коротких запасов; линия «скоро» — менее ' + cfg.cover + ' дн.' })}</div>
    <div class="scroll"><table id="lt"></table></div>`;
  let shown = [];
  const draw = () => {
    S.showOk = $('#ok', body).checked;
    shown = low.items.filter(i => (S.status ? i.status === S.status : S.showOk || i.status !== 'ok'));
    $('#lt', body).innerHTML = `<thead><tr><th>Статус</th><th>Товар</th><th class="n">Доступно</th><th class="n">Резерв</th><th class="n">Мин.</th><th class="n">Расход/день</th><th class="n">Хватит на</th><th class="n">Заказать</th><th>Где взять / где мало</th></tr></thead><tbody>${shown.length ? shown.map((i, k) => `<tr class="row" data-k="${k}"><td>${whPill(i.status)}</td><td>${esc(i.name)}<br><small>${esc(i.art)} · ${esc(i.brand)}</small></td><td class="n"><b>${UI.fmt0(i.available)}</b></td><td class="n">${UI.fmt0(i.reserved)}</td><td class="n">${i.min}${i.custom_min ? '<small> ✎</small>' : ''}</td><td class="n">${i.rate != null ? UI.fmt1(i.rate) : '—'}</td><td class="n">${whDays(i)}</td><td class="n">${i.reorder ? `<b>${UI.fmt0(i.reorder)}</b>` : '—'}</td><td>${i.move_from ? `Перебросить со склада «${esc(i.move_from.wh)}» (там ${UI.fmt0(i.move_from.available)})` : i.wh_low.length ? `Мало на складах: ${i.wh_low.map(esc).join(', ')}` : ''}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">Нет товаров с таким статусом 🎉</td></tr>'}</tbody>`;
    body.querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => { const i = shown[+tr.dataset.k]; whProductModal(i.art, i.name, () => route()); });
  };
  body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.status = S.status === b.dataset.f ? '' : b.dataset.f; EXT_PAGES.whlow(el); });
  $('#ok', body).onchange = draw;
  $('#s_save', body).onclick = async () => { const d = await api('/api/wh/settings', { method: 'POST', body: { low: +$('#s_low', body).value, cover: +$('#s_cover', body).value, target: +$('#s_target', body).value } }); if (d.error) return toast(d.error); EXT_PAGES.whlow(el); };
  $('#csv', body).onclick = () => UI.csv(`reorder_${low.window.to}.csv`, [['Статус', 'Товар', 'Артикул', 'Бренд', 'Доступно', 'Резерв', 'Минимум', 'Расход в день', 'Хватит на, дн.', 'Заказать'], ...low.items.filter(i => i.status !== 'ok').map(i => [WH_STATUS[i.status][2], i.name, i.art, i.brand, i.available, i.reserved, i.min, i.rate?.toFixed(2) ?? '', i.days_left?.toFixed(1) ?? '', i.reorder ?? ''])]);
  draw();
};

// ---------- movement ----------
let whMoveState = { days: 'auto', from: '', to: '', wh: '' };
EXT_PAGES.whmove = async el => {
  const [st, whs] = await Promise.all([api('/api/wh/stock'), api('/api/wh/warehouses')]);
  const latest = whLatest(st), body = whShell(el, 'whmove', latest ? 'Что приходило и уходило со склада между загрузками' : 'Нет загруженных остатков');
  if (!latest) return whEmpty(body, st);
  const S = whMoveState, add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const range = () => (S.days === 'custom' ? [S.from || add(latest, -30), S.to || latest] : S.days === 'all' || S.days === 'auto' ? ['2000-01-01', latest] : [add(latest, -Number(S.days)), latest]);
  const PRESETS = [['30', '30 дней'], ['60', '60 дней'], ['90', '90 дней'], ['all', 'Всё время'], ['custom', 'Свой период']];
  const [from, to] = range();
  const mv = await api(`/api/wh/movement?from=${from}&to=${to}&warehouse=${whEnc(S.wh)}`);
  body.innerHTML = `<div class="bar">${PRESETS.map(([k, t]) => `<button class="btn ${(S.days === k || (S.days === 'auto' && k === 'all')) ? 'on' : 'gray'} sm" data-d="${k}">${t}</button>`).join('')}
    ${S.days === 'custom' ? `<input type="date" id="f" value="${from}"> — <input type="date" id="t" value="${to}"><button class="btn sm" id="go">Показать</button>` : ''}
    <span class="spacer"></span><select id="wsel"><option value="">Все склады</option>${whs.map(w => `<option ${w.name === S.wh ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div><div id="mvBody"></div>`;
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.days = b.dataset.d; EXT_PAGES.whmove(el); });
  $('#wsel', body).onchange = e => { S.wh = e.target.value; EXT_PAGES.whmove(el); };
  if (S.days === 'custom') $('#go', body).onclick = () => { S.from = $('#f', body).value; S.to = $('#t', body).value; EXT_PAGES.whmove(el); };
  const box = $('#mvBody', body);
  if (mv.snapshots < 2 || mv.series.length < 2) {
    box.innerHTML = UI.empty('Для анализа движения нужны минимум две загрузки', 'Движение считается как разница между соседними загрузками остатков одного склада. Загрузите выгрузки за разные даты (можно старые файлы): приход, расход, темп продаж и «хватит на сколько дней» появятся автоматически.', '<button class="btn needs-edit" id="mvUp">⬆ Загрузить остатки</button>');
    const b = $('#mvUp', box); if (b) b.onclick = () => whUploadDialog(() => route(), S.wh);
    return;
  }
  const T = mv.totals, days = Math.max(1, (new Date(mv.series.at(-1).date) - new Date(mv.series[0].date)) / 864e5), rows = mv.items.filter(i => i.in || i.out || i.open || i.close);
  const topOut = rows.filter(i => i.out > 0).slice(0, 10), topIn = rows.filter(i => i.in > 0).sort((a, b) => b.in - a.in).slice(0, 10);
  const byBrand = {}; rows.forEach(i => { if (i.out > 0) byBrand[i.brand || 'Без бренда'] = (byBrand[i.brand || 'Без бренда'] || 0) + i.out; });
  const dead = rows.filter(i => i.available > 0 && !i.in && !i.out).sort((a, b) => b.available - a.available);
  box.innerHTML = `${mv.partial ? `<div class="insights" style="margin-bottom:14px"><li><span>ℹ</span><span>Период начинается раньше первой загрузки: движение считается с ${UI.dateRu(mv.series[0].date)}.</span></li></div>` : ''}
    <div class="kpis">${UI.tile('Остаток на начало', UI.fmt0(T.open), { sub: UI.dateRu(mv.series[0].date) })}${UI.tile('Приход', '+' + UI.fmt0(T.in), { sub: 'поступило между загрузками' })}${UI.tile('Расход', '−' + UI.fmt0(T.out), { sub: 'ушло между загрузками' })}
      ${UI.tile('Остаток на конец', UI.fmt0(T.close), { sub: UI.dateRu(mv.series.at(-1).date), delta: UI.delta(T.close - T.open, { title: 'Изменение за период', neutral: true }) })}${UI.tile('Средний расход в день', UI.fmt1(T.out / days), { sub: `за ${Math.round(days)} ${UI.plural(Math.round(days), 'день', 'дня', 'дней')}` })}${UI.tile('Загрузок в периоде', mv.snapshots, { sub: mv.warehouses.join(', ') })}</div>
    <div class="grid">
      ${UI.panel('Как изменился остаток', CH.bridge(T.open, T.in, T.out, T.close, { unit: ' шт.' }), { cls: 'w5', sub: 'Начало + приход − расход = конец' })}
      ${UI.panel('Остаток по датам', CH.area(mv.series.map(s => UI.dm(s.date)), [{ name: 'Единиц на складах', color: 'var(--c1)', values: mv.series.map(s => s.units) }], { unit: ' шт.' }), { cls: 'w7' })}
      ${UI.panel('Приход и расход по загрузкам', CH.columns(mv.series.slice(1).map(s => ({ label: UI.dm(s.date), values: [s.in, s.out] })), [{ name: 'Приход', color: 'var(--c3)' }, { name: 'Расход', color: 'var(--c2)' }]), { cls: 'w7', sub: 'Что произошло между этой и предыдущей загрузкой' })}
      ${UI.panel('Куда уходят остатки: бренды', CH.hbars(Object.entries(byBrand).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), { color: 'var(--c2)', unit: ' шт.', fmt: UI.fmt0, share: true }), { cls: 'w5', sub: 'Расход за период' })}
      ${UI.panel('Больше всего уходит', CH.hbars(topOut.map(i => ({ label: i.name, sub: i.brand, value: i.out })), { color: 'var(--c2)', unit: ' шт.', fmt: UI.fmt0 }), { cls: 'w6', sub: 'Топ-10 по расходу' })}
      ${UI.panel('Больше всего поступило', CH.hbars(topIn.map(i => ({ label: i.name, sub: i.brand, value: i.in })), { color: 'var(--c3)', unit: ' шт.', fmt: UI.fmt0, empty: 'Приходов не было' }), { cls: 'w6', sub: 'Топ-10 по приходу' })}
      ${UI.panel('ABC-анализ расхода', CH.pareto(rows.filter(i => i.out > 0).map(i => ({ label: i.name, value: i.out }))), { cls: 'w12', sub: 'A — товары, дающие 80% расхода; C — «хвост», который почти не двигается' })}
      ${UI.panel('Лежат без движения', dead.length ? `<div class="scroll" style="max-height:300px"><table><thead><tr><th>Товар</th><th class="n">Остаток</th></tr></thead><tbody>${dead.slice(0, 40).map(i => `<tr class="row" data-art="${esc(i.art)}" data-name="${esc(i.name)}"><td>${esc(i.name)}<br><small>${esc(i.brand)}</small></td><td class="n">${UI.fmt0(i.close)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Все товары в наличии двигались</div>', { cls: 'w12', sub: `Есть на складе, но за период ни прихода, ни расхода (${dead.length})` })}
    </div>
    <div class="bar" style="margin-top:6px"><h3 style="margin:0">Все товары</h3><span class="spacer"></span><input type="search" id="q" placeholder="Поиск" style="min-width:220px"><button class="btn gray" id="csv">Скачать CSV</button></div>
    <div class="scroll"><table id="mt"></table></div>`;
  let list = rows;
  const draw = () => {
    const q = $('#q', box).value.toLowerCase(); list = rows.filter(i => !q || (i.name + i.art).toLowerCase().includes(q));
    $('#mt', box).innerHTML = `<thead><tr><th>Товар</th><th class="n">Было</th><th class="n">Приход</th><th class="n">Расход</th><th class="n">Стало</th><th class="n">Расход/день</th><th class="n">Хватит на</th></tr></thead><tbody>${list.map((i, k) => `<tr class="row" data-k="${k}"><td>${esc(i.name)}<br><small>${esc(i.art)} · ${esc(i.brand)}</small></td><td class="n">${UI.fmt0(i.open)}</td><td class="n pos">${i.in ? '+' + UI.fmt0(i.in) : '—'}</td><td class="n">${i.out ? '−' + UI.fmt0(i.out) : '—'}</td><td class="n"><b>${UI.fmt0(i.close)}</b></td><td class="n">${i.rate != null ? UI.fmt1(i.rate) : '—'}</td><td class="n">${i.days_left != null ? Math.round(i.days_left) + ' дн.' : '—'}</td></tr>`).join('')}</tbody>`;
    box.querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => { const i = list[+tr.dataset.k]; whProductModal(i.art, i.name, () => route()); });
  };
  box.querySelectorAll('tr[data-art]').forEach(tr => tr.onclick = () => whProductModal(tr.dataset.art, tr.dataset.name, () => route()));
  $('#q', box).oninput = draw;
  $('#csv', box).onclick = () => UI.csv(`movement_${from}_${to}.csv`, [['Товар', 'Артикул', 'Бренд', 'Было', 'Приход', 'Расход', 'Стало', 'Расход в день', 'Хватит на, дн.'], ...list.map(i => [i.name, i.art, i.brand, i.open, i.in, i.out, i.close, i.rate?.toFixed(2) ?? '', i.days_left?.toFixed(1) ?? ''])]);
  draw();
};

// ---------- uploads & warehouses ----------
function whNameDialog(w, onDone) {
  const m = modal(`<h3>${w ? 'Склад «' + esc(w.name) + '»' : 'Новый склад'}</h3><div class="form"><label>Название<input id="nm" value="${esc(w?.name || '')}"></label><label>Заметка<input id="nt" value="${esc(w?.note || '')}" placeholder="например: Главный склад"></label></div><small id="err" class="neg" role="alert"></small>
    <div class="bar">${w && !w.uploads ? '<button class="btn danger" id="del">Удалить склад</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  if (w && !w.uploads) $('#del', m.el).onclick = async () => { if (!confirm('Удалить склад?')) return; const d = await api('/api/wh/warehouses/delete', { method: 'POST', body: { name: w.name } }); if (d.error) return $('#err', m.el).textContent = d.error; m.close(); onDone(); };
  $('#ok', m.el).onclick = async () => { const d = await api('/api/wh/warehouses', { method: 'POST', body: { name: $('#nm', m.el).value, note: $('#nt', m.el).value, old_name: w?.name } }); if (d.error) return $('#err', m.el).textContent = d.error; m.close(); onDone(); };
}

EXT_PAGES.whup = async el => {
  const [whs, ups] = await Promise.all([api('/api/wh/warehouses'), api('/api/wh/uploads')]);
  const body = whShell(el, 'whup', 'Склады и история загрузок');
  body.innerHTML = `<div class="bar"><h3 style="margin:0">Склады</h3><span class="spacer"></span><button class="btn gray needs-edit" id="addwh">+ Склад</button></div>
    <div class="grid">${whs.map(w => `<div class="panel w4"><div class="whcard"><div class="ph" style="margin:0"><div><h4>${esc(w.name)}</h4><div class="sub">${esc(w.note || ' ')}</div></div><button class="twin needs-edit" data-ed="${esc(w.name)}">✎</button></div>
      ${w.latest ? `<div class="stats"><div><b>${UI.fmt0(w.latest.items)}</b><span>позиций</span></div><div><b>${UI.fmt0(w.latest.available)}</b><span>доступно, шт.</span></div><div><b>${UI.fmt0(w.latest.reserved)}</b><span>в резерве</span></div></div><small>Остаток на ${UI.dateRu(w.latest.taken_at)} · загрузок: ${w.uploads}</small>` : '<small>Загрузок ещё нет</small>'}
      <div class="dz sm needs-edit" data-up="${esc(w.name)}" tabindex="0" role="button"><b>Загрузить остатки</b>перетащите файлы или нажмите</div></div></div>`).join('')}</div>
    <h3>История загрузок</h3><div class="scroll"><table><thead><tr><th>Остаток на дату</th><th>Склад</th><th>Файл</th><th class="n">Позиций</th><th class="n">Всего, шт.</th><th class="n">Доступно</th><th class="n">Резерв</th><th>Загрузил</th><th></th></tr></thead><tbody>${ups.length ? ups.map(u => `<tr><td>${UI.dateRu(u.taken_at)}</td><td>${esc(u.warehouse)}</td><td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(u.file)}">${esc(u.file)}</td><td class="n">${u.items}</td><td class="n">${UI.fmt0(u.total)}</td><td class="n">${UI.fmt0(u.available)}</td><td class="n">${UI.fmt0(u.reserved)}</td><td>${esc(u.uploaded_by)}<br><small>${esc((u.uploaded_at || '').slice(0, 16).replace('T', ' '))}</small></td><td class="needs-edit"><button class="btn gray sm" data-del="${u.id}">Удалить</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Загрузок пока нет</td></tr>'}</tbody></table></div>
    <p class="mut" style="margin-top:12px">Как пользоваться: после каждой выгрузки остатков из LINKO загружайте файл в нужный склад. Если за ту же дату файл уже был, он заменится. Чем чаще загрузки, тем точнее движение и прогноз «хватит на сколько дней».</p>`;
  $('#addwh', body).onclick = () => whNameDialog(null, () => route());
  body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => whNameDialog(whs.find(w => w.name === b.dataset.ed), () => route()));
  body.querySelectorAll('[data-up]').forEach(z => UI.bindDrop(z, files => whUploadDialog(() => route(), z.dataset.up, files)));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Удалить эту загрузку? Движение склада пересчитается.')) return; const d = await api(`/api/wh/uploads/${b.dataset.del}/delete`, { method: 'POST', body: {} }); if (d.error) return toast(d.error); route(); });
};
