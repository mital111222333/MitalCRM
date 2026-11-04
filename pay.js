// Зарплата (Агенты → 💰 Зарплата): the payroll of a plan period (the 16th – the 15th, the same period as the plans).
// Per person: the fixed pay in $ for the days at work (fix / working days of the month × days at work; days come from the
// attendance sheet of «Дисциплина»: a day with a LINKO report = 1, half a day = 0.5, командировка = 1; sick, отпросился,
// невыход and the rest are not paid), the percent of the money collected (the «Оплачено» of the LINKO client balance for the
// period; a team lead — of his agents and his own clients), the bonus by the collection ladder ($10 000 → $50, $20 000 → $100,
// $30 000 → $200 …), fuel (km of the month × сум per km, own rate for each person), minus advances (сум or $), minus the
// fines for being late (from «Дисциплина»), plus / minus anything else. $ are turned into сум at the rate of the month
// (the «Курс ЦБ» button takes the Central Bank rate). One person without lateness may get a restaurant voucher — shown, not paid.
// «Закрыть месяц» freezes the payroll and sends each person his pay slip in Telegram and to his cabinet (agentcab.js → me.js).
// Stored in the synced state: ext.pay = { bonus: [[10000, 50], …], bonusStep: 100, bonusEvery: 10000, voucher: 600000,
//   staff: { [name]: { role: 'agent' | 'lead' | 'courier' | 'store' | 'other', on, fix, pct, bonus, team: [agents], fuel, fines } },
//   periods: { [from]: { days: 26, rate, rateAt, km: { [name]: km }, worked: { [name]: days }, adv: { [name]: [{ d, s, cur, note }] },
//     extra: { [name]: [{ s, cur, note }] }, voucher: name, closed: iso, rows: [frozen rows] } }, slips: { [name]: slip } }.
window.EXT_PAGES = window.EXT_PAGES || {};

