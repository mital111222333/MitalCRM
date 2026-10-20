// Обязательный ассортимент (Продажи → Обязательный ассортимент): for every client type from LINKO («Тип» in «Баланс клиентов»)
// a list of key products that every point of that type should buy. Coverage is counted over the current plan period from the
// LINKO order lines (LX.model().lines, bonus lines excluded): a point is "closed" on a product if it bought it in the period.
// Only points that bought anything in the period are counted (a point without orders is a sleeping client, not an assortment gap).
// Stored in the synced state: ext.assort = { types: { [type]: [{ key, name }] }, target: 80 }.
window.EXT_PAGES = window.EXT_PAGES || {};

const AS = {
  NO_TYPE: 'Без типа',
  tab: 'agents', type: '', agent: '', q: '',
  cfg() { const x = CRMLocal.ext(); return (x.assort ||= { types: {}, target: 80 }); },
  key: l => (l.art ? 'a:' + String(l.art).trim() : 'n:' + LX.norm(l.product)),
  typeOf(client) { return String(CRMLocal.engine.getState().ag.clients?.[client]?.type || '').trim() || AS.NO_TYPE; },

  // everything the page needs, from the order lines of the period
  model() {
    const M = LX.model(), lines = M.lines.filter(l => l.client && !l.bonus && l.qty - l.ret > 0);
    const products = new Map(), points = new Map();
    for (const l of lines) {
      const k = AS.key(l);
      if (!products.has(k)) products.set(k, { key: k, name: l.product, brand: l.brand });
      let p = points.get(l.client);
      if (!p) { p = { name: l.client, agent: l.agent, type: AS.typeOf(l.client), keys: new Set(), sum: 0 }; points.set(l.client, p); }
      p.keys.add(k); p.sum += l.sum;
    }
    const cfg = AS.cfg(), list = [...points.values()];
    for (const p of list) {
      const need = cfg.types[p.type] || [];
      p.need = need.length; p.have = need.filter(n => p.keys.has(n.key)).length;
      p.miss = need.filter(n => !p.keys.has(n.key));
      p.pct = p.need ? p.have / p.need : null;
    }
    const types = [...new Set([...list.map(p => p.type), ...Object.keys(cfg.types)])].sort((a, b) => (a === AS.NO_TYPE) - (b === AS.NO_TYPE) || a.localeCompare(b));
    return { lines, products, points: list, types, target: (Number(cfg.target) || 80) / 100 };
  },

  // share of the type's active points that bought each product: the basis of the suggested list
  shares(m, type) {
    const pts = m.points.filter(p => p.type === type), n = pts.length, cnt = new Map();
    for (const p of pts) for (const k of p.keys) cnt.set(k, (cnt.get(k) || 0) + 1);
    return { n, rows: [...cnt.entries()].map(([k, c]) => ({ ...m.products.get(k), points: c, share: n ? c / n : 0 })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)) };
  },
  suggest(m, type) { return AS.shares(m, type).rows.filter(r => r.share >= 0.3).slice(0, 20).map(r => ({ key: r.key, name: r.name })); },

  // per agent: average coverage, points fully closed, points below the target
  byAgent(m) {
    const g = new Map();
    for (const p of m.points) {
      if (!p.need) continue;
      const a = g.get(p.agent) || { agent: p.agent, points: 0, sum: 0, full: 0, low: 0, gaps: 0 };
      a.points++; a.sum += p.pct; if (p.have === p.need) a.full++; if (p.pct < m.target) a.low++; a.gaps += p.need - p.have;
      g.set(p.agent, a);
    }
    return [...g.values()].map(a => ({ ...a, avg: a.sum / a.points })).sort((a, b) => a.avg - b.avg);
  },
  pctTxt: v => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%'),
  tone(v, target) { return v === null ? '' : v >= target ? 'pos' : v >= target - 0.2 ? '' : 'neg'; },
};

