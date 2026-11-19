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
      const s0 = Math.round(s * 100) / 100;
      out.push({ id, d: INVO.day(o.created_date), client, agent: LX.clientAgent(client, LX.person(o, 'user')), s: INVO.sumOf(x, s0), s0, disc: dc.pct, bonusItems: bonus, auto: special, x });
    }
    // special offers of earlier periods stay in the list from what was saved with them
    for (const [id, x] of Object.entries(c.orders)) if (!seen.has(id) && x.snap && (x.spec || x.ok)) out.push({ id, d: x.snap.d, client: x.snap.c, agent: x.snap.a, s: x.snap.s, s0: x.snap.s0 ?? x.snap.s, disc: x.disc ?? 0, bonusItems: [], auto: !!x.spec, x, old: true });
    return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : Number(b.id) - Number(a.id)));
  },
  isSpec: r => (r.x.spec !== undefined ? !!r.x.spec : r.auto),
  status: r => (r.x.stored ? 'stored' : r.x.ok ? 'ok' : 'new'),
  // the sum to pay: a free (bonus) invoice is 0, a sum corrected by hand wins over the LINKO sum
  sumOf: (x, s0) => (x.free ? 0 : x.sum != null && x.sum !== '' ? Number(x.sum) : s0),
  find: id => INVO.list().find(o => o.id === String(id)),
  // the city of the contract: set on the invoice → «Город по агентам» of the form → the agent's region (Пользователи) → the form's city
  regions: null,
  loadRegions() {
    if (INVO._reg) return INVO._reg;
    const sb = window.AUTH?.sb;
    INVO._reg = (async () => {
      const m = new Map();
      try {
        if (sb) {
          const [p, g] = await Promise.all([sb.from('profiles').select('linko_name, full_name, region_id'), sb.from('regions').select('id, name')]);
          const reg = Object.fromEntries((g.data || []).map(x => [x.id, x.name]));
          for (const x of p.data || []) if (reg[x.region_id]) for (const n of [x.linko_name, x.full_name]) if (n) m.set(INVO.akey(n), reg[x.region_id]);
        }
      } catch { /* no accounts: the form's cities only */ }
      // read before sign-in (or offline) the list is empty: don't keep it, ask again next time, otherwise every agent gets the default city
      if (!m.size) INVO._reg = null;
      INVO.regions = m; return m;
    })();
    return INVO._reg;
  },
  // an agent's name as a key: the same with any apostrophe (Xamroxoʻja / Xamroxo'ja) and word order
  akey: s => LX.norm(String(s || '').replace(/[’ʻʼ`´‘]/g, "'")),
  cityOf(r) {
    const F = INVO.cfg().form, a = INVO.akey(r.agent || ''), own = {};
    for (const l of String(F.cities || '').split('\n')) { const i = l.indexOf('='); if (i > 0 && l.slice(i + 1).trim()) own[INVO.akey(l.slice(0, i))] = l.slice(i + 1).trim(); }
    const c = r.x?.city || (a && own[a]) || (a && INVO.regions?.get(a)) || F.city || '';
    return String(c).trim().replace(/^./, s => s.toUpperCase());
  },
  // what is in the invoice (LINKO order product rows of the loaded period, or of an older order opened on «Заказы по дням»)
  lines(id) { const same = l => String(l.order) === String(id), L = LX.model().lines.filter(same); return (L.length ? L : (LX.ordX?.lines || []).filter(same)).filter(l => l.qty - l.ret > 0.0001); },
  qty: l => Math.round((l.qty - l.ret) * 100) / 100,

  // ---------- the schedule ----------
  stdPlan(d, s) { const c = INST.cfg(), days = Number(c.days) || 30, parts = Math.max(1, Number(c.parts) || 4), weekly = 7 * (parts - 1) < days; return Array.from({ length: parts }, (_, i) => ({ d: INVO.addDays(d, i + 1 === parts ? days : weekly ? 7 * (i + 1) : Math.round(days * (i + 1) / parts)), s: Math.round(s / parts * 100) / 100 })); },
  planOf(r) { const x = r.x; if (Array.isArray(x.plan) && x.plan.length) return x.plan; if (x.days) return [{ d: INVO.addDays(r.d, Number(x.days)), s: r.s }]; return INVO.stdPlan(r.d, r.s); },
  termText(r) {
    const x = r.x, pl = INVO.planOf(r);
    if (x.free) return `<b>бесплатно</b><br><small class="mut">🎁 бонус к №${esc(x.free)}</small>`;
    if (!x.plan && !x.days) return `<span class="mut">стандарт: ${pl.length} ч. до ${UI.dm(pl.at(-1).d)}</span>`;
    if (pl.length === 1) return pl[0].d === r.d ? '<b>сразу</b>' : `<b>${UI.dm(pl[0].d)}</b> <span class="mut">(${INVO.days(r.d, pl[0].d)} дн.)</span>`;
    return pl.map(p => `${UI.dm(p.d)} · ${INVO.money(p.s)}`).join('<br>');
  },
  // the table cell: «8 × $263,88» and «25.11 → 13.01»; the full schedule opens on click
  termShort(r) {
    const x = r.x, pl = INVO.planOf(r);
    if (x.free || !x.plan && !x.days || pl.length <= 2) return INVO.termText(r);
    const same = pl.every(p => Math.abs(p.s - pl[0].s) < 0.01), t0 = UI.localDate(Date.now()), nx = pl.find(p => p.d >= t0);
    return `<details class="iv-term"><summary><b>${pl.length} × ${same ? INVO.money(pl[0].s) : INVO.money(r.s / pl.length) + '≈'}</b><div class="ct-sub">${UI.dm(pl[0].d)} → ${UI.dm(pl.at(-1).d)}${nx ? ` · след. <b>${UI.dm(nx.d)}</b>` : ''}</div></summary>${pl.map(p => `<div${p === nx ? ' class="nx"' : ''}>${UI.dm(p.d)} · ${INVO.money(p.s)}</div>`).join('')}</details>`;
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
    const c = INVO.cfg(), x = { ...(c.orders[r.id] || {}) }, prev = x.bonusInv, s0 = r.s0 ?? r.s, today = UI.localDate(Date.now());
    for (const k of ['plan', 'days', 'sum', 'bonusInv', 'city']) delete x[k];
    Object.assign(x, v);
    x.snap = { c: r.client, a: r.agent, d: r.d, s: INVO.sumOf(x, s0), s0 };
    if (!x.ok) x.ok = today;
    c.orders[r.id] = JSON.parse(JSON.stringify(x));
    // the bonus invoice of the promotion: free while it is linked to this one
    if (prev && prev !== x.bonusInv) INVO.unfree(prev, r.id);
    if (x.bonusInv) {
      const b = INVO.find(x.bonusInv), y = { ...(c.orders[x.bonusInv] || {}) };
      for (const k of ['plan', 'days']) delete y[k];
      Object.assign(y, { free: r.id, spec: false, ok: y.ok || today, snap: b ? { c: b.client, a: b.agent, d: b.d, s: 0, s0: b.s0 ?? b.s } : { ...(y.snap || {}), s: 0 } });
      c.orders[x.bonusInv] = y;
    }
    INVO.prune(); INST.changed('Накладная №' + r.id + ' сохранена — напоминания пересчитаются за 5 минут');
  },
  // a bonus invoice becomes a normal (paid) one again
  unfree(id, mainId) {
    const c = INVO.cfg(), y = c.orders[id]; if (!y || (mainId && y.free !== mainId)) return;
    const main = y.free; delete y.free; if (y.snap) y.snap.s = INVO.sumOf(y, y.snap.s0 ?? y.snap.s);
    if (!mainId && c.orders[main]?.bonusInv === id) delete c.orders[main].bonusInv;
  },
  // invoices older than half a year are not needed by the reminders any more (special offers are kept for the archive list)
  prune() { const c = INVO.cfg(), cut = INVO.addDays(UI.localDate(Date.now()), -200); for (const [id, x] of Object.entries(c.orders)) if (x.snap?.d && x.snap.d < cut && !x.spec) delete c.orders[id]; },

  // the dialog styles: two columns on a computer (what was ordered | the schedule), one on a phone
  dlgCss: `<style>.ivd{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px 18px}
.ivd .ivh{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 5px;display:flex;gap:6px;align-items:center}
.ivd .ivh .spacer{flex:1}.ivd .ivh .btn{text-transform:none;letter-spacing:0;font-weight:600}
.ivd .ivtop{grid-column:1/-1;display:grid;grid-template-columns:140px 90px 130px minmax(0,1fr);gap:10px}
.ivd label.f{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:600;color:var(--text-2);margin:0}
.ivd label.f small{font-weight:400;color:var(--muted)}
.ivd input,.ivd select,.ivd textarea{width:100%;box-sizing:border-box;font-family:inherit}
.ivd .ivit{max-height:200px;overflow:auto;border-radius:12px;background:var(--card-2);box-shadow:inset 0 0 0 1px var(--line)}
.ivd .ivit table{width:100%;border-collapse:collapse;font-size:12.5px}
.ivd .ivit td{padding:3px 8px;border-bottom:1px solid var(--line);white-space:normal}
.ivd .ivit tr:last-child td{border-bottom:0}.ivd .ivit td.num{white-space:nowrap;text-align:right}
.ivd .ivit tr.t td{font-weight:700}.ivd .ivit tr.g td{background:color-mix(in srgb,var(--tint,#0a84ff) 10%,transparent)}
.ivd .ivpre{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px}.ivd .ivpre .btn{padding:4px 10px;font-size:12px}
.ivd #ivP{font-size:12px;margin-top:4px}.ivd #ivP .chip{font-size:11.5px;padding:2px 7px;margin:0 2px 3px 0;display:inline-block}
.ivd .ivfull{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 18px}
@media (max-width:760px){.ivd,.ivd .ivfull{grid-template-columns:1fr}.ivd .ivtop{grid-template-columns:1fr 1fr}.ivd .ivtop>:last-child{grid-column:1/-1}}</style>`,
  // the rows of an invoice as a small table; `free` — the bonus invoice (its sum is struck out)
  itemsTable(ls, free) {
    if (!ls.length) return '<p class="mut" style="margin:6px 8px;font-size:12px">Состав заказа в данных LINKO не найден.</p>';
    const tot = ls.reduce((a, l) => a + (l.bonus ? 0 : l.sum), 0);
    return `<table class="noxg"><tbody>${ls.map(l => `<tr class="${l.bonus || free ? 'g' : ''}"><td>${l.bonus || free ? '🎁 ' : ''}${esc(l.product)}</td><td class="num">× ${INVO.qty(l)}</td><td class="num">${l.bonus ? 'бонус' : free ? `<s class="mut">${INVO.money2(l.sum)}</s>` : INVO.money2(l.sum)}</td></tr>`).join('')}
      <tr class="t"><td>${ls.length} поз.</td><td></td><td class="num">${free ? `<s class="mut">${INVO.money2(tot)}</s> $0` : INVO.money2(tot)}</td></tr></tbody></table>`;
  },
  // a free invoice (the bonus of another one): what is in it and the way back
  freeDialog(r, el) {
    const main = r.x.free, m = modal(`${INVO.dlgCss}<h3 style="margin:0 0 2px">Накладная №${esc(r.id)} от ${UI.dateRu(r.d)}</h3>
      <p class="mut" style="margin:0 0 10px"><b>${esc(r.client)}</b> · ${esc(r.agent)}</p>
      <div class="panel" style="margin:0 0 10px;padding:10px 12px">🎁 <b>Бесплатно</b> — бонус к накладной <b>№${esc(main)}</b> (по акции). В LINKO: ${INVO.money2(r.s0)}, к оплате: <b>$0</b>. Напоминаний об оплате нет.</div>
      <div class="ivd"><div style="grid-column:1/-1"><div class="ivh">Что входит</div><div class="ivit">${INVO.itemsTable(INVO.lines(r.id), true)}</div></div></div>
      <div class="bar" style="margin-top:12px"><button class="btn gray" id="fvUn" type="button">Сделать платной</button><span class="spacer"></span><button class="btn gray" id="fvM" type="button">Открыть №${esc(main)}</button><button class="btn" id="fvX" type="button">Закрыть</button></div>`);
    m.el.classList.add('wide');
    $('#fvX', m.el).onclick = m.close;
    $('#fvM', m.el).onclick = () => { const o = INVO.find(main); if (!o) return toast('Накладной №' + main + ' нет в этом периоде'); m.close(); INVO.dialog(o, el); };
    $('#fvUn', m.el).onclick = () => { if (!confirm(`Накладная №${r.id} станет обычной (платной), бонус у №${main} снимется. Продолжить?`)) return; INVO.unfree(r.id); INST.changed('Накладная №' + r.id + ' снова платная'); m.close(); EXT_PAGES.invo(el); };
  },

  dialog(r, el) {
    if (r.x.free) return INVO.freeDialog(r, el);
    const x = r.x, pl0 = INVO.planOf(r), isStd = !x.plan && !x.days, s0 = r.s0 ?? r.s;
    const bonus0 = x.bonus ?? r.bonusItems.join('\n');
    // the other invoices of this client (two months around) that can be its free bonus
    const cand = INVO.list().filter(o => o.id !== r.id && !o.old && LX.norm(o.client) === LX.norm(r.client) && (!o.x.free || o.x.free === r.id) && !o.x.bonusInv && Math.abs(INVO.days(r.d, o.d)) <= 62);
    if (x.bonusInv && !cand.some(o => o.id === x.bonusInv)) { const b = INVO.find(x.bonusInv); cand.push(b || { id: x.bonusInv, d: r.d, s0: 0, s: 0 }); }
    const preset = [['now', 'Сразу'], ['d7', '7 дн.'], ['d14', '2 нед.'], ['m1', '1 мес.'], ['m2', '2 мес.'], ['m3', '3 мес.'], ['std', `Стандарт ${INST.cfg().parts || 4}×${INST.cfg().days || 30} дн.`]];
    const m = modal(`${INVO.dlgCss}<h3 style="margin:0 0 2px">Накладная №${esc(r.id)} от ${UI.dateRu(r.d)}</h3>
      <p class="mut" style="margin:0 0 12px"><b>${esc(r.client)}</b> · ${esc(r.agent)}</p>
      <div class="ivd">
        <div class="ivtop">
          <label class="f">Сумма к оплате, $<input id="ivSum" type="number" min="0" step="0.01" value="${r.s}"><small id="ivSum0">в LINKO ${INVO.money2(s0)}</small></label>
          <label class="f">Скидка, %<input id="ivD" type="number" min="0" max="100" step="0.5" value="${Math.round((x.disc ?? r.disc) * 10) / 10}"></label>
          <label class="f">Город договора<input id="ivCity" value="${esc(INVO.cityOf(r))}"><small>по агенту</small></label>
          <label class="f">🎁 Бонусная накладная — бесплатно<select id="ivBi"><option value="">— нет —</option>${cand.map(o => `<option value="${esc(o.id)}" ${o.id === x.bonusInv ? 'selected' : ''}>№${esc(o.id)} от ${UI.dm(o.d)} · ${INVO.money2(o.s0 ?? o.s)}</option>`).join('')}</select><small>${cand.length ? 'вторая накладная по акции станет $0' : 'других накладных этого клиента рядом нет'}</small></label>
        </div>
        <div><div class="ivh">Что заказал клиент</div><div class="ivit">${INVO.itemsTable(INVO.lines(r.id))}</div><div id="ivBiL"></div></div>
        <div><div class="ivh">Срок оплаты</div>
          <div class="ivpre">${preset.map(([k, t]) => `<button class="btn gray sm" data-pre="${k}" type="button">${t}</button>`).join('')}</div>
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:6px;font-size:12px"><span class="mut">Разбить на</span><input id="ivN" type="number" min="2" max="12" value="2" style="width:52px"><span class="mut">ч. каждые</span><select id="ivE" style="width:auto"><option value="m1">1 месяц</option><option value="w2">2 недели</option><option value="w1">1 неделю</option></select><button class="btn gray sm" id="ivSplit" type="button">Разбить</button></div>
          <textarea id="ivT" rows="3" placeholder="дата - сумма, по строке на часть: 15.12 - 500. Пусто — стандартный срок">${esc(isStd ? '' : INVO.text(pl0))}</textarea>
          <div id="ivP"></div></div>
        <div class="ivfull">
          <label class="f"><span class="ivh" style="margin:0">Бонусы<span class="spacer"></span>${[['🎁 товар', 'Товар: '], ['💵 деньги', 'Деньги бонусом: $'], ['📘 книжки', 'Сервисные книжки × ']].map(([t, v]) => `<button class="btn gray sm" data-badd="${esc(v)}" type="button">+ ${t}</button>`).join('')}</span><textarea id="ivB" rows="3" placeholder="по строке: товар × кол-во, деньги, сервисные книжки…">${esc(bonus0)}</textarea></label>
          <label class="f"><span class="ivh" style="margin:0">Акция / другие условия</span><textarea id="ivC" rows="3" placeholder="например: акция «2+1», доставка за наш счёт">${esc(x.cond || '')}</textarea></label>
        </div>
      </div>
      <div class="bar" style="margin-top:12px;flex-wrap:wrap;gap:8px"><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="ivS" ${INVO.isSpec(r) || x.bonusInv ? 'checked' : ''}> Спецпредложение — договор</label><span class="spacer"></span><button class="btn gray" id="ivX" type="button">Отмена</button><button class="btn" id="ivOk" type="button">Сохранить</button><button class="btn" id="ivPr" type="button">Сохранить и 🖨 договор</button></div>`);
    m.el.classList.add('wide');
    // the agent's region comes from the accounts a moment later: fill it in unless the field was already changed
    const cityAuto = () => INVO.cityOf({ ...r, x: { ...x, city: '' } }), C = $('#ivCity', m.el);
    if (!INVO.regions?.size) { const was = C.value; INVO.loadRegions().then(() => { if (C.value === was && !x.city) C.value = cityAuto(); }); }
    const T = $('#ivT', m.el), S = () => Math.max(0, Math.round((Number($('#ivSum', m.el).value) || 0) * 100) / 100);
    const biView = () => {
      const id = $('#ivBi', m.el).value, o = id && cand.find(c => c.id === id);
      $('#ivBiL', m.el).innerHTML = id ? `<div class="ivh" style="margin-top:8px">🎁 Бонусом: накладная №${esc(id)}${o?.d ? ' от ' + UI.dm(o.d) : ''} — бесплатно</div><div class="ivit">${INVO.itemsTable(INVO.lines(id), true)}</div>` : '';
      if (id) $('#ivS', m.el).checked = true;
    };
    $('#ivBi', m.el).onchange = biView; biView();
    $('#ivSum', m.el).oninput = () => { $('#ivSum0', m.el).innerHTML = Math.abs(S() - s0) > 0.005 ? `в LINKO ${INVO.money2(s0)} · <a href="#" id="ivSumR">вернуть</a>` : `в LINKO ${INVO.money2(s0)}`; const a = $('#ivSumR', m.el); if (a) a.onclick = e => { e.preventDefault(); $('#ivSum', m.el).value = s0; $('#ivSum', m.el).oninput(); }; pv(); };
    m.el.querySelectorAll('[data-badd]').forEach(b => b.onclick = e => { e.preventDefault(); const B = $('#ivB', m.el); B.value = (B.value.trim() ? B.value.replace(/\s+$/, '') + '\n' : '') + b.dataset.badd; B.focus(); B.setSelectionRange(B.value.length, B.value.length); });
    const pv = () => {
      if (!T.value.trim()) { $('#ivP', m.el).innerHTML = `<span class="mut">Стандартный: ${INVO.stdPlan(r.d, S()).map(p => UI.dm(p.d) + ' · ' + INVO.money(p.s)).join(', ')}</span>`; $('#ivOk', m.el).disabled = $('#ivPr', m.el).disabled = false; return; }
      const res = INVO.parse(T.value, r.d), tot = res.ok.reduce((a, p) => a + p.s, 0), diff = Math.round((S() - tot) * 100) / 100;
      $('#ivP', m.el).innerHTML = res.ok.map(p => `<span class="chip">${UI.dm(p.d)} · ${INVO.money2(p.s)}</span>`).join('') + (res.ok.length ? ` <b>Σ ${INVO.money2(tot)}</b>` : '') +
        (Math.abs(diff) > 0.01 && res.ok.length ? `<div class="${diff > 0 ? 'neg' : 'mut'}" style="margin-top:4px">${diff > 0 ? `Не хватает ${INVO.money2(diff)} до суммы — добавится к последней части` : `Больше суммы на ${INVO.money2(-diff)} — последняя часть будет меньше`}</div>` : '') +
        (res.bad.length ? `<div class="neg" style="margin-top:4px">Не понял: ${esc(res.bad.join('; '))}. Пример: 15.12 - 500</div>` : '');
      $('#ivOk', m.el).disabled = $('#ivPr', m.el).disabled = !!res.bad.length;
    };
    const set = pl => { T.value = pl ? INVO.text(pl) : ''; pv(); };
    T.oninput = pv;
    m.el.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => {
      const k = b.dataset.pre;
      if (k === 'std') return set(null);
      const d = k === 'now' ? r.d : k === 'd7' ? INVO.addDays(r.d, 7) : k === 'd14' ? INVO.addDays(r.d, 14) : INVO.addMonths(r.d, +k.slice(1));
      set([{ d, s: S() }]);
    });
    $('#ivSplit', m.el).onclick = () => {
      const n = Math.max(2, Math.min(12, Number($('#ivN', m.el).value) || 2)), e = $('#ivE', m.el).value, sum = S(), each = Math.floor(sum / n * 100) / 100;
      set(Array.from({ length: n }, (_, i) => ({ d: e === 'm1' ? INVO.addMonths(r.d, i + 1) : INVO.addDays(r.d, (e === 'w2' ? 14 : 7) * (i + 1)), s: i === n - 1 ? Math.round((sum - each * (n - 1)) * 100) / 100 : each })));
    };
    $('#ivSum', m.el).oninput();
    $('#ivX', m.el).onclick = m.close;
    const collect = () => {
      const res = T.value.trim() ? INVO.parse(T.value, r.d) : { ok: [], bad: [] };
      if (res.bad.length) return null;
      const sum = S(), bi = $('#ivBi', m.el).value, city = C.value.trim();
      return { ...(res.ok.length ? { plan: res.ok } : {}), ...(city && LX.norm(city) !== LX.norm(cityAuto()) ? { city } : {}), ...(Math.abs(sum - s0) > 0.005 ? { sum } : {}), ...(bi ? { bonusInv: bi } : {}), disc: Number($('#ivD', m.el).value) || 0, bonus: $('#ivB', m.el).value.trim(), cond: $('#ivC', m.el).value.trim(), spec: $('#ivS', m.el).checked || !!bi, ok: UI.localDate(Date.now()), ...(x.stored ? { stored: x.stored } : {}) };
    };
    $('#ivOk', m.el).onclick = () => { const v = collect(); if (!v) return; INVO.save(r, v); m.close(); EXT_PAGES.invo(el); };
    $('#ivPr', m.el).onclick = () => { const v = collect(); if (!v) return; v.spec = true; INVO.save(r, v); m.close(); EXT_PAGES.invo(el); const nx = INVO.cfg().orders[r.id]; INVO.preview([{ ...r, s: INVO.sumOf(nx, s0), s0, x: nx }]); };
  },

  // ---------- the one-time contract (special offer): half of an A4 sheet, filled in from the invoice ----------
  // 190 × 138 mm: two on one sheet (a copy for the client and one for us, or two different contracts). A contract that would not fit
  // is shrunk (nothing is cut). It can be printed, saved as a picture (PNG) and sent to Telegram.
  HALF: 521, // px: 138 mm
  css: () => `.cdoc{box-sizing:border-box;width:190mm;background:#fff!important;color:#111!important;font:11px/1.4 Arial,Helvetica,sans-serif;position:relative;overflow:hidden;text-align:left;border-radius:0;box-shadow:none}
.cdoc *{box-sizing:border-box;color:#111;background:transparent;text-shadow:none}
.cdoc .d-fit{padding:4mm 6mm 3mm}
.cdoc .d-top{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;border-bottom:2px solid #111;padding:0 0 3px;margin:0 0 4px}
.cdoc .d-co{font-size:20px;font-weight:700;letter-spacing:1.5px;line-height:1}
.cdoc .d-co small{display:block;font-size:9px;font-weight:400;letter-spacing:.3px;color:#555;margin-top:3px}
.cdoc .d-ttl{text-align:right}
.cdoc .d-h1{font-size:15px;font-weight:700;letter-spacing:.6px;line-height:1.1}
.cdoc .d-sub{font-size:10.5px;color:#444;margin-top:2px}
.cdoc .d-in{margin:0 0 2px;font-size:10.5px}
.cdoc .d-h2{font-size:9.5px;font-weight:700;margin:5px 0 2px;text-transform:uppercase;letter-spacing:.8px;color:#555}
.cdoc .d-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #999;border-radius:2px}
.cdoc .d-c{padding:2px 7px 3px;border-left:1px solid #ccc;min-width:0}
.cdoc .d-c:first-child{border-left:0}
.cdoc .d-c.w2{grid-column:span 2}
.cdoc .d-l{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.4px;color:#666;margin-bottom:1px}
.cdoc .d-v{font-size:12px;font-weight:700;overflow-wrap:anywhere}
.cdoc .d-v.n{font-weight:400;font-size:11.5px}
.cdoc .d-v.big{font-size:15px}
.cdoc .d-bon{border:1px solid #999;border-top:0;padding:2px 7px 3px}
.cdoc .d-bl{font-size:10.5px;line-height:1.38;white-space:pre-line;overflow-wrap:anywhere}
.cdoc .d-bl.c2{column-count:2;column-gap:14px;column-rule:1px solid #ddd}
.cdoc .d-bl.c3{column-count:3;column-gap:12px;column-rule:1px solid #ddd}
.cdoc .d-it{font-size:9.5px;line-height:1.3}
.cdoc .d-bh{font-size:10px;font-weight:700;margin:1px 0}
.cdoc .d-v small{display:block;font-size:8.5px;font-weight:400;color:#666}
.cdoc table{width:100%;border-collapse:collapse;border:0;border-radius:0;box-shadow:none;overflow:visible;background:#fff;margin:0}
.cdoc table tr>th,.cdoc table tr>td{border:0;border-bottom:1px solid #ccc;padding:2px 7px;vertical-align:middle;text-align:left;font-weight:normal;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35;color:#111;white-space:nowrap;position:static;background:#fff;height:auto}
.cdoc table tr>th{font-size:8.5px;text-transform:uppercase;letter-spacing:.4px;color:#555;font-weight:700;background:#f2f2f2;border-bottom:1px solid #999}
.cdoc .d-sch{display:flex;gap:12px;align-items:flex-start}
.cdoc .d-sch table{flex:1;border:1px solid #999}
.cdoc .d-sch tr>*:nth-child(3){text-align:right}
.cdoc .d-sch tr>*:first-child{width:24px;text-align:center;color:#555}
.cdoc .d-sch tr>*:nth-child(4){width:34%}
.cdoc .d-sch tr.d-tot>td{font-weight:700;background:#f2f2f2;border-bottom:0;border-top:1px solid #999;font-size:12px}
.cdoc .d-ft{margin:4px 0 0;font-size:10.5px;color:#333}
.cdoc .d-sgs{display:flex;gap:18px;margin-top:2px}
.cdoc .d-who{flex:1;min-width:0}
.cdoc .d-sl{height:10mm;border-bottom:1px solid #111}
.cdoc .d-who b{display:inline;font-size:10.5px}
.cdoc .d-who span{float:right;font-size:8.5px;color:#666;margin-top:2px}
.cdoc .d-who{padding-top:1px}`,
  doc(r) {
    const F = INVO.cfg().form, x = r.x || {}, pl = INVO.planOf(r), tot = pl.reduce((a, p) => a + p.s, 0);
    const bonus = String(x.bonus ?? r.bonusItems.join('\n')).trim(), disc = Math.round((x.disc ?? r.disc) * 10) / 10, sg = (F.signers || []).filter(Boolean);
    const city = INVO.cityOf(r);
    const term = pl.length === 1 ? `${UI.dateRu(pl[0].d)}${pl[0].d === r.d ? ' (сразу)' : ` (${INVO.days(r.d, pl[0].d)} дн.)`}` : `${pl.length} платежей, до ${UI.dateRu(pl.at(-1).d)}`;
    const bLines = bonus ? bonus.split('\n').map(t => t.trim()).filter(Boolean) : [];
    // the goods of the invoice and of its free bonus invoice: short lines in 1–3 columns, so the contract stays on half a sheet
    const s0 = r.s0 ?? r.s, its = l => `${l.product} × ${INVO.qty(l)}`, cols = n => (n > 10 ? ' c3' : n > 4 ? ' c2' : '');
    const goods = INVO.lines(r.id).filter(l => !l.bonus).map(its);
    const bi = x.bonusInv ? INVO.find(x.bonusInv) || { id: x.bonusInv } : null, bGoods = bi ? INVO.lines(bi.id).map(its) : [];
    // the schedule: one table, or two side by side when there are many parts
    const head = '<thead><tr><th>№</th><th>Дата оплаты</th><th>Сумма</th><th>Отметка об оплате</th></tr></thead>';
    const trs = (list, from) => list.map((p, i) => `<tr><td>${from + i + 1}</td><td>${UI.dateRu(p.d)}</td><td>${INVO.money2(p.s)}</td><td></td></tr>`).join('');
    const totRow = `<tr class="d-tot"><td></td><td>Итого</td><td>${INVO.money2(tot)}</td><td></td></tr>`;
    const half = Math.ceil(pl.length / 2);
    const sched = pl.length > 6 ? `<div class="d-sch"><table class="noxg">${head}<tbody>${trs(pl.slice(0, half), 0)}</tbody></table><table class="noxg">${head}<tbody>${trs(pl.slice(half), half)}${totRow}</tbody></table></div>`
      : `<div class="d-sch"><table class="noxg">${head}<tbody>${trs(pl, 0)}${totRow}</tbody></table></div>`;
    return `<section class="cdoc no-xg"><div class="d-fit">
      <div class="d-top"><div class="d-co">${esc(F.company || '')}<small>Поставщик</small></div>
        <div class="d-ttl"><div class="d-h1">ДОГОВОР-СПЕЦПРЕДЛОЖЕНИЕ № ${esc(r.id)}</div><div class="d-sub">к накладной № ${esc(r.id)} от ${UI.dateRu(r.d)}${city ? ' · г. ' + esc(city) : ''}</div></div></div>
      <div class="d-in"><b>${esc(F.company || '')}</b> (Поставщик) и <b>${esc(r.client)}</b> (Покупатель) заключили разовый договор об особых условиях поставки по накладной № ${esc(r.id)}.</div>
      <div class="d-h2">1. Накладная</div>
      <div class="d-grid">
        <div class="d-c"><span class="d-l">Покупатель (LINKO)</span><div class="d-v">${esc(r.client)}</div></div>
        <div class="d-c"><span class="d-l">Агент</span><div class="d-v n">${esc(r.agent || '—')}</div></div>
        <div class="d-c"><span class="d-l">Накладная</span><div class="d-v n">№ ${esc(r.id)} от ${UI.dateRu(r.d)}</div></div>
        <div class="d-c"><span class="d-l">Сумма к оплате</span><div class="d-v big">${INVO.money2(r.s)}${Math.abs(s0 - r.s) > 0.005 ? `<small>в накладной ${INVO.money2(s0)}</small>` : ''}</div></div>
      </div>
      ${goods.length ? `<div class="d-bon"><span class="d-l">Товары по накладной (${goods.length} поз.)</span><div class="d-bl d-it${cols(goods.length)}">${goods.map(esc).join('\n')}</div></div>` : ''}
      <div class="d-h2">2. Условия</div>
      <div class="d-grid">
        <div class="d-c"><span class="d-l">Скидка</span><div class="d-v">${disc > 0 ? `${String(disc).replace('.', ',')}% от прайса` : 'без скидки'}</div></div>
        <div class="d-c"><span class="d-l">Срок оплаты</span><div class="d-v">${term}</div></div>
        <div class="d-c w2"><span class="d-l">Акция / другие условия</span><div class="d-v n">${x.cond ? esc(x.cond) : '—'}</div></div>
      </div>
      <div class="d-bon"><span class="d-l">Бонусы</span>${bi ? `<div class="d-bh">Накладная № ${esc(bi.id)}${bi.d ? ' от ' + UI.dateRu(bi.d) : ''} — бесплатно${bi.s0 ? ` (по накладной ${INVO.money2(bi.s0)})` : ''}:</div>${bGoods.length ? `<div class="d-bl d-it${cols(bGoods.length)}">${bGoods.map(esc).join('\n')}</div>` : ''}` : ''}${bLines.length ? `${bi ? '<div class="d-bh">Другие бонусы:</div>' : ''}<div class="d-bl${cols(bLines.length)}">${bLines.map(esc).join('\n')}</div>` : bi ? '' : '<div class="d-bl">—</div>'}</div>
      <div class="d-h2">3. График оплаты</div>
      ${sched}
      <div class="d-ft">Покупатель обязуется оплатить сумму накладной в указанные сроки. Условия договора действуют только для накладной № ${esc(r.id)}.</div>
      <div class="d-sgs">${sg.map(s => `<div class="d-who"><div class="d-sl"></div><span>подпись</span><b>${esc(s)}</b></div>`).join('')}</div>
    </div></section>`;
  },
  // a contract that is taller than half a sheet is shrunk to fit (width grows by the same factor, so nothing is cut)
  fit(doc) {
    const fit = doc.querySelector('.d-fit'); if (!fit) return;
    fit.style.cssText = ''; doc.style.height = '';
    if (fit.offsetHeight <= INVO.HALF) return;
    // the largest scale at which the whole contract still fits above the cut line (binary search: a wider text block reflows into fewer lines)
    const tall = k => { fit.style.cssText = `width:${100 / k}%;transform:scale(${k});transform-origin:0 0`; return fit.offsetHeight * k > INVO.HALF; };
    let lo = 0.15, hi = 1;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (tall(m)) hi = m; else lo = m; }
    const k = lo; tall(k);
    doc.style.height = Math.min(INVO.HALF, Math.ceil(fit.offsetHeight * k)) + 'px';
  },
  // print: A4 sheets with two halves each; `two` — each contract twice (a copy for the client and one for us), otherwise the contracts follow each other
  printDocs(docs, two) {
    const items = []; docs.forEach(h => { items.push(h); if (two) items.push(h); });
    const sheets = []; for (let i = 0; i < items.length; i += 2) sheets.push(items.slice(i, i + 2));
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(fr);
    const d = fr.contentDocument; d.open();
    d.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Договор-спецпредложение</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .sheet{width:210mm;height:296mm;position:relative;page-break-after:always;break-after:page;overflow:hidden}.sheet:last-child{page-break-after:auto;break-after:auto}
      .half{position:absolute;left:10mm;width:190mm;height:138.5mm;overflow:hidden}.half.h1{top:6mm}.half.h2{top:154.5mm}
      .cut{position:absolute;left:0;right:0;top:148.5mm;height:0;border-top:1px dashed #444}.cut::before{content:"✂";position:absolute;left:4mm;top:-2.6mm;font-size:11px;line-height:1;color:#444;background:#fff;padding:0 1mm}${INVO.css()}</style></head><body>${sheets.map(s => `<div class="sheet">${s.map((h, i) => `<div class="half h${i + 1}">${h}</div>`).join('')}<div class="cut"></div></div>`).join('')}</body></html>`);
    d.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { toast('Не удалось открыть печать — скачайте картинкой'); } }, 350);
    setTimeout(() => fr.remove(), 120000);
  },
  // the contract as a picture (PNG): the document is drawn by the browser itself from its own HTML, so it looks exactly as printed
  async png(docEl, css = INVO.css()) {
    const w = Math.ceil(docEl.getBoundingClientRect().width), h = Math.ceil(docEl.getBoundingClientRect().height), S = 2.5;
    const xml = new XMLSerializer().serializeToString(docEl.cloneNode(true));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * S)}" height="${Math.round(h * S)}"><foreignObject x="0" y="0" width="${w}" height="${h}" transform="scale(${S})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div></foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('браузер не смог нарисовать картинку')); });
    const cv = document.createElement('canvas'); cv.width = Math.round(w * S); cv.height = Math.round(h * S);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/png')); if (!blob) throw new Error('картинка не получилась'); return blob;
  },
  fileName: r => ('Договор-' + r.id + '-' + String(r.client || '').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30) + '.png').replace(/_\.png$/, '.png'),
  // the preview: every contract on the screen as it will be printed, with the buttons: print, picture, send, copy
  async preview(rows) {
    rows = (rows || []).filter(Boolean);
    if (!rows.length) return toast('Нечего печатать');
    await INVO.loadRegions();
    const canShare = !!(navigator.canShare && navigator.share);
    const m = modal(`<h3 style="margin:0 0 8px">📄 Договор-спецпредложение</h3>
      <style>${INVO.css()}</style>
      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pvTwo"> 2 экземпляра на листе А4 (если нужно два)</label><span class="spacer"></span><button class="btn" id="pvPr" type="button">🖨 Печать</button><button class="btn gray" id="pvX" type="button">Закрыть</button></div>
      <div style="max-height:68vh;overflow:auto">${rows.map((r, i) => `<div style="margin:0 0 14px"><div class="bar" style="flex-wrap:wrap;gap:6px;margin-bottom:6px"><b>№${esc(r.id)} · ${esc(r.client)}</b><span class="spacer"></span>
        <button class="btn gray sm" data-png="${i}" type="button">🖼 Скачать картинкой</button>${canShare ? `<button class="btn gray sm" data-share="${i}" type="button">📤 Отправить (Telegram…)</button>` : ''}<button class="btn gray sm" data-copy="${i}" type="button">📋 Копировать картинку</button></div>
        <div style="display:inline-block;max-width:100%;overflow:auto;border:1px solid var(--line-2,#ccc)">${INVO.doc(r)}</div></div>`).join('')}</div>
      <p class="mut" style="font-size:12px;margin:6px 0 0">Договор занимает половину листа А4: распечатайте и поставьте подписи. Картинку можно сразу отправить в Telegram.</p>`);
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
    if (r) return r;
    const s0 = Math.round(((o.sum ?? o.s) - (o.ret || 0)) * 100) / 100, x = INVO.cfg().orders[id] || {};
    return { id, d: o.date || o.d, client: o.client, agent: o.agent || '', s: INVO.sumOf(x, s0), s0, disc: 0, bonusItems: [], auto: false, x };
  },
  // a hidden element for the dialog of an invoice: when it saves, the page behind it asks to draw itself again into this element
  sink(after) {
    if (!EXT_PAGES.invo.__sink) { const orig = EXT_PAGES.invo; const w = function (el) { if (el && el._sink) return el._sink(); return orig.apply(this, arguments); }; w.__sink = true; EXT_PAGES.invo = w; }
    const el = document.createElement('div'); el._sink = after; return el;
  },
  orderCard(r, after) {
    const M = LX.model(), f = INVO.money2, x = r.x || {}, pl = INVO.planOf(r), today = UI.localDate(Date.now()), c = INVO.cfg();
    const lines = INVO.lines(r.id);
    const disc = Math.round((x.disc ?? r.disc) * 10) / 10, std = c.form.std ?? 10, tg = CRMLocal.ext().tg || {}, on = !!INST.cfg().on;
    const meOk = !!tg.me?.id, agOk = !!tg.chats?.[r.agent]?.id, hour = String(INST.cfg().hour ?? 9).padStart(2, '0') + ':00';
    const ok = (v, yes, no) => v ? `<div>✅ ${yes}</div>` : `<div class="neg">⚠ ${no}</div>`;
    const dm = d => UI.dm(d), rem = p => (p.d < today ? '<span class="mut">срок прошёл</span>' : `${p.d > INVO.addDays(today, 1) ? dm(INVO.addDays(p.d, -1)) + ' (за день) и ' : p.d === INVO.addDays(today, 1) ? 'завтра (за день) и ' : ''}${p.d === today ? 'сегодня' : dm(p.d)} (в день срока)`);
    const m = modal(`<h3 style="margin:0 0 2px">Накладная №${esc(r.id)} · ${UI.dateRu(r.d)}</h3>
      <p class="mut" style="margin:0 0 10px"><b>${esc(r.client)}</b> · агент ${esc(r.agent || '—')} · сумма <b>${f(r.s)}</b> · скидка <b class="${Math.abs(disc - std) > 0.6 ? 'neg' : ''}">${disc > 0.05 ? disc + '%' : 'нет'}</b>${Math.abs(disc - std) > 0.6 ? ` (стандарт ${std}%)` : ` (стандарт)`}${x.cond ? ` · <i>${esc(x.cond)}</i>` : ''}</p>
      ${x.free ? `<div class="panel" style="margin:0 0 8px;padding:8px 12px">🎁 <b>Бесплатно</b> — бонус к накладной №${esc(x.free)} (в LINKO ${f(r.s0 ?? 0)})</div>` : x.bonusInv ? `<div class="panel" style="margin:0 0 8px;padding:8px 12px">🎁 Бонусом к этой накладной — №${esc(x.bonusInv)} бесплатно</div>` : ''}
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
  await CRMLocal.ready; await LX.load(); INVO.loadRegions();
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
  const table = () => rows.length ? `<div class="scroll"><table><thead><tr><th><input type="checkbox" id="ivAll" title="выбрать все для печати"></th><th>Дата · №</th><th>Клиент · агент</th><th class="num">Сумма</th><th class="num">Скидка</th><th>Бонусы / условия</th><th>Срок оплаты</th><th>Оплата</th><th>Статус</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const sp = INVO.isSpec(r), b = [r.x.bonusInv ? `🎁 №${r.x.bonusInv} бесплатно` : '', String(r.x.bonus ?? r.bonusItems.join(', ')).trim()].filter(Boolean).join('\n'), s0 = r.s0 ?? r.s; return `<tr data-id="${esc(r.id)}">
        <td><input type="checkbox" data-sel="${esc(r.id)}" ${INVO.sel.has(r.id) ? 'checked' : ''}></td><td style="white-space:nowrap">${UI.dm(r.d)}<div class="ct-sub">№${esc(r.id)}</div></td>
        <td style="min-width:170px"><b>${esc(r.client)}</b>${sp ? ' <span class="pill warn">спец</span>' : ''}${r.x.free ? ' <span class="pill info">🎁 бонус</span>' : ''}<div class="ct-sub">${esc(r.agent)}</div></td><td class="num"><b>${f(r.s)}</b>${Math.abs(s0 - r.s) > 0.005 ? `<br><small class="mut"><s>${f(s0)}</s></small>` : ''}</td>
        <td class="num ${Math.abs(dval(r) - (F.std ?? 10)) > 0.6 ? 'neg' : ''}">${dval(r) > 0.05 ? (Math.round(dval(r) * 10) / 10) + '%' : '—'}</td>
        <td class="iv-bon">${b || r.x.cond ? `<div class="iv-clamp" title="${esc([b, r.x.cond].filter(Boolean).join('\n'))}">${esc(b).replace(/\n/g, '<br>')}${r.x.cond ? `${b ? '<br>' : ''}<i>${esc(r.x.cond)}</i>` : ''}</div>` : '<span class="mut">—</span>'}</td>
        <td style="white-space:nowrap">${INVO.termShort(r)}</td><td style="min-width:150px">${pay(r)}</td><td>${stTag(r)}</td>
        <td class="ct-act">${INVO.status(r) === 'new' && !sp ? `<button class="btn gray sm" data-okstd="${esc(r.id)}" type="button" title="Оставить стандартный срок">✓</button> ` : ''}<button class="btn gray sm" data-ed="${esc(r.id)}" type="button" title="Срок оплаты и условия">✏️ Условия</button>${sp ? ` <button class="btn gray sm" data-pr="${esc(r.id)}" type="button" title="Печать договора">🖨</button>${INVO.status(r) !== 'new' ? ` <button class="btn gray sm" data-st="${esc(r.id)}" type="button" title="${r.x.stored ? 'Сдан на хранение ' + UI.dateRu(r.x.stored) + ' — нажмите, чтобы снять отметку' : 'Подписан и сдан на хранение'}">${r.x.stored ? '📁✓' : '📁'}</button>` : ''}` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : UI.empty(INVO.tab === 'new' ? 'Новых накладных нет — у всех срок задан 👍' : 'Пусто', '');
  const formView = () => `<div class="grid">${UI.panel('Форма договора-спецпредложения', `<div class="form">
      <label>Название компании (Поставщик)<input id="ifC" value="${esc(F.company || '')}"></label>
      <label>Город (если у агента не указан)<input id="ifT" value="${esc(F.city || '')}" placeholder="например: Фергана"></label>
      <label>Стандартная скидка, %<input id="ifS" type="number" min="0" max="100" step="0.5" value="${F.std ?? 10}"></label>
      <div class="mut" style="display:flex;align-items:end;font-size:13px">Накладная с другой скидкой или с бонусным товаром сама помечается «спец».</div>
      <label style="grid-column:1/-1">Город по агентам — по строке «Агент = Город» <span class="mut">(без строки — регион агента из «Пользователи», иначе город выше)</span><textarea id="ifA" rows="3" style="width:100%;box-sizing:border-box;font-family:inherit" placeholder="Adxamjon Umarov = Наманган">${esc(F.cities || '')}</textarea></label>
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
  body.querySelectorAll('.iv-clamp').forEach(d => d.onclick = () => d.classList.toggle('open'));
  body.querySelectorAll('[data-okstd]').forEach(b => b.onclick = () => { const r = byId(b.dataset.okstd); INVO.save(r, { disc: r.disc, spec: false }); re(); });
  body.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { const x = c.orders[b.dataset.st]; if (!x) return; if (x.stored) delete x.stored; else x.stored = UI.localDate(Date.now()); CRMLocal.touch(); re(); });
  body.querySelectorAll('[data-sel]').forEach(b => b.onchange = () => { if (b.checked) INVO.sel.add(b.dataset.sel); else INVO.sel.delete(b.dataset.sel); });
  const allBox = $('#ivAll', body); if (allBox) allBox.onchange = () => { body.querySelectorAll('[data-sel]').forEach(b => { b.checked = allBox.checked; if (b.checked) INVO.sel.add(b.dataset.sel); else INVO.sel.delete(b.dataset.sel); }); };
  const ps = $('#ivPrSel', body); if (ps) ps.onclick = () => { const l = all.filter(r => INVO.sel.has(r.id)); if (!l.length) return toast('Отметьте накладные галочкой слева'); INVO.preview(l); };
  const sa = $('#ivStdAll', body); if (sa) sa.onclick = () => { if (!confirm(`Оставить стандартный срок у ${newStd.length} обычных накладных?`)) return; const d = UI.localDate(Date.now()); for (const r of newStd) c.orders[r.id] = { ...(c.orders[r.id] || {}), disc: r.disc, spec: false, ok: d, snap: { c: r.client, a: r.agent, d: r.d, s: r.s } }; INVO.prune(); INST.changed('Стандартный срок подтверждён: ' + newStd.length); re(); };
  const fs = $('#ifSave', body); if (fs) fs.onclick = () => { Object.assign(F, { company: $('#ifC', body).value.trim(), city: $('#ifT', body).value.trim(), cities: $('#ifA', body).value.trim(), std: Number($('#ifS', body).value) || 0, signers: $('#ifG', body).value.split('\n').map(s => s.trim()).filter(Boolean) }); CRMLocal.touch(); toast('Форма сохранена'); re(); };
  const dm = $('#ifDemo', body); if (dm) dm.onclick = () => { const d = UI.localDate(Date.now()); INVO.preview([{ id: '12345', d, client: 'Пример клиента', agent: 'Агент', s: 1500, disc: 15, bonusItems: ['Сервисная книжка × 10', 'Масло Mitanol 5W-30 4 л × 2'], x: { plan: [{ d: INVO.addMonths(d, 1), s: 750 }, { d: INVO.addMonths(d, 2), s: 750 }], cond: 'акция «2+1»' } }]); };
};

// quick access from the menu (Деньги → Спецпредложения): the «Накладные» page opened right on the special offers tab
EXT_PAGES.specs = el => { INVO.tab = 'spec'; return EXT_PAGES.invo(el); };
