// Agents section (replaces the Google-Sheets workflow): summary, leaderboard, clients, tasks, uploads.
// Data comes from /api/ag/dashboard: every upload of the LINKO "Баланс клиентов" export is a dated snapshot.
window.EXT_PAGES = window.EXT_PAGES || {};

const AG_TABS = [['agents', 'Сводка'], ['leaders', 'Лидерборд'], ['aclients', 'Клиенты и долги'], ['atasks', 'Задания'], ['aup', 'Загрузки']];
const AKB_RULES = { paid: 'платят (оплатили за период)', sold: 'покупали (были продажи)', any: 'платят или покупали' };
const AKB_SHORT = { paid: 'платят', sold: 'покупали', any: 'платят или покупали' };
const TASK_STATUS = { done: ['good', '✓', 'Выполнено'], work: ['info', '◔', 'В работе'], overdue: ['crit', '✕', 'Просрочено'] };
let agSel = null; // selected upload id (null = the latest)
const agEnc = encodeURIComponent;

const agTotals = d => d.agents.reduce((t, a) => { for (const k of ['okb', 'akb', 'plan', 'sold', 'ret', 'paid', 'pool', 'debt', 'debtors', 'idle_debtors', 'proj_sold', 'proj_paid']) t[k] = (t[k] || 0) + (a[k] || 0); for (const k of ['d_sold', 'd_paid', 'd_debt']) if (a[k] !== null) t[k] = (t[k] || 0) + a[k]; return t; }, {});
// stable color per agent (follows the entity, not its rank)
const agColors = d => { const names = [...new Set([...d.agents.map(a => a.agent), ...d.trend.flatMap(t => Object.keys(t.agents))])].sort((a, b) => a.localeCompare(b)); return n => CH.colors[Math.max(names.indexOf(n), 0) % 8]; };
const agShort = n => (n.length > 22 ? n.slice(0, 21) + '…' : n);
const agPace = d => (d.forecast.projectable ? d.forecast.elapsed / d.forecast.month_days : null);

function agFileDate(f) { const m = f.name.match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : UI.localDate(f.lastModified); }

function agUploadDialog(onDone, files = []) {
  return UI.uploadDialog({
    title: 'Загрузка выгрузки клиентов',
    intro: 'Выгрузка «Баланс клиентов» из LINKO (.xlsx или .csv) — или ваша Google-таблица «Аналитика Митал» целиком: тогда подтянутся клиенты, агенты, План, Пул, Заметки и Задания. «Период» — за какие даты построена выгрузка в LINKO.',
    fields: [{ key: 'date', label: 'Выгрузка на дату', type: 'date', value: agFileDate }, { key: 'from', label: 'Период с', type: 'date', value: f => PLAN.from(agFileDate(f)) }, { key: 'to', label: 'по', type: 'date', value: agFileDate }],
    batch: [{ key: 'mode', label: 'План, Пул и Заметки', options: [['', 'Автоматически (рекомендуется)'], ['overwrite', 'Взять из файла (перезаписать)'], ['keep', 'Не менять']] }],
    url: (f, v) => `/api/ag/upload?file=${agEnc(f.name)}&date=${v.date}&from=${v.from}&to=${v.to}${v.mode ? '&mode=' + v.mode : ''}`,
    summarize: d => `${d.clients} клиентов${d.created ? ` · новых ${d.created}` : ''}${d.agent_changes ? ` · сменился агент у ${d.agent_changes}` : ''}${d.plan_updates ? ` · План/Пул обновлены у ${d.plan_updates}` : ''}${d.tasks_imported ? ` · заданий ${d.tasks_imported}` : ''}${d.replaced ? ' · заменена загрузка за этот период' : ''}`,
    onDone, files,
  });
}

async function agLoad() { return api('/api/ag/dashboard' + (agSel ? '?upload=' + agSel : '')); }