EXT_PAGES.assort = async el => {
  await CRMLocal.ready; await LX.load();
  const s = LX.st(), cfg = AS.cfg();
  const days = s?.from ? Math.max(1, Math.round((Date.parse((s.to || UI.localDate(Date.now())) + 'T00:00:00') - Date.parse(s.from + 'T00:00:00')) / 864e5) + 1) : 0;
  el.innerHTML = `<div class="page-head"><div><h2>Обязательный ассортимент</h2><div class="sub">${s?.from ? `Период плана ${UI.dateRu(s.from)} — ${UI.dateRu(s.to)} · заказы из LINKO за ${days} ${UI.plural(days, 'день', 'дня', 'дней')} · точка «закрыта» по товару, если купила его в этом периоде` : 'Нет данных о заказах из LINKO'}</div></div></div>
    <nav class="tabs no-print" aria-label="Ассортимент">${[['agents', 'Покрытие по агентам'], ['points', 'Чего не хватает точкам'], ['setup', 'Настройка списков']].map(([k, n]) => `<a href="#/assort" data-tab="${k}" class="${AS.tab === k ? 'on' : ''}">${n}</a>`).join('')}</nav><div id="asBody"></div>`;
  el.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); AS.tab = a.dataset.tab; EXT_PAGES.assort(el); });
  const body = $('#asBody', el);
  if (!LX.has() || !LX.d('items').length) { body.innerHTML = UI.empty('Нет заказов из LINKO', 'Ассортимент считается по товарам в заказах. Они приходят автозагрузкой из LINKO (<a href="#/cloud">Данные → Синхронизация и настройки</a>).'); return; }
  const m = AS.model(), f = UI.fmt0, configured = m.types.filter(t => (cfg.types[t] || []).length);
  if (!AS.type || !m.types.includes(AS.type)) AS.type = m.types[0] || '';
  const fewDays = days < 10 ? `<p class="mut">⚠ Пока только ${days} ${UI.plural(days, 'день', 'дня', 'дней')} периода: многие точки ещё просто не успели сделать заказ, поэтому покрытие сейчас ниже, чем будет к концу периода.</p>` : '';

  if (AS.tab === 'setup' || !configured.length) {
    if (AS.tab !== 'setup') AS.tab = 'setup';
    el.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === 'setup'));
    const sh = AS.shares(m, AS.type), chosen = new Map((cfg.types[AS.type] || []).map(n => [n.key, n]));
    const extra = [...chosen.values()].filter(n => !sh.rows.some(r => r.key === n.key)).map(n => ({ ...n, points: 0, share: 0 }));
    const q = LX.norm(AS.q), rows = [...sh.rows, ...extra].filter(r => !q || LX.norm(r.name + ' ' + (r.brand || '')).includes(q));
    body.innerHTML = `${configured.length ? '' : `<p>Списков ещё нет. Выберите тип точек, нажмите <b>«Предложить список»</b> — CRM отметит товары, которые берёт хотя бы 30% точек этого типа (не больше 20), — и поправьте галочками.</p>`}
      <div class="bar"><label class="mut">Тип точек <select id="asType">${m.types.map(t => `<option ${t === AS.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <span class="mut">активных точек этого типа: <b>${sh.n}</b> · в списке: <b id="asCnt">${chosen.size}</b></span><span class="spacer"></span>
      <label class="mut">Цель покрытия <input id="asTarget" type="number" min="10" max="100" step="5" value="${Number(cfg.target) || 80}" style="width:64px">%</label>
      <button class="btn gray" id="asSug">Предложить список</button><button class="btn danger" id="asClr"${chosen.size ? '' : ' disabled'}>Очистить</button></div>
      ${fewDays}
      <div class="bar"><input id="asQ" type="search" placeholder="Поиск товара или бренда" value="${esc(AS.q)}" style="min-width:240px"></div>
      ${UI.panel(`Товары, которые покупают точки типа «${esc(AS.type)}»`, rows.length ? LX.table(['', 'Товар', 'Бренд', '#Точек купили', '#Доля точек'], rows.slice(0, 400).map(r => `<tr><td><input type="checkbox" data-k="${esc(r.key)}" data-n="${esc(r.name)}" ${chosen.has(r.key) ? 'checked' : ''} aria-label="В обязательный список"></td><td>${esc(r.name)}</td><td>${esc(r.brand || '')}</td><td class="n">${f(r.points)}</td><td class="n">${AS.pctTxt(r.share)}</td></tr>`), { max: '560px' }) : '<p class="mut">Точки этого типа ещё ничего не купили в этом периоде.</p>', { sub: 'Галочка — товар обязателен для каждой точки этого типа. Сохраняется сразу.' })}`;
    const save = () => { CRMLocal.touch(); $('#asCnt', body).textContent = (cfg.types[AS.type] || []).length; $('#asClr', body).disabled = !(cfg.types[AS.type] || []).length; };
    $('#asType', body).onchange = e => { AS.type = e.target.value; EXT_PAGES.assort(el); };
    $('#asQ', body).oninput = e => { AS.q = e.target.value; clearTimeout(AS._t); AS._t = setTimeout(() => { EXT_PAGES.assort(el).then(() => { const i = $('#asQ', el); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250); };
    $('#asTarget', body).onchange = e => { const v = Math.round(Number(e.target.value)); if (!(v >= 10 && v <= 100)) return toast('Цель: от 10 до 100%'); cfg.target = v; CRMLocal.touch(); toast('Цель покрытия: ' + v + '%'); };
    $('#asSug', body).onclick = () => {
      const s2 = AS.suggest(m, AS.type);
      if (!s2.length) return toast('Нечего предложить: точки этого типа ещё мало покупали в этом периоде');
      if ((cfg.types[AS.type] || []).length && !confirm(`Заменить текущий список (${cfg.types[AS.type].length} тов.) предложенным (${s2.length} тов.)?`)) return;
      cfg.types[AS.type] = s2; CRMLocal.touch(); toast(`Предложено ${s2.length} тов. — проверьте галочки`); EXT_PAGES.assort(el);
    };
    $('#asClr', body).onclick = () => { if (!confirm(`Очистить список для «${AS.type}»?`)) return; delete cfg.types[AS.type]; CRMLocal.touch(); EXT_PAGES.assort(el); };
    body.querySelectorAll('input[data-k]').forEach(c => c.onchange = () => {
      const list = (cfg.types[AS.type] ||= []);
      if (c.checked) { if (!list.some(n => n.key === c.dataset.k)) list.push({ key: c.dataset.k, name: c.dataset.n }); }
      else cfg.types[AS.type] = list.filter(n => n.key !== c.dataset.k);
      if (!cfg.types[AS.type].length) delete cfg.types[AS.type];
      save();
    });
    return;
  }

  const agents = LX.agentsOf(m.points), pts = m.points.filter(p => p.need && (!AS.agent || p.agent === AS.agent));
  const agentBar = `<div class="bar"><select id="asAg" aria-label="Агент"><option value="">Все агенты</option>${agents.map(n => `<option ${n === AS.agent ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <span class="mut">типов со списком: ${configured.length} из ${m.types.length}${m.types.length > configured.length ? ` · без списка: ${m.types.filter(t => !configured.includes(t)).map(esc).join(', ')} — эти точки не считаются` : ''}</span></div>`;
  const bindAgent = () => { const s2 = $('#asAg', body); if (s2) s2.onchange = e => { AS.agent = e.target.value; EXT_PAGES.assort(el); }; };

  if (AS.tab === 'agents') {
    const A = AS.byAgent(m).filter(a => !AS.agent || a.agent === AS.agent);
    const all = pts.length, avg = all ? pts.reduce((a, p) => a + p.pct, 0) / all : null, full = pts.filter(p => p.have === p.need).length;
    // which key products are missing most often: the products to push this week
    const gap = new Map(); for (const p of pts) for (const n of p.miss) { const g = gap.get(n.key) || gap.set(n.key, { name: n.name, n: 0, types: new Set() }).get(n.key); g.n++; g.types.add(p.type); }
    const gaps = [...gap.values()].sort((a, b) => b.n - a.n);
    body.innerHTML = `${agentBar}${fewDays}
      <div class="kpis">${UI.tile('Среднее покрытие', AS.pctTxt(avg), { sub: `цель ${Math.round(m.target * 100)}%`, tone: avg === null ? '' : avg >= m.target ? 'good' : 'bad' })}
      ${UI.tile('Точек с полным набором', `${f(full)} из ${f(all)}`, { sub: all ? AS.pctTxt(full / all) + ' точек' : '' })}
      ${UI.tile('Ниже цели', f(pts.filter(p => p.pct < m.target).length), { sub: 'точек' })}
      ${UI.tile('Не хватает позиций', f(pts.reduce((a, p) => a + p.need - p.have, 0)), { sub: 'всего по точкам' })}</div>
      <div class="grid">
      ${UI.panel('Агенты: у кого точки закрыты хуже', A.length ? LX.table(['Агент', '#Точек', '#Среднее покрытие', '#Полный набор', '#Ниже цели', '#Не хватает позиций'], A.map(a => `<tr><td>${LX.ag(a.agent)}</td><td class="n">${f(a.points)}</td><td class="n ${AS.tone(a.avg, m.target)}"><b>${AS.pctTxt(a.avg)}</b></td><td class="n">${f(a.full)} (${AS.pctTxt(a.full / a.points)})</td><td class="n">${f(a.low)}</td><td class="n">${f(a.gaps)}</td></tr>`)) : '<p class="mut">Нет точек с заказами в этом периоде.</p>', { cls: 'w7', sub: 'Сверху — агенты с самым низким средним покрытием' })}
      ${UI.panel('Чего не хватает чаще всего', gaps.length ? LX.table(['Товар', '#Точек без него'], gaps.slice(0, 15).map(g => `<tr><td>${esc(g.name)}</td><td class="n">${f(g.n)}</td></tr>`), { max: '420px' }) : '<p class="mut">Все точки закрыты полностью 🎉</p>', { cls: 'w5', sub: 'Эти товары — задача на неделю' })}
      </div>`;
    bindAgent(); return;
  }

  // points: what each point still has to take, worst first — the agent's to-do list
  const P = pts.filter(p => p.have < p.need).sort((a, b) => a.pct - b.pct || b.sum - a.sum);
  body.innerHTML = `${agentBar}${fewDays}
    ${UI.panel(`Точки с неполным набором (${f(P.length)} из ${f(pts.length)})`, P.length ? LX.table(['Клиент', 'Агент', 'Тип', '#Покрытие', 'Не берёт — предложить', '#Купил за период'], P.slice(0, 500).map(p => `<tr><td>${LX.cl(p.name)}</td><td>${LX.ag(p.agent)}</td><td>${esc(p.type)}</td><td class="n ${AS.tone(p.pct, m.target)}">${p.have}/${p.need} · ${AS.pctTxt(p.pct)}</td><td>${p.miss.map(n => esc(n.name)).join(', ')}</td><td class="n">${LX.money(p.sum, LX.model().cur)}</td></tr>`), { max: '640px' }) : '<p class="mut">У всех точек полный набор 🎉</p>', { sub: 'Сверху — точки с самым низким покрытием. Список можно выгрузить в Excel или отправить агенту.' })}`;
  bindAgent();
};
