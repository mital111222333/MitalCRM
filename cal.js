// Календарь оплат (Деньги → Календарь оплат): the plan period 16 → 15 as a strip of days; under the chosen day — who must pay,
// how much and why, grouped by agent, next to what really came that day (the same payments as «Оплаты по дням»).
// Why a client pays:
//   «Спец · разовый договор» — the schedule of each order on spec price: 4 weekly parts, or the dates agreed on the order
//     («Сроки и договоры»); counted by the auto-loader (inst-state.json → clients[].orders[].parts).
//   «Договор» — a long contract (ext.inst.contracts): the month's sum is due by the last day of that contract month.
//   «Обещание» — the client's own payment schedule / a promise written after a call (ext.payPlan, ext.collect).
window.EXT_PAGES = window.EXT_PAGES || {};

const CAL = {
  off: 0, day: '', ag: '', why: '', q: '',
  WHY: { spec: ['Спец · разовый договор', 'cal-t1'], ct: ['Договор', 'cal-t2'], prom: ['Обещание', 'cal-t3'] },
  WD: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  iso: (y, m, d) => UI.localDate(new Date(y, m, d).getTime()),
  // the plan period that holds today, moved by `off` periods: 16th → 15th of the next month
  period(off) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth() + (t.getDate() >= 16 ? 0 : -1) + off;
    return { from: CAL.iso(y, m, 16), to: CAL.iso(y, m + 1, 15) };
  },
  days(p) { const out = []; for (let d = new Date(p.from + 'T12:00:00'); UI.localDate(d.getTime()) <= p.to; d.setDate(d.getDate() + 1)) out.push(UI.localDate(d.getTime())); return out; },
  // contract month i: from the start day of month i to the day before the same day of month i+1 (as the auto-loader counts it)
  ctMonth(start, i) {
    const y = +start.slice(0, 4), m0 = +start.slice(5, 7) - 1, d = +start.slice(8, 10);
    const at = k => CAL.iso(y, m0 + k, Math.min(d, new Date(y, m0 + k + 1, 0).getDate()));
    const next = new Date(at(i + 1) + 'T12:00:00'); next.setDate(next.getDate() - 1);
    return { from: at(i), to: UI.localDate(next.getTime()) };
  },
  money: v => '$' + UI.fmt0(Math.round(v || 0)),
  short: v => (v >= 1000 ? '$' + (Math.round(v / 100) / 10).toString().replace('.', ',') + 'k' : v > 0 ? '$' + Math.round(v) : ''),

  // every expected payment: { d, s, client, agent, kind, st: paid|late|wait, why }
  async items() {
    const t0 = REP.today(), out = [], cfg = INST.cfg(), st = cfg.on && INST.cloud() ? await INST.state() : null;
    const hasLX = typeof LX !== 'undefined', norm = n => (hasLX ? LX.norm(n) : String(n).toLowerCase());
    const agentOf = n => INST.agentOfClient(n) || (hasLX ? LX.clientAgent(n) : '') || 'Без агента';
    // spec orders: every part of every order that still has debt
    for (const c of st?.clients || []) {
      if (c.contract) continue; // a contract client pays by the contract month, not by orders
      for (const o of c.orders || []) (o.parts || []).forEach((p, i) => out.push({
        d: p.d, s: p.s, client: c.name, agent: c.agent || agentOf(c.name), kind: 'spec',
        st: p.st === 'paid' ? 'paid' : p.st === 'late' ? 'late' : 'wait',
        why: `Заказ №${esc(o.id)} от ${UI.dm(o.d)} на ${CAL.money(o.s)} · часть ${i + 1} из ${o.parts.length}${o.own ? ' · свой график' : ''}${o.cond ? ' · ' + esc(o.cond) : ''}`,
      }));
    }
    // long contracts: the month's plan, due by the month's last day
    const got = new Map((st?.contracts || []).map(k => [k.id, k]));
    for (const k of cfg.contracts) {
      if (!k.start) continue;
      const P = INST.planOf(k), s = got.get(k.id), name = k.accounts?.[0] || k.title;
      P.forEach((plan, i) => {
        if (!(plan > 0)) return;
        const w = CAL.ctMonth(k.start, i), paid = s?.list?.[i]?.paid ?? null;
        out.push({ d: w.to, s: plan, client: name, title: k.title, agent: k.agent || agentOf(name), kind: 'ct',
          st: paid != null && paid >= plan - 0.5 ? 'paid' : w.to < t0 ? 'late' : 'wait',
          why: `Договор на ${P.length} мес. · платёж за месяц ${i + 1} из ${P.length} (${UI.dm(w.from)}–${UI.dm(w.to)})${paid != null ? ` · уже оплатил ${CAL.money(paid)}` : ''}` });
      });
    }
    // promises and the client's own schedule: paid when the client paid that much from the promised day on
    const M = hasLX && LX.model ? LX.model() : null, pays = new Map();
    for (const p of M?.payments || []) { const n = norm(p.client); (pays.get(n) || pays.set(n, []).get(n)).push(p); }
    const col = CRMLocal.ext().collect || {};
    for (const [name, list] of Object.entries(CRMLocal.ext().payPlan || {})) for (const x of list || []) {
      const rec = (col[name] || []).filter(r => r.r === 'promise' && r.pd === x.d).at(-1);
      const came = (pays.get(norm(name)) || []).filter(p => p.date >= x.d).reduce((a, p) => a + p.amount, 0);
      out.push({ d: x.d, s: x.s, client: name, agent: agentOf(name), kind: 'prom',
        st: came >= x.s - 0.5 ? 'paid' : x.d < t0 ? 'late' : 'wait',
        why: rec ? `Обещал по звонку ${UI.dm(rec.d)}${rec.by ? ' (' + esc(rec.by) + ')' : ''}${rec.note ? ' · ' + esc(rec.note) : ''}` : 'График оплат клиента' });
    }
    return { list: out, st, M };
  },
};

