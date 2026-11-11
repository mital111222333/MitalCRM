// Накладные: сроки оплаты и спецпредложения (Деньги → 🧾 Накладные: сроки).
// Every new LINKO invoice of a client without a contract shows up here. By default it is paid like every order of the рассрочка
// (4 parts: 7, 14, 21 and 30 days); here its own schedule is set — «сразу», a week, 1–3 months, own dates, or 2–3 parts —
// together with the conditions: the discount from the price list, bonuses (free goods, service books, money), a promotion.
// An invoice that is not the standard 10% discount (or has bonus goods) is a special offer: a one-time contract is printed
// with everything filled in, signed by you and the others, and kept; «📁 Сдан на хранение» marks that it is in the archive.
// The schedule goes to the auto-loader with the рассрочка rules (inst-rules.json → orders), which counts what is paid of every
// invoice (payments close the oldest invoices first) and sends the reminders: the day before, on the day, and every day overdue.
// Stored in the synced state: ext.inst.orders = { [invoice id]: { plan?: [{d, s}], days?, disc?, bonus?, cond?, spec?, ok?, stored?,
//   snap: { c: client, a: agent, d: date, s: sum } } }, ext.inst.form = { company, city, std, signers: [..] }.
window.EXT_PAGES = window.EXT_PAGES || {};

