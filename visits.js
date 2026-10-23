// Визиты агентов (Агенты → Визиты): LINKO «Клиенты → Маршруты» — the plan of the day of every agent, which clients they visited,
// when they came in and left, what they did. The Google auto-loader (autolinko.gs visits_) takes it every 30 minutes into
// linko-visits.json, every day also into archive/YYYY/MM/YYYY-MM-DD/visits.json.gz, keeping LINKO's answers whole.
// File: { at, day, summary: <market/agent_plans/>, agents: { <id>: { name, plan: <market/agent_plans/<id>/>, stats: <market/detail_plan/> } }, errors }.
// First version: shows LINKO's data as it comes (tables with every field) and the list of fields, so the analysis
// (day timeline, week, clients, suspicious visits) can be built on the real field names.
window.EXT_PAGES = window.EXT_PAGES || {};

const VZ = {
  day: '', agent: '', src: 'plan', arr: 0, cache: {},
  // known LINKO field names → Russian column titles; the rest are shown as they come
  LABELS: {
    user: 'Агент', plan_visit: 'План визитов', visit_count: 'Посещено', no_visit: 'Не посещено', no_plan_visit_count: 'Вне плана',
    success_visit: 'Успешные', reject: 'Отказы', order_total_price: 'Сумма заказов', orders_count: 'Заказов', avg_check: 'Средний чек',
    akb: 'АКБ', strike_rate: 'Strike rate', min_start_time: 'Первый визит', max_end_time: 'Последний визит', done_rate: 'Выполнение',
    comment: 'Комментарий', created_date: 'Создано', start_time: 'Начало', end_time: 'Конец', done_time: 'Выполнено', status: 'Статус',
  },
  label: k => VZ.LABELS[k] || VZ.LABELS[k.split('.').at(-1)] || k,

  // today: linko-visits.json; other days: the archive
  async load(day) {
    if (VZ.cache[day]) return VZ.cache[day];
    const today = UI.localDate(Date.now());
    let j = null;
    if (day === today || !day) j = await CLOUD.readJson('linko-visits.json');
    if ((!j || (day && j.day !== day)) && day && typeof ARC !== 'undefined') {
      const f = ((await ARC.list()) || []).find(x => x.day === day && x.name === 'visits');
      if (f) j = await ARC.read(f.path);
    }
    if (j) VZ.cache[j.day] = j;
    return j;
  },
  async days() {
    try { return [...new Set(((await ARC.list()) || []).filter(f => f.name === 'visits').map(f => f.day))]; } catch { return []; }
  },

  // every array of objects inside a LINKO answer, with its path; the longest first (it is usually the list of visits)
  arrays(x, path = '', out = [], depth = 0) {
    if (depth > 6 || x == null || typeof x !== 'object') return out;
    if (Array.isArray(x)) {
      const objs = x.filter(v => v && typeof v === 'object' && !Array.isArray(v));
      if (objs.length) out.push({ path: path || '(весь ответ)', rows: objs });
      objs.slice(0, 3).forEach(v => VZ.arrays(v, path + '[]', out, depth + 1));
      return depth ? out : out.sort((a, b) => b.rows.length - a.rows.length);
    }
    for (const k of Object.keys(x)) VZ.arrays(x[k], path ? path + '.' + k : k, out, depth + 1);
    return depth ? out : out.sort((a, b) => b.rows.length - a.rows.length);
  },
  // one row → flat { 'a.b': value } (two levels deep; a nested list becomes its length)
  flat(o, pre = '', out = {}, depth = 0) {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? pre + '.' + k : k;
      if (Array.isArray(v)) out[key] = `[${v.length}]`;
      else if (v && typeof v === 'object') { if (depth < 2) VZ.flat(v, key, out, depth + 1); }
      else out[key] = v;
    }
    return out;
  },
  // the summary is a tree (branch → supervisor → agent): its leaves are the agents
  leaves(x, out = []) {
    if (Array.isArray(x)) { x.forEach(v => VZ.leaves(v, out)); return out; }
    if (!x || typeof x !== 'object') return out;
    const kids = x.child_data || x.childData;
    if (Array.isArray(kids) && kids.length) return VZ.leaves(kids, out);
    if (Array.isArray(x.results)) return VZ.leaves(x.results, out);
    out.push(x); return out;
  },
  cell(v) {
    if (v == null || v === '') return '<span class="mut">—</span>';
    if (typeof v === 'boolean') return v ? '✓' : '✗';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const d = s.slice(0, 10), t = s.slice(11, 16); return esc(d === VZ.day ? t : UI.dateRu(d) + ' ' + t); }
    if (/^https?:\/\//.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">открыть</a>`;
    return esc(s.length > 120 ? s.slice(0, 120) + '…' : s);
  },
  // a table with every non-empty column (at most 30), rows as LINKO sent them
  grid(rows, { max = '560px' } = {}) {
    const F = rows.map(r => VZ.flat(r)), keys = [];
    for (const f of F) for (const k of Object.keys(f)) if (!keys.includes(k) && F.some(x => x[k] != null && x[k] !== '')) keys.push(k);
    const cols = keys.slice(0, 30);
    return LX.table(cols.map(VZ.label), F.map(f => `<tr>${cols.map(k => `<td>${VZ.cell(f[k])}</td>`).join('')}</tr>`), { max }) + (keys.length > 30 ? `<p class="mut">Показаны 30 полей из ${keys.length} — все поля в списке ниже.</p>` : '');
  },
  // field list of a LINKO answer: path, how often it is filled, an example
  fields(rows) {
    const F = rows.map(r => VZ.flat(r)), m = new Map();
    for (const f of F) for (const [k, v] of Object.entries(f)) { const x = m.get(k) || { n: 0, ex: '' }; if (v != null && v !== '') { x.n++; if (!x.ex) x.ex = String(v).slice(0, 60); } m.set(k, x); }
    return [...m.entries()].map(([k, x]) => ({ k, n: x.n, ex: x.ex, of: F.length }));
  },
};