(() => {
  const css = document.createElement('style');
  css.textContent = `.cal-kp{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}
.cal-strip{display:grid;grid-template-columns:repeat(16,minmax(0,1fr));gap:6px;margin:0 0 6px}
.cal-d{all:unset;box-sizing:border-box;cursor:pointer;border:1px solid var(--line);border-radius:14px;padding:8px 2px 9px;text-align:center;background:var(--card);display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;transition:border-color .15s,transform .15s}
.cal-d:hover{transform:translateY(-1px)}.cal-d:focus-visible{outline:2px solid var(--tint,#0a84ff);outline-offset:2px}.cal-d.we{background:color-mix(in srgb,var(--text) 4%,var(--card))}
.cal-d.on{border:2px solid var(--tint,#0a84ff);padding:7px 1px 8px;background:color-mix(in srgb,var(--tint,#0a84ff) 12%,var(--card))}
.cal-d i{font-style:normal;font-size:11px;color:var(--muted)}.cal-d b{font-size:20px;font-weight:700;line-height:1.1}.cal-d em{font-style:normal;font-size:12px;color:var(--text-2,var(--muted));font-weight:600;min-height:15px}
.cal-d.td i{color:var(--tint,#0a84ff);font-weight:700}
.cal-pb{width:74%;height:5px;border-radius:3px;background:color-mix(in srgb,var(--text) 9%,transparent);overflow:hidden;display:flex}.cal-pb s{height:5px;text-decoration:none}
.cal-f{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:16px 0 14px}
.cal-c{all:unset;cursor:pointer;font-size:13px;padding:5px 12px;border-radius:999px;border:1px solid var(--line);color:var(--text-2,var(--muted));white-space:nowrap}
.cal-c:focus-visible{outline:2px solid var(--tint,#0a84ff)}.cal-c.on{background:var(--text);color:var(--card);border-color:var(--text)}.cal-c .dt{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.cal-dh{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:4px 0 12px}.cal-dh h3{margin:0;font-size:22px}
.cal-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px;align-items:start}
.cal-ag{border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden}
.cal-agh{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line)}.cal-agh b{font-size:15px}.cal-agh .tot{margin-left:auto;color:var(--muted);font-size:13px;white-space:nowrap}
.cal-av{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex:none}
.cal-r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 14px;padding:11px 16px;border-bottom:1px solid var(--line)}.cal-r:last-child{border-bottom:0}
.cal-r a.nm{font-size:15px;font-weight:600;color:var(--text);text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cal-r .am{font-size:17px;font-weight:700;text-align:right;white-space:nowrap}.cal-r .why{font-size:12.5px;color:var(--muted);display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.cal-r .stt{font-size:12px;text-align:right;white-space:nowrap}.cal-r.paid .am{color:var(--good,#30d158)}.cal-r.late .am{color:var(--bad,#ff453a)}
.cal-tag{font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.cal-t1{background:color-mix(in srgb,#ff9f0a 18%,transparent);color:color-mix(in srgb,#ff9f0a 70%,var(--text))}
.cal-t2{background:color-mix(in srgb,#bf5af2 18%,transparent);color:color-mix(in srgb,#bf5af2 70%,var(--text))}
.cal-t3{background:color-mix(in srgb,#0a84ff 16%,transparent);color:color-mix(in srgb,#0a84ff 72%,var(--text))}
@media(max-width:900px){.cal-strip{grid-template-columns:repeat(8,minmax(0,1fr))}.cal-kp{grid-template-columns:repeat(2,minmax(0,1fr))}.cal-g{grid-template-columns:1fr}}`;
  document.head.appendChild(css);
})();

