// Dependency-free SVG/HTML charts. Every function returns an HTML string.
// Conventions (from the dataviz guide): one axis only, thin marks (bars <= 24px, lines 2px, markers r>=4 with a 2px surface ring),
// solid hairline grid, 4px rounded data-end, 2px gaps between touching fills, legend for >= 2 series, text never wears the data color,
// every chart carries a hidden table twin (toggled by the "Таблица" button) and hover tooltips (data-tip, handled in ui.js).
const CH = {
  colors: ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'],
  compact(n) {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн';
    if (a >= 1e4) return s + Math.round(a / 1e3) + ' тыс';
    if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace(/\.0$/, '') + ' тыс';
    return s + (a < 10 && a % 1 ? a.toFixed(1) : Math.round(a));
  },
  nice(v) { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; },
  // clean axis: returns {max, ticks} with 4 intervals
  ticks(maxValue, n = 4) { const step = CH.nice((maxValue || 1) / n), max = Math.max(step * n, step); return { max, ticks: Array.from({ length: n + 1 }, (_, i) => step * i) }; },
  esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  full: n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
  // tooltip attribute: html is shown by the global handler (ui.js); keyboard-focusable so it is not hover-only
  tip(html) { return ` data-tip="${CH.esc(html)}" tabindex="0"`; },
  tipRows(title, rows) { return `<b>${CH.esc(title)}</b>` + rows.map(r => `<div class="tr"><span>${r.color ? `<i class="sw" style="background:${r.color}"></i>` : ''}${CH.esc(r.name)}</span><b>${CH.esc(r.value)}</b></div>`).join(''); },
  twinTable(heads, rows) { return `<div class="tableview"><table><thead><tr>${heads.map((h, i) => `<th class="${i ? 'n' : ''}">${CH.esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${CH.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; },
  legend(items) { return `<div class="legend">${items.map(i => `<span>${i.line ? `<i class="ln" style="background:${i.color}"></i>` : `<i class="dot" style="background:${i.color}"></i>`}${CH.esc(i.name)}</span>`).join('')}</div>`; },
  barPath(x, y, w, h, r = 4) { r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`; },

  sparkline(values, color = 'var(--c1)', w = 120, h = 34) {
    if (values.length < 2) return '';
    const max = Math.max(...values), min = Math.min(...values), span = max - min || 1, p = 4;
    const pts = values.map((v, i) => [p + i * (w - 2 * p) / (values.length - 1), h - p - (v - min) / span * (h - 2 * p)]);
    const line = pts.map(q => q.map(x => x.toFixed(1)).join(',')).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polygon points="${p},${h - p} ${line} ${w - p},${h - p}" fill="${color}" opacity=".10"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="3.2" fill="${color}" stroke="var(--surface)" stroke-width="2"/></svg>`;
  },

  // labels: x labels; series: [{name, color, values}]. Lines 2px, first series gets a 10% wash; crosshair + tooltip on hover.
  area(labels, series, { height = 250, fmt = CH.full, unit = '', fill = true } = {}) {
    if (!labels.length) return '<div class="empty">Нет данных за период</div>';
    const W = 720, H = height, L = 50, R = 18, T = 14, B = 28, n = labels.length;
    const { max, ticks } = CH.ticks(Math.max(...series.flatMap(s => s.values), 0));
    const x = i => (n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1)), y = v => H - B - v / max * (H - T - B);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${CH.compact(v)}</text>`).join('');
    const step = Math.ceil(n / 9);
    const xl = labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}" class="axis">${CH.esc(l)}</text>` : '')).join('');
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const last = s.values.length - 1;
      return `${fill && si === 0 ? `<polygon points="${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity=".10"/>` : ''}<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last)}" cy="${y(s.values[last])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    }).join('');
    const dots = series.map(s => s.values.map((v, i) => `<circle class="hd" data-i="${i}" cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')).join('');
    const bw = (W - L - R) / Math.max(n - 1, 1);
    const hits = labels.map((l, i) => `<rect class="hit" data-i="${i}" data-x="${x(i)}" x="${x(i) - bw / 2}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"${CH.tip(CH.tipRows(l, series.map(s => ({ name: s.name, value: fmt(s.values[i]) + unit, color: s.color }))))}/>`).join('');
    const body = `${series.length > 1 ? CH.legend(series.map(s => ({ ...s, line: true }))) : ''}<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="График по датам">${grid}${xl}<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}"/>${paths}${dots}${hits}</svg>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['Дата', ...series.map(s => s.name)], labels.map((l, i) => [l, ...series.map(s => fmt(s.values[i]) + unit)]));
  },

  // groups: [{label, values:[...]}], series: [{name,color}]. Grouped (or stacked) columns <= 24px thick, 4px round top.
  columns(groups, series, { height = 240, fmt = CH.full, stacked = false } = {}) {
    if (!groups.length) return '<div class="empty">Нет данных за период</div>';
    const W = 720, H = height, L = 50, R = 12, T = 14, B = 30, n = groups.length, slot = (W - L - R) / n;
    const tot = g => (stacked ? g.values.reduce((a, v) => a + v, 0) : Math.max(...g.values));
    const { max, ticks } = CH.ticks(Math.max(...groups.map(tot), 0));
    const y = v => H - B - v / max * (H - T - B), k = series.length, bw = Math.min(24, (slot * 0.7) / (stacked ? 1 : k) - (stacked ? 0 : 2));
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${CH.compact(v)}</text>`).join('');
    const step = Math.ceil(n / 10);
    const marks = groups.map((g, i) => {
      const cx = L + slot * i + slot / 2, tip = CH.tip(CH.tipRows(g.label, series.map((s, j) => ({ name: s.name, value: fmt(g.values[j]), color: s.color }))));
      let bars = '', acc = 0;
      g.values.forEach((v, j) => {
        const h = v / max * (H - T - B); if (h <= 0) return;
        if (stacked) { const top = y(acc + v); bars += `<path d="${CH.barPath(cx - bw / 2, top, bw, h - 2, j === g.values.length - 1 ? 4 : 0)}" fill="${series[j].color}"/>`; acc += v; }
        else { const bx = cx - (k * (bw + 2)) / 2 + j * (bw + 2); bars += `<path d="${CH.barPath(bx, y(v), bw, h)}" fill="${series[j].color}"/>`; }
      });
      return `<g${tip}>${bars}<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>${i % step === 0 || i === n - 1 ? `<text x="${cx}" y="${H - 10}" text-anchor="middle" class="axis">${CH.esc(g.label)}</text>` : ''}</g>`;
    }).join('');
    const body = `${CH.legend(series)}<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${marks}</svg>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', ...series.map(s => s.name)], groups.map(g => [g.label, ...g.values.map(v => fmt(v))]));
  },

  // part-to-whole, at most 6 segments (the tail folds into "Прочие")
  donut(items, { unit = '', max = 6, center = 'всего', fmt = CH.full } = {}) {
    items = items.filter(i => i.value > 0);
    if (!items.length) return '<div class="empty">Нет данных за период</div>';
    if (items.length > max) { const rest = items.slice(max - 1).reduce((a, i) => a + i.value, 0); items = [...items.slice(0, max - 1), { label: 'Прочие', value: rest, color: 'var(--c-other)' }]; }
    const total = items.reduce((a, i) => a + i.value, 0), r = 64, C = 2 * Math.PI * r, gap = items.length > 1 ? 2.5 : 0;
    let acc = 0;
    const col = (it, i) => it.color || CH.colors[i % 8];
    const ring = items.map((it, i) => {
      const len = it.value / total * C, seg = Math.max(len - gap, 0.5);
      const s = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${col(it, i)}" stroke-width="18" stroke-dasharray="${seg.toFixed(2)} ${(C - seg).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 90 90)"${CH.tip(CH.tipRows(it.label, [{ name: `${(it.value / total * 100).toFixed(1)}%`, value: fmt(it.value) + unit, color: col(it, i) }]))}/>`;
      acc += len; return s;
    }).join('');
    const body = `<div class="donut"><svg viewBox="0 0 180 180" role="img"><circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--grid)" stroke-width="18"/>${ring}<text x="90" y="88" text-anchor="middle" class="dnum">${CH.compact(total)}</text><text x="90" y="106" text-anchor="middle" class="axis">${CH.esc(center)}</text></svg>
      <ul class="dlegend">${items.map((it, i) => `<li><i class="dot" style="background:${col(it, i)};margin:0"></i><span class="dl" title="${CH.esc(it.label)}">${CH.esc(it.label)}</span><b>${fmt(it.value)}${unit}</b><em>${(it.value / total * 100).toFixed(0)}%</em></li>`).join('')}</ul></div>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', 'Значение', 'Доля'], items.map(it => [it.label, fmt(it.value) + unit, (it.value / total * 100).toFixed(1) + '%']));
  },

  // items: [{label, sub?, value, color?, segs?: [{name,value,color}]}]. One series = one color; value at the bar tip.
  hbars(items, { color = 'var(--c1)', unit = '', max: forcedMax, empty = 'Нет данных', fmt = CH.compact, share = false } = {}) {
    if (!items.length) return `<div class="empty">${empty}</div>`;
    const tot = it => it.segs ? it.segs.reduce((a, s) => a + s.value, 0) : it.value;
    const max = forcedMax ?? Math.max(...items.map(i => Math.abs(tot(i))), 1), sum = items.reduce((a, i) => a + Math.abs(tot(i)), 0);
    const body = `<div class="hbars">${items.map(it => {
      const v = tot(it), tipRows = it.segs ? it.segs.map(s => ({ name: s.name, value: CH.full(s.value) + unit, color: s.color })) : [{ name: share && sum ? `${(Math.abs(v) / sum * 100).toFixed(1)}% от итога` : 'Значение', value: CH.full(v) + unit, color: it.color || color }];
      const fills = it.segs ? it.segs.filter(s => s.value > 0).map(s => `<div class="hfill" style="width:${Math.max(s.value / max * 100, 1)}%;background:${s.color}"></div>`).join('') : `<div class="hfill" style="width:${Math.max(Math.abs(v) / max * 100, 1.2)}%;background:${it.color || color}"></div>`;
      return `<div class="hrow"${CH.tip(CH.tipRows(it.label, tipRows))}><span class="hl" title="${CH.esc(it.label)}">${CH.esc(it.label)}${it.sub ? `<small>${CH.esc(it.sub)}</small>` : ''}</span><div class="htrack">${fills}</div><span class="hv">${it.text ?? fmt(v) + unit}</span></div>`;
    }).join('')}</div>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', 'Значение'], items.map(i => [i.label, CH.full(tot(i)) + unit]));
  },

  // 100% stacked rows: rows [{label, segs:[{name,value,color}]}]
  stack100(rows, { empty = 'Нет данных' } = {}) {
    if (!rows.length) return `<div class="empty">${empty}</div>`;
    const names = [...new Map(rows.flatMap(r => r.segs).map(s => [s.name, s.color])).entries()].map(([name, color]) => ({ name, color }));
    const body = `${CH.legend(names)}<div class="stack100">${rows.map(r => {
      const t = r.segs.reduce((a, s) => a + s.value, 0) || 1;
      return `<div class="s100row"><span class="hl" title="${CH.esc(r.label)}">${CH.esc(r.label)}</span><div class="s100">${r.segs.filter(s => s.value > 0).map(s => `<div style="flex:${s.value};background:${s.color}"${CH.tip(CH.tipRows(r.label, [{ name: s.name, value: `${CH.full(s.value)} (${(s.value / t * 100).toFixed(0)}%)`, color: s.color }]))}></div>`).join('')}</div></div>`;
    }).join('')}</div>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', ...names.map(n => n.name)], rows.map(r => [r.label, ...names.map(n => CH.full(r.segs.find(s => s.name === n.name)?.value ?? 0))]));
  },

  // one bar split into labelled segments
  stack(items) {
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!total) return '<div class="empty">Нет данных</div>';
    const body = `<div class="stack">${items.filter(i => i.value).map(i => `<div style="flex:${i.value};background:${i.color}"${CH.tip(CH.tipRows(i.label, [{ name: 'Количество', value: String(i.value), color: i.color }]))}></div>`).join('')}</div><ul class="slegend">${items.map(i => `<li><i class="dot" style="background:${i.color};margin:0"></i>${CH.esc(i.label)}<b>${i.value}</b></li>`).join('')}</ul>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', 'Количество'], items.map(i => [i.label, String(i.value)]));
  },

  // progress meter: the fill carries severity, the track is a lighter step of the same hue; optional pace marker (where "on schedule" is)
  meter(value, target, { unit = '', pace = null, label = '', tone: forced } = {}) {
    const pct = target > 0 ? value / target : null;
    let tone = forced ?? '';
    if (!forced && pct !== null) tone = pct >= 1 ? 'good' : pace != null ? (pct >= pace * 0.9 ? '' : pct >= pace * 0.6 ? 'warn' : 'crit') : (pct >= 0.6 ? '' : pct >= 0.3 ? 'warn' : 'crit');
    const w = pct === null ? 0 : Math.min(pct, 1) * 100;
    return `<div class="mrow"${CH.tip(CH.tipRows(label || 'Выполнение', [{ name: 'Факт', value: CH.full(value) + unit }, { name: 'План', value: CH.full(target) + unit }, { name: 'Выполнено', value: pct === null ? '—' : Math.round(pct * 100) + '%' }, ...(pace != null ? [{ name: 'По графику', value: Math.round(pace * 100) + '%' }] : [])]))}>
      <span>${label ? CH.esc(label) : ''}</span><span class="mv"><b>${CH.compact(value)}${unit}</b> / ${CH.compact(target)}${unit} · ${pct === null ? '—' : Math.round(pct * 100) + '%'}</span>
      <div class="meter ${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct === null ? 0 : Math.round(pct * 100)}"><i style="width:${w}%"></i>${pace != null && pace > 0 && pace < 1 ? `<b style="left:${pace * 100}%"></b>` : ''}</div></div>`;
  },

  // stock bridge: opening -> +in -> -out -> closing
  bridge(open, inn, out, close, { unit = '' } = {}) {
    const W = 560, H = 230, L = 14, R = 14, T = 26, B = 34, top = Math.max(open, open + inn, close, 1), y = v => H - B - v / top * (H - T - B);
    const cols = [
      { name: 'Остаток на начало', from: 0, to: open, color: 'var(--c1)', val: CH.full(Math.round(open)) },
      { name: 'Приход', from: open, to: open + inn, color: 'var(--c3)', val: '+' + CH.full(Math.round(inn)) },
      { name: 'Расход', from: open + inn - out, to: open + inn, color: 'var(--c2)', val: '−' + CH.full(Math.round(out)) },
      { name: 'Остаток на конец', from: 0, to: close, color: 'var(--c1)', val: CH.full(Math.round(close)) },
    ];
    const slot = (W - L - R) / 4, bw = 24;
    const marks = cols.map((c, i) => {
      const cx = L + slot * i + slot / 2, y1 = y(c.to), h = Math.max(y(c.from) - y1, 1.5);
      return `<g${CH.tip(CH.tipRows(c.name, [{ name: 'Штук', value: c.val + unit, color: c.color }]))}><path d="${CH.barPath(cx - bw / 2, y1, bw, h)}" fill="${c.color}"/><text x="${cx}" y="${y1 - 7}" text-anchor="middle" class="axis val">${c.val}</text><text x="${cx}" y="${H - 12}" text-anchor="middle" class="axis">${c.name}</text></g>`;
    }).join('');
    const link = (i, v) => `<line x1="${L + slot * i + slot / 2 + bw / 2}" x2="${L + slot * (i + 1) + slot / 2 - bw / 2}" y1="${y(v)}" y2="${y(v)}" stroke="var(--axis)" stroke-width="1"/>`;
    const body = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>${link(0, open)}${link(1, open + inn)}${link(2, close)}${marks}</svg>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', 'Штук'], cols.map(c => [c.name, c.val + unit]));
  },

  // Pareto on ONE axis: bars = share of the total (%), line = cumulative share (%), colored by ABC class
  pareto(items) {
    const total = items.reduce((a, i) => a + i.value, 0);
    if (!total) return '<div class="empty">Нет данных</div>';
    const W = 720, H = 340, L = 46, R = 14, T = 16, B = 100, n = items.length, bw = Math.min(24, (W - L - R) / n * 0.7), slot = (W - L - R) / n;
    let cum = 0;
    const rows = items.map(it => { const before = cum / total * 100; cum += it.value; return { ...it, share: it.value / total * 100, cum: cum / total * 100, cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C' }; });
    const col = { A: 'var(--c1)', B: 'var(--c4)', C: 'var(--c-other)' }, y = p => H - B - p / 100 * (H - T - B);
    const grid = [0, 25, 50, 75, 100].map(p => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" stroke="${p === 0 ? 'var(--axis)' : 'var(--grid)'}"/><text x="${L - 8}" y="${y(p) + 4}" text-anchor="end" class="axis">${p}%</text>`).join('');
    const bars = rows.map((r, i) => {
      const cx = L + slot * i + slot / 2;
      return `<g${CH.tip(CH.tipRows(r.label, [{ name: 'Значение', value: CH.full(r.value) }, { name: 'Доля', value: r.share.toFixed(1) + '%' }, { name: 'Накопленная доля', value: r.cum.toFixed(1) + '%' }, { name: 'Класс', value: r.cls, color: col[r.cls] }]))}><path d="${CH.barPath(cx - bw / 2, y(r.share), bw, Math.max(y(0) - y(r.share), 1.5))}" fill="${col[r.cls]}"/><rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/><text transform="translate(${cx + 4},${H - B + 12}) rotate(-40)" text-anchor="end" class="axis">${CH.esc(r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label)}</text></g>`;
    }).join('');
    const line = rows.map((r, i) => `${(L + slot * i + slot / 2).toFixed(1)},${y(r.cum).toFixed(1)}`).join(' ');
    const cnt = c => rows.filter(r => r.cls === c).length;
    const body = `${CH.legend([{ name: `A — ${cnt('A')} (до 80%)`, color: col.A }, { name: `B — ${cnt('B')} (до 95%)`, color: col.B }, { name: `C — ${cnt('C')}`, color: col.C }, { name: 'накопленная доля', color: 'var(--text)', line: true }])}<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${bars}<polyline points="${line}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" opacity=".75"/></svg>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['Позиция', 'Значение', 'Доля', 'Накоп.', 'Класс'], rows.map(r => [r.label, CH.full(r.value), r.share.toFixed(1) + '%', r.cum.toFixed(1) + '%', r.cls]));
  },

  // vertical bars (single series)
  vbars(items, { height = 220, color = 'var(--c1)', colors, fmt = CH.compact } = {}) {
    if (!items.length) return '<div class="empty">Нет данных</div>';
    const W = 420, H = height, L = 8, B = 30, T = 22, max = Math.max(...items.map(i => i.value), 1), slot = (W - 2 * L) / items.length, bw = Math.min(24, slot * 0.64);
    const body = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" stroke="var(--axis)"/>${items.map((it, i) => {
      const h = it.value / max * (H - T - B), cx = L + slot * i + slot / 2;
      return `<g${CH.tip(CH.tipRows(it.label, [{ name: 'Значение', value: CH.full(it.value), color: colors ? colors[i] : color }]))}><path d="${CH.barPath(cx - bw / 2, H - B - h, bw, Math.max(h, 1))}" fill="${colors ? colors[i] : color}"/><text x="${cx}" y="${H - B - h - 6}" text-anchor="middle" class="axis val">${fmt(it.value)}</text><text x="${cx}" y="${H - 10}" text-anchor="middle" class="axis">${CH.esc(it.label.length > 9 ? it.label.slice(0, 8) + '…' : it.label)}</text></g>`;
    }).join('')}</svg>`;
    return `<div class="chartview">${body}</div>` + CH.twinTable(['', 'Значение'], items.map(i => [i.label, CH.full(i.value)]));
  },

  // semi-circle gauge (kept for the older dashboards): bar capped at 100%, text shows the real value
  gauge(percent, label = '', sub = '') {
    const p = Math.max(0, Math.min(percent ?? 0, 100)), col = percent >= 100 ? 'var(--st-good)' : percent >= 60 ? 'var(--st-warn)' : 'var(--st-crit)';
    return `<div class="gauge"><svg viewBox="0 0 200 118" role="img" aria-label="${CH.esc(label)} ${percent ?? 0}%"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--grid)" stroke-width="14" stroke-linecap="round" pathLength="100"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" pathLength="100" stroke-dasharray="${p} 100"/><text x="100" y="92" text-anchor="middle" class="gnum">${percent == null ? '—' : percent + '%'}</text></svg><div class="gl">${CH.esc(label)}</div><small>${CH.esc(sub)}</small></div>`;
  },
};