EXT_PAGES.visits = async el => {
  await CRMLocal.ready;
  el.innerHTML = `<div class="page-head"><div><h2>Визиты агентов</h2><div class="sub">Из LINKO «Клиенты → Маршруты»: план дня, к кому агент пришёл, во сколько вошёл и вышел, что сделал. Обновляется каждые 30 минут, каждый день сохраняется в архив.</div></div></div><div id="vzBody"><p class="mut">Загружаю визиты…</p></div>`;
  const body = $('#vzBody', el);
  if (!CLOUD.on()) { body.innerHTML = UI.empty('Синхронизация не настроена', 'Визиты приходят через тот же приватный репозиторий, что и данные CRM. Включите <a href="#/cloud">Данные → Синхронизация и настройки</a>.'); return; }
  const today = UI.localDate(Date.now());
  VZ.day ||= today;
  let j, days;
  try { [j, days] = await Promise.all([VZ.load(VZ.day), VZ.days()]); } catch (e) { body.innerHTML = `<p class="neg">Не удалось получить визиты: ${esc(e.message)}</p>`; return; }
  if (!j) {
    body.innerHTML = UI.empty('Визитов пока нет', `Их собирает скрипт автозагрузки. Обновите его в Google: <a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт» → вставьте вместо старого → сохраните. Через 30 минут здесь появятся визиты за сегодня.`);
    return;
  }
  VZ.day = j.day;
  for (const d of [today, j.day]) if (!days.includes(d)) days.push(d);
  days.sort().reverse();
  const agents = Object.entries(j.agents || {}).map(([id, a]) => ({ id, ...a })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  if (!agents.some(a => a.id === VZ.agent)) VZ.agent = agents[0]?.id || '';
  const A = agents.find(a => a.id === VZ.agent), errs = Object.entries(j.errors || {});
  const sum = VZ.leaves(j.summary);
  const src = A ? (VZ.src === 'stats' ? A.stats : A.plan) : null, arrs = src ? VZ.arrays(src) : [];
  if (VZ.arr >= arrs.length) VZ.arr = 0;
  const rows = arrs[VZ.arr]?.rows || [];
  const fieldsOf = (title, rs) => rs.length ? UI.panel(title, LX.table(['Поле', '#Заполнено', 'Пример'], VZ.fields(rs).map(f => `<tr><td><code>${esc(f.k)}</code></td><td class="n">${f.n} из ${f.of}</td><td>${esc(f.ex)}</td></tr>`), { max: '420px' }), { cls: 'w6' }) : '';

  body.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <label>День <select id="vzDay">${days.map(d => `<option value="${d}"${d === VZ.day ? ' selected' : ''}>${UI.dateRu(d)}${d === today ? ' (сегодня)' : ''}</option>`).join('')}</select></label>
      <label>Агент <select id="vzAg">${agents.map(a => `<option value="${esc(a.id)}"${a.id === VZ.agent ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <button class="btn" id="vzRe" type="button">🔄 Обновить</button>
      <span class="mut">Данные LINKO на ${esc(new Date(j.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))} · агентов ${agents.length}</span>
    </div>
    ${errs.length ? `<p class="mut">LINKO не отдал часть данных: ${errs.slice(0, 6).map(([k, v]) => esc(k + ' — ' + v)).join('; ')}</p>` : ''}
    <div class="grid">
    ${sum.length ? UI.panel('Сводка по агентам за день', VZ.grid(sum, { max: '420px' }), { cls: 'w12', sub: 'Как в LINKO «Маршруты»: план визитов, посещено, вне плана, заказы, первый и последний визит.' }) : ''}
    ${A ? UI.panel(`Визиты: ${esc(A.name)}`, `<nav class="tabs" style="margin-bottom:8px"><a href="#" data-src="plan" class="${VZ.src === 'plan' ? 'on' : ''}">План и визиты дня</a><a href="#" data-src="stats" class="${VZ.src === 'stats' ? 'on' : ''}">Подробности плана</a></nav>
        ${arrs.length > 1 ? `<p><label>Список <select id="vzArr">${arrs.map((a, i) => `<option value="${i}"${i === VZ.arr ? ' selected' : ''}>${esc(a.path)} (${a.rows.length})</option>`).join('')}</select></label></p>` : ''}
        ${rows.length ? VZ.grid(rows) : `<p class="mut">LINKO не прислал списка за этот день${src && typeof src === 'object' ? '. Ответ: ' + esc(JSON.stringify(src).slice(0, 300)) : ''}.</p>`}`, { cls: 'w12' }) : UI.panel('Визиты', '<p class="mut">За этот день LINKO не прислал визитов ни по одному агенту.</p>', { cls: 'w12' })}
    ${fieldsOf('Поля LINKO: ' + esc(arrs[VZ.arr]?.path || 'визиты'), rows)}
    ${fieldsOf('Поля LINKO: сводка', sum)}
    ${UI.panel('Настройка анализа', `<p>Это первая версия: здесь видно всё, что LINKO отдаёт о визитах. Нажмите кнопку — список полей скопируется (без имён клиентов), вставьте его в чат. По нему будут построены лента дня агента, неделя, клиенты и подозрительные визиты.</p><button class="btn" id="vzCopy" type="button">📋 Скопировать список полей</button>`, { cls: 'w12' })}
    </div>`;

  const redraw = () => EXT_PAGES.visits(el);
  $('#vzDay', body).onchange = e => { VZ.day = e.target.value; VZ.arr = 0; redraw(); };
  if ($('#vzAg', body)) $('#vzAg', body).onchange = e => { VZ.agent = e.target.value; VZ.arr = 0; redraw(); };
  $('#vzRe', body).onclick = () => { delete VZ.cache[VZ.day]; redraw(); };
  if ($('#vzArr', body)) $('#vzArr', body).onchange = e => { VZ.arr = Number(e.target.value); redraw(); };
  body.querySelectorAll('[data-src]').forEach(a => a.onclick = e => { e.preventDefault(); VZ.src = a.dataset.src; VZ.arr = 0; redraw(); });
  $('#vzCopy', body).onclick = async () => {
    // field names and how often they are filled; examples only for times, numbers and yes/no (no client names)
    const safe = v => (/^[\d\s.,:T+\-]+$|^(true|false)$/.test(v) ? v : v ? '…' : '');
    const part = (name, rs) => `${name} (${rs.length}):\n` + VZ.fields(rs).map(f => `  ${f.k} — ${f.n}/${f.of} ${safe(f.ex)}`).join('\n');
    const out = [];
    for (const [key, nm] of [['plan', 'agent_plans/<id>'], ['stats', 'detail_plan']]) for (const a of VZ.arrays(A?.[key])) out.push(part(`${nm} → ${a.path}`, a.rows));
    if (A) for (const [key, nm] of [['plan', 'agent_plans/<id>'], ['stats', 'detail_plan']]) if (A[key] && !Array.isArray(A[key])) out.push(`${nm} (верхний уровень): ` + Object.keys(A[key]).join(', '));
    out.push(part('agent_plans (сводка)', sum));
    try { await navigator.clipboard.writeText(`Визиты LINKO, ${VZ.day}\n` + out.join('\n\n')); toast('Список полей скопирован — вставьте его в чат'); } catch { toast('Не удалось скопировать — сделайте снимок экрана'); }
  };
};
