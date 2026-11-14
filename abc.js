// ABC клиентов (Продажи → Рост продаж → ABC клиентов): which clients make the sales and which of them buy less than usual.
// Sales = «Продано» of the latest snapshot of each plan period: the current period + up to three previous ones.
// A — the clients that together give 80% of the sales, B — the next 15%, C — the rest.
// «Просел»: the forecast of the current period (sold so far ÷ the share of the period that has passed) is 40%+ below the
// client's average of the previous periods. Counted once at least 20% of the period has passed and there is a previous period.
window.EXT_PAGES = window.EXT_PAGES || {};

const ABC = {
  f: { cls: '', agent: '', down: false },
  calc(d) {
    const S = CRMLocal.engine.getState(), byP = new Map();
    for (const u of S.ag.uploads || []) { const c = byP.get(u.period_from); if (!c || u.taken_at >= c.taken_at) byP.set(u.period_from, u); }
    const cur = d.upload.period_from, prev = [...byP.values()].filter(u => u.period_from < cur).sort((a, b) => (a.period_from < b.period_from ? -1 : 1)).slice(-3);
    const maps = prev.map(u => new Map(u.rows.map(r => [r.client, r.sold || 0]))), pace = agPace(d), canProj = pace !== null && pace >= 0.2 && prev.length > 0;
    const rows = d.clients.map(c => {
      const ps = maps.map(m => m.get(c.name) || 0), psum = ps.reduce((a, b) => a + b, 0), avg = prev.length ? psum / prev.length : null, sold = c.sold || 0;
      const proj = canProj ? sold / Math.min(pace, 1) : null, trend = proj !== null && avg > 0 ? proj / avg - 1 : null;
      return { name: c.name, agent: c.agent || 'Без агента', sold, total: psum + sold, avg, proj, trend, down: trend !== null && avg >= 50 && trend <= -0.4, lost: trend !== null ? Math.max(0, avg - proj) : 0, debt: c.debt || 0, buyDays: c.buyDays ?? null };
    }).sort((a, b) => b.total - a.total);
    const T = rows.reduce((s, r) => s + r.total, 0); let acc = 0;
    for (const r of rows) { r.cls = r.total <= 0 ? 'C' : acc < T * 0.8 ? 'A' : acc < T * 0.95 ? 'B' : 'C'; acc += r.total; r.share = T > 0 ? r.total / T : 0; }
    return { rows, T, periods: prev.length + 1, canProj, pace };
  },
};

EXT_PAGES.abc = async el => {
  el.innerHTML = '<div class="page-head"><div><h2>ABC клиентов</h2><div class="sub">Загружаю…</div></div></div>';
  const d = await REP.load(); if (!el.isConnected) return;
  if (d.empty) { el.innerHTML = `<div class="page-head"><div><h2>ABC клиентов</h2></div></div>${UI.empty('Данных пока нет', 'ABC считается из выгрузок LINKO «Баланс клиентов».', '<a class="btn" href="#/up">Загрузить данные</a>')}`; return; }
  const R = ABC.calc(d), m = v => '$' + UI.fmt0(Math.round(v || 0)), F = ABC.f, pct = v => Math.round(v * 100) + '%';
  const by = k => R.rows.filter(r => r.cls === k), sumT = l => l.reduce((s, r) => s + r.total, 0), down = R.rows.filter(r => r.down && r.cls !== 'C');
  const agents = [...new Set(R.rows.map(r => r.agent))].sort();
  const list = R.rows.filter(r => (!F.cls || r.cls === F.cls) && (!F.agent || r.agent === F.agent) && (!F.down || r.down));
  const tone = { A: 'good', B: 'info', C: 'muted' };
  const tile = (k, t) => { const l = by(k); return UI.tile(`Класс ${k}`, `${l.length} ${UI.plural(l.length, 'клиент', 'клиента', 'клиентов')}`, { sub: `${R.T > 0 ? pct(sumT(l) / R.T) : '0%'} продаж · ${t}`, tone: k === 'A' ? 'good' : '' }); };
  el.innerHTML = `<div class="page-head"><div><h2>ABC клиентов</h2><div class="sub">Продажи за ${R.periods} ${UI.plural(R.periods, 'период', 'периода', 'периодов')} (текущий и предыдущие) · всего ${m(R.T)}</div></div></div>
    <div class="kpis">${tile('A', 'дают 80% продаж — держать лично')}${tile('B', 'следующие 15% — растить до A')}${tile('C', 'последние 5% — не тратить визиты')}
      ${UI.tile('Просели (A и B)', R.canProj ? `${down.length}` : '—', { sub: R.canProj ? (down.length ? `недобор за период ${m(down.reduce((s, r) => s + r.lost, 0))}` : 'ключевые клиенты покупают как обычно') : (R.periods < 2 ? 'сравнение появится со второго периода' : 'считается после 20% периода'), tone: down.length ? 'bad' : '' })}</div>
    <div class="bar"><div class="dp-seg">${[['', 'Все'], ['A', 'A'], ['B', 'B'], ['C', 'C']].map(([k, t]) => `<button type="button" data-abc="${k}" class="${F.cls === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <select id="abcAg" aria-label="Агент"><option value="">Все агенты</option>${agents.map(a => `<option ${a === F.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="abcDown" ${F.down ? 'checked' : ''}> Только просевшие</label><span class="spacer"></span><span class="mut">${list.length} ${UI.plural(list.length, 'клиент', 'клиента', 'клиентов')}</span></div>
    <div class="scroll"><table><thead><tr><th>Клиент</th><th>Класс</th><th>Агент</th><th class="n">Продажи всего</th><th class="n">Доля</th><th class="n">В среднем за период</th><th class="n">Этот период</th><th class="n">Прогноз периода</th><th class="n">К обычному</th><th class="n">Долг</th><th class="n">Без покупок, дн.</th></tr></thead><tbody>
      ${list.map(r => `<tr class="row"><td><a href="#" data-client="${esc(r.name)}" style="color:var(--text);text-decoration:none"><b>${esc(r.name)}</b></a></td><td><span class="pill ${tone[r.cls]}">${r.cls}</span></td><td>${esc(r.agent)}</td><td class="n">${m(r.total)}</td><td class="n">${(r.share * 100).toFixed(1)}%</td>
        <td class="n">${r.avg === null ? '—' : m(r.avg)}</td><td class="n">${m(r.sold)}</td><td class="n">${r.proj === null ? '—' : m(r.proj)}</td><td class="n ${r.trend === null ? '' : r.trend <= -0.4 ? 'neg' : r.trend >= 0.2 ? 'pos' : ''}">${r.trend === null ? '—' : (r.trend > 0 ? '+' : '') + Math.round(r.trend * 100) + '%'}${r.down ? ' ⚠️' : ''}</td><td class="n ${r.debt > 0.5 ? 'neg' : ''}">${r.debt > 0.5 ? m(r.debt) : '—'}</td><td class="n">${r.buyDays ?? '—'}</td></tr>`).join('')}</tbody></table></div>`;
  const re = () => EXT_PAGES.abc(el);
  el.querySelectorAll('[data-abc]').forEach(b => b.onclick = () => { F.cls = b.dataset.abc; re(); });
  $('#abcAg', el).onchange = e => { F.agent = e.target.value; re(); };
  $('#abcDown', el).onchange = e => { F.down = e.target.checked; re(); };
};
