// Итоги разговора (agent page → «📝 Итоги разговора»): what was agreed with the agent and by when. A goal with a number is
// checked by the CRM itself from the data it already has (LINKO payments and orders, new points, sleeping clients brought back,
// the log of first visits); a goal without a number is marked done / not done by hand. The next time the agent page is opened,
// the panel «Договорённости» shows how each one went.
// Stored in the synced state: ext.talks = [{ id, agent, at: 'YYYY-MM-DD', note, goals: [{ kind, target, text, due, manual }] }].
window.EXT_PAGES = window.EXT_PAGES || {};

const TALK = {
  KINDS: {
    pay: { t: 'Собрать денег', unit: '$', hint: 'оплаты клиентов агента из LINKO' },
    sell: { t: 'Продать на сумму', unit: '$', hint: 'заказы агента из LINKO' },
    new: { t: 'Новых точек', unit: 'шт', hint: 'засчитанные новые точки' },
    wake: { t: 'Вернуть спящих', unit: 'кл', hint: 'вернувшиеся из «Возврат спящих»' },
    late: { t: 'Без опозданий', unit: '', hint: 'ни одного первого визита позже начала дня' },
    route: { t: 'Маршрут не ниже', unit: '%', hint: 'визиты по журналу дисциплины' },
    free: { t: 'Без цифры', unit: '', hint: 'отметите сами' },
  },
  all() { const x = CRMLocal.ext(); return (x.talks ||= []); },
  today: () => UI.localDate(Date.now()),
  inRange: (d, a, b) => !!d && d >= a && d <= b,

  // progress of one goal: { st: 'done' | 'wait' | 'fail', txt }
  check(agent, from, g) {
    const t0 = TALK.today(), end = g.due, over = t0 > end, f = UI.fmt0;
    const fin = (have, need, txt) => ({ have, need, txt, st: have >= need ? 'done' : over ? 'fail' : 'wait' });
    if (g.manual) return { st: g.manual, txt: g.manual === 'done' ? 'отмечено: выполнено' : 'отмечено: не выполнено' };
    try {
      if (g.kind === 'pay' || g.kind === 'sell') {
        const M = LX.model();
        const sum = g.kind === 'pay' ? M.payments.filter(p => p.agent === agent && TALK.inRange(p.date, from, end)).reduce((s, p) => s + p.amount, 0)
          : M.ords.filter(o => o.agent === agent && TALK.inRange(o.date, from, end) && !/cancel|reject|return|отмен|отклон|возвр/i.test(String(o.status))).reduce((s, o) => s + o.sum, 0);
        return fin(sum, g.target, `$${f(sum)} из $${f(g.target)}`);
      }
      if (g.kind === 'new') { const n = NP.model()?.list.filter(x => x.agent === agent && x.status === 'ok' && TALK.inRange(x.metAt, from, end)).length || 0; return fin(n, g.target, `${n} из ${g.target}`); }
      if (g.kind === 'wake') { const n = WK.cfg().list.filter(r => r.agent === agent).map(r => WK.status(r)).filter(s => s.st === 'back' && TALK.inRange(s.buy.date, from, end)).length; return fin(n, g.target, `${n} из ${g.target}`); }
      if (g.kind === 'late' || g.kind === 'route') {
        const c = DS.cfg(), start = DS.mins(c.start || '09:00'), log = Object.keys(c.days).filter(d => TALK.inRange(d, from, end)).map(d => ({ d, ...(c.days[d][agent] || {}) })).filter(x => x.first || x.plan);
        if (g.kind === 'late') {
          const late = log.filter(x => x.first && DS.mins(x.first) > start);
          if (late.length) return { st: 'fail', txt: `опоздания: ${late.map(x => UI.dm(x.d) + ' ' + x.first).join(', ')}` };
          return { st: over ? 'done' : 'wait', txt: `пока без опозданий (дней в журнале: ${log.length})` };
        }
        const P = log.reduce((s, x) => s + (x.plan || 0), 0), D = log.reduce((s, x) => s + (x.done || 0), 0), pct = P ? Math.round(D / P * 100) : 0;
        if (!over) return { st: 'wait', txt: P ? `сейчас ${pct}% (${D}/${P})` : 'нет данных журнала' };
        return { st: P && pct >= g.target ? 'done' : 'fail', txt: P ? `${pct}% (${D}/${P})` : 'нет данных журнала' };
      }
    } catch (e) { return { st: over ? 'fail' : 'wait', txt: 'нет данных: ' + e.message }; }
    return { st: over ? 'fail' : 'wait', txt: over ? 'срок вышел — отметьте вручную' : 'отметьте, когда будет сделано' };
  },
  ST: { done: ['good', '✓ выполнено'], wait: ['info', 'в работе'], fail: ['crit', '✕ не выполнено'] },
  goalTitle(g) { const K = TALK.KINDS[g.kind] || TALK.KINDS.free; return K.t + (g.kind === 'free' || g.kind === 'late' ? '' : ' ' + (K.unit === '$' ? '$' + UI.fmt0(g.target) : UI.fmt0(g.target) + (K.unit === '%' ? '%' : ''))); },

  panel(agent) {
    const list = TALK.all().filter(t => t.agent === agent).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
    if (!list.length) return UI.panel('🤝 Договорённости', '<p class="mut">Договорённостей с агентом ещё нет. После разговора нажмите «📝 Итоги разговора» — запишите, о чём договорились и к какому сроку, и в следующий раз CRM покажет, выполнено ли.</p>', { cls: 'w12' });
    const goals = list.flatMap(t => t.goals.map((g, i) => ({ t, g, i, r: TALK.check(agent, t.at, g) })));
    const open = goals.filter(x => x.r.st === 'wait'), closed = goals.filter(x => x.r.st !== 'wait'), done = closed.filter(x => x.r.st === 'done').length;
    const link = (x, m, txt) => `<a href="#" data-tk="${x.t.id}" data-gi="${x.i}" data-m="${m}">${txt}</a>`;
    const row = x => `<li><div>${UI.pill(...TALK.ST[x.r.st])} <b>${esc(TALK.goalTitle(x.g))}</b>${x.g.text ? ' — ' + esc(x.g.text) : ''} <span class="mut">· до ${UI.dateRu(x.g.due)} · договорились ${UI.dateRu(x.t.at)}</span></div>
      <div class="mut">${esc(x.r.txt || '')}<span class="needs-edit"> · ${x.g.manual ? link(x, '', 'считать автоматически') : `${link(x, 'done', 'выполнено')} · ${link(x, 'fail', 'не выполнено')}`}</span></div></li>`;
    const last = list[0];
    return UI.panel(`🤝 Договорённости (${open.length} в работе)`, `${last.note ? `<p><span class="mut">Последний разговор ${UI.dateRu(last.at)}:</span> ${esc(last.note)}</p>` : ''}
      ${open.length ? `<ul class="notes">${open.map(row).join('')}</ul>` : '<p class="mut">Открытых договорённостей нет.</p>'}
      ${closed.length ? `<details${open.length ? '' : ' open'}><summary class="mut">Прошлые договорённости: выполнено ${done} из ${closed.length}</summary><ul class="notes">${closed.slice(0, 30).map(row).join('')}</ul></details>` : ''}`, { cls: 'w12', sub: 'Цели с цифрой CRM проверяет сама по данным; остальные отметьте вручную' });
  },

  dialog(agent, onSave) {
    const due = UI.localDate(Date.now() + 7 * 864e5);
    const goalRow = i => `<div class="form" data-row="${i}"><label>Цель<select data-k="kind">${Object.entries(TALK.KINDS).map(([k, v]) => `<option value="${k}">${v.t}</option>`).join('')}</select></label>
      <label>Сколько<input data-k="target" type="number" min="0" step="1"></label><label>Срок<input data-k="due" type="date" value="${due}"></label><label>Комментарий<input data-k="text" maxlength="200" placeholder="например: клиенты А1 и Б2"></label></div>`;
    const m = modal(`<h3>Итоги разговора: ${esc(agent)}</h3><label class="mut" style="display:block">О чём говорили<textarea id="tkNote" rows="3" style="width:100%" maxlength="1000" placeholder="Что не получается, что агент пообещал, чем вы поможете"></textarea></label>
      <h4>О чём договорились</h4><div id="tkGoals">${goalRow(0)}</div><button class="btn gray sm" id="tkAdd" type="button">＋ ещё цель</button>
      <p class="mut" id="tkHint"></p><small id="tkErr" class="neg" role="alert"></small>
      <div class="bar"><span class="spacer"></span><button class="btn gray" id="tkX">Отмена</button><button class="btn" id="tkOk">Сохранить</button></div>`);
    m.el.classList.add('wide');
    const hint = () => { $('#tkHint', m.el).textContent = [...m.el.querySelectorAll('[data-row]')].map(r => { const k = r.querySelector('[data-k=kind]').value, K = TALK.KINDS[k]; r.querySelector('[data-k=target]').disabled = k === 'free' || k === 'late'; return K.t + ' — ' + K.hint; }).join(' · '); };
    const bind = () => m.el.querySelectorAll('[data-k=kind]').forEach(s => s.onchange = hint);
    bind(); hint();
    $('#tkAdd', m.el).onclick = () => { const n = m.el.querySelectorAll('[data-row]').length; if (n >= 5) return; $('#tkGoals', m.el).insertAdjacentHTML('beforeend', goalRow(n)); bind(); hint(); };
    $('#tkX', m.el).onclick = m.close;
    $('#tkOk', m.el).onclick = () => {
      const note = $('#tkNote', m.el).value.trim(), goals = [], err = $('#tkErr', m.el);
      for (const r of m.el.querySelectorAll('[data-row]')) {
        const v = k => r.querySelector(`[data-k=${k}]`).value.trim(), kind = v('kind'), target = Number(v('target')), text = v('text'), d = v('due');
        const needNum = kind !== 'free' && kind !== 'late';
        if (needNum && !v('target') && !text) continue; // empty row
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return (err.textContent = 'Укажите срок');
        if (d < TALK.today()) return (err.textContent = 'Срок не может быть в прошлом');
        if (needNum && !(target > 0)) return (err.textContent = `«${TALK.KINDS[kind].t}»: укажите, сколько`);
        if (kind === 'route' && target > 100) return (err.textContent = 'Маршрут: не больше 100%');
        if (kind === 'free' && !text) return (err.textContent = 'Цель без цифры: напишите в комментарии, что именно сделать');
        goals.push({ kind, target: needNum ? Math.round(target) : 0, text: text.slice(0, 200), due: d, manual: '' });
      }
      if (!goals.length && !note) return (err.textContent = 'Запишите хотя бы одну договорённость или о чём говорили');
      const list = TALK.all(), id = list.reduce((x, t) => Math.max(x, t.id || 0), 0) + 1;
      list.push({ id, agent, at: TALK.today(), note: note.slice(0, 1000), goals });
      CRMLocal.touch(); m.close(); toast('Итоги разговора сохранены'); onSave();
    };
  },

  bind(el) {
    el.querySelectorAll('[data-tk]').forEach(a => a.onclick = e => {
      e.preventDefault();
      const t = TALK.all().find(x => x.id === Number(a.dataset.tk)), g = t?.goals[Number(a.dataset.gi)]; if (!g) return;
      g.manual = a.dataset.m; CRMLocal.touch(); route();
    });
  },
};

// add the panel and the button to the agent page without changing it
(() => {
  const orig = EXT_PAGES.agent; if (typeof orig !== 'function') return;
  EXT_PAGES.agent = async el => {
    await orig(el);
    const agent = typeof AGP !== 'undefined' ? AGP.agent : null, grid = el.querySelector('.grid'); if (!agent || !grid) return;
    grid.insertAdjacentHTML('afterbegin', TALK.panel(agent));
    const actions = el.querySelector('.page-head .actions');
    if (actions) { actions.insertAdjacentHTML('afterbegin', '<button class="btn needs-edit" id="tkOpen">📝 Итоги разговора</button>'); $('#tkOpen', el).onclick = () => TALK.dialog(agent, () => route()); }
    TALK.bind(el);
  };
})();