const INVO = {
  tab: 'new', agent: '', q: '', sel: new Set(),
  cfg() {
    const c = INST.cfg(); c.form ||= { company: 'MITAL', city: '', std: 10, signers: ['Руководитель', 'Бухгалтер', 'Супервайзер'] };
    // the first version had four signatures (руководитель, агент, бухгалтер, клиент): that exact list becomes руководитель, бухгалтер, супервайзер
    if (JSON.stringify(c.form.signers) === JSON.stringify(['Руководитель', 'Агент', 'Бухгалтер', 'Клиент'])) c.form.signers = ['Руководитель', 'Бухгалтер', 'Супервайзер'];
    return c;
  },
  money: v => '$' + UI.fmt0(Math.round((v || 0) * 100) / 100),
  money2: v => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  closed: s => /cancel|reject|отмен|отклон/i.test(String(s || '')),
  usd: cur => !cur || /usd|\$|долл/i.test(cur),
  day: d => String(d || '').slice(0, 10),
  addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
  // the same date n months later (31.01 + 1 month = 28/29.02)
  addMonths(d, n) { const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, dd = +d.slice(8, 10), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(dd, last))).toISOString().slice(0, 10); },

  // ---------- LINKO invoices of this period, with the discount and bonus goods ----------
  // LINKO «discount_price»: when it is a small part of the sum it is the discount amount (sum after discount = total_price),
  // when it is close to the sum it is the price after the discount. Either way the result is the % off the price list.
  discount(o) {
    const t = LX.n(o.total_price), d = LX.n(o.discount_price);
    if (!(t > 0) || !(d > 0)) return { pct: 0, alt: 0 };
    if (d < t * 0.5) return { pct: d / (t + d) * 100, alt: d / t * 100 };
    return { pct: (1 - d / t) * 100, alt: (t - d) / d * 100 };
  },
  contractNames() { const s = new Set(); for (const k of INST.cfg().contracts || []) for (const a of k.accounts || []) s.add(LX.norm(a)); return s; },
  list() {
    const c = INVO.cfg(), std = Number(c.form.std ?? 10), ct = INVO.contractNames(), items = new Map();
    for (const i of LX.d('items')) {
      if (!i.is_bonus) continue;
      const q = LX.n(i.amount) - LX.n(i.return_amount); if (!(q > 0)) continue;
      const l = items.get(String(i.order_id)) || []; l.push(`${i.product_name || 'товар'} × ${Math.round(q * 100) / 100}`); items.set(String(i.order_id), l);
    }
    const out = [], seen = new Set();
    for (const o of LX.d('orders')) {
      if (o.id == null || INVO.closed(o.status) || !INVO.usd(o['currency.name'])) continue;
      const client = String(o['client.name'] || '').trim(), s = LX.n(o.total_price) - LX.n(o.total_return_price);
      if (!client || !(s > 0.005) || ct.has(LX.norm(client))) continue;
      const id = String(o.id), x = c.orders[id] || {}, dc = INVO.discount(o), bonus = items.get(id) || [];
      const special = bonus.length > 0 || (dc.pct > 0.05 && Math.abs(dc.pct - std) > 0.6 && Math.abs(dc.alt - std) > 0.6) || (!(dc.pct > 0.05) && std > 0);
      seen.add(id);
      out.push({ id, d: INVO.day(o.created_date), client, agent: LX.clientAgent(client, LX.person(o, 'user')), s: Math.round(s * 100) / 100, disc: dc.pct, bonusItems: bonus, auto: special, x });
    }
    // special offers of earlier periods stay in the list from what was saved with them
    for (const [id, x] of Object.entries(c.orders)) if (!seen.has(id) && x.snap && (x.spec || x.ok)) out.push({ id, d: x.snap.d, client: x.snap.c, agent: x.snap.a, s: x.snap.s, disc: x.disc ?? 0, bonusItems: [], auto: !!x.spec, x, old: true });
    return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : Number(b.id) - Number(a.id)));
  },
  isSpec: r => (r.x.spec !== undefined ? !!r.x.spec : r.auto),
  status: r => (r.x.stored ? 'stored' : r.x.ok ? 'ok' : 'new'),

  // ---------- the schedule ----------
  stdPlan(d, s) { const c = INST.cfg(), days = Number(c.days) || 30, parts = Math.max(1, Number(c.parts) || 4), weekly = 7 * (parts - 1) < days; return Array.from({ length: parts }, (_, i) => ({ d: INVO.addDays(d, i + 1 === parts ? days : weekly ? 7 * (i + 1) : Math.round(days * (i + 1) / parts)), s: Math.round(s / parts * 100) / 100 })); },
  planOf(r) { const x = r.x; if (Array.isArray(x.plan) && x.plan.length) return x.plan; if (x.days) return [{ d: INVO.addDays(r.d, Number(x.days)), s: r.s }]; return INVO.stdPlan(r.d, r.s); },
  termText(r) {
    const x = r.x, pl = INVO.planOf(r);
    if (!x.plan && !x.days) return `<span class="mut">стандарт: ${pl.length} ч. до ${UI.dm(pl.at(-1).d)}</span>`;
    if (pl.length === 1) return pl[0].d === r.d ? '<b>сразу</b>' : `<b>${UI.dm(pl[0].d)}</b> <span class="mut">(${INVO.days(r.d, pl[0].d)} дн.)</span>`;
    return pl.map(p => `${UI.dm(p.d)} · ${INVO.money(p.s)}`).join('<br>');
  },
  days: (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5),
  // «15.12-500, 15.01.2027-500» or one per line; a date without a year is the first such date not earlier than the invoice
  parse(text, from) {
    const ok = [], bad = [];
    for (const part of String(text || '').split(/\s*[;\n]+\s*|,\s+(?=\d{1,2}[.\/])/).map(x => x.trim()).filter(Boolean)) {
      const m = part.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\s*[-–—:=]\s*\$?\s*([\d\s.,']+?)\s*\$?$/);
      if (!m) { bad.push(part); continue; }
      let amt = m[4].replace(/[\s']/g, ''); amt = /^\d{1,3}(,\d{3})+$/.test(amt) ? amt.replace(/,/g, '') : amt.replace(',', '.');
      const dd = +m[1], mm = +m[2], s = Number(amt);
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +from.slice(0, 4);
      const mk = yy => { const t = new Date(Date.UTC(yy, mm - 1, dd)); return t.getUTCMonth() === mm - 1 && t.getUTCDate() === dd ? t.toISOString().slice(0, 10) : null; };
      let d = mm >= 1 && mm <= 12 ? mk(y) : null;
      if (d && !m[3] && d < INVO.addDays(from, -1)) d = mk(y + 1);
      if (!d || !(s > 0)) { bad.push(part); continue; }
      ok.push({ d, s: Math.round(s * 100) / 100 });
    }
    return { ok: ok.sort((a, b) => a.d.localeCompare(b.d)), bad };
  },
  text: pl => pl.map(p => `${p.d.slice(8)}.${p.d.slice(5, 7)}.${p.d.slice(0, 4)} - ${p.s}`).join('\n'),

  save(r, v) {
    const c = INVO.cfg(), x = { ...(c.orders[r.id] || {}) };
    for (const k of ['plan', 'days']) delete x[k];
    Object.assign(x, v, { snap: { c: r.client, a: r.agent, d: r.d, s: r.s } });
    if (!x.ok) x.ok = UI.localDate(Date.now());
    c.orders[r.id] = JSON.parse(JSON.stringify(x));
    INVO.prune(); INST.changed('Накладная №' + r.id + ' сохранена — напоминания пересчитаются за 5 минут');
  },
  // invoices older than half a year are not needed by the reminders any more (special offers are kept for the archive list)
  prune() { const c = INVO.cfg(), cut = INVO.addDays(UI.localDate(Date.now()), -200); for (const [id, x] of Object.entries(c.orders)) if (x.snap?.d && x.snap.d < cut && !x.spec) delete c.orders[id]; },

  dialog(r, el) {
    const x = r.x, pl0 = INVO.planOf(r), isStd = !x.plan && !x.days;
    const bonus0 = x.bonus ?? r.bonusItems.join('\n');
    const m = modal(`<h3 style="margin:0 0 4px">Накладная №${esc(r.id)} от ${UI.dateRu(r.d)}</h3>
      <p class="mut" style="margin:0 0 10px"><b>${esc(r.client)}</b> · ${esc(r.agent)} · сумма <b>${INVO.money2(r.s)}</b></p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[['now', 'Сразу'], ['d7', '7 дней'], ['d14', '2 недели'], ['m1', '1 месяц'], ['m2', '2 месяца'], ['m3', '3 месяца'], ['std', `Стандарт (${INST.cfg().parts || 4} ч. за ${INST.cfg().days || 30} дн.)`]].map(([k, t]) => `<button class="btn gray sm" data-pre="${k}" type="button">${t}</button>`).join('')}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="mut">Разбить на</span><input id="ivN" type="number" min="2" max="12" value="2" style="width:60px"><span class="mut">частей, каждые</span><select id="ivE"><option value="m1">1 месяц</option><option value="w2">2 недели</option><option value="w1">1 неделю</option></select><button class="btn gray sm" id="ivSplit" type="button">Разбить</button></div>
      <label class="mut" style="display:block">График оплаты: дата - сумма, по строке на часть (например <b>15.12 - 500</b>). Пусто — стандартный срок.<textarea id="ivT" rows="4" style="width:100%;box-sizing:border-box;font-family:inherit">${esc(isStd ? '' : INVO.text(pl0))}</textarea></label>
      <div id="ivP" style="margin:6px 0 10px;min-height:22px"></div>
      <div class="form">
        <label>Скидка от прайса, %<input id="ivD" type="number" min="0" max="100" step="0.5" value="${Math.round((x.disc ?? r.disc) * 10) / 10}"></label>
        <label style="display:flex;gap:8px;align-items:end"><span style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ivS" ${INVO.isSpec(r) ? 'checked' : ''}> Спецпредложение — печатать договор</span></label>
        <label style="grid-column:1/-1">Бонусы <span class="mut">(бесплатный товар, сервисные книжки, деньги бонусом…)</span><textarea id="ivB" rows="2" style="width:100%;box-sizing:border-box;font-family:inherit">${esc(bonus0)}</textarea></label>
        <label style="grid-column:1/-1">Акция / другие условия<input id="ivC" value="${esc(x.cond || '')}" placeholder="например: акция «2+1», доставка за наш счёт"></label>
      </div>
      <div class="bar"><span class="spacer"></span><button class="btn gray" id="ivX" type="button">Отмена</button><button class="btn" id="ivOk" type="button">Сохранить</button><button class="btn" id="ivPr" type="button">Сохранить и 🖨 договор</button></div>`);
    const T = $('#ivT', m.el);
    const pv = () => {
      if (!T.value.trim()) { $('#ivP', m.el).innerHTML = `<span class="mut">Стандартный график: ${INVO.stdPlan(r.d, r.s).map(p => UI.dm(p.d) + ' · ' + INVO.money(p.s)).join(', ')}</span>`; $('#ivOk', m.el).disabled = $('#ivPr', m.el).disabled = false; return; }
      const res = INVO.parse(T.value, r.d), tot = res.ok.reduce((a, p) => a + p.s, 0), diff = Math.round((r.s - tot) * 100) / 100;
      $('#ivP', m.el).innerHTML = res.ok.map(p => `<span class="chip">${UI.dateRu(p.d)} · ${INVO.money2(p.s)}</span>`).join(' ') + (res.ok.length ? ` <b>Σ ${INVO.money2(tot)}</b>` : '') +
        (Math.abs(diff) > 0.01 && res.ok.length ? `<div class="${diff > 0 ? 'neg' : 'mut'}" style="margin-top:4px">${diff > 0 ? `Не хватает ${INVO.money2(diff)} до суммы накладной — добавится к последней части` : `Больше суммы накладной на ${INVO.money2(-diff)} — последняя часть будет меньше`}</div>` : '') +
        (res.bad.length ? `<div class="neg" style="margin-top:4px">Не понял: ${esc(res.bad.join('; '))}. Пример: 15.12 - 500</div>` : '');
      $('#ivOk', m.el).disabled = $('#ivPr', m.el).disabled = !!res.bad.length;
    };
    const set = pl => { T.value = pl ? INVO.text(pl) : ''; pv(); };
    T.oninput = pv;
    m.el.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => {
      const k = b.dataset.pre;
      if (k === 'std') return set(null);
      const d = k === 'now' ? r.d : k === 'd7' ? INVO.addDays(r.d, 7) : k === 'd14' ? INVO.addDays(r.d, 14) : INVO.addMonths(r.d, +k.slice(1));
      set([{ d, s: r.s }]);
    });
    $('#ivSplit', m.el).onclick = () => {
      const n = Math.max(2, Math.min(12, Number($('#ivN', m.el).value) || 2)), e = $('#ivE', m.el).value, each = Math.floor(r.s / n * 100) / 100;
      set(Array.from({ length: n }, (_, i) => ({ d: e === 'm1' ? INVO.addMonths(r.d, i + 1) : INVO.addDays(r.d, (e === 'w2' ? 14 : 7) * (i + 1)), s: i === n - 1 ? Math.round((r.s - each * (n - 1)) * 100) / 100 : each })));
    };
    pv();
    $('#ivX', m.el).onclick = m.close;
    const collect = () => {
      const res = T.value.trim() ? INVO.parse(T.value, r.d) : { ok: [], bad: [] };
      if (res.bad.length) return null;
      return { ...(res.ok.length ? { plan: res.ok } : {}), disc: Number($('#ivD', m.el).value) || 0, bonus: $('#ivB', m.el).value.trim(), cond: $('#ivC', m.el).value.trim(), spec: $('#ivS', m.el).checked, ok: UI.localDate(Date.now()), ...(x.stored ? { stored: x.stored } : {}) };
    };
    $('#ivOk', m.el).onclick = () => { const v = collect(); if (!v) return; INVO.save(r, v); m.close(); EXT_PAGES.invo(el); };
    $('#ivPr', m.el).onclick = () => { const v = collect(); if (!v) return; v.spec = true; INVO.save(r, v); m.close(); EXT_PAGES.invo(el); INVO.preview([{ ...r, x: INVO.cfg().orders[r.id] }]); };
  },

  // ---------- the one-time contract (special offer): half of an A4 sheet, filled in from the invoice ----------
  // 190 × 138 mm: two on one sheet (a copy for the client and one for us, or two different contracts). A contract that would not fit
  // is shrunk (nothing is cut). It can be printed, saved as a picture (PNG) and sent to Telegram.
  HALF: 521, // px: 138 mm
  css: () => `.cdoc{box-sizing:border-box;width:190mm;background:#fff!important;color:#000!important;font:10.5px/1.35 Arial,Helvetica,sans-serif;position:relative;overflow:hidden;text-align:left;border-radius:0;box-shadow:none}
.cdoc *{box-sizing:border-box;color:#000;background:transparent;text-shadow:none}
.cdoc .d-fit{padding:4mm 5mm 3mm}
.cdoc .d-h1{font-size:15.5px;text-align:center;margin:0 0 1px;letter-spacing:.3px;font-weight:700}
.cdoc .d-sub{text-align:center;margin:0 0 4px;font-size:10px}
.cdoc .d-in{margin:0 0 5px}
.cdoc .d-h2{font-size:10.8px;font-weight:700;margin:6px 0 2px;text-transform:uppercase;letter-spacing:.2px}
.cdoc table{width:100%;border-collapse:collapse;border:0;border-radius:0;box-shadow:none;overflow:visible;background:#fff;margin:0}
.cdoc table tr>th,.cdoc table tr>td{border:1px solid #000;padding:3px 5px;vertical-align:top;text-align:left;font-weight:normal;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.35;color:#000;white-space:normal;position:static;background:#fff;height:auto}
.cdoc table tr>th{font-weight:700;background:#f0f0f0}
.cdoc .d-kv tr>th{width:17%}
.cdoc .d-kv tr>td{width:33%}
.cdoc .d-sum{font-size:12.5px;font-weight:700}
.cdoc .d-sch{display:flex;gap:8px;align-items:flex-start}
.cdoc .d-sch table{flex:1}
.cdoc .d-sch tr>td:nth-child(3){text-align:right;white-space:nowrap}
.cdoc .d-sch tr>td:first-child,.cdoc .d-sch tr>th:first-child{width:20px;text-align:center}
.cdoc .d-sch tr.d-tot>td{font-weight:700;background:#f0f0f0}
.cdoc .d-ft{margin:5px 0 2px}
.cdoc .d-sg{display:flex;gap:10px;align-items:flex-end}
.cdoc .d-sgs{flex:1;display:flex;gap:14px;flex-wrap:wrap}
.cdoc .d-who{flex:1 1 30%;min-width:44mm}
.cdoc .d-who b{display:block;margin:0 0 15px;font-size:10.5px}
.cdoc .d-ln{display:flex;gap:6px;font-size:8.5px;color:#555}
.cdoc .d-ln span{border-top:1px solid #000;padding-top:1px;text-align:center;color:#555}
.cdoc .d-ln span:nth-child(1){flex:2}.cdoc .d-ln span:nth-child(2){flex:1.2}.cdoc .d-ln span:nth-child(3){flex:1}
.cdoc .d-mp{width:17mm;height:17mm;border:1px dashed #888;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#888;font-size:9px;flex:none;margin-bottom:2px}`,
  doc(r) {
    const F = INVO.cfg().form, x = r.x || {}, pl = INVO.planOf(r), tot = pl.reduce((a, p) => a + p.s, 0), today = UI.localDate(Date.now());
    const bonus = String(x.bonus ?? r.bonusItems.join('\n')).trim(), disc = Math.round((x.disc ?? r.disc) * 10) / 10, sg = (F.signers || []).filter(Boolean);
    const term = pl.length === 1 ? `<b>${UI.dateRu(pl[0].d)}</b>${pl[0].d === r.d ? ' (сразу)' : ` (${INVO.days(r.d, pl[0].d)} дн.)`}` : `<b>${pl.length} частями</b>, последняя — ${UI.dateRu(pl.at(-1).d)}`;
    // the schedule: one table, or two side by side when there are many parts
    const head = '<thead><tr><th>№</th><th>Дата оплаты</th><th>Сумма</th><th>Отметка об оплате</th></tr></thead>';
    const trs = (list, from) => list.map((p, i) => `<tr><td>${from + i + 1}</td><td>${UI.dateRu(p.d)}</td><td>${INVO.money2(p.s)}</td><td></td></tr>`).join('');
    const totRow = `<tr class="d-tot"><td></td><td>Итого</td><td>${INVO.money2(tot)}</td><td></td></tr>`;
    const half = Math.ceil(pl.length / 2);
    const sched = pl.length > 6 ? `<div class="d-sch"><table class="noxg">${head}<tbody>${trs(pl.slice(0, half), 0)}</tbody></table><table class="noxg">${head}<tbody>${trs(pl.slice(half), half)}${totRow}</tbody></table></div>`
      : `<div class="d-sch"><table class="noxg">${head}<tbody>${trs(pl, 0)}${totRow}</tbody></table></div>`;
    return `<section class="cdoc no-xg"><div class="d-fit">
      <div class="d-h1">ДОГОВОР-СПЕЦПРЕДЛОЖЕНИЕ № ${esc(r.id)}</div>
      <div class="d-sub">разовый договор к накладной № ${esc(r.id)} от ${UI.dateRu(r.d)}${F.city ? ' · ' + esc(F.city) : ''} · ${UI.dateRu(today)}</div>
      <div class="d-in"><b>${esc(F.company || '')}</b> (Поставщик) и клиент <b>${esc(r.client)}</b> (Покупатель) договорились об особых условиях поставки по накладной № ${esc(r.id)}.</div>
      <div class="d-h2">1. Накладная</div>
      <table class="noxg d-kv"><tbody>
        <tr><th>Клиент (как в LINKO)</th><td>${esc(r.client)}</td><th>Накладная</th><td>№ ${esc(r.id)} от ${UI.dateRu(r.d)}</td></tr>
        <tr><th>Агент</th><td>${esc(r.agent || '—')}</td><th>Сумма накладной</th><td class="d-sum">${INVO.money2(r.s)}</td></tr>
      </tbody></table>
      <div class="d-h2">2. Условия</div>
      <table class="noxg d-kv"><tbody>
        <tr><th>Скидка</th><td>${disc > 0 ? `<b>${String(disc).replace('.', ',')}%</b> от прайса` : 'по прайсу, без скидки'}</td><th>Срок оплаты</th><td>${term}</td></tr>
        <tr><th>Бонусы</th><td>${bonus ? esc(bonus).replace(/\n/g, '<br>') : '—'}</td><th>Акция / другие условия</th><td>${x.cond ? esc(x.cond) : '—'}</td></tr>
      </tbody></table>
      <div class="d-h2">3. График оплаты</div>
      ${sched}
      <div class="d-ft">Покупатель обязуется оплатить сумму накладной в указанные сроки. Условия этого договора действуют только для накладной № ${esc(r.id)}.</div>
      <div class="d-sg"><div class="d-sgs">${sg.map(s => `<div class="d-who"><b>${esc(s)}</b><div class="d-ln"><span>ФИО</span><span>Подпись</span><span>Дата</span></div></div>`).join('')}</div><div class="d-mp">М.П.</div></div>
    </div></section>`;
  },
  // a contract that is taller than half a sheet is shrunk to fit (width grows by the same factor, so nothing is cut)
  fit(doc) {
    const fit = doc.querySelector('.d-fit'); if (!fit) return;
    fit.style.cssText = ''; doc.style.height = '';
    if (fit.offsetHeight <= INVO.HALF) return;
    let k = 1;
    for (let i = 0; i < 5; i++) { fit.style.cssText = `width:${100 / k}%;transform:scale(${k});transform-origin:0 0`; const h = fit.offsetHeight * k; if (h <= INVO.HALF + 1) break; k *= INVO.HALF / h * 0.995; }
    doc.style.height = Math.min(INVO.HALF, Math.ceil(fit.offsetHeight * k)) + 'px';
  },
  // print: A4 sheets with two halves each; `two` — each contract twice (a copy for the client and one for us), otherwise the contracts follow each other
  printDocs(docs, two) {
    const items = []; docs.forEach(h => { items.push(h); if (two) items.push(h); });
    const sheets = []; for (let i = 0; i < items.length; i += 2) sheets.push(items.slice(i, i + 2));
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(fr);
    const d = fr.contentDocument; d.open();
    d.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Договор-спецпредложение</title><style>@page{size:A4;margin:8mm 10mm}*{box-sizing:border-box}body{margin:0;background:#fff}
      .sheet{height:281mm;page-break-after:always;overflow:hidden}.sheet:last-child{page-break-after:auto}.half{height:140mm;position:relative}.half+.half{border-top:1px dashed #888}.half+.half::before{content:"✂";position:absolute;left:-1mm;top:-3.4mm;font-size:9px;color:#888;background:#fff}${INVO.css()}</style></head><body>${sheets.map(s => `<div class="sheet">${s.map(h => `<div class="half">${h}</div>`).join('')}</div>`).join('')}</body></html>`);
    d.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { toast('Не удалось открыть печать — скачайте картинкой'); } }, 350);
    setTimeout(() => fr.remove(), 120000);
  },
  // the contract as a picture (PNG): the document is drawn by the browser itself from its own HTML, so it looks exactly as printed
  async png(docEl) {
    const w = Math.ceil(docEl.getBoundingClientRect().width), h = Math.ceil(docEl.getBoundingClientRect().height), S = 2.5;
    const xml = new XMLSerializer().serializeToString(docEl.cloneNode(true));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * S)}" height="${Math.round(h * S)}"><foreignObject x="0" y="0" width="${w}" height="${h}" transform="scale(${S})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${INVO.css()}</style>${xml}</div></foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('браузер не смог нарисовать картинку')); });
    const cv = document.createElement('canvas'); cv.width = Math.round(w * S); cv.height = Math.round(h * S);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); if (!blob) throw new Error('картинка не получилась'); return blob;
  },
  fileName: r => ('Договор-' + r.id + '-' + String(r.client || '').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30) + '.png').replace(/_\.png$/, '.png'),
  // the preview: every contract on the screen as it will be printed, with the buttons: print, picture, send, copy
  preview(rows) {
    rows = (rows || []).filter(Boolean);
    if (!rows.length) return toast('Нечего печатать');
    const canShare = !!(navigator.canShare && navigator.share);
    const m = modal(`<h3 style="margin:0 0 8px">📄 Договор-спецпредложение</h3>
      <style>${INVO.css()}</style>
      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pvTwo"> 2 экземпляра на листе А4 (если нужно два)</label><span class="spacer"></span><button class="btn" id="pvPr" type="button">🖨 Печать</button><button class="btn gray" id="pvX" type="button">Закрыть</button></div>
      <div style="max-height:68vh;overflow:auto">${rows.map((r, i) => `<div style="margin:0 0 14px"><div class="bar" style="flex-wrap:wrap;gap:6px;margin-bottom:6px"><b>№${esc(r.id)} · ${esc(r.client)}</b><span class="spacer"></span>
        <button class="btn gray sm" data-png="${i}" type="button">🖼 Скачать картинкой</button>${canShare ? `<button class="btn gray sm" data-share="${i}" type="button">📤 Отправить (Telegram…)</button>` : ''}<button class="btn gray sm" data-copy="${i}" type="button">📋 Копировать картинку</button></div>
        <div style="display:inline-block;max-width:100%;overflow:auto;border:1px solid var(--line-2,#ccc)">${INVO.doc(r)}</div></div>`).join('')}</div>
      <p class="mut" style="font-size:12px;margin:6px 0 0">Договор занимает половину листа А4: распечатайте, поставьте подписи и печать (М.П.). Картинку можно сразу отправить в Telegram.</p>`);
    m.el.classList.add('wide');
    const docs = [...m.el.querySelectorAll('.cdoc')]; docs.forEach(INVO.fit);
    $('#pvX', m.el).onclick = m.close;
    $('#pvPr', m.el).onclick = () => INVO.printDocs(docs.map(d => d.outerHTML), $('#pvTwo', m.el).checked);
    const blobOf = async i => { try { return await INVO.png(docs[i]); } catch (e) { toast('Не получилось сделать картинку: ' + (e.message || e) + '. Нажмите «Печать» → «Сохранить как PDF»'); return null; } };
    m.el.querySelectorAll('[data-png]').forEach(b => b.onclick = async () => { const i = +b.dataset.png, bl = await blobOf(i); if (!bl) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = INVO.fileName(rows[i]); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); toast('Картинка сохранена — отправьте её в Telegram'); });
    m.el.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => { const i = +b.dataset.share, bl = await blobOf(i); if (!bl) return; const file = new File([bl], INVO.fileName(rows[i]), { type: 'image/png' }); try { if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Договор-спецпредложение №' + rows[i].id }); else toast('Это устройство не умеет отправлять файлы — скачайте картинкой'); } catch (e) { if (e.name !== 'AbortError') toast('Не получилось отправить: ' + (e.message || e)); } });
    m.el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const bl = await blobOf(+b.dataset.copy); if (!bl) return; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]); toast('Картинка скопирована — вставьте в Telegram (Ctrl+V)'); } catch { toast('Браузер не дал скопировать — нажмите «Скачать картинкой»'); } });
  },
  print(rows) { INVO.preview(rows); },

  // ---------- one invoice as a card: what is in it, the agreed term, the reminders, the contract ----------
  // the row of an invoice as the «Накладные» page has it (from the LINKO order); an order of a client with a contract is built by hand
  rowOf(o, map) {
    const id = String(o.id), r = map ? map.get(id) : INVO.list().find(x => x.id === id);
    return r || { id, d: o.date || o.d, client: o.client, agent: o.agent || '', s: Math.round(((o.sum ?? o.s) - (o.ret || 0)) * 100) / 100, disc: 0, bonusItems: [], auto: false, x: INVO.cfg().orders[id] || {} };
  },
  // a hidden element for the dialog of an invoice: when it saves, the page behind it asks to draw itself again into this element
  sink(after) {
    if (!EXT_PAGES.invo.__sink) { const orig = EXT_PAGES.invo; const w = function (el) { if (el && el._sink) return el._sink(); return orig.apply(this, arguments); }; w.__sink = true; EXT_PAGES.invo = w; }
    const el = document.createElement('div'); el._sink = after; return el;
  },
  orderCard(r, after) {
    const M = LX.model(), f = INVO.money2, x = r.x || {}, pl = INVO.planOf(r), today = UI.localDate(Date.now()), c = INVO.cfg();
    const lines = M.lines.filter(l => String(l.order) === String(r.id));
    const disc = Math.round((x.disc ?? r.disc) * 10) / 10, std = c.form.std ?? 10, tg = CRMLocal.ext().tg || {}, on = !!INST.cfg().on;
    const meOk = !!tg.me?.id, agOk = !!tg.chats?.[r.agent]?.id, hour = String(INST.cfg().hour ?? 9).padStart(2, '0') + ':00';
    const ok = (v, yes, no) => v ? `<div>✅ ${yes}</div>` : `<div class="neg">⚠ ${no}</div>`;
    const dm = d => UI.dm(d), rem = p => (p.d < today ? '<span class="mut">срок прошёл</span>' : `${p.d > INVO.addDays(today, 1) ? dm(INVO.addDays(p.d, -1)) + ' (за день) и ' : p.d === INVO.addDays(today, 1) ? 'завтра (за день) и ' : ''}${p.d === today ? 'сегодня' : dm(p.d)} (в день срока)`);
    const m = modal(`<h3 style="margin:0 0 2px">Накладная №${esc(r.id)} · ${UI.dateRu(r.d)}</h3>
      <p class="mut" style="margin:0 0 10px"><b>${esc(r.client)}</b> · агент ${esc(r.agent || '—')} · сумма <b>${f(r.s)}</b> · скидка <b class="${Math.abs(disc - std) > 0.6 ? 'neg' : ''}">${disc > 0.05 ? disc + '%' : 'нет'}</b>${Math.abs(disc - std) > 0.6 ? ` (стандарт ${std}%)` : ` (стандарт)`}${x.cond ? ` · <i>${esc(x.cond)}</i>` : ''}</p>
      <div class="scroll" style="max-height:220px">${lines.length ? `<table><thead><tr><th>Товар</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead><tbody>${lines.map(l => { const q = l.qty - l.ret; return `<tr><td>${esc(l.product)}${l.bonus ? ' <span class="pill warn">бонус</span>' : ''}</td><td class="num">${UI.fmt0(q)}</td><td class="num">${l.bonus ? '—' : q ? f(l.sum / q) : '—'}</td><td class="num">${l.bonus ? '—' : f(l.sum)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="mut">Состав заказа в загруженных данных LINKO не найден.</p>'}</div>
      ${String(x.bonus ?? r.bonusItems.join(', ')).trim() ? `<p style="margin:8px 0 0"><b>Бонусы:</b> ${esc(String(x.bonus ?? r.bonusItems.join(', '))).replace(/\n/g, '<br>')}</p>` : ''}
      <h4 style="margin:12px 0 4px">Когда клиент должен оплатить <span class="mut" style="font-weight:normal">— ${x.plan || x.days ? '🤝 как договорились' : 'стандартный график'}</span></h4>
      <div class="scroll"><table><thead><tr><th>№</th><th>Срок</th><th class="num">Сумма</th><th>Напоминание ${on ? 'вам и агенту' : ''}</th></tr></thead><tbody>${pl.map((p, i) => `<tr><td>${i + 1}</td><td><b>${UI.dateRu(p.d)}</b></td><td class="num">${f(p.s)}</td><td><small>${on ? rem(p) : '—'}</small></td></tr>`).join('')}</tbody></table></div>
      <div style="margin:8px 0;font-size:13px">${on ? `<div>🔔 Напоминания приходят в Telegram утром (${hour}): за день до срока, в день срока и каждый день, пока не оплачено.</div>` : '<div class="neg">⚠ Напоминания выключены: «Рассрочка и договоры» → ⚙ Настройки → «Включить».</div>'}
        ${ok(meOk, 'Вам придёт в Telegram', 'Ваш чат не выбран — раздел «Telegram агентам»')}${ok(agOk, `Агенту ${esc(r.agent)} придёт в Telegram`, `У агента ${esc(r.agent || '')} не привязан Telegram — привяжите в «Telegram агентам»`)}</div>
      <div class="bar" style="flex-wrap:wrap;gap:8px"><button class="btn" id="ocT" type="button">📅 Срок и условия</button><button class="btn" id="ocD" type="button">📄 Договор (печать / картинка)</button><button class="btn gray" id="ocC" type="button">👤 Карточка клиента</button><span class="spacer"></span><button class="btn gray" id="ocX" type="button">Закрыть</button></div>`);
    m.el.classList.add('wide');
    $('#ocX', m.el).onclick = m.close;
    $('#ocD', m.el).onclick = () => INVO.preview([r]);
    $('#ocC', m.el).onclick = () => { if (typeof CARD !== 'undefined') CARD.open(r.client); };
    $('#ocT', m.el).onclick = () => { m.close(); INVO.dialog(r, INVO.sink(() => { if (after) after(); INVO.orderCard(INVO.rowOf({ id: r.id, date: r.d, client: r.client, agent: r.agent, sum: r.s }), after); })); };
  },
};

EXT_PAGES.invo = async el => {
  await CRMLocal.ready; await LX.load();
  const c = INVO.cfg(), F = c.form, f = INVO.money;
  el.innerHTML = `<div class="page-head"><div><h2>🧾 Накладные: сроки оплаты</h2><div class="sub">Каждая накладная клиента без договора — свой срок оплаты и условия; спецпредложение — разовый договор на печать. Напоминания: за день, в день срока и каждый день при просрочке.</div></div></div><div id="ivBody"><p class="mut">Загружаю…</p></div>`;
  const body = $('#ivBody', el);
  const st = c.on && INST.cloud() ? await INST.state() : null; if (!el.isConnected) return;
  const paid = new Map(); for (const cl of st?.clients || []) for (const o of cl.orders || []) paid.set(String(o.id), o);
  const all = INVO.list(), agents = [...new Set(all.map(r => r.agent))].sort((a, b) => a.localeCompare(b));
  const fit = r => (!INVO.agent || r.agent === INVO.agent) && (!INVO.q || (r.client + ' ' + r.id).toLowerCase().includes(INVO.q.toLowerCase()));
  const groups = { new: all.filter(r => !r.old && INVO.status(r) === 'new'), spec: all.filter(INVO.isSpec), all: all.filter(r => !r.old) };
  const rows = INVO.tab === 'form' ? [] : groups[INVO.tab].filter(fit);
  const newStd = groups.new.filter(r => !INVO.isSpec(r) && fit(r));
  const warn = !c.on ? `<div class="panel" style="margin-bottom:10px"><b>Напоминания выключены.</b> Включите рассрочку: <a href="#/inst">📅 Рассрочка и договоры → ⚙ Настройки</a> → «Включить». Без этого сроки сохраняются, но в Telegram ничего не придёт.</div>` : '';
  const pay = r => { const o = paid.get(r.id); if (!o) return st ? '<span class="pill good">оплачена ✓</span>' : '<span class="mut">—</span>'; return `${o.late > 0.5 ? `<span class="pill crit">просрочено ${f(o.late)}</span><br>` : o.today > 0.5 ? `<span class="pill warn">сегодня ${f(o.today)}</span><br>` : ''}<small>оплачено ${f(o.paid)} · осталось <b>${f(o.left)}</b></small>`; };
  const stTag = r => ({ new: '<span class="pill warn">проверить</span>', ok: '<span class="pill good">✓ срок задан</span>', stored: '<span class="pill info">📁 сдан</span>' }[INVO.status(r)]);
  const dval = r => r.x.disc ?? r.disc;
  const table = () => rows.length ? `<div class="scroll"><table><thead><tr><th><input type="checkbox" id="ivAll" title="выбрать все для печати"></th><th>Дата</th><th>№</th><th>Клиент</th><th>Агент</th><th class="num">Сумма</th><th class="num">Скидка</th><th>Бонусы / условия</th><th>Срок оплаты</th><th>Оплата</th><th>Статус</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const sp = INVO.isSpec(r), b = String(r.x.bonus ?? r.bonusItems.join(', ')).trim(); return `<tr data-id="${esc(r.id)}">
        <td><input type="checkbox" data-sel="${esc(r.id)}" ${INVO.sel.has(r.id) ? 'checked' : ''}></td><td>${UI.dm(r.d)}</td><td>${esc(r.id)}</td>
        <td>${esc(r.client)}${sp ? ' <span class="pill warn">спец</span>' : ''}</td><td>${esc(r.agent)}</td><td class="num"><b>${f(r.s)}</b></td>
        <td class="num ${Math.abs(dval(r) - (F.std ?? 10)) > 0.6 ? 'neg' : ''}">${dval(r) > 0.05 ? (Math.round(dval(r) * 10) / 10) + '%' : '—'}</td>
        <td style="max-width:220px;white-space:normal"><small>${esc(b).replace(/\n/g, '<br>')}${r.x.cond ? `${b ? '<br>' : ''}<i>${esc(r.x.cond)}</i>` : ''}</small></td>
        <td>${INVO.termText(r)}</td><td>${pay(r)}</td><td>${stTag(r)}</td>
        <td style="white-space:nowrap">${INVO.status(r) === 'new' && !sp ? `<button class="btn gray sm" data-okstd="${esc(r.id)}" type="button" title="Оставить стандартный срок">✓</button> ` : ''}<button class="btn gray sm" data-ed="${esc(r.id)}" type="button">Срок / условия</button>${sp ? ` <button class="btn gray sm" data-pr="${esc(r.id)}" type="button" title="Печать договора">🖨</button>${INVO.status(r) !== 'new' ? ` <button class="btn gray sm" data-st="${esc(r.id)}" type="button" title="${r.x.stored ? 'Сдан на хранение ' + UI.dateRu(r.x.stored) + ' — нажмите, чтобы снять отметку' : 'Подписан и сдан на хранение'}">${r.x.stored ? '📁✓' : '📁'}</button>` : ''}` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : UI.empty(INVO.tab === 'new' ? 'Новых накладных нет — у всех срок задан 👍' : 'Пусто', '');
  const formView = () => `<div class="grid">${UI.panel('Форма договора-спецпредложения', `<div class="form">
      <label>Название компании (Поставщик)<input id="ifC" value="${esc(F.company || '')}"></label>
      <label>Город<input id="ifT" value="${esc(F.city || '')}" placeholder="например: Фергана"></label>
      <label>Стандартная скидка, %<input id="ifS" type="number" min="0" max="100" step="0.5" value="${F.std ?? 10}"></label>
      <div class="mut" style="display:flex;align-items:end;font-size:13px">Накладная с другой скидкой или с бонусным товаром сама помечается «спец».</div>
      <label style="grid-column:1/-1">Кто подписывает — по строке на подпись<textarea id="ifG" rows="4" style="width:100%;box-sizing:border-box;font-family:inherit">${esc((F.signers || []).join('\n'))}</textarea></label></div>
      <div class="bar"><button class="btn" id="ifSave" type="button">Сохранить</button><button class="btn gray" id="ifDemo" type="button">🖨 Пример договора</button></div>`, { cls: 'w6' })}
    ${UI.panel('Как это работает', `<ol class="steps"><li>Новая накладная из LINKO сама появляется во вкладке «Новые». По умолчанию у неё стандартный срок: ${INST.cfg().parts || 4} части за ${INST.cfg().days || 30} дн.</li>
      <li>Обычная накладная (скидка ${F.std ?? 10}%, без бонусов) — нажмите <b>✓</b>. Можно все сразу: «✓ Стандарт всем обычным».</li>
      <li>Спецпредложение — «Срок / условия»: срок (сразу, неделя, 1–3 месяца, свои даты, на части), скидка, бонусы, акция → «Сохранить и 🖨 договор».</li>
      <li>Подписали и отдали на хранение — нажмите <b>📁</b>.</li>
      <li>Оплаты из LINKO закрывают сначала самые старые накладные. Вам и агенту в Telegram: за день до срока, в день срока и каждый день, пока накладная просрочена.</li></ol>`, { cls: 'w6' })}</div>`;
  const tabs = [['new', `Новые (${groups.new.length})`], ['spec', `Спецпредложения (${groups.spec.length})`], ['all', `Все за период (${groups.all.length})`], ['form', '⚙ Форма договора']];
  body.innerHTML = warn + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><nav class="tabs">${tabs.map(([k, t]) => `<a href="#" data-tab="${k}" class="${INVO.tab === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
    ${INVO.tab !== 'form' ? `<select id="ivAg"><option value="">Все агенты</option>${agents.map(a => `<option ${a === INVO.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><input id="ivQ" placeholder="клиент или №" value="${esc(INVO.q)}" style="width:160px">
      <span class="spacer"></span>${INVO.tab === 'new' && newStd.length ? `<button class="btn gray" id="ivStdAll" type="button">✓ Стандарт всем обычным (${newStd.length})</button>` : ''}<button class="btn gray" id="ivPrSel" type="button">🖨 Печать выбранных</button>` : ''}</div>
    <div id="ivMain">${INVO.tab === 'form' ? formView() : table()}</div>
    ${INVO.tab !== 'form' ? '<p class="mut" style="font-size:12px;margin-top:8px">Скидка считается из LINKO (сумма скидки в накладной). Если где-то видите неверный %, исправьте его в «Срок / условия» — в договор пойдёт ваша цифра.</p>' : ''}`;

  const re = () => EXT_PAGES.invo(el), byId = id => all.find(r => r.id === id);
  body.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); INVO.tab = a.dataset.tab; re(); });
  const ag = $('#ivAg', body); if (ag) ag.onchange = () => { INVO.agent = ag.value; re(); };
  const q = $('#ivQ', body); if (q) q.onchange = () => { INVO.q = q.value.trim(); re(); };
  body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => INVO.dialog(byId(b.dataset.ed), el));
  body.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => INVO.preview([byId(b.dataset.pr)]));
  body.querySelectorAll('[data-okstd]').forEach(b => b.onclick = () => { const r = byId(b.dataset.okstd); INVO.save(r, { disc: r.disc, spec: false }); re(); });
  body.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { const x = c.orders[b.dataset.st]; if (!x) return; if (x.stored) delete x.stored; else x.stored = UI.localDate(Date.now()); CRMLocal.touch(); re(); });
  body.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { if (b.checked) INVO.sel.add(b.dataset.sel); else INVO.sel.delete(b.dataset.sel); });
  const allBox = $('#ivAll', body); if (allBox) allBox.onchange = () => { body.querySelectorAll('[data-sel]').forEach(b => { b.checked = allBox.checked; if (b.checked) INVO.sel.add(b.dataset.sel); else INVO.sel.delete(b.dataset.sel); }); };
  const ps = $('#ivPrSel', body); if (ps) ps.onclick = () => { const l = all.filter(r => INVO.sel.has(r.id)); if (!l.length) return toast('Отметьте накладные галочкой слева'); INVO.preview(l); };
  const sa = $('#ivStdAll', body); if (sa) sa.onclick = () => { if (!confirm(`Оставить стандартный срок у ${newStd.length} обычных накладных?`)) return; const d = UI.localDate(Date.now()); for (const r of newStd) c.orders[r.id] = { ...(c.orders[r.id] || {}), disc: r.disc, spec: false, ok: d, snap: { c: r.client, a: r.agent, d: r.d, s: r.s } }; INVO.prune(); INST.changed('Стандартный срок подтверждён: ' + newStd.length); re(); };
  const fs = $('#ifSave', body); if (fs) fs.onclick = () => { Object.assign(F, { company: $('#ifC', body).value.trim(), city: $('#ifT', body).value.trim(), std: Number($('#ifS', body).value) || 0, signers: $('#ifG', body).value.split('\n').map(s => s.trim()).filter(Boolean) }); CRMLocal.touch(); toast('Форма сохранена'); re(); };
  const dm = $('#ifDemo', body); if (dm) dm.onclick = () => { const d = UI.localDate(Date.now()); INVO.preview([{ id: '12345', d, client: 'Пример клиента', agent: 'Агент', s: 1500, disc: 15, bonusItems: ['Сервисная книжка × 10', 'Масло Mitanol 5W-30 4 л × 2'], x: { plan: [{ d: INVO.addMonths(d, 1), s: 750 }, { d: INVO.addMonths(d, 2), s: 750 }], cond: 'акция «2+1»' } }]); };
};