function agShell(el, tab, d) {
  const up = d.upload;
  el.innerHTML = `<div class="page-head"><div><h2>Агенты и клиенты</h2><div class="sub">${d.empty ? 'Нет загруженных данных' : `Данные на <b>${UI.dateRu(up.taken_at)}</b> · период ${UI.dateRu(up.period_from)} — ${UI.dateRu(up.period_to)} · ${esc(up.file || 'файл')}${d.prev ? ` · сравнение с ${UI.dateRu(d.prev.taken_at)}` : ''}`}</div></div>
    <div class="actions">${!d.empty && d.uploads.length > 1 ? `<label class="mut">Данные на <select id="agSel">${d.uploads.map(u => `<option value="${u.id}" ${u.id === up.id ? 'selected' : ''}>${UI.dateRu(u.taken_at)} · ${UI.dm(u.period_from)}–${UI.dm(u.period_to)}</option>`).join('')}</select></label>` : ''}<button class="btn needs-edit" id="agUpBtn">⬆ Загрузить выгрузку</button></div></div>
    <nav class="tabs" aria-label="Разделы агентов">${AG_TABS.map(([r, t]) => `<a href="#/${r}" class="${r === tab ? 'on' : ''}">${t}</a>`).join('')}</nav><div id="agBody"></div>`;
  $('#agUpBtn', el).onclick = () => agUploadDialog(() => route());
  const sel = $('#agSel', el); if (sel) sel.onchange = () => { agSel = +sel.value === d.uploads[0].id ? null : +sel.value; route(); };
  return $('#agBody', el);
}

function agEmpty(body) {
  body.innerHTML = UI.empty('Данных по агентам пока нет', 'Загрузите выгрузку «Баланс клиентов» из LINKO или вашу Google-таблицу «Аналитика Митал». Приложение возьмёт клиентов, агентов, План, Пул, Заметки и Задания и сразу покажет сводку, лидерборд и долги — вписывать вручную ничего не нужно.', '<div class="dz needs-edit" id="agEmptyDz" tabindex="0" role="button"><b>Перетащите файл сюда</b>или нажмите, чтобы выбрать</div>');
  const dz = $('#agEmptyDz', body); if (dz) UI.bindDrop(dz, files => agUploadDialog(() => route(), files));
}

async function agSetRule(rule) { const r = await api('/api/ag/settings', { method: 'POST', body: { akb: rule } }); if (r.error) toast(r.error); else route(); }

function agInsights(d) {
  const A = d.agents, T = agTotals(d), out = [], pace = agPace(d), f0 = UI.fmt0;
  const top = A[0]; if (top && top.sold > 0) out.push(['good', '🏆', `Лидер продаж — <b>${esc(top.agent)}</b>: ${f0(top.sold)}${top.plan ? ` (${UI.pct(top.sold, top.plan)}% плана)` : ''}.`]);
  const lag = A.filter(a => a.plan > 0).map(a => ({ a, p: a.sold / a.plan })).filter(x => pace === null ? x.p < 0.5 : x.p < pace * 0.6).sort((x, y) => x.p - y.p)[0];
  if (lag) out.push(['warn', '⚠', `<b>${esc(lag.a.agent)}</b> отстаёт по продажам: ${Math.round(lag.p * 100)}% плана${pace !== null ? ` при ${Math.round(pace * 100)}% прошедшего месяца` : ''}.`]);
  const nopay = A.filter(a => a.pool > 0 && a.paid === 0); if (nopay.length) out.push(['crit', '✕', `Нет оплат за период у: <b>${nopay.map(a => esc(a.agent)).join(', ')}</b> (общий пул ${f0(nopay.reduce((s, a) => s + a.pool, 0))}).`]);
  if (T.idle_debtors) { const sum = d.clients.filter(c => c.b1 < 0 && c.sold <= 0).reduce((s, c) => s - c.b1, 0); out.push(['warn', '⏳', `<b>${T.idle_debtors}</b> клиентов с долгом ${f0(sum)} не покупали в этом периоде: их стоит прозвонить.`]); }
  if (T.proj_sold) out.push([T.plan && T.proj_sold >= T.plan ? 'good' : 'warn', '📈', `При текущем темпе команда продаст за месяц ≈ <b>${f0(T.proj_sold)}</b>${T.plan ? ` — это ${UI.pct(T.proj_sold, T.plan)}% плана` : ''}.`]);
  const noAg = d.clients.filter(c => c.agent === 'Без агента').length; if (noAg) out.push(['warn', '❓', `<b>${noAg}</b> клиентов без агента. Назначьте их на вкладке «Клиенты».`]);
  const od = d.tasks.filter(t => t.status === 'overdue').length; if (od) out.push(['crit', '✕', `Просроченных заданий: <b>${od}</b>.`]);
  return out.length ? out : [['good', '✓', 'Критичных замечаний нет.']];
}