const PAY = {
  from: '',
  ROLE: { agent: 'Агент', lead: 'Руководитель', courier: 'Доставщик', store: 'Завсклад', other: 'Другое' },
  DEF: { agent: { fix: 400, pct: 1, bonus: true, fuel: 600, fines: true }, lead: { fix: 600, pct: 1, bonus: false, fuel: 600, fines: true }, courier: { fix: 400, pct: 0, bonus: false, fuel: 600, fines: false }, store: { fix: 400, pct: 0, bonus: false, fuel: 0, fines: false }, other: { fix: 0, pct: 0, bonus: false, fuel: 0, fines: false } },
  cfg() {
    const x = CRMLocal.ext(), c = (x.pay ||= {});
    c.bonus ||= [[10000, 50], [20000, 100], [30000, 200], [40000, 300], [50000, 400], [60000, 500]];
    if (c.bonusStep == null) c.bonusStep = 100; if (c.bonusEvery == null) c.bonusEvery = 10000; if (c.voucher == null) c.voucher = 600000;
    c.staff ||= {}; c.periods ||= {}; c.slips ||= {}; return c;
  },
  per(from) { const p = (PAY.cfg().periods[from] ||= {}); if (!p.days) p.days = 26; p.km ||= {}; p.worked ||= {}; p.adv ||= {}; p.extra ||= {}; return p; },
  person(name, role) { const c = PAY.cfg(); if (!c.staff[name]) c.staff[name] = { role: role || 'agent', on: true, team: [], ...PAY.DEF[role || 'agent'] }; return c.staff[name]; },
  sum: v => Math.round(v || 0).toLocaleString('ru-RU') + ' сум',
  usd: v => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
  inSum: (v, cur, rate) => (cur === '$' ? (Number(v) || 0) * rate : Number(v) || 0),
  // the bonus of a collection: the highest step reached; past the last step +bonusStep for every bonusEvery more
  bonusOf(collected) {
    const c = PAY.cfg(), L = c.bonus.filter(b => b[0] > 0).slice().sort((a, b) => a[0] - b[0]); let b = 0;
    for (const [t, v] of L) if (collected >= t) b = v;
    const last = L[L.length - 1];
    if (last && collected >= last[0] && c.bonusStep > 0 && c.bonusEvery > 0) b = last[1] + Math.floor((collected - last[0]) / c.bonusEvery) * c.bonusStep;
    return b;
  },
  // the period's balance snapshot: the final one (with the payments of the next day) if there is one, else the newest
  async dash(from) {
    const end = PLAN.end(from), grace = UI.localDate(Date.parse(end + 'T12:00:00') + 864e5);
    const own = (CRMLocal.engine.getState().ag.uploads || []).filter(u => u.period_from === from && !u.synth).sort((a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : b.id - a.id));
    const all = (CRMLocal.engine.getState().ag.uploads || []).filter(u => u.period_from === from);
    const top = all.find(u => u.period_to === grace) || own.find(u => u.taken_at <= end) || own[0];
    if (!top) return null;
    const d = await CRMLocal.request('GET', '/api/ag/dashboard?upload=' + top.id);
    return d && !d.error && !d.empty ? { d, at: top.taken_at, final: top.period_to === grace } : null;
  },
  // days at work in the period from the attendance sheet: a report = 1, half a day = 0.5, командировка = 1; the rest are not paid
  workedOf(name, from, end) {
    if (typeof DS === 'undefined') return null;
    const c = DS.cfg(), t0 = UI.localDate(Date.now()); let n = 0, seen = false;
    for (let t = Date.parse(from + 'T12:00:00'), e = Date.parse((end < t0 ? end : t0) + 'T12:00:00'); t <= e; t += 864e5) {
      const d = UI.localDate(t), x = c.days[d]?.[name], st = DS.eff(d, name, x).st; if (x || c.abs[d]?.[name]) seen = true;
      n += st === 'trip' ? 1 : DS.worked(st, x);
    }
    return seen ? n : null; // no record of this person at all — not in LINKO (courier, store keeper): days are set by hand
  },
  // невыходы of the period (полдня без причины = 0.5): a person with any is not offered the voucher
  absentOf(name, from, end) {
    if (typeof DS === 'undefined') return 0;
    const c = DS.cfg(), t0 = UI.localDate(Date.now()); let n = 0;
    for (let t = Date.parse(from + 'T12:00:00'), e = Date.parse((end < t0 ? end : t0) + 'T12:00:00'); t <= e; t += 864e5) { const d = UI.localDate(t), st = DS.eff(d, name, c.days[d]?.[name]).st; n += st === 'absent' ? 1 : st === 'halfbad' ? 0.5 : 0; }
    return n;
  },
  finesOf(name, from, end) {
    if (typeof DS === 'undefined') return { sum: 0, min: 0 };
    const c = DS.cfg(), start = DS.mins(c.start || '09:00'); let min = 0;
    for (let t = Date.parse(from + 'T12:00:00'), e = Date.parse(end + 'T12:00:00'); t <= e; t += 864e5) { const d = UI.localDate(t), x = c.days[d]?.[name]; if (x?.first) min += DS.lateFor(d, name, x.first, start); }
    return { min, sum: min * (Number(c.fine) || 0) };
  },

  // every row of the payroll of a period
  rows(from, D) {
    const c = PAY.cfg(), p = PAY.per(from), end = PLAN.end(from), rate = Number(p.rate) || 0, days = Number(p.days) || 26;
    const ag = new Map((D?.d?.agents || []).filter(a => a.agent && a.agent !== 'Без агента').map(a => [a.agent, a]));
    for (const a of ag.keys()) PAY.person(a, 'agent');
    return Object.entries(c.staff).filter(([, s]) => s.on !== false).map(([name, s]) => {
      const auto = PAY.workedOf(name, from, end), worked = p.worked[name] != null ? Number(p.worked[name]) : auto != null ? auto : days;
      const paidDays = Math.min(worked, days), fix = (Number(s.fix) || 0) / days * paidDays;
      const own = ag.get(name)?.paid || 0, team = s.role === 'lead' ? (s.team || []).filter(t => t !== name).reduce((t, a) => t + (ag.get(a)?.paid || 0), 0) : 0;
      const collected = own + team, pct = collected * (Number(s.pct) || 0) / 100, bonus = s.bonus ? PAY.bonusOf(collected) : 0;
      const km = Number(p.km[name]) || 0, fuel = km * (Number(s.fuel) || 0);
      const adv = (p.adv[name] || []).reduce((t, a) => t + PAY.inSum(a.s, a.cur, rate), 0), extra = (p.extra[name] || []).reduce((t, a) => t + PAY.inSum(a.s, a.cur, rate), 0);
      const fn = s.fines !== false ? PAY.finesOf(name, from, end) : { sum: 0, min: 0 };
      const usd = fix + pct + bonus, total = Math.round(usd * rate + fuel + extra - adv - fn.sum);
      return { name, role: s.role, s, days, worked, auto, paidDays, fix, own, team, collected, pct, bonus, usd, km, fuel, adv, extra, fine: fn.sum, fineMin: fn.min, total, rate };
    }).sort((a, b) => Object.keys(PAY.ROLE).indexOf(a.role) - Object.keys(PAY.ROLE).indexOf(b.role) || a.name.localeCompare(b.name));
  },
  // the pay slip as lines (for the detail window, Telegram and the cabinet)
  slip(r, from, p) {
    const n = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU');
    const L = [[`Фикс: $${n(r.s.fix, 0)} / ${r.days} дн. × ${n(r.paidDays, 1)} дн.`, PAY.usd(r.fix)]];
    if (r.pct) L.push([`Собрано ${PAY.usd(r.collected)}${r.team ? ` (свои ${PAY.usd(r.own)} + команда ${PAY.usd(r.team)})` : ''} × ${r.s.pct}%`, PAY.usd(r.pct)]);
    if (r.s.bonus) L.push([`Бонус за сбор ${PAY.usd(r.collected)}`, PAY.usd(r.bonus)]);
    L.push([`Итого в $ ${PAY.usd(r.usd)} × курс ${n(r.rate, 2)}`, PAY.sum(r.usd * r.rate)]);
    if (r.fuel) L.push([`Газ / метан: ${n(r.km, 0)} км × ${n(r.s.fuel, 0)} сум`, PAY.sum(r.fuel)]);
    for (const e of p.extra[r.name] || []) L.push([`${e.note || 'Прочее'}`, (e.s < 0 ? '−' : '+') + (e.cur === '$' ? PAY.usd(Math.abs(e.s)) : PAY.sum(Math.abs(e.s)))]);
    for (const a of p.adv[r.name] || []) L.push([`Аванс${a.d ? ' ' + UI.dm(a.d) : ''}${a.note ? ' · ' + a.note : ''}`, '−' + (a.cur === '$' ? PAY.usd(a.s) : PAY.sum(a.s))]);
    if (r.fine) L.push([`Штраф за опоздания: ${n(r.fineMin, 0)} мин`, '−' + PAY.sum(r.fine)]);
    return L;
  },
  async rateCbu() {
    const r = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/', { cache: 'no-store' }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null, v = Number(j?.[0]?.Rate);
    if (!(v > 0)) throw new Error('Курс ЦБ не получен — впишите вручную');
    return { rate: v, date: j[0].Date };
  },
  // «Закрыть месяц»: rows frozen, a pay slip to everyone with a Telegram chat and to his cabinet
  async close(from, rows) {
    const c = PAY.cfg(), p = PAY.per(from), tg = CRMLocal.ext().tg || {}, label = PLAN.label(from); let sent = 0;
    p.rows = rows.map(r => ({ ...r, s: { ...r.s }, lines: PAY.slip(r, from, p) })); p.closed = new Date().toISOString();
    for (const r of p.rows) {
      const voucher = p.voucher === r.name;
      c.slips[r.name] = { period: from, label, lines: r.lines, total: r.total, voucher: voucher ? c.voucher : 0, at: p.closed };
      const ch = tg.chats?.[r.name]?.id;
      if (tg.token && ch) try { await TG.send(ch, esc(`💰 Зарплата за ${label}\n` + r.lines.map(([a, b]) => `${a}: ${b}`).join('\n') + `\n\nК выплате: ${PAY.sum(r.total)}` + (voucher ? `\n🎁 Ваучер в ресторан на ${PAY.sum(c.voucher)} — за месяц без опозданий!` : ''))); sent++; } catch (e) { toast('Telegram, ' + r.name + ': ' + e.message); }
    }
    CRMLocal.touch();
    if (typeof AC !== 'undefined' && AC.publish) AC.publish({ force: true }).catch(() => {});
    return sent;
  },
  periods() {
    const ups = CRMLocal.engine.getState().ag.uploads || [], t0 = UI.localDate(Date.now());
    return [...new Set([PLAN.from(t0), ...ups.map(u => u.period_from), ...Object.keys(PAY.cfg().periods)])].filter(Boolean).sort().reverse().slice(0, 12);
  },
};

