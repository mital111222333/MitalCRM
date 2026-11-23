// База клиентов (#/kb): всё, что вы знаете о клиенте сверх LINKO — с кем работает, какие масла, по каким ценам покупает и продаёт,
// договоры, оборот в месяц, контакты, что любит. Дорога: Регионы → Агенты → Клиенты → Досье, и поиск сверху (имя, ориентир,
// телефон, бренд, поставщик — латиницей или кириллицей, с опечатками).
// Данные — таблица ai_client_info в базе MITAL: туда же пишет JUMAVOY, когда вы рассказываете ему о клиенте (голосом, по-узбекски
// или по-русски). Новая цена / новый договор того же товара и той же фирмы не стирает старый: старый уходит в «Историю», в досье
// видно «было → стало». Без интернета страница открывается из сохранённой копии, а записанное уходит в базу, когда связь вернётся.
// SQL: supabase/migrations/20261123000001_client_base_crm.sql (до него раздел показывает, что нужно сделать).
window.EXT_PAGES = window.EXT_PAGES || {};

const KB = {
  SQL: '20261123000001_client_base_crm.sql',
  CACHE: 'crm_kb_v1', QUEUE: 'crm_kb_q_v1', FRESH_DAYS: 7,
  // раздел, значок, заголовок, подсказка для «Что», подсказка для «С кем»
  CATS: [
    ['price', '💲', 'Цены', 'товар: Mobil Super 3000 5W-40 4л', 'у кого / чья цена: MITAL, Ravshan Oil'],
    ['supplier', '🚚', 'С кем работает', 'бренд или что берёт: Mobil, Shell', 'поставщик: Ravshan Oil'],
    ['oil', '🛢', 'Масла у клиента', 'бренд / товар на полке', ''],
    ['contract', '📄', 'Договоры', 'о чём: поставка, отсрочка, бонус', 'с кем договор: MITAL, Valvoline'],
    ['volume', '📦', 'Оборот и объёмы', 'что: масла всего, Mitanol, бочки', ''],
    ['contact', '📇', 'Контакты', 'кто: владелец, продавец, ЛПР', ''],
    ['preference', '❤️', 'Что любит / характер', 'тема: скидка, бонус, общение', ''],
    ['competitor', '⚔️', 'Конкуренты рядом', 'кто рядом / чей агент ходит', ''],
    ['equipment', '🔧', 'Оборудование / сервис', 'подъёмник, яма, замена масла', ''],
    ['note', '📝', 'Заметки', '', ''],
  ],
  SIDE: { buy: 'закупает', sell: 'продаёт' },
  rows: [], at: null, loaded: false, err: '', noSql: false, busy: false, regs: null, regList: [],
  q: '', filter: 'all',

  // ---------- names: the same rule as JUMAVOY (Cyrillic → Latin, h = x, no apostrophes), so keys match the bot's ----------
  TR: { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' },
  norm: s => String(s || '').toLowerCase().replace(/[а-яёўқғҳ]/g, ch => KB.TR[ch] ?? ch).replace(/[ʻʼ'’`‘]/g, '').replace(/h/g, 'x').replace(/(.)\1+/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim(),
  dice(a, b) { const g = s => { const o = new Set(), t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; }; const A = g(a), B = g(b); let k = 0; for (const x of A) if (B.has(x)) k++; return 2 * k / (A.size + B.size || 1); },
  key: r => [KB.norm(r.client), r.category, KB.norm(r.subject), KB.norm(r.party), r.side || ''].join('|'),
  cat: k => KB.CATS.find(c => c[0] === k) || KB.CATS[KB.CATS.length - 1],
  day: r => String(r.created_at || '').slice(0, 10),
  fresh: r => !r.replaced_by && KB.day(r) >= UI.localDate(Date.now() - KB.FRESH_DAYS * 864e5),
  ago(d) { if (!d) return ''; const n = Math.round((Date.parse(UI.localDate(Date.now())) - Date.parse(d)) / 864e5); return n <= 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} ${UI.plural(n, 'день', 'дня', 'дней')} назад`; },
  money(v, cur) { const f = UI.fmt0(v); return cur === 'UZS' ? `${f} сум` : cur === 'RUB' ? `${f} ₽` : cur === 'EUR' ? `€${f}` : `$${f}`; },
  priceText: r => (r.price == null ? '' : `${KB.money(Number(r.price), r.currency)}${r.unit ? '/' + r.unit : ''}`),
  factText: r => [r.subject, r.party && (r.subject ? '— ' : '') + r.party, r.price != null ? (r.side ? KB.SIDE[r.side] + ' ' : '') + KB.priceText(r) : '', r.detail].filter(Boolean).join(' '),

  // ---------- data ----------
  owner() { const p = window.AUTH?.profile; return p && !['agent', 'store'].includes(p.role) ? p.id : null; },
  cacheLoad() { try { const c = JSON.parse(localStorage.getItem(KB.CACHE) || 'null'); if (c && c.owner === KB.owner() && Array.isArray(c.rows)) { KB.rows = c.rows; KB.at = c.at; KB.loaded = true; } } catch { /* none */ } },
  cacheSave() { try { localStorage.setItem(KB.CACHE, JSON.stringify({ owner: KB.owner(), at: KB.at, rows: KB.rows })); } catch { /* storage full: works without the copy */ } },
  queue() { try { return JSON.parse(localStorage.getItem(KB.QUEUE) || '[]'); } catch { return []; } },
  setQueue(q) { try { q.length ? localStorage.setItem(KB.QUEUE, JSON.stringify(q)) : localStorage.removeItem(KB.QUEUE); } catch { /* storage blocked */ } },
  isNoSql: e => /owner_id|ai_client_info|42P01|42703|PGRST20[45]|permission denied|schema cache/i.test(String(e?.message || e?.code || e)),

  async pull() {
    const sb = window.AUTH?.sb, me = KB.owner();
    if (!sb || !me) { KB.err = 'Войдите в CRM своим логином, чтобы увидеть базу клиентов'; return; }
    if (navigator.onLine === false) { KB.err = ''; return; }
    await KB.flush();
    const all = [];
    for (let from = 0; ; from += 1000) { // the database gives at most 1000 rows per request
      const { data, error } = await sb.from('ai_client_info').select('*').eq('owner_id', me).order('id').range(from, from + 999);
      if (error) { if (KB.isNoSql(error)) { KB.noSql = true; KB.err = ''; } else KB.err = 'Не удалось загрузить: ' + (error.message || error); return; }
      all.push(...data); if (data.length < 1000) break;
    }
    const pend = KB.queue().filter(x => x.t === 'add').map(x => x.row); // written offline, not in the base yet
    KB.rows = [...all, ...pend]; KB.at = new Date().toISOString(); KB.loaded = true; KB.noSql = false; KB.err = ''; KB.cacheSave();
  },
  // offline records go to the base when the connection is back: insert → mark what it replaces; delete → bring the older one back
  async flush() {
    const sb = window.AUTH?.sb; let q = KB.queue(); if (!sb || !q.length || navigator.onLine === false || KB.flushing) return;
    KB.flushing = true;
    try {
      while (q.length) {
        const x = q[0];
        if (x.t === 'add') await KB.serverAdd(x.row, x.replaces);
        else if (x.t === 'del') await KB.serverDel(x.id);
        q = KB.queue().slice(1); KB.setQueue(q);
      }
    } catch (e) { console.warn('kb flush', e); } finally { KB.flushing = false; }
  },
  async serverAdd(row, replaces) {
    const sb = window.AUTH.sb, { id: _tmp, created_at: _c, pending: _p, ...body } = row;
    const { data, error } = await sb.from('ai_client_info').insert(body).select().single(); if (error) throw error;
    const { data: cur } = await sb.from('ai_client_info').select('id, client, category, subject, party, side').eq('owner_id', KB.owner()).eq('client', row.client).is('replaced_by', null);
    const old = (data.category === 'note' || (!data.subject && !data.party)) ? [] : (cur || []).filter(r => r.id !== data.id && KB.key(r) === KB.key(data)).map(r => r.id);
    if (replaces > 0 && !old.includes(replaces)) old.push(replaces);
    if (old.length) { const { error: e2 } = await sb.from('ai_client_info').update({ replaced_by: data.id }).in('id', old); if (e2) throw e2; }
    return { row: data, old };
  },
  async serverDel(id) {
    const sb = window.AUTH.sb;
    const { error } = await sb.from('ai_client_info').delete().eq('id', id); if (error) throw error;
    await sb.from('ai_client_info').update({ replaced_by: null }).eq('replaced_by', id); // the older version comes back
  },
  // one record: online straight to the base, offline into the queue (shown at once with «⏳ ждёт связи»)
  async add(f, replaces = 0) {
    const row = { owner_id: KB.owner(), chat_id: null, source: 'crm', client: f.client, crm_client: f.crm_client || null, category: f.category, subject: f.subject || '', party: f.party || '', detail: f.detail || '',
      price: f.price ?? null, currency: f.price != null ? f.currency || 'USD' : null, unit: f.unit || '', side: f.category === 'price' ? f.side || '' : '', valid_from: f.from || null, valid_to: f.to || null };
    const local = old => { // the same replacement locally, so the page is right before the next load
      for (const r of KB.rows) if (!r.replaced_by && (old ? old.includes(r.id) : r.id !== row.id && row.category !== 'note' && (row.subject || row.party) && KB.key(r) === KB.key(row)) || (replaces && r.id === replaces)) r.replaced_by = row.id;
    };
    if (navigator.onLine !== false) {
      try { const { row: saved, old } = await KB.serverAdd(row, replaces); KB.rows.push(saved); row.id = saved.id; local(old); KB.cacheSave(); return saved; }
      catch (e) { if (KB.isNoSql(e)) { KB.noSql = true; throw new Error('Сначала выполните SQL — см. вверху страницы'); } if (!/fetch|network|Failed/i.test(String(e?.message || e))) throw e; }
    }
    row.id = -Date.now(); row.created_at = new Date().toISOString(); row.pending = true;
    KB.setQueue([...KB.queue(), { t: 'add', row, replaces }]); KB.rows.push(row); local(); KB.cacheSave();
    return row;
  },
  async del(id) {
    if (id < 0) KB.setQueue(KB.queue().filter(x => !(x.t === 'add' && x.row.id === id)));
    else if (navigator.onLine !== false) { try { await KB.serverDel(id); } catch (e) { if (!/fetch|network|Failed/i.test(String(e?.message || e))) throw e; KB.setQueue([...KB.queue(), { t: 'del', id }]); } }
    else KB.setQueue([...KB.queue(), { t: 'del', id }]);
    KB.rows = KB.rows.filter(r => r.id !== id); for (const r of KB.rows) if (r.replaced_by === id) r.replaced_by = null; KB.cacheSave();
  },

  // ---------- regions of agents: «Пользователи» (region of the account) and «Город по агентам» of the contract form ----------
  async loadRegions() {
    if (KB.regs) return;
    const m = new Map(), list = new Set();
    try { if (typeof INVO !== 'undefined') { const r = await INVO.loadRegions(); for (const [k, v] of r || []) m.set(k, v); } } catch { /* no accounts */ }
    try { const F = typeof INVO !== 'undefined' ? INVO.cfg().form || {} : {}; for (const l of String(F.cities || '').split('\n')) { const i = l.indexOf('='); if (i > 0 && l.slice(i + 1).trim()) m.set(INVO.akey(l.slice(0, i)), l.slice(i + 1).trim()); } } catch { /* no form */ }
    try { const { data } = await window.AUTH?.sb?.from('regions').select('name').order('name') || {}; for (const x of data || []) list.add(x.name); } catch { /* offline */ }
    KB.regs = m; KB.regList = [...list];
  },
  regionOf(agent) { if (!agent || !KB.regs) return ''; const k = typeof INVO !== 'undefined' ? INVO.akey(agent) : String(agent).toLowerCase(); const v = KB.regs.get(k); return v ? String(v).trim().replace(/^./, s => s.toUpperCase()) : ''; },

  // ---------- one list of clients: every CRM client + every client the base knows ----------
  NOREG: 'Регион не указан', NEWREG: 'Новые (нет в CRM)', NOAG: 'Без агента',
  build(d) {
    const by = new Map(), crmBy = new Map();
    for (const c of d.empty ? [] : d.clients) {
      const k = KB.norm(c.name);
      const e = { key: k, name: c.name, crm: c, inCrm: true, agent: c.agent || KB.NOAG, region: KB.regionOf(c.agent) || KB.NOREG, facts: [], all: [], kbName: '' };
      by.set(k, e); crmBy.set(c.name, e);
    }
    for (const r of KB.rows) {
      let e = (r.crm_client && crmBy.get(r.crm_client)) || by.get(KB.norm(r.client));
      if (!e) { const k = KB.norm(r.client); e = { key: k, name: r.client, crm: null, inCrm: false, agent: KB.NOAG, region: KB.NEWREG, facts: [], all: [], kbName: r.client }; by.set(k, e); }
      if (!e.kbName) e.kbName = r.client;
      e.all.push(r); if (!r.replaced_by) e.facts.push(r);
    }
    for (const e of by.values()) {
      e.updated = e.all.reduce((m, r) => (KB.day(r) > m ? KB.day(r) : m), '');
      e.fresh = e.facts.filter(KB.fresh).length;
      e.hay = KB.norm([e.name, e.crm?.landmark, e.crm?.phone, e.crm?.type, e.agent, ...e.facts.map(KB.factText)].filter(Boolean).join(' '));
      e.nameN = KB.norm(e.name);
    }
    return [...by.values()];
  },
  group(list, field) {
    const m = new Map();
    for (const e of list) { const g = m.get(e[field]) || { name: e[field], n: 0, filled: 0, fresh: 0, updated: '' }; g.n++; if (e.facts.length) g.filled++; g.fresh += e.fresh ? 1 : 0; if (e.updated > g.updated) g.updated = e.updated; m.set(e[field], g); }
    return [...m.values()];
  },
  search(list, q) {
    const qn = KB.norm(q), words = qn.split(' ').filter(Boolean); if (!words.length) return [];
    const out = [];
    for (const e of list) {
      let s = 0;
      if (e.nameN === qn) s = 100; else if (e.nameN.startsWith(qn)) s = 90; else if (words.every(w => e.nameN.includes(w))) s = 80;
      else if (words.every(w => e.hay.includes(w))) s = 60;
      else { const d = Math.max(KB.dice(qn, e.nameN), ...e.nameN.split(' ').map(t => KB.dice(qn, t))); if (d >= 0.6) s = 40 * d; }
      if (s) out.push({ e, s: s + (e.facts.length ? 3 : 0) });
    }
    return out.sort((a, b) => b.s - a.s || (b.e.updated || '').localeCompare(a.e.updated || '')).slice(0, 40).map(x => x.e);
  },
  hit(e, q) { const w = KB.norm(q).split(' ').filter(Boolean); if (!w.length || w.every(x => e.nameN.includes(x))) return null; return e.facts.find(r => w.some(x => KB.norm(KB.factText(r)).includes(x))) || null; },

  // ---------- address: #/kb?r=Region&a=Agent&c=Client ----------
  params() { const i = location.hash.indexOf('?'); return Object.fromEntries(new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1))); },
  href(p) { const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString(); return '#/kb' + (s ? '?' + s : ''); },

  hl(text, q) {
    const t = esc(text), w = String(q || '').trim(); if (!w) return t;
    const i = String(text).toLowerCase().indexOf(w.toLowerCase());
    return i < 0 ? t : esc(String(text).slice(0, i)) + '<mark>' + esc(String(text).slice(i, i + w.length)) + '</mark>' + esc(String(text).slice(i + w.length));
  },
  chips(e) { const s = [...new Set(e.facts.filter(r => ['supplier', 'oil'].includes(r.category)).map(r => r.party || r.subject).filter(Boolean))].slice(0, 4); return s.map(x => `<span class="kb-chip">${esc(x)}</span>`).join(''); },
  row(e, q = '') {
    const sub = [e.inCrm ? e.agent : 'нет в CRM', e.region !== KB.NOREG && e.region !== KB.NEWREG ? e.region : '', e.crm?.landmark].filter(Boolean).map(esc).join(' · '), h = q && KB.hit(e, q);
    return `<a class="kb-row" href="${KB.href({ c: e.name })}"><div class="kb-av${e.facts.length ? ' on' : ''}">${esc((e.name.match(/\p{L}/u) || ['?'])[0].toUpperCase())}</div>
      <div class="kb-rm"><div class="kb-rn">${KB.hl(e.name, q)}${e.fresh ? ' <span class="kb-new">новое</span>' : ''}</div><div class="kb-rs">${sub}</div>
      ${h ? `<div class="kb-rh">${KB.cat(h.category)[1]} ${KB.hl(KB.factText(h), q.split(' ').find(w => KB.norm(KB.factText(h)).includes(KB.norm(w))) || '')}</div>` : e.facts.length ? `<div class="kb-rc">${KB.chips(e)}</div>` : ''}</div>
      <div class="kb-rr">${e.facts.length ? `<b>${e.facts.length}</b><small>${UI.dm(e.updated)}</small>` : '<small class="mut">пусто</small>'}</div></a>`;
  },
  tile(href, name, g, sub = '') {
    const pct = g.n ? Math.round(g.filled / g.n * 100) : 0;
    return `<a class="kb-tile" href="${href}"><div class="kb-tn">${esc(name)}${g.fresh ? ` <span class="kb-new">${g.fresh} нов.</span>` : ''}</div>
      <div class="kb-tv">${g.n} <small>${UI.plural(g.n, 'клиент', 'клиента', 'клиентов')}</small></div>
      <div class="kb-bar"><i style="width:${pct}%"></i></div><div class="kb-ts">досье: ${g.filled} (${pct}%)${g.updated ? ' · ' + UI.dm(g.updated) : ''}${sub}</div></a>`;
  },
};

// ---------- the page ----------
window.EXT_PAGES.kb = async el => {
  const P = KB.params(), f = UI.fmt0;
  if (!KB.loaded) KB.cacheLoad();
  el.innerHTML = `<div class="kb">
    <div class="page-head"><div><h2>База клиентов</h2><div class="sub" id="kbSub">Загрузка…</div></div>
      <div class="actions"><button class="btn gray" id="kbXl" type="button">⬇ Excel</button><button class="btn gray" id="kbRe" type="button" title="Обновить из базы">🔄</button><button class="btn" id="kbNew" type="button">＋ Клиент</button></div></div>
    <div class="kb-search"><input id="kbQ" type="search" placeholder="Поиск: имя клиента, ориентир, телефон, бренд, поставщик…" autocomplete="off" enterkeyhint="search" aria-label="Поиск клиента"><span class="kb-qx" id="kbQx" hidden>✕</span></div>
    <div id="kbMsg"></div><div id="kbBody"><div class="soon">Загрузка…</div></div></div>`;
  const body = $('#kbBody', el), q = $('#kbQ', el);
  q.value = KB.q;
  const [d] = await Promise.all([REP.load(), KB.loadRegions()]);
  let list = KB.build(d);

  const head = () => {
    const facts = KB.rows.filter(r => !r.replaced_by).length, n = list.filter(e => e.facts.length).length, pend = KB.queue().length;
    $('#kbSub', el).innerHTML = `${list.length} клиентов · досье у ${n} · записей ${facts}${KB.at ? ` · обновлено ${new Date(KB.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}${pend ? ` · <b>⏳ ${pend} ждут связи</b>` : ''}`;
    const msg = $('#kbMsg', el);
    msg.innerHTML = KB.noSql ? `<div class="panel kb-warn"><b>Нужно один раз включить базу клиентов в CRM.</b> Откройте Supabase → SQL Editor, вставьте SQL и нажмите Run. Записи JUMAVOY сохранятся.
        <div class="bar" style="margin-top:8px"><button class="btn" id="kbSql" type="button">📋 Скопировать SQL</button><a class="btn gray" href="https://supabase.com/dashboard/project/oxchgcfyzszemqlvdjjr/sql/new" target="_blank" rel="noopener">Открыть SQL Editor</a></div></div>`
      : KB.err ? `<div class="panel kb-warn">${esc(KB.err)}</div>` : navigator.onLine === false ? '<div class="panel kb-warn">Нет интернета — показана сохранённая копия. Новые записи уйдут в базу, когда связь вернётся.</div>' : '';
    const sq = $('#kbSql', el); if (sq) sq.onclick = async () => {
      try { const t = await (await fetch('supabase/migrations/' + KB.SQL, { cache: 'no-cache' })).text(); await navigator.clipboard.writeText(t); toast('SQL скопирован — вставьте в SQL Editor и нажмите Run'); }
      catch { toast('Не удалось скопировать: откройте файл supabase/migrations/' + KB.SQL + ' на GitHub'); }
    };
  };

  const crumbs = () => {
    const c = P.c && list.find(e => e.name === P.c), r = P.r || c?.region, a = P.a || (c?.inCrm ? c.agent : '');
    const parts = [`<a href="#/kb">Все регионы</a>`];
    if (r) parts.push(`<a href="${KB.href({ r })}">${esc(r)}</a>`);
    if (a && r !== KB.NEWREG) parts.push(`<a href="${KB.href({ r, a })}">${esc(a)}</a>`);
    if (c) parts.push(`<span>${esc(c.name)}</span>`);
    return parts.length > 1 ? `<nav class="kb-crumbs">${parts.join('<i>›</i>')}</nav>` : '';
  };

  // level 0: regions + the latest records
  const regionsView = () => {
    const G = KB.group(list, 'region'), names = [...new Set([...KB.regList, ...G.map(g => g.name)])];
    const order = n => (n === KB.NEWREG ? 2 : n === KB.NOREG ? 1 : 0);
    names.sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'ru'));
    const last = KB.rows.filter(r => !r.replaced_by).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12);
    const ent = r => list.find(e => e.all.includes(r));
    return `<div class="kb-tiles">${names.map(n => KB.tile(KB.href({ r: n }), n, G.find(g => g.name === n) || { n: 0, filled: 0, fresh: 0 }, n === KB.NOREG ? '<br><span class="mut">агенту не задан регион — «Настройки → Пользователи»</span>' : '')).join('')}</div>
      ${UI.panel('🆕 Последние записи', last.length ? `<div class="kb-feed">${last.map(r => { const e = ent(r); return `<a class="kb-fi" href="${KB.href({ c: e?.name || r.client })}"><span class="kb-fc">${KB.cat(r.category)[1]}</span><div><b>${esc(e?.name || r.client)}</b> <small class="mut">${UI.dm(KB.day(r))} · ${r.source === 'crm' ? 'CRM' : 'JUMAVOY'}</small><div>${esc(KB.factText(r))}</div></div></a>`; }).join('')}</div>`
        : '<p class="mut" style="margin:0">Пока пусто. Расскажите JUMAVOY о клиенте — голосом, по-узбекски или по-русски: <i>«Fozilxon Mobil 5W-40 ni Ravshan Oildan 14.5 dollardan oladi, 16 dan sotadi, oyiga 40 karobka moy oladi»</i> — запись появится здесь. Или откройте клиента и нажмите «＋ Записать».</p>', { cls: 'w12' })}`;
  };
  // level 1: agents of a region
  const agentsView = r => {
    const mine = list.filter(e => e.region === r);
    if (r === KB.NEWREG) return clientsView(mine, '');
    const G = KB.group(mine, 'agent').sort((a, b) => (a.name === KB.NOAG) - (b.name === KB.NOAG) || b.n - a.n);
    return G.length ? `<div class="kb-tiles">${G.map(g => KB.tile(KB.href({ r, a: g.name }), g.name, g)).join('')}</div>` : UI.empty('В этом регионе клиентов пока нет', 'Клиенты появятся после загрузки LINKO или когда вы расскажете о новом клиенте JUMAVOY.');
  };
  // level 2: clients of an agent
  const clientsView = (mine, a) => {
    const F = { all: ['Все', () => true], filled: ['С досье', e => e.facts.length], empty: ['Без досье', e => !e.facts.length], fresh: ['🆕 Новое', e => e.fresh] };
    const shown = mine.filter(F[KB.filter]?.[1] || F.all[1]).sort((x, y) => (y.updated || '').localeCompare(x.updated || '') || x.name.localeCompare(y.name, 'ru'));
    return `<div class="kb-filt">${Object.entries(F).map(([k, [t, fn]]) => `<button type="button" class="kb-fb${KB.filter === k ? ' on' : ''}" data-f="${k}">${t} <small>${mine.filter(fn).length}</small></button>`).join('')}</div>
      <div class="kb-list">${shown.map(e => KB.row(e)).join('') || '<p class="mut" style="padding:14px">Нет клиентов под этот фильтр.</p>'}</div>`;
  };

  // level 3: the dossier
  const dossier = e => {
    const c = e.crm, fresh = e.facts.filter(KB.fresh), prevOf = r => e.all.filter(x => x.replaced_by === r.id).sort((a, b) => b.id - a.id)[0];
    const ph = c?.phone || (typeof LX !== 'undefined' && c ? LX.phone(c.name) : '');
    const factLi = (r, opts = {}) => {
      const p = prevOf(r), hist = e.all.filter(x => x.replaced_by && KB.key(x) === KB.key(r)).length;
      const price = r.price != null ? `<div class="kb-price">${r.side ? `<span class="kb-side ${r.side}">${KB.SIDE[r.side]}</span>` : ''}<b>${esc(KB.priceText(r))}</b>${p && p.price != null ? `<s>${esc(KB.priceText(p))}</s>` : ''}</div>` : '';
      const title = [r.subject, r.party].filter(Boolean);
      return `<li class="kb-f${r.pending ? ' pend' : ''}"><div class="kb-fm">${opts.cat ? `<span class="kb-fcat">${KB.cat(r.category)[1]} ${KB.cat(r.category)[2]}</span>` : ''}
          ${title.length ? `<div class="kb-ft">${r.subject ? `<b>${esc(r.subject)}</b>` : ''}${r.subject && r.party ? ' · ' : ''}${r.party ? esc(r.party) : ''}</div>` : ''}${price}
          ${r.detail ? `<div class="kb-fd">${esc(r.detail)}</div>` : ''}${p && p.price == null && (p.detail || '') !== (r.detail || '') ? `<div class="kb-was">было: ${esc(p.detail || p.party || p.subject)}</div>` : ''}
          <div class="kb-fx">${r.valid_from || r.valid_to ? `<span>${r.valid_from ? 'с ' + UI.dateRu(r.valid_from) : ''}${r.valid_to ? ' до ' + UI.dateRu(r.valid_to) : ''}</span>` : ''}<span>${r.pending ? '⏳ ждёт связи' : UI.dateRu(KB.day(r)) + ' · ' + (r.source === 'crm' ? 'CRM' : 'JUMAVOY')}</span>${KB.fresh(r) ? '<span class="kb-new">новое</span>' : ''}${hist ? `<a href="#" data-h="${r.id}">🕘 история (${hist})</a>` : ''}</div></div>
        <div class="kb-fa"><button class="btn gray sm" data-ed="${r.id}" type="button" title="Новое значение (старое уйдёт в историю)">✏️</button><button class="btn gray sm" data-del="${r.id}" type="button" title="Удалить ошибочную запись">✕</button></div></li>`;
    };
    const cats = KB.CATS.filter(([k]) => e.facts.some(r => r.category === k));
    const missing = ['price', 'supplier', 'volume', 'contract', 'contact'].filter(k => !e.facts.some(r => r.category === k));
    const timeline = e.all.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return `<div class="kb-dh panel"><div class="kb-dn"><h3>${esc(e.name)}</h3>
        <div class="mut">${[e.inCrm ? 'Агент: ' + e.agent : 'Нет в CRM — записан со слов', e.region !== KB.NEWREG && e.region !== KB.NOREG ? e.region : '', c?.landmark, c?.type].filter(Boolean).map(esc).join(' · ')}</div></div>
        ${c ? `<div class="kb-dk"><div><small>Долг</small><b class="${c.debt > 0.5 ? 'neg' : ''}">$${f(c.debt)}</b></div><div><small>Последняя покупка</small><b>${c.lastBuy ? UI.dateRu(c.lastBuy) : '—'}</b></div><div><small>Продано за период</small><b>$${f(c.sold || 0)}</b></div></div>` : ''}
        <div class="bar kb-da">${ph ? `<a class="btn gray" href="tel:${esc(ph)}">📞 ${esc(ph)}</a>` : ''}${c ? '<button class="btn gray" id="kbCard" type="button">📊 Карточка CRM</button>' : ''}<button class="btn" id="kbAdd" type="button">＋ Записать</button></div></div>
      <div class="kb-quick panel"><textarea id="kbQt" rows="2" placeholder="Быстро записать: что нового о клиенте (цена, договор, с кем работает, что любит)…"></textarea>
        <div class="kb-qr"><select id="kbQc" aria-label="Раздел">${KB.CATS.map(([k, i, t]) => `<option value="${k}" ${k === 'note' ? 'selected' : ''}>${i} ${t}</option>`).join('')}</select><button class="btn" id="kbQs" type="button">Записать</button></div>
        <small class="mut">Цены и договоры удобнее через «＋ Записать» или голосом JUMAVOY — он сам разложит по разделам.</small></div>
      ${fresh.length && fresh.length < e.facts.length ? UI.panel(`🆕 Новое за ${KB.FRESH_DAYS} дней`, `<ul class="kb-fl kb-fn">${fresh.sort((a, b) => b.id - a.id).slice(0, 8).map(r => { const p = prevOf(r); return `<li>${KB.cat(r.category)[1]} <b>${esc(KB.factText(r))}</b>${p ? ` <span class="mut">(было: ${esc(p.price != null ? KB.priceText(p) : p.detail || p.party || p.subject)})</span>` : ''} <small class="mut">· ${UI.dm(KB.day(r))}</small></li>`; }).join('')}</ul>`, { cls: 'w12 kb-freshp' }) : ''}
      <nav class="tabs kb-dt"><a href="#" data-dt="now" class="${KB.dtab !== 'hist' ? 'on' : ''}">Актуально (${e.facts.length})</a><a href="#" data-dt="hist" class="${KB.dtab === 'hist' ? 'on' : ''}">История (${e.all.length})</a></nav>
      ${KB.dtab === 'hist'
        ? (timeline.length ? `<ul class="kb-fl kb-tl">${timeline.map(r => `<li class="kb-f${r.replaced_by ? ' old' : ''}"><div class="kb-fm"><span class="kb-fcat">${KB.cat(r.category)[1]} ${KB.cat(r.category)[2]}</span><div class="kb-fd">${esc(KB.factText(r))}</div><div class="kb-fx"><span>${UI.dateRu(KB.day(r))} · ${r.source === 'crm' ? 'CRM' : 'JUMAVOY'}</span>${r.replaced_by ? '<span>заменено новым</span>' : '<span class="pos">актуально</span>'}</div></div></li>`).join('')}</ul>` : '<p class="mut">Записей нет.</p>')
        : (cats.length ? `<div class="kb-cats">${cats.map(([k, i, t]) => `<section class="panel kb-cat"><h4>${i} ${t}</h4><ul class="kb-fl">${e.facts.filter(r => r.category === k).sort((a, b) => b.id - a.id).map(r => factLi(r)).join('')}</ul></section>`).join('')}</div>` : '')
          + (missing.length ? `<div class="kb-miss">Ещё не записано: ${missing.map(k => `<button type="button" class="kb-chip btnlike" data-addc="${k}">${KB.cat(k)[1]} ${KB.cat(k)[2]}</button>`).join('')}</div>` : '')}`;
  };

  // the form: one record (new, or a new version of an old one)
  const form = (e, pre = {}, replaces = 0) => {
    const r = pre, m = modal(`<h3>${replaces ? 'Новое значение' : 'Записать'}: ${esc(e?.name || 'новый клиент')}</h3>
      <div class="form kb-form">${e ? '' : '<label style="grid-column:1/-1">Клиент (точка, магазин, автосервис)<input id="fCl" placeholder="как называете клиента"></label>'}
        <label style="grid-column:1/-1">Раздел<select id="fC">${KB.CATS.map(([k, i, t]) => `<option value="${k}" ${k === (r.category || 'price') ? 'selected' : ''}>${i} ${t}</option>`).join('')}</select></label>
        <label data-for="s">Что<input id="fS" value="${esc(r.subject || '')}"></label><label data-for="p">С кем<input id="fP" value="${esc(r.party || '')}"></label>
        <div data-for="side" class="kb-sides" style="grid-column:1/-1"><label><input type="radio" name="fSd" value="buy" ${r.side !== 'sell' ? 'checked' : ''}> Клиент <b>покупает</b> по этой цене</label><label><input type="radio" name="fSd" value="sell" ${r.side === 'sell' ? 'checked' : ''}> Клиент <b>продаёт</b> по этой цене</label></div>
        <label data-for="price">Цена<input id="fPr" type="number" step="0.01" min="0" inputmode="decimal" value="${r.price ?? ''}"></label>
        <label data-for="price">Валюта<select id="fCu">${['USD', 'UZS', 'RUB', 'EUR'].map(x => `<option ${x === (r.currency || 'USD') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label data-for="price">За<input id="fU" value="${esc(r.unit || 'шт')}" placeholder="шт / л / коробка / бочка"></label>
        <label style="grid-column:1/-1">Подробно<textarea id="fD" rows="3">${esc(r.detail || '')}</textarea></label>
        <label data-for="dates">С даты<input id="fF" type="date" value="${r.valid_from || ''}"></label><label data-for="dates">До даты<input id="fT" type="date" value="${r.valid_to || ''}"></label></div>
      ${replaces ? '<p class="mut" style="margin:8px 0 0">Прежнее значение не удалится — уйдёт в «Историю».</p>' : ''}
      <div class="bar" style="margin-top:12px"><span class="spacer"></span><button class="btn gray" id="fX" type="button">Отмена</button><button class="btn" id="fOk" type="button">Сохранить</button></div>`);
    const C = $('#fC', m.el), show = () => {
      const k = C.value, cat = KB.cat(k);
      m.el.querySelectorAll('[data-for]').forEach(x => { const t = x.dataset.for; x.hidden = t === 'side' || t === 'price' ? k !== 'price' && !(t === 'price' && k === 'volume') : t === 'dates' ? !['contract', 'price'].includes(k) : t === 's' ? k === 'note' : t === 'p' ? !cat[4] : false; });
      $('#fS', m.el).placeholder = cat[3]; $('#fP', m.el).placeholder = cat[4];
      $('#fD', m.el).placeholder = { contract: 'условия: отсрочка 30 дней, бонус 1 коробка с 10…', volume: 'oyiga 40 karobka / в месяц ~$3000 масел', contact: 'Бахром, +998 90 …', preference: 'любит бонус товаром, не любит долгие разговоры', price: 'условия: при оплате сразу, с бонусом…' }[k] || '';
    };
    C.onchange = show; show();
    $('#fX', m.el).onclick = m.close;
    $('#fOk', m.el).onclick = async () => {
      const k = C.value, name = e ? e.kbName || e.name : $('#fCl', m.el).value.trim();
      if (!name) return toast('Как называется клиент?');
      const pr = $('#fPr', m.el).value.trim(), fct = { client: name, crm_client: e?.inCrm ? e.name : null, category: k, subject: $('#fS', m.el).value.trim(), party: $('#fP', m.el).value.trim(), detail: $('#fD', m.el).value.trim(),
        price: (k === 'price' || k === 'volume') && pr !== '' ? Number(pr) : null, currency: $('#fCu', m.el).value, unit: $('#fU', m.el).value.trim(), side: k === 'price' ? m.el.querySelector('[name=fSd]:checked')?.value : '',
        from: ['contract', 'price'].includes(k) ? $('#fF', m.el).value : '', to: ['contract', 'price'].includes(k) ? $('#fT', m.el).value : '' };
      if (!fct.subject && !fct.party && !fct.detail && fct.price == null) return toast('Заполните хотя бы одно поле');
      $('#fOk', m.el).disabled = true;
      try { await KB.add(fct, replaces); m.close(); toast(navigator.onLine === false ? 'Записано — уйдёт в базу, когда появится интернет' : 'Записано'); location.hash = KB.href({ c: e ? e.name : name }); route(); }
      catch (err) { $('#fOk', m.el).disabled = false; toast(err.message || String(err)); }
    };
  };

  const draw = () => {
    head();
    const s = KB.q.trim();
    $('#kbQx', el).hidden = !s;
    let html;
    if (s) {
      const res = KB.search(list, s);
      html = `<div class="kb-list kb-res">${res.map(e => KB.row(e, s)).join('') || `<p class="mut" style="padding:14px">Ничего не найдено по «${esc(s)}». <a href="#" id="kbAddNew">＋ Записать нового клиента «${esc(s)}»</a></p>`}</div>`;
    } else if (P.c) {
      const e = list.find(x => x.name === P.c) || list.find(x => x.key === KB.norm(P.c));
      html = crumbs() + (e ? dossier(e) : UI.empty('Клиент не найден', 'Возможно, его переименовали в LINKO. Найдите через поиск сверху.'));
    } else if (P.r && P.a) html = crumbs() + clientsView(list.filter(x => x.region === P.r && x.agent === P.a), P.a);
    else if (P.r) html = crumbs() + agentsView(P.r);
    else html = regionsView();
    body.innerHTML = html;
    bind();
  };
  const bind = () => {
    body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { KB.filter = b.dataset.f; draw(); });
    body.querySelectorAll('[data-dt]').forEach(a => a.onclick = ev => { ev.preventDefault(); KB.dtab = a.dataset.dt; draw(); });
    const an = $('#kbAddNew', body); if (an) an.onclick = ev => { ev.preventDefault(); const fm = form(null); const v = KB.q.trim(); setTimeout(() => { const i = document.getElementById('fCl'); if (i) i.value = v; }, 0); return fm; };
    if (!P.c || KB.q.trim()) return;
    const e = list.find(x => x.name === P.c) || list.find(x => x.key === KB.norm(P.c)); if (!e) return;
    const byId = id => e.all.find(r => r.id === +id);
    const card = $('#kbCard', body); if (card) card.onclick = () => CARD.open(e.name);
    $('#kbAdd', body).onclick = () => form(e);
    body.querySelectorAll('[data-addc]').forEach(b => b.onclick = () => form(e, { category: b.dataset.addc }));
    body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const r = byId(b.dataset.ed); form(e, r, r.id); });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const r = byId(b.dataset.del); if (!confirm(`Удалить ошибочную запись?\n\n${KB.factText(r)}\n\nЕсли это просто новое значение — нажмите ✏️, тогда старое останется в истории.`)) return;
      try { await KB.del(r.id); toast('Удалено'); list = KB.build(d); draw(); } catch (err) { toast(err.message || String(err)); }
    });
    body.querySelectorAll('[data-h]').forEach(a => a.onclick = ev => {
      ev.preventDefault(); const r = byId(a.dataset.h), all = e.all.filter(x => KB.key(x) === KB.key(r) || x.id === r.id || x.replaced_by === r.id).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      const m = modal(`<h3>История: ${esc([r.subject, r.party].filter(Boolean).join(' · ') || KB.cat(r.category)[2])}</h3><ul class="kb-fl kb-tl">${all.map(x => `<li class="kb-f${x.replaced_by ? ' old' : ''}"><div class="kb-fm"><div class="kb-fd"><b>${esc(x.price != null ? (x.side ? KB.SIDE[x.side] + ' ' : '') + KB.priceText(x) : x.detail || x.party || x.subject)}</b>${x.price != null && x.detail ? ' · ' + esc(x.detail) : ''}</div><div class="kb-fx"><span>${UI.dateRu(KB.day(x))} · ${x.source === 'crm' ? 'CRM' : 'JUMAVOY'}</span>${x.replaced_by ? '' : '<span class="pos">сейчас</span>'}</div></div></li>`).join('')}</ul><div class="bar"><span class="spacer"></span><button class="btn gray" id="hX" type="button">Закрыть</button></div>`);
      $('#hX', m.el).onclick = m.close;
    });
    const qs = $('#kbQs', body);
    if (qs) qs.onclick = async () => {
      const t = $('#kbQt', body).value.trim(); if (!t) return toast('Напишите, что записать');
      qs.disabled = true;
      try { await KB.add({ client: e.kbName || e.name, crm_client: e.inCrm ? e.name : null, category: $('#kbQc', body).value, detail: t }); toast(navigator.onLine === false ? 'Записано — уйдёт в базу, когда появится интернет' : 'Записано'); list = KB.build(d); draw(); }
      catch (err) { qs.disabled = false; toast(err.message || String(err)); }
    };
  };

  let t = 0;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { KB.q = q.value; draw(); }, 120); };
  q.onkeydown = ev => { if (ev.key === 'Enter') { const a = body.querySelector('.kb-row'); if (a) { KB.q = ''; location.hash = a.getAttribute('href'); } } if (ev.key === 'Escape') { q.value = KB.q = ''; draw(); } };
  $('#kbQx', el).onclick = () => { q.value = KB.q = ''; draw(); q.focus(); };
  body.addEventListener('click', ev => { if (ev.target.closest('.kb-res .kb-row')) { KB.q = ''; q.value = ''; } });
  $('#kbNew', el).onclick = () => form(null);
  $('#kbRe', el).onclick = async () => { $('#kbRe', el).disabled = true; await KB.pull(); list = KB.build(d); draw(); $('#kbRe', el).disabled = false; if (!KB.err && !KB.noSql) toast('Обновлено'); };
  $('#kbXl', el).onclick = () => {
    const rows = [['Регион', 'Агент', 'Клиент', 'В CRM', 'Раздел', 'Что', 'С кем', 'Покупает / продаёт', 'Цена', 'Валюта', 'За', 'Подробно', 'С', 'До', 'Записано', 'Откуда', 'Актуально']];
    for (const e of list) for (const r of e.all.slice().sort((a, b) => a.id - b.id)) rows.push([e.region, e.agent, e.name, e.inCrm ? 'да' : 'нет', KB.cat(r.category)[2], r.subject, r.party, KB.SIDE[r.side] || '', r.price ?? '', r.price != null ? r.currency : '', r.unit, r.detail, r.valid_from || '', r.valid_to || '', KB.day(r), r.source === 'crm' ? 'CRM' : 'JUMAVOY', r.replaced_by ? 'старое' : 'да']);
    if (rows.length < 2) return toast('База пока пуста');
    UI.csv('база-клиентов-' + UI.localDate(Date.now()), rows);
  };
  if (!P.c && !KB.q && matchMedia('(min-width: 900px)').matches) q.focus();
  if (P.c) window.scrollTo(0, 0);

  draw(); // the saved copy at once, then the fresh rows from the base
  if (!KB.busy) { KB.busy = true; try { await KB.pull(); } finally { KB.busy = false; } if (document.body.contains(body)) { list = KB.build(d); draw(); } }
};
addEventListener('online', () => KB.flush().then(() => { if (/^#\/kb/.test(location.hash) && typeof route === 'function') route(); }));

(() => {
  const css = document.createElement('style');
  css.textContent = `
.kb .page-head .actions .btn{white-space:nowrap}
.kb-search{position:sticky;top:calc(var(--nav,56px) + 4px);z-index:5;margin:0 0 12px}
.kb-search input{width:100%;box-sizing:border-box;font-size:16px;min-height:46px;padding:10px 40px 10px 42px;border-radius:14px;background:var(--card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23889' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 13px 50%/18px;box-shadow:var(--shadow);color:var(--text)}
.kb-qx{position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--muted);padding:6px}
.kb-warn{border-color:#efdcae;background:#fffaf0;margin-bottom:12px;color:#5c4400}
.kb-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:14px;margin:0 0 12px}
.kb-crumbs a{color:var(--brand);text-decoration:none}.kb-crumbs i{color:var(--muted);font-style:normal;padding:0 2px}.kb-crumbs span{color:var(--text-2)}
.kb-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:14px}
.kb-tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:var(--radius,14px);padding:14px 16px;box-shadow:var(--shadow);color:var(--text);text-decoration:none;transition:transform .12s}
.kb-tile:hover{transform:translateY(-2px)}.kb-tn{font-weight:600;font-size:15px}.kb-tv{font-size:26px;font-weight:700;margin:6px 0}.kb-tv small{font-size:13px;font-weight:500;color:var(--text-2)}
.kb-bar{height:5px;border-radius:5px;background:var(--line);overflow:hidden}.kb-bar i{display:block;height:100%;background:var(--brand);border-radius:5px}
.kb-ts{font-size:12px;color:var(--muted);margin-top:6px}
.kb-new{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:9px;background:#e8f7ec;color:#1b7a36;vertical-align:middle}
.kb-filt{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.kb-fb{border:1px solid var(--line-2);background:var(--card);color:var(--text-2);border-radius:18px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
.kb-fb.on{background:var(--brand);border-color:var(--brand);color:#fff}.kb-fb small{opacity:.7}
.kb-list{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,14px);box-shadow:var(--shadow);overflow:hidden}
.kb-row{display:flex;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid var(--line);color:var(--text);text-decoration:none}
.kb-row:first-child{border-top:0}.kb-row:hover{background:var(--card-2,#f6f7fa)}
.kb-av{flex:none;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:var(--line);color:var(--text-2)}
.kb-av.on{background:var(--brand-50,#e9f1ff);color:var(--brand)}
.kb-rm{flex:1;min-width:0}.kb-rn{font-weight:600;overflow:hidden;text-overflow:ellipsis}.kb-rs{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kb-rh{font-size:13px;color:var(--text-2);margin-top:2px}.kb-rc{margin-top:4px;display:flex;gap:4px;flex-wrap:wrap}
.kb-rr{flex:none;text-align:right;display:flex;flex-direction:column;align-items:flex-end;font-size:14px}.kb-rr small{font-size:11px;color:var(--muted)}
.kb mark{background:#ffe9a8;color:inherit;border-radius:3px;padding:0 1px}
.kb-chip{display:inline-block;font-size:12px;padding:2px 8px;border-radius:10px;background:var(--brand-50,#eef3fb);color:var(--text-2);border:0}
.kb-chip.btnlike{cursor:pointer;font:inherit;font-size:12.5px;padding:5px 10px;margin:3px 4px 0 0}
.kb-feed{display:flex;flex-direction:column}.kb-fi{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px}.kb-fi:first-child{border-top:0}
.kb-fc{flex:none;width:28px;font-size:18px;text-align:center}
.kb-dh{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
.kb-dh h3{margin:0 0 4px;font-size:22px}.kb-dn{min-width:0;flex:1 1 260px}
.kb-dk{display:flex;gap:18px;flex-wrap:wrap}.kb-dk div{display:flex;flex-direction:column}.kb-dk small{color:var(--muted);font-size:12px}.kb-dk b{font-size:17px}
.kb-da{width:100%;margin:0;flex-wrap:wrap}
.kb-quick{margin-bottom:12px;display:flex;flex-direction:column;gap:8px}
.kb-quick textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;resize:vertical}
.kb-qr{display:flex;gap:8px}.kb-qr select{flex:1;min-width:0}
.kb-dt{margin:6px 0 12px}
.kb-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;align-items:start}
.kb-cat h4{margin:0 0 6px}.kb-fl{list-style:none;margin:0;padding:0}
.kb-f{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)}.kb-fl .kb-f:first-child{border-top:0}
.kb-f.pend{opacity:.75}.kb-f.old{opacity:.55}.kb-f.old .kb-fd{text-decoration:line-through}
.kb-fm{flex:1;min-width:0}.kb-fcat{font-size:12px;color:var(--muted);display:block;margin-bottom:2px}
.kb-ft{font-size:14.5px}.kb-fd{font-size:14px;color:var(--text);white-space:pre-wrap;word-break:break-word}.kb-was{font-size:12.5px;color:var(--muted)}
.kb-price{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:2px 0}.kb-price b{font-size:18px}.kb-price s{color:var(--muted);font-size:13px}
.kb-side{font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:8px}.kb-side.buy{background:#e9f1ff;color:#1d57c4}.kb-side.sell{background:#fff1e0;color:#a35a00}
.kb-fx{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:3px}.kb-fx a{color:var(--brand);text-decoration:none}
.kb-fa{flex:none;display:flex;gap:4px}.kb-fa .btn{min-height:30px;padding:3px 8px}
.kb-miss{margin-top:12px;font-size:13px;color:var(--muted)}
.kb-freshp{border-color:#bfe0c4;margin-bottom:12px}.kb-fn li{padding:5px 0;font-size:14px;border-top:1px solid var(--line)}.kb-fn li:first-child{border-top:0}
.kb-form .kb-sides{display:flex;flex-direction:column;gap:6px}.kb-form .kb-sides label{display:flex;gap:8px;align-items:center;font-weight:400}
.kb-form [hidden]{display:none!important}
[data-theme=dark] .kb-warn{background:#2b2514;color:#f3dc9a;border-color:#5a4a1c}[data-theme=dark] .kb mark{background:#6b5410}
[data-theme=dark] .kb-new{background:#173a22;color:#8fe0a8}[data-theme=dark] .kb-side.buy{background:#1a2b4d;color:#9cc0ff}[data-theme=dark] .kb-side.sell{background:#3d2a12;color:#ffc27a}
@media (max-width:640px){.kb .page-head .actions{width:100%}.kb .page-head .actions #kbNew{flex:1}.kb-tiles{grid-template-columns:1fr 1fr;gap:8px}.kb-tile{padding:11px 12px}.kb-tv{font-size:22px}
  .kb-cats{grid-template-columns:1fr}.kb-dk{gap:12px;width:100%}.kb-da .btn{flex:1 1 auto}.kb-search{top:calc(var(--nav,52px) + 2px)}}`;
  document.head.appendChild(css);
})();