EXT_PAGES.pcal = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>Календарь оплат</h2><div class="sub">Загружаю…</div></div></div>';
  await CRMLocal.ready; if (typeof LX !== 'undefined') await LX.load();
  const { list, st, M } = await CAL.items(); if (!el.isConnected) return;
  const P = CAL.period(CAL.off), days = CAL.days(P), t0 = REP.today(), f = CAL.money;
  if (!CAL.day || CAL.day < P.from || CAL.day > P.to) CAL.day = t0 >= P.from && t0 <= P.to ? t0 : P.from;
  const inP = list.filter(x => x.d >= P.from && x.d <= P.to);
  const agents = [...new Set(inP.map(x => x.agent))].sort((a, b) => a.localeCompare(b));
  const PAL = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff375f', '#64d2ff', '#ac8e68', '#5e5ce6', '#ff6b35', '#32ade6'];
  const col = a => PAL[Math.max(0, agents.indexOf(a)) % PAL.length];
  const qn = CAL.q.trim().toLowerCase();
  const V = inP.filter(x => (!CAL.ag || x.agent === CAL.ag) && (!CAL.why || x.kind === CAL.why) && (!qn || x.client.toLowerCase().includes(qn) || (x.title || '').toLowerCase().includes(qn)));
  const sum = (l, s) => l.filter(x => !s || x.st === s).reduce((a, x) => a + x.s, 0), n = (l, s) => l.filter(x => x.st === s).length;
  const came = (M?.payments || []).filter(p => p.date >= P.from && p.date <= P.to && (!CAL.ag || p.agent === CAL.ag));
  const dayBtn = d => {
    const L = V.filter(x => x.d === d), t = sum(L) || 1, dt = new Date(d + 'T12:00:00'), we = dt.getDay() === 0 || dt.getDay() === 6;
    return `<button class="cal-d ${d === CAL.day ? 'on' : ''} ${we ? 'we' : ''} ${d === t0 ? 'td' : ''}" data-d="${d}" type="button" aria-label="${UI.dateRu(d)}: ${f(sum(L))}" aria-pressed="${d === CAL.day}">
      <i>${d === t0 ? 'сегодня' : CAL.WD[dt.getDay()]}</i><b>${dt.getDate()}</b><em>${CAL.short(sum(L))}</em>
      <span class="cal-pb" style="${L.length ? '' : 'visibility:hidden'}">${L.length ? `<s style="width:${sum(L, 'paid') / t * 100}%;background:var(--good,#30d158)"></s><s style="width:${sum(L, 'late') / t * 100}%;background:var(--bad,#ff453a)"></s><s style="width:${sum(L, 'wait') / t * 100}%;background:color-mix(in srgb,var(--text) 25%,transparent)"></s>` : ''}</span></button>`;
  };
  const half = Math.ceil(days.length / 2);
  const D = V.filter(x => x.d === CAL.day), byAg = new Map(); for (const x of D) (byAg.get(x.agent) || byAg.set(x.agent, []).get(x.agent)).push(x);
  const cameD = came.filter(p => p.date === CAL.day && (!qn || p.client.toLowerCase().includes(qn))), cameS = cameD.reduce((a, p) => a + p.amount, 0);
  const row = x => `<div class="cal-r ${x.st}"><a class="nm" href="#" data-client="${esc(x.client)}" title="${esc(x.client)}">${esc(x.kind === 'ct' && x.title ? x.title : x.client)}</a><div class="am">${f(x.s)}</div>
    <div class="why"><span class="cal-tag ${CAL.WHY[x.kind][1]}">${CAL.WHY[x.kind][0]}</span>${x.why}</div>
    <div class="stt">${x.st === 'paid' ? '<span class="pill good">оплатил</span>' : x.st === 'late' ? '<span class="pill crit">не оплатил</span>' : CAL.day === t0 ? '<span class="pill info">сегодня</span>' : '<span class="mut">ожидаем</span>'}</div></div>`;
  const agBox = ([a, L]) => `<section class="cal-ag"><div class="cal-agh"><span class="cal-av" style="background:${col(a)}">${esc(a.slice(0, 1))}</span><b>${esc(a)}</b><span class="tot">${L.length} ${UI.plural(L.length, 'клиент', 'клиента', 'клиентов')} · <b style="color:var(--text)">${f(sum(L))}</b></span></div>${L.sort((x, y) => y.s - x.s).map(row).join('')}</section>`;
  const dt = new Date(CAL.day + 'T12:00:00'), wd = dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const noSpec = !st ? `<div class="empty">Спец-графики заказов считает автозагрузка — включите её в <a href="#/inst">Рассрочка и договоры → Настройки</a>. Сейчас видны только договоры и обещания.</div>` : '';
  el.innerHTML = `<div class="page-head"><div><h2>Календарь оплат</h2><div class="sub">Кто, когда и сколько должен заплатить · период ${UI.dateRu(P.from)} — ${UI.dateRu(P.to)}</div></div>
      <div class="actions"><button class="btn gray" id="calPrev" type="button" aria-label="Прошлый период">‹ ${UI.dm(CAL.period(CAL.off - 1).from)}</button>${CAL.off ? '<button class="btn gray" id="calNow" type="button">Текущий период</button>' : ''}<button class="btn gray" id="calNext" type="button" aria-label="Следующий период">${UI.dm(CAL.period(CAL.off + 1).from)} ›</button></div></div>
    <div class="cal-kp">
      ${UI.tile('Ждём за период', f(sum(V)), { sub: `${V.length} ${UI.plural(V.length, 'платёж', 'платежа', 'платежей')} по графику` })}
      ${UI.tile('Оплачено по графику', f(sum(V, 'paid')), { tone: 'good', sub: `всего пришло за период ${f(came.reduce((a, p) => a + p.amount, 0))}` })}
      ${UI.tile('Просрочено', f(sum(V, 'late')), { tone: sum(V, 'late') ? 'bad' : '', sub: `${n(V, 'late')} ${UI.plural(n(V, 'late'), 'платёж', 'платежа', 'платежей')}` })}
      ${UI.tile('Осталось получить', f(sum(V, 'wait')), { sub: 'до ' + UI.dateRu(P.to) })}
    </div>
    ${noSpec}
    <div class="cal-strip">${days.slice(0, half).map(dayBtn).join('')}</div><div class="cal-strip">${days.slice(half).map(dayBtn).join('')}</div>
    <div class="cal-f"><button class="cal-c ${!CAL.ag ? 'on' : ''}" data-ag="" type="button">Все агенты</button>${agents.map(a => `<button class="cal-c ${CAL.ag === a ? 'on' : ''}" data-ag="${esc(a)}" type="button"><span class="dt" style="background:${col(a)}"></span>${esc(a)}</button>`).join('')}
      <span style="width:14px"></span><button class="cal-c ${!CAL.why ? 'on' : ''}" data-why="" type="button">Все причины</button>${Object.entries(CAL.WHY).map(([k, [t]]) => `<button class="cal-c ${CAL.why === k ? 'on' : ''}" data-why="${k}" type="button">${t}</button>`).join('')}
      <span style="flex:1"></span><input id="calQ" type="search" placeholder="Поиск клиента" value="${esc(CAL.q)}" style="max-width:220px" aria-label="Поиск клиента"></div>
    <div class="cal-dh"><h3>${wd[0].toUpperCase() + wd.slice(1)}</h3><span class="mut">${D.length ? `${D.length} ${UI.plural(D.length, 'клиент должен', 'клиента должны', 'клиентов должны')} заплатить <b style="color:var(--text)">${f(sum(D))}</b>` : 'по графику оплат нет'}${cameD.length ? ` · фактически пришло <b class="pos">${f(cameS)}</b>` : ''}</span></div>
    <div class="cal-g">${[...byAg.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).map(agBox).join('') || '<div class="empty">В этот день оплат по графику не ждём.</div>'}
      ${cameD.length ? `<section class="cal-ag"><div class="cal-agh"><b>Фактически пришло в этот день</b><span class="tot">${cameD.length} ${UI.plural(cameD.length, 'оплата', 'оплаты', 'оплат')} · <b class="pos">${f(cameS)}</b></span></div>${cameD.slice().sort((a, b) => b.amount - a.amount).map(p => `<div class="cal-r paid"><a class="nm" href="#" data-client="${esc(p.client)}">${esc(p.client)}</a><div class="am">${f(p.amount)}</div><div class="why">${esc(p.agent)}${p.time ? ' · ' + esc(p.time) : ''}</div><div></div></div>`).join('')}</section>` : ''}
    </div>`;
  const redraw = () => EXT_PAGES.pcal(el);
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { CAL.day = b.dataset.d; redraw(); });
  el.querySelectorAll('[data-ag]').forEach(b => b.onclick = () => { CAL.ag = b.dataset.ag; redraw(); });
  el.querySelectorAll('[data-why]').forEach(b => b.onclick = () => { CAL.why = b.dataset.why; redraw(); });
  $('#calPrev', el).onclick = () => { CAL.off--; CAL.day = ''; redraw(); };
  $('#calNext', el).onclick = () => { CAL.off++; CAL.day = ''; redraw(); };
  const now = $('#calNow', el); if (now) now.onclick = () => { CAL.off = 0; CAL.day = ''; redraw(); };
  const q = $('#calQ', el); let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => { CAL.q = q.value; await redraw(); const n2 = $('#calQ', el); if (n2) { n2.focus(); n2.setSelectionRange(n2.value.length, n2.value.length); } }, 350); };
};