EXT_PAGES.pay = async el => {
  await CRMLocal.ready;
  const c = PAY.cfg(), list = PAY.periods(); if (!list.includes(PAY.from)) PAY.from = list[0];
  const from = PAY.from, p = PAY.per(from), end = PLAN.end(from), closed = !!p.closed, f = UI.fmt0;
  el.innerHTML = `<div class="page-head"><div><h2>💰 Зарплата</h2><div class="sub">Фикс по явке, процент и бонус со сбора, газ, авансы и штрафы за период плана ${esc(PLAN.label(from))}</div></div></div><div id="payBody"><p class="mut">Считаю…</p></div>`;
  const body = $('#payBody', el), D = await PAY.dash(from).catch(() => null);
  if (!el.isConnected) return;
  const rows = closed && p.rows ? p.rows : PAY.rows(from, D), rate = Number(p.rate) || 0;
  const tot = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  // the voucher: agents who were never late and had no невыход in the period
  const noLate = rows.filter(r => r.role === 'agent' && !r.fineMin && r.paidDays > 0 && !PAY.absentOf(r.name, from, end) && (typeof DS === 'undefined' || !DS.cfg().skip[r.name]));
  const staffAll = Object.entries(c.staff).sort((a, b) => a[0].localeCompare(b[0])), agentsAll = staffAll.filter(([, s]) => s.role === 'agent').map(([n]) => n);
  body.innerHTML = `<div class="bar" style="flex-wrap:wrap">
      <label class="mut">Период <select id="pyFrom">${list.map(x => `<option value="${x}" ${x === from ? 'selected' : ''}>${esc(PLAN.label(x))}${c.periods[x]?.closed ? ' · закрыт' : ''}</option>`).join('')}</select></label>
      <label class="mut">Рабочих дней в месяце <input id="pyDays" type="number" min="1" max="31" step="0.5" value="${p.days}" style="width:70px" ${closed ? 'disabled' : ''}></label>
      <label class="mut">Курс $ <input id="pyRate" type="number" min="0" step="0.01" value="${rate || ''}" placeholder="например 12 700" style="width:110px" ${closed ? 'disabled' : ''}></label>
      ${closed ? '' : '<button class="btn gray sm" id="pyCbu" type="button">Курс ЦБ</button>'}<span class="mut">${p.rateAt ? 'курс ЦБ на ' + esc(p.rateAt) : ''}</span>
      <span class="spacer" style="flex:1"></span>
      <button class="btn gray sm" id="pyXls" type="button">⬇ Excel</button>
      ${closed ? `<span class="pill good">месяц закрыт ${new Date(p.closed).toLocaleDateString('ru-RU')}</span> <button class="btn gray sm" id="pyReopen" type="button">Открыть заново</button>` : '<button class="btn" id="pyClose" type="button">✓ Закрыть месяц и разослать</button>'}</div>
    ${!rate ? '<p class="neg"><b>Впишите курс доллара</b> (или «Курс ЦБ») — без него суммы в $ не переводятся в сумы.</p>' : ''}
    ${!D ? '<p class="mut">⚠ Нет баланса LINKO за этот период — собранные деньги, процент и бонус = 0.</p>' : !D.final && end < UI.localDate(Date.now()) ? '<p class="mut">⚠ Итогового баланса за этот период (с оплатами 16-го) ещё нет — сбор по последнему балансу периода.</p>' : ''}
    <div class="kpis">
      ${UI.tile('К выплате всего', rate ? PAY.sum(tot('total')) : 'нужен курс', { sub: rows.length + ' чел.' + (rate ? '' : ' · впишите курс $'), hero: true })}
      ${UI.tile('Фикс + % + бонус', PAY.usd(tot('usd')), { sub: rate ? '≈ ' + PAY.sum(tot('usd') * rate) : 'нужен курс' })}
      ${UI.tile('Газ / метан', PAY.sum(tot('fuel')), { sub: f(tot('km')) + ' км' })}
      ${UI.tile('Авансы', PAY.sum(tot('adv')), { sub: 'вычтены', tone: tot('adv') ? 'warn' : '' })}
      ${UI.tile('Штрафы', PAY.sum(tot('fine')), { sub: f(tot('fineMin')) + ' мин опозданий', tone: tot('fine') ? 'bad' : 'good' })}
    </div>
    <div class="grid">
    ${UI.panel('Ведомость', `<div class="tscroll"><table><thead><tr><th>Сотрудник</th><th class="n">Дней</th><th class="n">Фикс</th><th class="n">Собрано</th><th class="n">%</th><th class="n">Бонус</th><th class="n">Км</th><th class="n">Газ</th><th class="n">Авансы</th><th class="n">Штраф</th><th class="n">Прочее</th><th class="n">К выплате</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b><div class="mut" style="font-size:12px">${esc(PAY.ROLE[r.role] || r.role)}${p.voucher === r.name ? ' · 🎁 ваучер' : ''}</div></td>
        <td class="n">${closed ? f(r.paidDays) : `<input data-pyw="${esc(r.name)}" type="number" min="0" max="31" step="0.5" value="${p.worked[r.name] ?? (r.auto ?? r.days)}" style="width:58px;text-align:right" title="${r.auto != null ? 'по табелю: ' + r.auto + ' дн.' : 'нет в табеле — впишите вручную'}">`}<small class="mut"> / ${r.days}</small>${r.auto != null && p.worked[r.name] != null && Number(p.worked[r.name]) !== r.auto ? '<div class="mut" style="font-size:11px">табель: ' + r.auto + '</div>' : ''}</td>
        <td class="n">${PAY.usd(r.fix)}</td><td class="n">${r.collected ? PAY.usd(r.collected) : '—'}</td><td class="n">${r.pct ? PAY.usd(r.pct) : '—'}</td><td class="n">${r.bonus ? '<b>' + PAY.usd(r.bonus) + '</b>' : '—'}</td>
        <td class="n">${closed ? f(r.km) : `<input data-pyk="${esc(r.name)}" type="number" min="0" step="10" value="${p.km[r.name] || ''}" placeholder="0" style="width:72px;text-align:right">`}</td>
        <td class="n">${r.fuel ? f(r.fuel) : '—'}</td><td class="n ${r.adv ? 'neg' : ''}">${r.adv ? '−' + f(r.adv) : '—'}</td><td class="n ${r.fine ? 'neg' : ''}">${r.fine ? '−' + f(r.fine) : '—'}</td><td class="n">${r.extra ? (r.extra > 0 ? '+' : '−') + f(Math.abs(r.extra)) : '—'}</td>
        <td class="n">${rate ? `<b>${f(r.total)}</b><div class="mut" style="font-size:11px">≈ ${PAY.usd(r.total / rate)}</div>` : '<span class="mut">нужен курс</span>'}</td><td><button class="btn gray sm" data-pyopen="${esc(r.name)}" type="button">${closed ? 'Лист' : 'Авансы, лист'}</button></td></tr>`).join('')}
      <tr><td><b>Итого</b></td><td></td><td class="n"><b>${PAY.usd(tot('fix'))}</b></td><td class="n"><b>${PAY.usd(tot('collected'))}</b></td><td class="n"><b>${PAY.usd(tot('pct'))}</b></td><td class="n"><b>${PAY.usd(tot('bonus'))}</b></td><td class="n"><b>${f(tot('km'))}</b></td><td class="n"><b>${f(tot('fuel'))}</b></td><td class="n"><b>${f(tot('adv'))}</b></td><td class="n"><b>${f(tot('fine'))}</b></td><td class="n"><b>${f(tot('extra'))}</b></td><td class="n"><b>${rate ? f(tot('total')) : '—'}</b></td><td></td></tr></tbody></table></div>`,
      { cls: 'w12', sub: `Фикс = фикс / ${p.days} дн. × дней на работе (по табелю «Дисциплины»: отчёт в LINKO = 1, полдня = 0,5, командировка = 1; больничный, отпросился, невыход не оплачиваются; число можно поправить). Собрано — «Оплачено» из баланса LINKO за период${D ? ' (баланс на ' + UI.dateRu(D.at) + ')' : ''}. Суммы — в сумах по курсу; «≈ $» — для сравнения.` })}
    ${UI.panel('🎁 Ваучер в ресторан', noLate.length ? `<p class="mut" style="margin-top:0">Без опозданий и невыходов за период: ${noLate.length}. Выберите одного — ему придёт поздравление вместе с расчётом (ваучер ${PAY.sum(c.voucher)}, деньгами не выплачивается).</p>
      <div class="bar" style="flex-wrap:wrap">${noLate.map(r => `<label style="display:flex;gap:6px;align-items:center"><input type="radio" name="pyV" value="${esc(r.name)}" ${p.voucher === r.name ? 'checked' : ''} ${closed ? 'disabled' : ''}> ${esc(r.name)}</label>`).join('')}${closed ? '' : '<label style="display:flex;gap:6px;align-items:center"><input type="radio" name="pyV" value="" ' + (!p.voucher ? 'checked' : '') + '> никому</label>'}</div>` : '<p class="mut" style="margin:0">В этом периоде нет агентов без опозданий и невыходов.</p>', { cls: 'w6' })}
    ${UI.panel('Бонус за сбор', `<div class="tscroll"><table><thead><tr><th class="n">Собрал от, $</th><th class="n">Бонус, $</th><th></th></tr></thead><tbody>${c.bonus.map((b, i) => `<tr><td class="n"><input data-pyb="${i}" data-k="0" type="number" min="0" step="1000" value="${b[0]}" style="width:100px;text-align:right"></td><td class="n"><input data-pyb="${i}" data-k="1" type="number" min="0" step="10" value="${b[1]}" style="width:80px;text-align:right"></td><td><button class="btn gray sm" data-pybdel="${i}" type="button">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="bar" style="flex-wrap:wrap"><button class="btn gray sm" id="pyBAdd" type="button">＋ ступень</button><label class="mut">дальше + <input id="pyBStep" type="number" min="0" step="10" value="${c.bonusStep}" style="width:70px"> $ за каждые <input id="pyBEvery" type="number" min="1000" step="1000" value="${c.bonusEvery}" style="width:90px"> $</label><label class="mut">Ваучер, сум <input id="pyVSum" type="number" min="0" step="10000" value="${c.voucher}" style="width:110px"></label></div>`,
      { cls: 'w6', sub: 'Бонус получают те, у кого в условиях стоит «бонус». Пример: собрал $25 000 → $100, $64 000 → $500, дальше по шагу.' })}
    ${UI.panel('Сотрудники и условия', `<div class="tscroll"><table><thead><tr><th>В ведомости</th><th>Сотрудник</th><th>Должность</th><th class="n">Фикс, $</th><th class="n">% со сбора</th><th>Бонус</th><th class="n">Газ, сум/км</th><th>Штрафы</th><th>Команда (для руководителя)</th></tr></thead><tbody>
      ${staffAll.map(([n, s]) => `<tr><td><input type="checkbox" data-pys="${esc(n)}" data-k="on" ${s.on !== false ? 'checked' : ''}></td><td>${esc(n)}</td>
        <td><select data-pys="${esc(n)}" data-k="role">${Object.entries(PAY.ROLE).map(([k, t]) => `<option value="${k}" ${s.role === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="n"><input data-pys="${esc(n)}" data-k="fix" type="number" min="0" step="10" value="${s.fix ?? 0}" style="width:70px;text-align:right"></td>
        <td class="n"><input data-pys="${esc(n)}" data-k="pct" type="number" min="0" max="100" step="0.1" value="${s.pct ?? 0}" style="width:60px;text-align:right"></td>
        <td><input type="checkbox" data-pys="${esc(n)}" data-k="bonus" ${s.bonus ? 'checked' : ''}></td>
        <td class="n"><input data-pys="${esc(n)}" data-k="fuel" type="number" min="0" step="50" value="${s.fuel ?? 0}" style="width:70px;text-align:right"></td>
        <td><input type="checkbox" data-pys="${esc(n)}" data-k="fines" ${s.fines !== false ? 'checked' : ''}></td>
        <td>${s.role === 'lead' ? `<details><summary>${(s.team || []).length ? esc((s.team || []).join(', ')) : 'выбрать агентов'}</summary>${agentsAll.filter(a => a !== n).map(a => `<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-pyteam="${esc(n)}" value="${esc(a)}" ${(s.team || []).includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</details>` : '<span class="mut">—</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="bar" style="flex-wrap:wrap"><input id="pyNew" placeholder="Имя (доставщик, завсклад…)" style="min-width:220px"><select id="pyNewRole">${Object.entries(PAY.ROLE).filter(([k]) => k !== 'agent').map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><button class="btn gray sm" id="pyAdd" type="button">＋ Добавить сотрудника</button></div>`,
      { cls: 'w12', sub: 'Агенты из LINKO появляются сами (фикс $400, 1%, бонус). Руководителю отметьте его агентов — процент считается с их сбора и с его собственных клиентов. Доставщик и завсклад без LINKO — дни на работе вписываются в ведомости. «Штрафы» — вычитать штрафы за опоздания из «Дисциплины». Снимите «В ведомости», если человеку зарплата здесь не считается.' })}
    </div>`;

  const redraw = () => EXT_PAGES.pay(el), save = () => { CRMLocal.touch(); redraw(); };
  $('#pyFrom', body).onchange = e => { PAY.from = e.target.value; redraw(); };
  $('#pyXls', body).onclick = () => UI.csv('зарплата-' + from, [['Сотрудник', 'Должность', 'Дней на работе', 'Из дней', 'Фикс, $', 'Собрано, $', 'Процент, $', 'Бонус, $', 'Курс', 'Км', 'Газ, сум', 'Авансы, сум', 'Штраф, сум', 'Прочее, сум', 'К выплате, сум', 'Ваучер'],
    ...rows.map(r => [r.name, PAY.ROLE[r.role] || r.role, r.paidDays, r.days, Math.round(r.fix * 100) / 100, Math.round(r.collected), Math.round(r.pct * 100) / 100, r.bonus, rate, r.km, Math.round(r.fuel), Math.round(r.adv), Math.round(r.fine), Math.round(r.extra), r.total, p.voucher === r.name ? c.voucher : ''])]);
  body.querySelectorAll('[data-pyopen]').forEach(b => b.onclick = () => PAY.dialog(rows.find(r => r.name === b.dataset.pyopen), from, closed, redraw));
  if (closed) { $('#pyReopen', body).onclick = () => { if (!confirm('Открыть ведомость заново? Суммы снова будут считаться; расчётные листы у сотрудников останутся до следующего закрытия.')) return; delete p.closed; delete p.rows; save(); }; }
  else {
    $('#pyDays', body).onchange = e => { const v = Number(e.target.value); if (!(v >= 1 && v <= 31)) return toast('Дней: от 1 до 31'); p.days = v; save(); };
    $('#pyRate', body).onchange = e => { const v = Number(e.target.value); p.rate = v > 0 ? v : 0; p.rateAt = ''; save(); };
    $('#pyCbu', body).onclick = async () => { try { const r = await PAY.rateCbu(); p.rate = r.rate; p.rateAt = r.date; toast('Курс ЦБ на ' + r.date + ': ' + r.rate); save(); } catch (e) { toast(e.message); } };
    body.querySelectorAll('[data-pyw]').forEach(i => i.onchange = () => { const r = rows.find(x => x.name === i.dataset.pyw), v = i.value === '' ? null : Number(i.value); if (v === null || v === r.auto) delete p.worked[i.dataset.pyw]; else p.worked[i.dataset.pyw] = v; save(); });
    body.querySelectorAll('[data-pyk]').forEach(i => i.onchange = () => { const v = Number(i.value) || 0; if (v) p.km[i.dataset.pyk] = v; else delete p.km[i.dataset.pyk]; save(); });
    body.querySelectorAll('input[name="pyV"]').forEach(i => i.onchange = () => { p.voucher = i.value || ''; save(); });
    $('#pyClose', body).onclick = async () => {
      if (!rate) return toast('Сначала впишите курс доллара');
      if (!confirm(`Закрыть ведомость ${PLAN.label(from)}? Суммы зафиксируются, каждому с Telegram придёт расчётный лист.`)) return;
      const n = await PAY.close(from, rows); toast(`Месяц закрыт. Расчётных листов отправлено: ${n}`); redraw();
    };
  }
  // bonus ladder, voucher, staff conditions (they are not per period)
  body.querySelectorAll('[data-pyb]').forEach(i => i.onchange = () => { c.bonus[+i.dataset.pyb][+i.dataset.k] = Number(i.value) || 0; save(); });
  body.querySelectorAll('[data-pybdel]').forEach(b => b.onclick = () => { c.bonus.splice(+b.dataset.pybdel, 1); save(); });
  $('#pyBAdd', body).onclick = () => { const l = c.bonus[c.bonus.length - 1] || [0, 0]; c.bonus.push([l[0] + 10000, l[1] + 100]); save(); };
  $('#pyBStep', body).onchange = e => { c.bonusStep = Number(e.target.value) || 0; save(); };
  $('#pyBEvery', body).onchange = e => { c.bonusEvery = Math.max(1, Number(e.target.value) || 10000); save(); };
  $('#pyVSum', body).onchange = e => { c.voucher = Number(e.target.value) || 0; save(); };
  body.querySelectorAll('[data-pys]').forEach(i => i.onchange = () => {
    const s = c.staff[i.dataset.pys], k = i.dataset.k;
    if (k === 'on' || k === 'bonus' || k === 'fines') s[k] = i.checked;
    else if (k === 'role') { s.role = i.value; if (i.value === 'lead' && !s.team) s.team = []; }
    else s[k] = Number(i.value) || 0;
    save();
  });
  body.querySelectorAll('[data-pyteam]').forEach(i => i.onchange = () => { const s = c.staff[i.dataset.pyteam], t = new Set(s.team || []); if (i.checked) t.add(i.value); else t.delete(i.value); s.team = [...t]; CRMLocal.touch(); });
  $('#pyAdd', body).onclick = () => { const n = $('#pyNew', body).value.trim(); if (!n) return toast('Впишите имя'); if (c.staff[n]) return toast('Такой сотрудник уже есть'); PAY.person(n, $('#pyNewRole', body).value); save(); };
};

// a person's pay slip: the breakdown, advances and other additions / deductions of the period
PAY.dialog = (r, from, closed, redraw) => {
  if (!r) return;
  const p = PAY.per(from), lines = closed && r.lines ? r.lines : PAY.slip(r, from, p);
  const m = modal(`<h3 style="margin:0 0 4px">${esc(r.name)}</h3><p class="mut" style="margin:0 0 10px">${esc(PAY.ROLE[r.role] || r.role)} · ${esc(PLAN.label(from))}${p.voucher === r.name ? ' · 🎁 ваучер в ресторан' : ''}</p>
    <table style="width:100%">${lines.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="n" style="white-space:nowrap">${esc(b)}</td></tr>`).join('')}<tr><td><b>К выплате</b></td><td class="n"><b>${PAY.sum(r.total)}</b></td></tr></table>
    ${closed ? '' : `<h4 style="margin:14px 0 6px">Авансы</h4><div id="pyAdvL"></div>
      <div class="bar" style="flex-wrap:wrap"><input id="pyAD" type="date" value="${UI.localDate(Date.now())}"><input id="pyAS" type="number" min="0" step="1000" placeholder="сумма" style="width:120px"><select id="pyAC"><option value="сум">сум</option><option value="$">$</option></select><input id="pyAN" placeholder="комментарий" style="flex:1;min-width:120px"><button class="btn gray sm" id="pyAAdd" type="button">＋ Аванс</button></div>
      <h4 style="margin:14px 0 6px">Прочее (премия «+», удержание «−»)</h4><div id="pyExL"></div>
      <div class="bar" style="flex-wrap:wrap"><input id="pyES" type="number" step="1000" placeholder="+ или − сумма" style="width:130px"><select id="pyEC"><option value="сум">сум</option><option value="$">$</option></select><input id="pyEN" placeholder="за что" style="flex:1;min-width:120px"><button class="btn gray sm" id="pyEAdd" type="button">＋ Добавить</button></div>`}
    <div class="bar"><span class="spacer"></span><button class="btn" id="pyX" type="button">Готово</button></div>`);
  $('#pyX', m.el).onclick = () => { m.close(); redraw(); };
  if (closed) return;
  const draw = () => {
    $('#pyAdvL', m.el).innerHTML = (p.adv[r.name] || []).map((a, i) => `<div class="bar" style="margin:2px 0">${a.d ? UI.dateRu(a.d) : ''} · <b>${a.cur === '$' ? PAY.usd(a.s) : PAY.sum(a.s)}</b>${a.note ? ' · ' + esc(a.note) : ''} <button class="btn gray sm" data-dela="${i}" type="button">✕</button></div>`).join('') || '<p class="mut" style="margin:0">Авансов нет.</p>';
    $('#pyExL', m.el).innerHTML = (p.extra[r.name] || []).map((a, i) => `<div class="bar" style="margin:2px 0"><b>${a.s < 0 ? '−' : '+'}${a.cur === '$' ? PAY.usd(Math.abs(a.s)) : PAY.sum(Math.abs(a.s))}</b>${a.note ? ' · ' + esc(a.note) : ''} <button class="btn gray sm" data-dele="${i}" type="button">✕</button></div>`).join('') || '<p class="mut" style="margin:0">Нет.</p>';
    m.el.querySelectorAll('[data-dela]').forEach(b => b.onclick = () => { p.adv[r.name].splice(+b.dataset.dela, 1); CRMLocal.touch(); draw(); });
    m.el.querySelectorAll('[data-dele]').forEach(b => b.onclick = () => { p.extra[r.name].splice(+b.dataset.dele, 1); CRMLocal.touch(); draw(); });
  };
  $('#pyAAdd', m.el).onclick = () => { const s = Number($('#pyAS', m.el).value); if (!(s > 0)) return toast('Сумма аванса'); (p.adv[r.name] ||= []).push({ d: $('#pyAD', m.el).value, s, cur: $('#pyAC', m.el).value, note: $('#pyAN', m.el).value.trim().slice(0, 100) }); $('#pyAS', m.el).value = ''; $('#pyAN', m.el).value = ''; CRMLocal.touch(); draw(); };
  $('#pyEAdd', m.el).onclick = () => { const s = Number($('#pyES', m.el).value); if (!s) return toast('Сумма: плюс — премия, минус — удержание'); (p.extra[r.name] ||= []).push({ s, cur: $('#pyEC', m.el).value, note: $('#pyEN', m.el).value.trim().slice(0, 100) }); $('#pyES', m.el).value = ''; $('#pyEN', m.el).value = ''; CRMLocal.touch(); draw(); };
  draw();
};
