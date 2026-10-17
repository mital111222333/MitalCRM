// Leaderboard (Агенты → Лидерборд): sales and collected money with plan progress against the period pace,
// changes since the previous upload, an overall standing, per-agent plans for the period,
// and a picture of the leaderboard that is sent to a Telegram group in one click.
window.EXT_PAGES = window.EXT_PAGES || {};

const LB = {
  dl: 'за день', // label of the daily change; «за 16.10» in the past-period view
  moveTitle: ['Поднялся с прошлой загрузки', 'Опустился с прошлой загрузки'],
  day(v) { const n = Math.round(v || 0); return n > 0 ? `+$${UI.fmt0(n)} ${LB.dl}` : n < 0 ? `−$${UI.fmt0(-n)} ${LB.dl}` : ''; },
  MEDAL: ['🥇', '🥈', '🥉'],
  initials: n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
  // tone of a plan percent against the share of the period already gone
  tone(p, pace) { if (p === null) return 'none'; if (p >= 1) return 'good'; if (pace === null) return p >= 0.6 ? 'ok' : p >= 0.3 ? 'warn' : 'crit'; return p >= pace * 0.9 ? 'ok' : p >= pace * 0.6 ? 'warn' : 'crit'; },
  TONE_TEXT: { good: 'план выполнен', ok: 'идёт по графику', warn: 'отстаёт', crit: 'сильно отстаёт', none: 'план не задан' },
  COLORS: { good: '#1b9e4b', ok: '#2a78d6', warn: '#e29a00', crit: '#e34948', none: '#b4b9c0' },

  build(d) {
    LB.dl = d.lbPast ? 'за ' + UI.dm(d.lbPast.grace) : 'за день';
    LB.moveTitle = d.lbPast ? ['Поднялся за счёт оплат ' + UI.dm(d.lbPast.grace), 'Опустился после оплат ' + UI.dm(d.lbPast.grace)] : ['Поднялся с прошлой загрузки', 'Опустился с прошлой загрузки'];
    const pace = agPace(d), list = d.agents.filter(a => a.agent !== 'Без агента');
    const board = (key, planKey, dKey, needKey) => {
      const rows = list.map(a => ({ a, v: a[key], plan: a[planKey] || 0, p: a[planKey] > 0 ? a[key] / a[planKey] : null, dv: a[dKey], need: a[needKey] })).sort((x, y) => y.v - x.v);
      const prev = d.prev ? rows.map(r => ({ n: r.a.agent, v: r.v - (r.dv ?? 0) })).sort((x, y) => y.v - x.v).map(x => x.n) : null;
      rows.forEach((r, i) => { r.rank = i + 1; r.move = prev ? prev.indexOf(r.a.agent) - i : 0; r.tone = LB.tone(r.p, pace); });
      return rows;
    };
    const sales = board('sold', 'plan', 'd_sold', 'need_sell_day'), money = board('paid', 'pool', 'd_paid', 'need_collect_day');
    // overall: average plan completion (each side capped at 150%); without plans — by the sum of places
    const hasPlans = list.every(a => a.plan > 0 && a.pool > 0);
    const overall = list.map(a => {
      const s = sales.find(r => r.a === a), m = money.find(r => r.a === a);
      return { a, s, m, score: hasPlans ? (Math.min(s.p, 1.5) + Math.min(m.p, 1.5)) / 2 : null, places: s.rank + m.rank };
    }).sort((x, y) => (hasPlans ? y.score - x.score : x.places - y.places || y.s.v - x.s.v));
    return { pace, sales, money, overall, hasPlans, T: agTotals(d) };
  },

  bar(r, pace) {
    const w = r.p === null ? 0 : Math.min(r.p, 1) * 100;
    return `<div class="lbbar" title="${r.p === null ? 'План не задан' : Math.round(r.p * 100) + '% плана'}"><i style="width:${w}%;background:${LB.COLORS[r.tone]}"></i>${pace !== null && r.p !== null ? `<b style="left:${Math.min(pace, 1) * 100}%" title="Где нужно быть по графику: ${Math.round(pace * 100)}%"></b>` : ''}</div>`;
  },
  rows(rows, pace, col, kind) {
    return rows.map(r => `<div class="lbrow">
      <span class="lbpos">${r.rank <= 3 ? `<span class="lbmedal" aria-label="${r.rank} место">${LB.MEDAL[r.rank - 1]}</span>` : r.rank}</span>
      <span class="lbava" style="background:${col(r.a.agent)}" aria-hidden="true">${esc(LB.initials(r.a.agent))}</span>
      <div class="lbmain">
        <div class="lbtop"><span class="lbname"><a class="clink" data-agent="${esc(r.a.agent)}">${esc(r.a.agent)}</a>${r.move > 0 ? ` <span class="delta up" title="${LB.moveTitle[0]}">▲${r.move}</span>` : r.move < 0 ? ` <span class="delta down" title="${LB.moveTitle[1]}">▼${-r.move}</span>` : ''}</span><b class="lbval">$${UI.fmt0(r.v)}</b></div>
        ${LB.bar(r, pace)}
        <div class="lbsub"><span>${r.p === null ? '<span class="mut">план не задан</span>' : `<b style="color:${LB.COLORS[r.tone]}">${Math.round(r.p * 100)}%</b> из $${UI.fmt0(r.plan)} · ${LB.TONE_TEXT[r.tone]}`}</span><span>${LB.day(r.dv) || d0(r)}${r.plan > 0 ? (r.v < r.plan ? ` · <b>${kind === 'money' ? 'осталось собрать' : 'осталось продать'} $${UI.fmt0(r.plan - r.v)}</b>` : ' · план закрыт ✓') : ''}</span></div>
      </div></div>`).join('');
    function d0(r) { return r.dv === null || r.dv === undefined ? '' : `<span class="mut">${LB.dl} 0</span>`; }
  },

  // ---------- picture for Telegram ----------
  async image(d) {
    try { await document.fonts.ready; } catch { /* ignore */ }
    const L = LB.build(d), n = Math.max(L.sales.length, 1), W = 1080, ROW = 104, SEC = 100 + n * ROW;
    const H = 240 + SEC * 2 + 40;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), F = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
    const rr = (X, Y, w, h, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
    const text = (t, X, Y, size, color, weight = 400, align = 'left') => { x.font = `${weight} ${size}px ${F}`; x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(t, X, Y); };
    const fit = (t, size, weight, maxW) => { x.font = `${weight} ${size}px ${F}`; if (x.measureText(t).width <= maxW) return t; while (t.length > 3 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
    x.fillStyle = '#eef1f4'; x.fillRect(0, 0, W, H);
    // header
    const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#0e2433'); g.addColorStop(1, '#183a50'); x.fillStyle = g; x.fillRect(0, 0, W, 200);
    const fc = d.forecast, per = `${UI.dateRu(d.upload.period_from)} — ${UI.dateRu(fc.period_end || d.upload.period_to)}`, P = d.lbPast;
    if (P) {
      text('🏆 ИТОГИ ПЕРИОДА MITAL', 56, 84, 52, '#ffffff', 700);
      text(`Период плана ${per}`, 58, 132, 24, '#cde8e6');
      text(`Продажи — по ${UI.dateRu(P.end)} · деньги — по ${UI.dateRu(P.end)} + оплаты ${UI.dateRu(P.grace)}`, 58, 170, 21, '#9fd3cf');
    } else {
    text('🏆 ЛИДЕРЫ MITAL', 56, 84, 52, '#ffffff', 700);
    text(`Данные на ${UI.dateRu(d.upload.taken_at)} · период плана ${per}${fc.projectable ? ` · осталось ${fc.days_left} дн.` : ''}`, 58, 132, 24, '#cde8e6');
    }
    if (L.pace !== null && !P) text(`Прошло ${Math.round(L.pace * 100)}% периода — метка на полосе показывает, где нужно быть по графику`, 58, 170, 21, '#9fd3cf');
    const section = (Y, title, rows, color) => {
      rr(40, Y, W - 80, SEC - 16, 22); x.fillStyle = '#ffffff'; x.fill();
      text(title, 72, Y + 56, 32, '#14212b', 700);
      rows.forEach((r, i) => {
        const y = Y + 86 + i * ROW;
        if (i) { x.fillStyle = '#e2e7ec'; x.fillRect(72, y - 6, W - 144, 1); }
        // place
        const medal = ['#f4b400', '#9aa5b1', '#c77d3a'][i];
        x.beginPath(); x.arc(100, y + 36, 24, 0, Math.PI * 2); x.fillStyle = medal || '#eef1f4'; x.fill();
        text(String(r.rank), 100, y + 45, 24, medal ? '#ffffff' : '#4f5d69', 700, 'center');
        // name, value
        text(fit(r.a.agent, 28, 600, 520), 146, y + 30, 28, '#14212b', 600);
        text('$' + UI.fmt0(r.v), W - 72, y + 30, 32, '#14212b', 700, 'right');
        // bar
        const bx = 146, bw = W - 72 - 146 - 230, by = y + 46;
        rr(bx, by, bw, 14, 7); x.fillStyle = '#edf0f3'; x.fill();
        if (r.p !== null && r.p > 0) { rr(bx, by, Math.max(14, bw * Math.min(r.p, 1)), 14, 7); x.fillStyle = LB.COLORS[r.tone]; x.fill(); }
        if (L.pace !== null && r.p !== null) { x.fillStyle = '#14212b'; x.fillRect(bx + bw * Math.min(L.pace, 1) - 1.5, by - 5, 3, 24); }
        text(r.p === null ? 'план не задан' : `${Math.round(r.p * 100)}% плана`, W - 72, y + 60, 24, r.p === null ? '#7b8792' : LB.COLORS[r.tone], 600, 'right');
        const sub = [r.plan > 0 ? (r.v < r.plan ? `${color === 'money' ? 'осталось собрать' : 'осталось продать'} $${UI.fmt0(r.plan - r.v)}` : 'план закрыт ✓') : '', LB.day(r.dv), r.move > 0 ? `▲ ${r.move}` : r.move < 0 ? `▼ ${-r.move}` : ''].filter(Boolean).join('   ');
        if (sub) text(sub, 146, y + 88, 20, '#7b8792');
      });
      return Y + SEC;
    };
    let Y = 230;
    Y = section(Y, '🛒 Продажи', L.sales, 'sales');
    Y = section(Y + 10, '💰 Собранные деньги', L.money, 'money');
    return c;
  },
  async blob(d) { const c = await LB.image(d); return new Promise(res => c.toBlob(res, 'image/png')); },
  caption(d) {
    const L = LB.build(d), s = L.sales[0], m = L.money[0];
    if (d.lbPast) return `🏆 <b>Итоги периода ${UI.dm(d.upload.period_from)}–${UI.dm(d.lbPast.end)}</b> (деньги с оплатами ${UI.dm(d.lbPast.grace)})\n🛒 Продажи: <b>${esc(s?.a.agent || '—')}</b> — $${UI.fmt0(s?.v || 0)}${s?.p != null ? ` · ${Math.round(s.p * 100)}% плана` : ''}\n💰 Сбор денег: <b>${esc(m?.a.agent || '—')}</b> — $${UI.fmt0(m?.v || 0)}${m?.p != null ? ` · ${Math.round(m.p * 100)}% плана` : ''}`;
    return `🏆 <b>Лидеры на ${UI.dateRu(d.upload.taken_at)}</b>\n🛒 Продажи: <b>${esc(s?.a.agent || '—')}</b> — $${UI.fmt0(s?.v || 0)}\n💰 Сбор денег: <b>${esc(m?.a.agent || '—')}</b> — $${UI.fmt0(m?.v || 0)}${d.forecast.projectable ? `\n⏳ До конца периода ${d.forecast.days_left} дн.` : ''}`;
  },
  async sendPhoto(chat, blob, caption) {
    const conf = TG.conf(), fd = new FormData();
    fd.append('chat_id', chat); fd.append('photo', blob, 'leaders.png'); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
    let r; try { r = await fetch(`https://api.telegram.org/bot${conf.token}/sendPhoto`, { method: 'POST', body: fd }); } catch { throw new Error('Нет связи с Telegram'); }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(r.status === 403 ? 'Бот не состоит в этой группе или его удалили — добавьте бота в группу' : r.status === 400 && /chat not found/i.test(j.description) ? 'Чат не найден — добавьте бота в группу заново' : j.description || 'Ошибка Telegram');
  },
};

async function lbSendDialog(d) {
  const conf = TG.conf();
  if (!conf.token) { toast('Сначала подключите бота: Отчёты → Telegram агентам'); location.hash = '#/tg'; return; }
  const draw = async () => {
    const groups = Object.values(conf.groups || {}), people = Object.values(conf.seen || {});
    const opts = [...groups.map(g => [g.id, '👥 ' + g.name]), ...(conf.me ? [[conf.me.id, '👤 Мне (' + conf.me.name + ')']] : []), ...people.filter(p => String(p.id) !== String(conf.me?.id)).map(p => [p.id, '👤 ' + p.name])];
    const cur = conf.lbChat || groups[0]?.id || conf.me?.id || '';
    m.el.querySelector('#lbBody').innerHTML = `${opts.length ? `<label class="mut">Куда отправить<select id="lbChat" style="display:block;width:100%;margin-top:4px">${opts.map(([id, n]) => `<option value="${id}" ${String(id) === String(cur) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      ${groups.length ? '' : `<p class="mut">Чтобы отправлять в группу: добавьте бота в вашу группу агентов (в группе → «Добавить участника» → найдите бота), затем нажмите «Обновить список».</p>`}
      <div class="bar" style="margin:10px 0"><button class="btn gray sm" id="lbFind">🔄 Обновить список чатов</button></div>`;
    m.el.querySelector('#lbFind').onclick = async () => { try { await TG.discover(); await draw(); toast('Список обновлён'); } catch (e) { toast(e.message); } };
  };
  const m = modal(`<h3>Отправить лидерборд в Telegram</h3><div id="lbBody"></div><img id="lbPrev" alt="Картинка лидерборда" style="width:100%;border-radius:10px;border:1px solid var(--line);margin-top:6px">
    <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="lbX">Закрыть</button><button class="btn" id="lbGo">📤 Отправить</button></div>`);
  m.el.classList.add('wide');
  await draw();
  const blob = await LB.blob(d), url = URL.createObjectURL(blob); m.el.querySelector('#lbPrev').src = url;
  m.el.querySelector('#lbX').onclick = () => { URL.revokeObjectURL(url); m.close(); };
  m.el.querySelector('#lbGo').onclick = async () => {
    const sel = m.el.querySelector('#lbChat'); if (!sel) return toast('Нет чатов: добавьте бота в группу и обновите список');
    const btn = m.el.querySelector('#lbGo'); btn.disabled = true; btn.textContent = 'Отправляю…';
    try { await LB.sendPhoto(sel.value, blob, LB.caption(d)); conf.lbChat = sel.value; CRMLocal.touch(); toast('Лидерборд отправлен'); URL.revokeObjectURL(url); m.close(); }
    catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '📤 Отправить'; }
  };
}

function lbPlansDialog(d) {
  const per = d.upload.period_from, x = CRMLocal.ext(), all = (x.agentPlans ||= {}), P = all[per] || {};
  const byClients = {}; for (const c of d.clients) { const b = (byClients[c.agent] ||= { plan: 0, pool: 0 }); b.plan += c.plan || 0; b.pool += c.pool || 0; }
  const agents = d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  const m = modal(`<h3>Планы агентов на период ${UI.dateRu(per)} — ${UI.dateRu(d.forecast.period_end || d.upload.period_to)}</h3>
    <p class="mut" style="margin-top:0">Сумма в долларах на весь период. Если оставить пустым — берётся сумма планов по клиентам этого агента (серым).</p>
    <div class="tscroll"><table><thead><tr><th>Агент</th><th class="n">План продаж, $</th><th class="n">План сбора денег, $</th></tr></thead><tbody>${agents.map((n, i) => `<tr><td>${esc(n)}</td><td class="n"><input type="number" min="0" step="100" data-i="${i}" data-k="plan" value="${P[n]?.plan || ''}" placeholder="${UI.fmt0(byClients[n]?.plan || 0)}" style="width:130px;text-align:right"></td><td class="n"><input type="number" min="0" step="100" data-i="${i}" data-k="pool" value="${P[n]?.pool || ''}" placeholder="${UI.fmt0(byClients[n]?.pool || 0)}" style="width:130px;text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="pX">Отмена</button><button class="btn" id="pOk">Сохранить</button></div>`);
  m.el.querySelector('#pX').onclick = () => m.close();
  m.el.querySelector('#pOk').onclick = () => {
    const out = {};
    m.el.querySelectorAll('input[data-i]').forEach(inp => { const v = Number(inp.value); if (v > 0) (out[agents[+inp.dataset.i]] ||= {})[inp.dataset.k] = v; });
    all[per] = out; CRMLocal.touch(); m.close(); toast('Планы сохранены'); route();
  };
}

const lbAddDay = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const lbPeriodEnd = pf => { const y = +pf.slice(0, 4), m = +pf.slice(5, 7), dd = +pf.slice(8, 10), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), t = new Date(Date.UTC(y, m, Math.min(dd, dim))); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
let lbPastOn = false; // Лидерборд → «Прошлый период»

// The previous plan period as it is judged: sales up to its last day (15th),
// money up to its last day plus what clients paid on the first day of the new period (16th — the extra day for agents).
// Payments of the 16th come from: a balance export of the old period taken on the 16th (16.09–16.10), or the export of the new period for that one day (16.10–16.10).
function lbPastInfo(live) {
  const ups = live.uploads, curPF = live.upload.period_from;
  const prevPF = [...new Set(ups.map(u => u.period_from))].filter(p => p < curPF).sort().pop();
  if (!prevPF) return null;
  const end = lbPeriodEnd(prevPF), grace = lbAddDay(end, 1), own = ups.filter(u => u.period_from === prevPF); // newest first
  const base = own.find(u => u.taken_at <= end) || own[own.length - 1];
  const ext = own.find(u => u.taken_at === grace && u.id !== base.id) || null;
  const day1 = ups.find(u => u.period_from === grace && u.taken_at === grace) || null;
  const src = base.taken_at > end ? 'included' : ext ? 'ext' : day1 ? 'day1' : 'none';
  return { prevPF, end, grace, base, ext, day1, src };
}

async function lbPastData(info) {
  const d = await api('/api/ag/dashboard?upload=' + info.base.id);
  if (d.error || d.empty) throw new Error(d.error || 'Нет данных прошлого периода');
  const S = CRMLocal.engine.getState(), rowsOf = id => S.ag.uploads.find(u => u.id === id)?.rows || [];
  const cAg = new Map(d.clients.map(c => [c.name, c.agent])), cl = new Map(d.clients.map(c => [c.name, c])), pay = [];
  if (info.src === 'ext') { const b = new Map(rowsOf(info.base.id).map(r => [r.client, r.paid || 0])); for (const r of rowsOf(info.ext.id)) pay.push([r, (r.paid || 0) - (b.get(r.client) || 0)]); }
  else if (info.src === 'day1') for (const r of rowsOf(info.day1.id)) pay.push([r, r.paid || 0]);
  const g = {}; let total = 0;
  for (const [r, v] of pay) {
    if (Math.abs(v) < 0.005) continue;
    const ag = cAg.get(r.client) || r.agent || S.ag.clients[r.client]?.agent || 'Без агента';
    g[ag] = (g[ag] || 0) + v; total += v;
    const c = cl.get(r.client); if (c) { c.paid += v; c.d_paid = v; c.b1 += v; }
  }
  for (const n of Object.keys(g)) if (!d.agents.some(a => a.agent === n)) d.agents.push({ agent: n, okb: 0, akb: 0, plan: 0, sold: 0, ret: 0, paid: 0, pool: 0, more_sale: 0, more_pool: 0, debt: 0, debtors: 0, idle_debtors: 0 });
  for (const a of d.agents) {
    const v = g[a.agent] || 0;
    a.paid += v; a.debt = Math.max(0, a.debt - v);
    a.d_paid = info.src === 'none' || info.src === 'included' ? null : v; a.d_sold = null;
    delete a.need_sell_day; delete a.need_collect_day;
  }
  d.prev = info.src === 'ext' || info.src === 'day1' ? { taken_at: info.base.taken_at } : null; // arrows: change of place thanks to the 16th
  d.lbPast = { end: info.end, grace: info.grace, src: info.src, total };
  return d;
}

EXT_PAGES.leaders = async el => {
  const live = await agLoad(), body = agShell(el, 'leaders', live);
  if (live.empty) return agEmpty(body);
  const info = lbPastInfo(live);
  let d = live;
  if (lbPastOn && info) { try { d = await lbPastData(info); } catch (e) { toast(e.message); lbPastOn = false; } }
  if (!info) lbPastOn = false;
  const L = LB.build(d), col = agColors(d), T = L.T, fc = d.forecast, pace = L.pace, P = d.lbPast;
  const top = (rows, title) => rows[0] ? `<div class="lbhero"><span class="lbmedal">🥇</span><div><div class="mut">${title}</div><b>${esc(rows[0].a.agent)}</b><div>$${UI.fmt0(rows[0].v)}${rows[0].p !== null ? ` · ${Math.round(rows[0].p * 100)}% плана` : ''}</div></div></div>` : '';
  const perBtn = info ? `<button class="btn ${P ? '' : 'gray'}" id="lbPer" title="Итоги прошлого периода: деньги с учётом оплат ${UI.dm(info.grace)}">${P ? '↩ Текущий период' : `📅 Прошлый период ${UI.dm(info.prevPF)}–${UI.dm(info.end)}`}</button>` : '';
  const perText = P ? `<span class="mut">Итоги ${UI.dm(info.prevPF)}–${UI.dm(info.end)} · продажи по ${UI.dm(info.end)} · деньги по ${UI.dm(info.end)}${P.src === 'none' ? '' : ` + оплаты ${UI.dm(info.grace)}`}</span>`
    : `<span class="mut">${fc.projectable ? `Период ${UI.dm(d.upload.period_from)}–${UI.dm(fc.period_end)} · прошло ${Math.round(pace * 100)}%, осталось ${fc.days_left} дн.` : ''}</span>`;
  const note = !P ? '' : P.src === 'none'
    ? `<div class="lbnote warn">⚠ Оплаты за ${UI.dateRu(info.grace)} не найдены, поэтому деньги показаны только по ${UI.dateRu(info.end)}. Загрузите «Баланс клиентов» из LINKO за один день ${UI.dateRu(info.grace)} (период ${UI.dm(info.grace)}–${UI.dm(info.grace)}) — и оплаты этого дня добавятся сюда. <a href="#/aup">Перейти к загрузке</a></div>`
    : P.src === 'included'
      ? `<div class="lbnote">Загрузка прошлого периода сделана ${UI.dateRu(info.base.taken_at)} — оплаты ${UI.dm(info.grace)} уже в ней (продажи тоже).</div>`
      : `<div class="lbnote">💰 К собранным деньгам добавлены оплаты за ${UI.dateRu(info.grace)}: <b>$${UI.fmt0(P.total)}</b>${info.base.taken_at < info.end ? ` · ⚠ последняя загрузка прошлого периода — на ${UI.dateRu(info.base.taken_at)}, а не на ${UI.dateRu(info.end)}` : ''}. Стрелки ▲▼ в «Собранных деньгах» — как изменилось место за счёт этого дня.</div>`;
  body.innerHTML = `<div class="bar"><button class="btn" id="lbSend">📤 Отправить в Telegram</button><button class="btn gray" id="lbDown">⬇ Скачать картинку</button><button class="btn gray" id="lbPlans">🎯 Планы агентов</button>${perBtn}
      ${perText}</div>${note}
    <div class="lbheros">${top(L.sales, 'Лидер продаж')}${top(L.money, 'Лидер по сбору денег')}${L.overall[0] ? `<div class="lbhero"><span class="lbmedal">⭐</span><div><div class="mut">Лучший в общем зачёте</div><b>${esc(L.overall[0].a.agent)}</b><div>${L.hasPlans ? `${Math.round(L.overall[0].score * 100)}% планов в среднем` : `места: продажи ${L.overall[0].s.rank}, сбор ${L.overall[0].m.rank}`}</div></div></div>` : ''}
      <div class="lbhero team"><span class="lbmedal">👥</span><div><div class="mut">Команда</div><b>$${UI.fmt0(T.sold)}</b> продано${T.plan ? ` · ${UI.pct(T.sold, T.plan)}%` : ''}<div><b>$${UI.fmt0(T.paid)}</b> собрано${T.pool ? ` · ${UI.pct(T.paid, T.pool)}%` : ''}</div></div></div></div>
    <div class="grid">
      ${UI.panel('🛒 Продажи', LB.rows(L.sales, pace, col, 'sales'), { cls: 'w6', sub: P ? `Сколько продал агент за период ${UI.dm(info.prevPF)}–${UI.dm(info.end)}` : 'Сколько продал агент за период и сколько это от его плана' })}
      ${UI.panel('💰 Собранные деньги', LB.rows(L.money, pace, col, 'money'), { cls: 'w6', sub: P ? `Собрано по ${UI.dm(info.end)}${P.src === 'none' ? '' : ` + оплаты ${UI.dm(info.grace)}`}, от плана сбора прошлого периода` : 'Сколько денег собрал агент и сколько это от плана сбора' })}
      ${UI.panel('⭐ Общий зачёт', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Место</th><th>Агент</th><th class="n">Продажи</th><th class="n">Сбор денег</th><th class="n">АКБ / ОКБ</th><th class="n">Долг клиентов</th><th class="n">${L.hasPlans ? 'Средний % планов' : 'Сумма мест'}</th></tr></thead><tbody>${L.overall.map((o, i) => `<tr><td>${i < 3 ? LB.MEDAL[i] : i + 1}</td><td><span class="lbava sm" style="background:${col(o.a.agent)}" aria-hidden="true">${esc(LB.initials(o.a.agent))}</span><a class="clink" data-agent="${esc(o.a.agent)}">${esc(o.a.agent)}</a></td><td class="n">$${UI.fmt0(o.s.v)}<br><small>${o.s.p === null ? 'план не задан' : Math.round(o.s.p * 100) + '% · ' + o.s.rank + ' место'}</small></td><td class="n">$${UI.fmt0(o.m.v)}<br><small>${o.m.p === null ? 'план не задан' : Math.round(o.m.p * 100) + '% · ' + o.m.rank + ' место'}</small></td><td class="n">${o.a.akb} / ${o.a.okb}<br><small>${UI.pct(o.a.akb, o.a.okb) ?? 0}%</small></td><td class="n">$${UI.fmt0(o.a.debt)}</td><td class="n"><b>${L.hasPlans ? Math.round(o.score * 100) + '%' : o.places}</b></td></tr>`).join('')}</tbody></table></div>
        <p class="mut" style="margin:10px 0 0">${L.hasPlans ? 'Общий зачёт — среднее выполнения плана продаж и плана сбора (каждый учитывается максимум до 150%).' : 'Планы заданы не у всех агентов, поэтому общий зачёт — по сумме мест в продажах и сборе (меньше — лучше). Задайте планы кнопкой «🎯 Планы агентов».'} ${P ? '' : `Стрелки ▲▼ — изменение места с прошлой загрузки${d.prev ? ` (${UI.dateRu(d.prev.taken_at)})` : ''}. Чёрная метка на полосе — где агент должен быть по графику.`}</p>`, { cls: 'w12' })}
    </div>`;
  $('#lbSend', body).onclick = () => lbSendDialog(d);
  $('#lbPlans', body).onclick = () => lbPlansDialog(d);
  const per = $('#lbPer', body); if (per) per.onclick = () => { lbPastOn = !lbPastOn; route(); };
  $('#lbDown', body).onclick = async () => { const b = await LB.blob(d), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = P ? `итоги-${d.upload.period_from}.png` : `лидеры-${d.upload.taken_at}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
};
