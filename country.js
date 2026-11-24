// «Обзор страны» (#/country) and «Журнал действий» (#/audit): pages for the admin and РОП.
// Every supervisor's CRM lives in his own browser and database folder; the РОП cannot open them. What he CAN read (database rules):
// every agent's cabinet (agent_cabinets: plan / fact, collection, debt, discipline — the same numbers the agent sees), every account,
// region and CRM folder (workspaces: when it was saved last). From these this page builds the country: regions → supervisors → agents,
// what needs attention, and the hiring rule. It does not depend on the CRM data of this browser, so it opens on any device.
(() => {
  const H = 3600e3, STALE_H = 24;
  // the hiring rule of a city: 2 agents to start, +1 when the collection of the month reaches each step
  const HIRE = { base: 2, steps: [45000, 65000, 85000] };
  const money = v => '$' + UI.fmt0(Math.round(Number(v) || 0));
  const pctTxt = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '—');
  const ago = t => {
    if (!t) return 'никогда';
    const h = (Date.now() - Date.parse(t)) / H;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' мин назад';
    if (h < 24) return Math.round(h) + ' ч назад';
    return Math.round(h / 24) + ' дн. назад';
  };
  const bar = (v, pace) => {
    if (v == null) return '<span class="mut">—</span>';
    const tone = pace == null ? '' : v >= pace ? 'pos' : v >= pace - 15 ? '' : 'neg';
    return `<b class="${tone}">${v}%</b>`;
  };
  // the share of the period already gone: a plan done «on pace» = this share
  const paceOf = per => {
    if (!per?.from || !per?.to) return null;
    const a = Date.parse(per.from), b = Date.parse(per.to) + 864e5, n = Date.now();
    if (!(b > a)) return null;
    return Math.max(0, Math.min(100, Math.round((n - a) / (b - a) * 100)));
  };

  async function load() {
    const sb = AUTH.sb;
    const [p, r, l, w, c] = await Promise.all([
      sb.from('profiles').select('id, full_name, role, supervisor_id, region_id, linko_name, is_active'),
      sb.from('regions').select('id, name, status').order('name'),
      sb.from('supervisor_regions').select('supervisor_id, region_id'),
      sb.from('workspaces').select('owner_id, saved_at, device'),
      // only the small parts of each cabinet: the client lists stay in the database
      sb.from('agent_cabinets').select('agent_id, updated_at, updated_by, kpi:data->kpi, period:data->period, data_at:data->>data_at, name:data->>agent, role:data->>role, fine:data->disc->fine, late:data->disc->late, absent:data->disc->absent'),
    ]);
    const err = p.error || r.error || l.error || w.error || c.error;
    if (err) throw err;
    return { people: p.data, regions: r.data, links: l.data, ws: w.data, cabs: c.data };
  }

  function model(D) {
    const byId = Object.fromEntries(D.people.map(x => [x.id, x])), regName = Object.fromEntries(D.regions.map(x => [x.id, x.name]));
    const wsOf = Object.fromEntries(D.ws.map(x => [x.owner_id, x])), cabOf = Object.fromEntries(D.cabs.map(x => [x.agent_id, x]));
    const leads = D.people.filter(x => ['supervisor', 'admin', 'rop'].includes(x.role));
    const regsOf = id => D.links.filter(x => x.supervisor_id === id).map(x => x.region_id);
    let pace = null;
    const agents = D.people.filter(x => x.role === 'agent' && x.is_active).map(a => {
      const cb = cabOf[a.id], k = cb?.kpi || {}, sv = byId[a.supervisor_id];
      if (pace == null && cb?.period) pace = paceOf(cb.period);
      const age = cb ? (Date.now() - Date.parse(cb.updated_at)) / H : null;
      return {
        id: a.id, name: a.full_name, linko: a.linko_name, region: a.region_id, regionName: regName[a.region_id] || '—', sv, cab: cb, age,
        stale: cb ? age > STALE_H : false, sold: +k.sold || 0, plan: +k.plan || 0, paid: +k.paid || 0, pool: +k.pool || 0, debt: +k.debt || 0, debtors: +k.debtors || 0,
        akb: k.akb ?? null, fine: +cb?.fine || 0, late: +cb?.late || 0, absent: +cb?.absent || 0,
        sp: k.plan > 0 ? Math.round(k.sold / k.plan * 100) : null, cp: k.pool > 0 ? Math.round(k.paid / k.pool * 100) : null,
      };
    });
    const sum = list => list.reduce((t, a) => ({ sold: t.sold + a.sold, plan: t.plan + a.plan, paid: t.paid + a.paid, pool: t.pool + a.pool, debt: t.debt + a.debt, debtors: t.debtors + a.debtors }),
      { sold: 0, plan: 0, paid: 0, pool: 0, debt: 0, debtors: 0 });
    const regions = D.regions.map(g => {
      const list = agents.filter(a => a.region === g.id), T = sum(list);
      const svs = leads.filter(s => s.is_active && regsOf(s.id).includes(g.id));
      const want = HIRE.base + HIRE.steps.filter(x => T.paid >= x).length, next = HIRE.steps.find(x => T.paid < x) ?? null;
      return { ...g, list, T, svs, want, next, stale: list.filter(a => a.stale || !a.cab).length };
    });
    const sups = leads.filter(s => s.is_active && (s.role === 'supervisor' || agents.some(a => a.sv?.id === s.id))).map(s => {
      const list = agents.filter(a => a.sv?.id === s.id);
      return { ...s, list, T: sum(list), regs: regsOf(s.id).map(id => regName[id]).filter(Boolean), ws: wsOf[s.id] || null, stale: list.filter(a => a.stale || !a.cab).length };
    });
    // what needs attention, the most important first
    const sig = [];
    for (const s of sups) {
      const n = s.list.filter(a => a.stale).length;
      if (n) sig.push(['crit', `${s.full_name}: у ${n} ${UI.plural(n, 'агента', 'агентов', 'агентов')} кабинет не обновлялся больше суток — ${s.ws ? `CRM открывали ${ago(s.ws.saved_at)}` : 'своей CRM в базе нет'}. Агенты видят старые долги и план.`]);
      if (s.role === 'supervisor' && !s.regs.length) sig.push(['warn', `${s.full_name}: не указаны регионы, которые он ведёт (Пользователи → Изменить).`]);
    }
    for (const x of D.people.filter(p => p.is_active && ['agent', 'store'].includes(p.role) && p.supervisor_id && byId[p.supervisor_id] && !byId[p.supervisor_id].is_active)) {
      sig.push(['crit', `${x.full_name} закреплён за заблокированным руководителем ${byId[x.supervisor_id].full_name} — передайте его другому.`]);
    }
    for (const a of agents) {
      if (!a.linko) sig.push(['warn', `${a.name}: нет «Имени в LINKO» — кабинет не может появиться.`]);
      else if (!a.cab) sig.push(['warn', `${a.name}: кабинет ещё ни разу не отправлялся (руководитель — ${a.sv?.full_name || 'не указан'}).`]);
      else if (pace != null && a.sp != null && a.sp < pace - 20) sig.push(['warn', `${a.name} (${a.regionName}): план продаж ${a.sp}% при темпе ${pace}% — отстаёт.`]);
      if (a.cp != null && pace != null && a.cp < pace - 25 && a.debt > 0) sig.push(['warn', `${a.name}: сбор ${a.cp}% при темпе ${pace}%, долг клиентов ${money(a.debt)}.`]);
    }
    for (const g of regions) {
      if (g.status === 'active' && g.list.length && !g.svs.length) sig.push(['warn', `${g.name}: у региона нет супервайзера.`]);
      if (g.list.length && g.want > g.list.length) sig.push(['good', `${g.name}: сбор ${money(g.T.paid)} — по правилу найма пора взять ${g.want - g.list.length} ${UI.plural(g.want - g.list.length, 'агента', 'агентов', 'агентов')} (сейчас ${g.list.length}).`]);
    }
    return { agents, regions, sups, T: sum(agents), pace, sig, period: agents.find(a => a.cab?.period)?.cab.period || null };
  }

  EXT_PAGES.country = async el => {
    if (!AUTH.sb) { el.innerHTML = UI.empty('Нет связи', 'Раздел работает только с интернетом.'); return; }
    if (!AUTH.isManager()) { el.innerHTML = UI.empty('Нет доступа', 'Обзор страны видят администратор и РОП.'); return; }
    el.innerHTML = '<div class="soon">Загрузка…</div>';
    const at = location.hash;
    let D; try { D = await load(); } catch (e) { el.innerHTML = UI.empty('Не удалось загрузить', esc(e.message || String(e))); return; }
    if (!el.isConnected || location.hash !== at) return;
    const M = model(D), T = M.T, sel = (() => { try { return localStorage.getItem('crm_country_reg') || ''; } catch { return ''; } })();
    const regs = M.regions.filter(g => g.list.length || g.svs.length);
    const show = sel ? M.agents.filter(a => a.region === sel) : M.agents;
    const per = M.period ? `${UI.dm(M.period.from)} — ${UI.dm(M.period.to)}${M.period.days_left != null ? ` · осталось ${M.period.days_left} дн.` : ''}` : 'период ещё неизвестен';
    const staleN = M.agents.filter(a => a.stale || !a.cab).length;
    el.innerHTML = `<div class="page-head"><div><h2>Обзор страны</h2><div class="sub">${esc(per)}${M.pace != null ? ` · темп ${M.pace}%` : ''} · ${M.agents.length} ${UI.plural(M.agents.length, 'агент', 'агента', 'агентов')} в ${regs.length} ${UI.plural(regs.length, 'регионе', 'регионах', 'регионах')} · цифры из кабинетов агентов</div></div>
      <div class="tools"><button class="btn gray" id="coXl">⬇ Excel</button><button class="btn gray" id="coRe">↻ Обновить</button></div></div>
    <div class="kpis">
      ${UI.tile('Продажи', money(T.sold), { sub: T.plan ? `план ${money(T.plan)} · ${pctTxt(T.sold, T.plan)}` : 'план не задан', tone: T.plan && M.pace != null ? (T.sold / T.plan * 100 >= M.pace ? 'good' : 'warn') : '' })}
      ${UI.tile('Сбор', money(T.paid), { sub: T.pool ? `пул ${money(T.pool)} · ${pctTxt(T.paid, T.pool)}` : 'пул не задан' })}
      ${UI.tile('Дебиторка', money(T.debt), { sub: `должников: ${T.debtors}`, tone: 'warn' })}
      ${UI.tile('Кабинеты', `${M.agents.length - staleN} из ${M.agents.length}`, { sub: staleN ? `${staleN} устарели или не отправлены` : 'все свежие', tone: staleN ? 'warn' : 'good' })}
    </div>
    <div class="grid">
    ${UI.panel('Требует внимания', M.sig.length ? `<ul class="co-sig">${M.sig.slice(0, 40).map(([k, t]) => `<li>${UI.pill(k, k === 'crit' ? 'срочно' : k === 'good' ? 'рост' : 'внимание')} ${esc(t)}</li>`).join('')}</ul>${M.sig.length > 40 ? `<p class="mut">…и ещё ${M.sig.length - 40}</p>` : ''}` : '<p class="mut" style="margin:0">Всё в порядке: кабинеты свежие, люди закреплены.</p>', { sub: M.sig.length ? `${M.sig.length}` : '' })}
    ${UI.panel('Регионы', LX.table(['Регион', 'Супервайзер', '#Агентов', '#Продажи', '#План', '#Сбор', '#Дебиторка', 'Правило найма'], regs.map(g => `<tr><td><b>${esc(g.name)}</b>${g.status === 'opening' ? ' <span class="mut">(открывается)</span>' : ''}</td>
        <td>${esc(g.svs.map(s => s.full_name).join(', ') || '—')}</td><td class="n">${g.list.length}</td><td class="n">${money(g.T.sold)}</td><td class="n">${bar(g.T.plan ? Math.round(g.T.sold / g.T.plan * 100) : null, M.pace)}</td>
        <td class="n">${money(g.T.paid)}</td><td class="n">${money(g.T.debt)}</td>
        <td>${g.want > g.list.length ? UI.pill('good', `нанять +${g.want - g.list.length}`) : g.next ? `<span class="mut">следующий агент при сборе ${money(g.next)}</span>` : '<span class="mut">все ступени пройдены</span>'}</td></tr>`)),
      { sub: `Правило найма: ${HIRE.base} агента в городе, +1 при сборе ${HIRE.steps.map(money).join(', ')} за месяц` })}
    ${UI.panel('Супервайзеры', LX.table(['Супервайзер', 'Регионы', '#Агентов', '#Продажи', '#План', '#Сбор', '#Дебиторка', 'CRM сохранена', 'Кабинеты'], M.sups.map(s => `<tr><td><b>${esc(s.full_name)}</b> <span class="mut">${esc(AUTH.ROLE_RU[s.role] || '')}</span></td>
        <td>${esc(s.regs.join(', ') || '—')}</td><td class="n">${s.list.length}</td><td class="n">${money(s.T.sold)}</td><td class="n">${bar(s.T.plan ? Math.round(s.T.sold / s.T.plan * 100) : null, M.pace)}</td>
        <td class="n">${money(s.T.paid)}</td><td class="n">${money(s.T.debt)}</td><td>${s.ws ? esc(ago(s.ws.saved_at)) : '<span class="mut">нет</span>'}</td>
        <td>${s.list.length ? (s.stale ? UI.pill('warn', `${s.stale} устарели`) : UI.pill('good', 'свежие')) : '—'}</td></tr>`)))}
    ${UI.panel('Агенты', `<div class="bar" style="margin-top:0"><label>Регион <select id="coReg"><option value="">Все регионы</option>${regs.map(g => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label></div>
      ${LX.table(['#', 'Агент', 'Регион', 'Супервайзер', '#Продажи', '#План', '#Сбор', '#Сбор % пула', '#Дебиторка', '#Должников', '#АКБ', 'Дисциплина', 'Кабинет'],
        [...show].sort((a, b) => (b.sp ?? -1) - (a.sp ?? -1) || b.sold - a.sold).map((a, i) => `<tr><td class="n">${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.regionName)}</td><td>${esc(a.sv?.full_name || '—')}</td>
        <td class="n">${money(a.sold)}</td><td class="n">${bar(a.sp, M.pace)}</td><td class="n">${money(a.paid)}</td><td class="n">${bar(a.cp, M.pace)}</td><td class="n">${money(a.debt)}</td><td class="n">${a.debtors}</td><td class="n">${a.akb ?? '—'}</td>
        <td>${a.cab ? `${a.late ? `опозд. ${a.late}` : ''}${a.absent ? ` · пропуск ${a.absent}` : ''}${a.fine ? ` · штраф ${UI.fmt0(a.fine)}` : ''}` || '<span class="mut">без замечаний</span>' : '—'}</td>
        <td>${!a.cab ? UI.pill('muted', 'нет') : a.stale ? UI.pill('warn', ago(a.cab.updated_at)) : `<span class="mut">${esc(ago(a.cab.updated_at))}</span>`}</td></tr>`))}`,
      { sub: M.pace != null ? `Зелёный — не ниже темпа ${M.pace}%, красный — отстаёт больше чем на 15 пунктов` : '' })}
    </div>`;
    $('#coRe', el).onclick = () => EXT_PAGES.country(el);
    $('#coReg', el).onchange = e => { try { localStorage.setItem('crm_country_reg', e.target.value); } catch { /* storage blocked */ } EXT_PAGES.country(el); };
    $('#coXl', el).onclick = () => UI.csv(`Обзор страны ${UI.localDate(Date.now())}.xlsx`, [['Агент', 'Регион', 'Супервайзер', 'Продажи', 'План', 'План %', 'Сбор', 'Пул', 'Сбор %', 'Дебиторка', 'Должников', 'Опоздания', 'Пропуски', 'Штраф', 'Кабинет обновлён'],
      ...M.agents.map(a => [a.name, a.regionName, a.sv?.full_name || '', a.sold, a.plan, a.sp ?? '', a.paid, a.pool, a.cp ?? '', a.debt, a.debtors, a.late, a.absent, a.fine, a.cab ? new Date(a.cab.updated_at).toLocaleString('ru-RU') : ''])]);
  };

  // ---------- Журнал действий: who changed what (accounts, regions, CRM saves) ----------
  const TABLE = { accounts: 'Аккаунт', profiles: 'Пользователь', regions: 'Регион', supervisor_regions: 'Регионы руководителя', workspaces: 'CRM' };
  const ACT = { create: 'создан', update: 'изменён', set_password: 'новый пароль', set_active: 'блокировка', INSERT: 'добавлено', UPDATE: 'изменено', DELETE: 'удалено' };
  const FIELD = { full_name: 'имя', role: 'роль', supervisor_id: 'руководитель', region_id: 'регион', linko_name: 'имя в LINKO', phone: 'телефон', is_active: 'активен', name: 'название', status: 'статус' };
  EXT_PAGES.audit = async el => {
    if (!AUTH.sb) { el.innerHTML = UI.empty('Нет связи', 'Раздел работает только с интернетом.'); return; }
    if (!AUTH.isManager()) { el.innerHTML = UI.empty('Нет доступа', 'Журнал видят администратор и РОП.'); return; }
    el.innerHTML = '<div class="soon">Загрузка…</div>';
    const at = location.hash, sb = AUTH.sb;
    const [lg, pp, rg] = await Promise.all([sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300), sb.from('profiles').select('id, full_name, role'), sb.from('regions').select('id, name')]);
    if (!el.isConnected || location.hash !== at) return;
    if (lg.error) { el.innerHTML = UI.empty('Не удалось загрузить', esc(lg.error.message)); return; }
    const who = Object.fromEntries((pp.data || []).map(x => [x.id, x.full_name])), reg = Object.fromEntries((rg.data || []).map(x => [x.id, x.name]));
    const val = (k, v) => (v == null || v === '' ? '—' : k === 'role' ? AUTH.ROLE_RU[v] || v : k === 'supervisor_id' ? who[v] || '?' : k === 'region_id' ? reg[v] || '?' : k === 'is_active' ? (v ? 'да' : 'нет') : String(v));
    const what = x => {
      const o = x.old_data || {}, n = x.new_data || {};
      if (x.table_name === 'accounts') {
        const t = who[x.row_id] || n.full_name || n.login || '';
        if (x.action === 'set_active') return `${t}: ${n.active ? 'разблокирован' : 'заблокирован'}`;
        if (x.action === 'create') return `${t} · ${AUTH.ROLE_RU[n.role] || n.role || ''}`;
        return t;
      }
      if (x.table_name === 'workspaces') return `CRM: ${who[n.owner_id || o.owner_id] || ''}`;
      if (x.table_name === 'supervisor_regions') return `${who[n.supervisor_id || o.supervisor_id] || ''}: ${reg[n.region_id || o.region_id] || ''}`;
      const name = n.full_name || o.full_name || n.name || o.name || '';
      if (x.action !== 'UPDATE') return name;
      const ch = Object.keys(FIELD).filter(k => k in n && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map(k => `${FIELD[k]}: ${val(k, o[k])} → ${val(k, n[k])}`);
      return `${name}${ch.length ? ' — ' + ch.join('; ') : ''}`;
    };
    const rows = lg.data;
    el.innerHTML = `<div class="page-head"><div><h2>Журнал действий</h2><div class="sub">Последние ${rows.length} изменений: аккаунты, роли, регионы, новые CRM. Записи делает база — их нельзя изменить или удалить.</div></div>
      <div class="tools"><input id="auQ" placeholder="Поиск: имя, действие" style="min-width:200px"><button class="btn gray" id="auXl">⬇ Excel</button></div></div>
    <div class="grid">${UI.panel('Изменения', LX.table(['Когда', 'Кто', 'Что', 'Действие', 'Подробно'], rows.map(x => `<tr data-q="${esc((who[x.user_id] || '') + ' ' + what(x) + ' ' + (TABLE[x.table_name] || x.table_name) + ' ' + (ACT[x.action] || x.action)).toLowerCase()}">
      <td>${new Date(x.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(who[x.user_id] || (x.user_id ? '?' : 'система'))}</td>
      <td>${esc(TABLE[x.table_name] || x.table_name)}</td><td>${esc(ACT[x.action] || x.action)}</td><td>${esc(what(x))}</td></tr>`)))}</div>`;
    $('#auQ', el).oninput = e => { const q = e.target.value.trim().toLowerCase(); el.querySelectorAll('tr[data-q]').forEach(tr => { tr.hidden = !!q && !tr.dataset.q.includes(q); }); };
    $('#auXl', el).onclick = () => UI.csv(`Журнал ${UI.localDate(Date.now())}.xlsx`, [['Когда', 'Кто', 'Что', 'Действие', 'Подробно'], ...rows.map(x => [new Date(x.at).toLocaleString('ru-RU'), who[x.user_id] || '', TABLE[x.table_name] || x.table_name, ACT[x.action] || x.action, what(x)])]);
  };

  const css = document.createElement('style');
  css.textContent = '.co-sig{list-style:none;margin:0;padding:0;display:grid;gap:6px}.co-sig li{display:flex;gap:8px;align-items:flex-start;line-height:1.4}.co-sig .pill{flex:none}';
  document.head.appendChild(css);
})();