// ---------- summary ----------
EXT_PAGES.agents = async el => {
  const d = await agLoad(), body = agShell(el, 'agents', d);
  if (d.empty) return agEmpty(body);
  const T = agTotals(d), col = agColors(d), pace = agPace(d), rule = d.settings.akb;
  const sameMonthTrend = d.trend.filter(t => t.from === d.upload.period_from && t.to <= d.upload.period_to);
  const agNames = d.agents.map(a => a.agent);
  body.innerHTML = `<div class="kpis">
      ${UI.tile('Продано', UI.fmt0(T.sold), { hero: false, sub: T.plan ? `план ${UI.fmt0(T.plan)} · ${UI.pct(T.sold, T.plan)}%` : 'план не задан', delta: UI.delta(T.d_sold), tone: T.plan && T.sold >= T.plan ? 'good' : '' })}
      ${UI.tile('Оплачено', UI.fmt0(T.paid), { sub: T.pool ? `пул ${UI.fmt0(T.pool)} · ${UI.pct(T.paid, T.pool)}%` : 'пул не задан', delta: UI.delta(T.d_paid) })}
      ${UI.tile('Долг клиентов', UI.fmt0(T.debt), { sub: `должников: ${T.debtors}`, delta: UI.delta(T.d_debt, { inverse: true }), tone: 'warn' })}
      ${UI.tile('АКБ / ОКБ', `${T.akb} / ${T.okb}`, { sub: `активны ${UI.pct(T.akb, T.okb) ?? 0}% клиентов`, hint: 'АКБ — активная клиентская база, ОКБ — все клиенты' })}
      ${UI.tile('Возвраты', UI.fmt0(T.ret), { sub: T.sold ? `${(T.ret / T.sold * 100).toFixed(1)}% от продаж` : '' })}
      ${T.proj_sold ? UI.tile('Прогноз продаж на месяц', '≈ ' + UI.fmt0(T.proj_sold), { sub: T.plan ? `${UI.pct(T.proj_sold, T.plan)}% плана при текущем темпе` : 'при текущем темпе', tone: T.plan && T.proj_sold < T.plan * 0.9 ? 'warn' : 'good' }) : ''}</div>
    <div class="bar" style="margin-top:-4px"><span class="mut">АКБ — клиенты, которые:</span><select id="akb">${Object.entries(AKB_RULES).map(([k, v]) => `<option value="${k}" ${k === rule ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="mut">В вашей Google-таблице было «платят».</span></div>
    <div class="grid">
      ${UI.panel('План и факт по агентам', `<div class="scroll" style="max-height:none"><table><thead><tr><th>Агент</th><th>Продажи к плану</th><th>Оплаты к пулу</th><th class="n">АКБ / ОКБ</th><th class="n">Долг</th>${T.proj_sold ? '<th class="n">Прогноз месяца</th>' : ''}<th class="n">С прошлой загрузки</th></tr></thead><tbody>${d.agents.map(a => `<tr><td><i class="dot" style="background:${col(a.agent)};margin:0 8px 0 0"></i>${esc(a.agent)}</td><td style="min-width:200px">${CH.meter(a.sold, a.plan, { pace, label: '' })}</td><td style="min-width:200px">${CH.meter(a.paid, a.pool, { pace, label: '' })}</td><td class="n">${a.akb} / ${a.okb}<br><small>${UI.pct(a.akb, a.okb) ?? 0}%</small></td><td class="n">${UI.fmt0(a.debt)}<br><small>${a.debtors} кл.</small></td>${T.proj_sold ? `<td class="n">${a.proj_sold !== undefined ? '≈ ' + UI.fmt0(a.proj_sold) + (a.plan ? `<br><small>${UI.pct(a.proj_sold, a.plan)}% плана</small>` : '') : '—'}${a.need_sell_day ? `<br><small>нужно ${UI.fmt0(a.need_sell_day)}/день</small>` : ''}</td>` : ''}<td class="n">${UI.delta(a.d_sold) || '<span class="mut">—</span>'}<br><small>оплаты ${a.d_paid === null ? '—' : UI.sign(a.d_paid)}</small></td></tr>`).join('')}</tbody><tfoot><tr><td><b>Итого</b></td><td>${CH.meter(T.sold, T.plan, { pace })}</td><td>${CH.meter(T.paid, T.pool, { pace })}</td><td class="n"><b>${T.akb} / ${T.okb}</b></td><td class="n"><b>${UI.fmt0(T.debt)}</b></td>${T.proj_sold ? `<td class="n"><b>≈ ${UI.fmt0(T.proj_sold)}</b></td>` : ''}<td></td></tr></tfoot></table></div>${pace !== null ? `<p class="mut" style="margin:10px 0 0">Тонкая метка на шкале — где должен быть агент «по графику»: прошло ${Math.round(pace * 100)}% месяца. Цвет шкалы: зелёный — план выполнен, синий — идёт по графику, жёлтый и красный — отстаёт.</p>` : ''}`, { cls: 'w12', sub: 'Как в листе «Агенты», но с графиком выполнения и прогнозом' })}
      ${UI.panel('Что важно', `<ul class="insights">${agInsights(d).map(([k, i, t]) => `<li class="${k}"><span aria-hidden="true">${i}</span><span>${t}</span></li>`).join('')}</ul>`, { cls: 'w5' })}
      ${UI.panel('Динамика продаж по агентам', sameMonthTrend.length > 1 ? CH.area(sameMonthTrend.map(t => UI.dm(t.date)), agNames.map(n => ({ name: agShort(n), color: col(n), values: sameMonthTrend.map(t => t.agents[n]?.sold || 0) })), { fill: false }) : '<div class="empty">Загрузите выгрузки за несколько дней этого периода: появится динамика.</div>', { cls: 'w7', sub: 'Продано нарастающим итогом по загрузкам периода' })}
      ${UI.panel('Продано по агентам', CH.hbars(d.agents.map(a => ({ label: a.agent, value: a.sold, color: col(a.agent), sub: a.plan ? `план ${UI.fmt0(a.plan)}` : '' })), { fmt: UI.fmt0 }), { cls: 'w4' })}
      ${UI.panel('Оплачено по агентам', CH.hbars([...d.agents].sort((a, b) => b.paid - a.paid).map(a => ({ label: a.agent, value: a.paid, color: col(a.agent), sub: a.pool ? `пул ${UI.fmt0(a.pool)}` : '' })), { fmt: UI.fmt0 }), { cls: 'w4' })}
      ${UI.panel('Долг клиентов по агентам', CH.hbars([...d.agents].sort((a, b) => b.debt - a.debt).map(a => ({ label: a.agent, value: a.debt, color: col(a.agent), sub: `${a.debtors} должников` })), { fmt: UI.fmt0 }), { cls: 'w4' })}
      ${UI.panel('Активная клиентская база', CH.stack100(d.agents.map(a => ({ label: a.agent, segs: [{ name: `АКБ (${AKB_SHORT[rule]})`, value: a.akb, color: 'var(--c1)' }, { name: 'Остальные', value: a.okb - a.akb, color: 'var(--c-other)' }] }))), { cls: 'w6', sub: 'Доля активных клиентов у каждого агента' })}
      ${UI.panel('Крупнейшие долги', CH.hbars([...d.clients].filter(c => c.b1 < 0).sort((a, b) => a.b1 - b.b1).slice(0, 10).map(c => ({ label: c.name, sub: c.agent, value: -c.b1 })), { color: 'var(--c2)', fmt: UI.fmt0 }), { cls: 'w6', sub: 'Топ-10 клиентов по сумме долга' })}
    </div>`;
  $('#akb', body).onchange = e => agSetRule(e.target.value);
};

// ---------- leaderboard ----------
EXT_PAGES.leaders = async el => {
  const d = await agLoad(), body = agShell(el, 'leaders', d);
  if (d.empty) return agEmpty(body);
  const MEDAL = ['🥇', '🥈', '🥉'], col = agColors(d);
  const board = (title, sub, key, prevKey, planKey, fmtv = UI.fmt0) => {
    const list = [...d.agents].sort((a, b) => b[key] - a[key]);
    const prev = d.prev ? [...d.agents].map(a => ({ a: a.agent, v: a[key] - (a[prevKey] ?? 0) })).sort((x, y) => y.v - x.v).map(x => x.a) : null;
    const move = n => { if (!prev) return ''; const diff = prev.indexOf(n) - list.findIndex(a => a.agent === n); return diff > 0 ? `<span class="delta up" title="Место относительно прошлой загрузки">▲ ${diff}</span>` : diff < 0 ? `<span class="delta down" title="Место относительно прошлой загрузки">▼ ${-diff}</span>` : ''; };
    const order = [list[1], list[0], list[2]].filter(Boolean), ix = a => list.indexOf(a);
    const max = Math.max(list[0]?.[key] || 0, 1);
    return UI.panel(title, `<div class="podium">${order.map(a => `<div class="pod p${ix(a) + 1}"><div class="medal" aria-hidden="true">${MEDAL[ix(a)]}</div><div class="pn" title="${esc(a.agent)}">${esc(a.agent)}</div><div class="pv">${fmtv(a[key])}</div><small>${a[planKey] ? UI.pct(a[key], a[planKey]) + '% плана' : 'план не задан'}</small>${move(a.agent)}</div>`).join('')}</div>
      ${list.map((a, i) => `<div class="rank"><span class="rn">${i < 3 ? MEDAL[i] : i + 1}</span><div><div style="display:flex;justify-content:space-between;gap:8px"><span><i class="dot" style="background:${col(a.agent)};margin:0 6px 0 0"></i>${esc(a.agent)}</span><b>${fmtv(a[key])}</b></div><div class="meter" style="--m:${col(a.agent)};margin-top:6px"><i style="width:${a[key] / max * 100}%"></i></div></div><span>${move(a.agent)}</span></div>`).join('')}`, { cls: 'w6', sub });
  };
  const pctBoard = (title, sub, a, b) => {
    const list = d.agents.filter(x => x[b] > 0).map(x => ({ x, p: x[a] / x[b] })).sort((m, n) => n.p - m.p);
    return UI.panel(title, list.length ? CH.hbars(list.map(({ x, p }) => ({ label: x.agent, sub: `${UI.fmt0(x[a])} из ${UI.fmt0(x[b])}`, value: p * 100, color: col(x.agent), text: Math.round(p * 100) + '%' })), { max: Math.max(100, ...list.map(l => l.p * 100)) }) : '<div class="empty">План не задан. Заполните его на вкладке «Клиенты».</div>', { cls: 'w6', sub });
  };
  body.innerHTML = `<div class="grid">${board('🏆 Продажи', 'Кто больше всех продал за период', 'sold', 'd_sold', 'plan')}${board('💰 Собранные деньги', 'Кто больше всех собрал оплат', 'paid', 'd_paid', 'pool')}
    ${pctBoard('Выполнение плана продаж', 'Доля плана, которая уже продана', 'sold', 'plan')}${pctBoard('Выполнение плана оплат', 'Доля пула, которая уже собрана', 'paid', 'pool')}</div>
    <p class="mut">Стрелки показывают, как изменилось место агента по сравнению с прошлой загрузкой${d.prev ? ` (${UI.dateRu(d.prev.taken_at)})` : ' — они появятся после второй загрузки'}.</p>`;
};

// ---------- clients ----------
let agClientState = { q: '', agent: '', status: '', sort: 'b1', dir: 1 };
EXT_PAGES.aclients = async el => {
  const d = await agLoad(), body = agShell(el, 'aclients', d);
  if (d.empty) return agEmpty(body);
  const S = agClientState, agents = [...new Set(d.clients.map(c => c.agent))].sort((a, b) => a.localeCompare(b)), canEdit = can('agents.edit'), dis = canEdit ? '' : 'disabled';
  const STAT = { '': 'Все клиенты', active: 'АКБ (активные)', idle: 'Неактивные', debt: 'Должники', idledebt: 'Должники без покупок', noagent: 'Без агента', plan: 'С планом или пулом' };
  body.innerHTML = `<div class="bar"><input type="search" id="q" placeholder="Поиск клиента" style="flex:1;min-width:200px" value="${esc(S.q)}"><select id="ag"><option value="">Все агенты</option>${agents.map(a => `<option ${a === S.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    <select id="st">${Object.entries(STAT).map(([k, v]) => `<option value="${k}" ${k === S.status ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn gray" id="csv">Скачать CSV</button></div>
    <div class="bar needs-edit" id="bulk" hidden><b id="bcnt"></b><select id="bag">${agents.filter(a => a !== 'Без агента').map(a => `<option>${esc(a)}</option>`).join('')}</select><button class="btn sm" id="bgo">Назначить агента выбранным</button></div>
    <p class="mut" id="sum" style="margin:0 2px 10px"></p><div class="scroll"><table id="ct"></table></div>
    <p class="mut" style="margin:10px 2px">План и Пул (плановая сумма продаж и сбора оплат на клиента) и Заметки редактируются прямо в таблице и сохраняются сразу. Они не стираются при новой загрузке. Статус АКБ: клиенты, которые ${AKB_SHORT[d.settings.akb]}.</p>`;
  let list = [];
  const selected = new Set();
  const COLS = [['name', 'Клиент', 'l'], ['agent', 'Агент', 'l'], ['b0', 'Баланс на начало'], ['sold', 'Продано'], ['ret', 'Возврат'], ['paid', 'Оплачено'], ['b1', 'Баланс на конец'], ['plan', 'План'], ['pool', 'Пул'], ['note', 'Заметки', 'l']];
  const draw = () => {
    S.q = $('#q', body).value; S.agent = $('#ag', body).value; S.status = $('#st', body).value;
    const q = S.q.toLowerCase();
    list = d.clients.filter(c => (!q || c.name.toLowerCase().includes(q)) && (!S.agent || c.agent === S.agent) && (!S.status || (S.status === 'active' ? c.active : S.status === 'idle' ? !c.active : S.status === 'debt' ? c.b1 < 0 : S.status === 'idledebt' ? c.b1 < 0 && c.sold <= 0 : S.status === 'noagent' ? c.agent === 'Без агента' : c.plan > 0 || c.pool > 0)));
    list.sort((a, b) => { const x = a[S.sort], y = b[S.sort]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.dir; });
    $('#sum', body).innerHTML = `Показано <b>${list.length}</b> из ${d.clients.length} · долг показанных: <b class="neg">${UI.fmt0(list.reduce((s, c) => s + (c.b1 < 0 ? -c.b1 : 0), 0))}</b> · продано: <b>${UI.fmt0(list.reduce((s, c) => s + c.sold, 0))}</b> · оплачено: <b>${UI.fmt0(list.reduce((s, c) => s + c.paid, 0))}</b>`;
    $('#ct', body).innerHTML = `<thead><tr><th class="needs-edit"><input type="checkbox" id="all" aria-label="Выбрать всех"></th>${COLS.map(([k, t, c]) => `<th class="sort ${c === 'l' ? '' : 'n'}" data-s="${k}">${t}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th>Статус</th></tr></thead><tbody>${list.length ? list.map((c, i) => `<tr><td class="needs-edit"><input type="checkbox" data-sel="${i}" ${selected.has(c.name) ? 'checked' : ''}></td><td style="min-width:210px">${esc(c.name)}${c.landmark || c.phone ? `<br><small>${esc([c.landmark, c.phone].filter(Boolean).join(' · '))}</small>` : ''}</td><td><select data-ag="${i}" ${dis} style="max-width:170px">${[...new Set([...agents, c.agent])].map(a => `<option ${a === c.agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></td><td class="n">${UI.fmt0(c.b0)}</td><td class="n">${UI.fmt0(c.sold)}</td><td class="n">${UI.fmt0(c.ret)}</td><td class="n">${UI.fmt0(c.paid)}${c.d_paid ? `<br><small class="pos">${UI.sign(c.d_paid)}</small>` : ''}</td><td class="n ${c.b1 < 0 ? 'neg' : ''}">${UI.fmt0(c.b1)}</td><td class="n"><input class="cell" type="number" min="0" data-f="plan" data-i="${i}" value="${c.plan || ''}" ${dis}></td><td class="n"><input class="cell" type="number" min="0" data-f="pool" data-i="${i}" value="${c.pool || ''}" ${dis}></td><td><input class="cell txt" data-f="note" data-i="${i}" value="${esc(c.note)}" ${dis}></td><td>${c.active ? UI.pill('good', 'АКБ', '✓') : UI.pill('muted', 'неактивен')}</td></tr>`).join('') : `<tr><td colspan="${COLS.length + 2}" class="empty">Ничего не найдено</td></tr>`}</tbody>`;
    body.querySelectorAll('[data-s]').forEach(th => th.onclick = () => { const k = th.dataset.s; S.dir = S.sort === k ? -S.dir : 1; S.sort = k; draw(); });
    body.querySelectorAll('input[data-f]').forEach(inp => inp.onchange = async () => {
      const c = list[+inp.dataset.i], f = inp.dataset.f, v = f === 'note' ? inp.value : Number(inp.value || 0);
      const r = await api('/api/ag/client', { method: 'POST', body: { name: c.name, [f]: v } });
      if (r.error) { toast(r.error); inp.value = c[f] || ''; } else { c[f] = v; inp.style.background = 'var(--st-good-bg)'; setTimeout(() => { inp.style.background = ''; }, 900); }
    });
    body.querySelectorAll('select[data-ag]').forEach(s => s.onchange = async () => { const c = list[+s.dataset.ag], r = await api('/api/ag/client', { method: 'POST', body: { name: c.name, agent: s.value } }); if (r.error) { toast(r.error); s.value = c.agent; } else { c.agent = s.value; toast('Агент изменён. Сводка обновится после перезагрузки данных.'); } });
    const sync = () => { $('#bulk', body).hidden = !selected.size; $('#bcnt', body).textContent = `Выбрано: ${selected.size}`; };
    body.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => { const c = list[+cb.dataset.sel]; cb.checked ? selected.add(c.name) : selected.delete(c.name); sync(); });
    const all = $('#all', body); if (all) all.onchange = () => { list.forEach(c => (all.checked ? selected.add(c.name) : selected.delete(c.name))); draw(); sync(); };
    sync();
  };
  ['q', 'ag', 'st'].forEach(id => $('#' + id, body).addEventListener('input', draw));
  $('#bgo', body).onclick = async () => { const r = await api('/api/ag/clients/bulk', { method: 'POST', body: { names: [...selected], agent: $('#bag', body).value } }); if (r.error) return toast(r.error); toast(`Назначено клиентов: ${r.updated}`); route(); };
  $('#csv', body).onclick = () => UI.csv(`clients_${d.upload.taken_at}.csv`, [['Клиент', 'Агент', 'Баланс на начало', 'Продано', 'Возврат', 'Оплачено', 'Баланс на конец', 'План', 'Пул', 'Заметки', 'АКБ'], ...list.map(c => [c.name, c.agent, c.b0, c.sold, c.ret, c.paid, c.b1, c.plan, c.pool, c.note, c.active ? 'да' : 'нет'])]);
  draw();
};

// ---------- tasks ----------
function agTaskDialog(d, t, onDone) {
  const m = modal(`<h3>${t ? 'Задание' : 'Новое задание'}</h3><div class="form">
    <label>Клиент<input id="cl" list="cll" value="${esc(t?.client || '')}" ${t ? 'disabled' : ''} placeholder="начните вводить название"><datalist id="cll">${d.clients.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
    <label>Тип задания<select id="kd">${d.kinds.map(k => `<option ${k === t?.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    <label>Цель, сумма<input id="tg" type="number" min="0" value="${t?.target || ''}"></label><label>Срок<input id="du" type="date" value="${t?.due || ''}"></label>
    <label style="grid-column:1/-1">Что сделать<input id="tx" value="${esc(t?.text || '')}" placeholder="например: собрать оплату по долгу"></label></div>
    <small>Факт считается автоматически: для «Сбор оплаты» — сколько клиент оплатил с момента создания задания, для «Продажа» — сколько купил. Для других типов отметьте выполнение вручную.</small><br><small id="err" class="neg" role="alert"></small>
    <div class="bar">${t ? '<button class="btn danger" id="del">Удалить</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  if (t) $('#del', m.el).onclick = async () => { if (!confirm('Удалить задание?')) return; await api(`/api/ag/tasks/${t.id}/delete`, { method: 'POST', body: {} }); m.close(); onDone(); };
  $('#ok', m.el).onclick = async () => { const r = await api('/api/ag/tasks', { method: 'POST', body: { id: t?.id, client: $('#cl', m.el).value, kind: $('#kd', m.el).value, target: +$('#tg', m.el).value, due: $('#du', m.el).value, text: $('#tx', m.el).value } }); if (r.error) return $('#err', m.el).textContent = r.error; m.close(); onDone(); };
}

EXT_PAGES.atasks = async el => {
  const d = await agLoad(), body = agShell(el, 'atasks', d);
  if (d.empty) return agEmpty(body);
  const T = d.tasks, col = agColors(d), count = (a, s) => T.filter(t => t.agent === a && t.status === s).length;
  const agentsWith = [...new Set(T.map(t => t.agent || 'Без агента'))].sort();
  body.innerHTML = `<div class="bar"><span class="spacer"></span><button class="btn needs-edit" id="new">+ Задание</button></div>
    <div class="kpis">${UI.tile('Всего заданий', T.length)}${UI.tile('Выполнено', T.filter(t => t.status === 'done').length, { tone: 'good' })}${UI.tile('В работе', T.filter(t => t.status === 'work').length)}${UI.tile('Просрочено', T.filter(t => t.status === 'overdue').length, { tone: T.some(t => t.status === 'overdue') ? 'bad' : '' })}</div>
    <div class="grid">${UI.panel('Задания по агентам', T.length ? CH.stack100(agentsWith.map(a => ({ label: a, segs: [{ name: 'Выполнено', value: count(a, 'done'), color: 'var(--st-good)' }, { name: 'В работе', value: count(a, 'work'), color: 'var(--c1)' }, { name: 'Просрочено', value: count(a, 'overdue'), color: 'var(--st-crit)' }] }))) : '<div class="empty">Заданий пока нет. Создайте первое: кнопка «+ Задание».</div>', { cls: 'w12', sub: 'Выполнено, в работе и просрочено у каждого агента' })}</div>
    <div class="scroll"><table><thead><tr><th>Создано</th><th>Клиент</th><th>Агент</th><th>Тип</th><th>Что сделать</th><th class="n">Цель</th><th>Выполнение</th><th>Срок</th><th>Статус</th><th class="needs-edit" title="Отметка агента">Агент ✔</th></tr></thead><tbody>${T.length ? T.map((t, i) => `<tr class="row" data-i="${i}"><td>${UI.dateRu(t.created)}</td><td>${esc(t.client)}${t.in_file ? '' : '<br><small class="neg">нет в выгрузке</small>'}</td><td><i class="dot" style="background:${col(t.agent)};margin:0 6px 0 0"></i>${esc(t.agent || '—')}</td><td>${esc(t.kind)}</td><td>${esc(t.text)}</td><td class="n">${t.target ? UI.fmt0(t.target) : '—'}</td><td style="min-width:150px">${t.pct !== null ? CH.meter(t.fact, t.target, { tone: t.status === 'overdue' ? 'crit' : '' }) : '<small>вручную</small>'}</td><td>${t.due ? UI.dateRu(t.due) : '—'}</td><td>${UI.pill(...TASK_STATUS[t.status].slice(0, 1), TASK_STATUS[t.status][2], TASK_STATUS[t.status][1])}</td><td class="needs-edit"><input type="checkbox" data-done="${t.id}" ${t.agent_done ? 'checked' : ''} aria-label="Агент выполнил"></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Нет заданий</td></tr>'}</tbody></table></div>`;
  $('#new', body).onclick = () => agTaskDialog(d, null, () => route());
  body.querySelectorAll('tr.row').forEach(tr => tr.onclick = e => { if (e.target.closest('input')) return; if (can('agents.edit')) agTaskDialog(d, T[+tr.dataset.i], () => route()); });
  body.querySelectorAll('[data-done]').forEach(cb => cb.onchange = async () => { await api('/api/ag/tasks', { method: 'POST', body: { id: +cb.dataset.done, agent_done: cb.checked } }); route(); });
};

// ---------- uploads ----------
EXT_PAGES.aup = async el => {
  const d = await agLoad(), body = agShell(el, 'aup', d);
  const ups = d.uploads || [];
  body.innerHTML = `<div class="grid"><div class="panel w5"><div class="ph"><h4>Загрузить выгрузку</h4></div><div class="dz needs-edit" id="dz" tabindex="0" role="button"><b>Перетащите файлы сюда</b>или нажмите, чтобы выбрать (можно сразу несколько)</div>
      <p class="mut" style="margin:12px 0 0">Подходят: выгрузка «Баланс клиентов» из LINKO и ваша Google-таблица «Аналитика Митал» (.xlsx). Если за эту дату и период файл уже загружали, он заменится. План, Пул и Заметки при обычной загрузке не стираются.</p></div>
    <div class="panel w7"><div class="ph"><h4>Правило АКБ</h4></div>${d.empty ? '<p class="mut">Появится после первой загрузки.</p>' : `<p style="margin:0 0 10px">АКБ (активная клиентская база) — клиенты, которые:</p><select id="rule">${Object.entries(AKB_RULES).map(([k, v]) => `<option value="${k}" ${k === d.settings.akb ? 'selected' : ''}>${v}</option>`).join('')}</select><p class="mut" style="margin:10px 0 0">В вашей Google-таблице (лист «Аналитика заданий») АКБ — это «платят». В прототипе на HTML — «покупали». Выберите то, что вам удобнее: цифры во всех разделах пересчитаются.</p>`}</div></div>
    <h3>История загрузок</h3><div class="scroll"><table><thead><tr><th>На дату</th><th>Период</th><th>Файл</th><th class="n">Клиентов</th><th class="n">Продано</th><th class="n">Оплачено</th><th class="n">Долг (баланс)</th><th>Загрузил</th><th class="needs-edit"></th></tr></thead><tbody>${ups.length ? ups.map(u => `<tr><td>${UI.dateRu(u.taken_at)}</td><td>${UI.dm(u.period_from)} — ${UI.dm(u.period_to)}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(u.file)}">${esc(u.file)}</td><td class="n">${u.clients}</td><td class="n">${UI.fmt0(u.sold)}</td><td class="n">${UI.fmt0(u.paid)}</td><td class="n ${u.b1 < 0 ? 'neg' : ''}">${UI.fmt0(u.b1)}</td><td>${esc(u.uploaded_by)}<br><small>${esc((u.uploaded_at || '').slice(0, 16).replace('T', ' '))}</small></td><td class="needs-edit"><button class="btn gray sm" data-del="${u.id}">Удалить</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Загрузок пока нет</td></tr>'}</tbody></table></div>`;
  UI.bindDrop($('#dz', body), files => agUploadDialog(() => route(), files));
  const rule = $('#rule', body); if (rule) rule.onchange = () => agSetRule(rule.value);
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Удалить эту загрузку? План, Пул и Заметки клиентов сохранятся.')) return; const r = await api(`/api/ag/uploads/${b.dataset.del}/delete`, { method: 'POST', body: {} }); if (r.error) return toast(r.error); agSel = null; route(); });
};
