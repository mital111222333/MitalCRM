// Accounts: every person signs in with his own login and password (Supabase Auth). Roles: admin, rop, supervisor, agent, store (завсклад).
// app.js already asks /api/me, /api/login, /api/logout and /api/me/password — this file answers them from Supabase
// (static-api.js used to answer /api/me with a fixed «Вы»). Must load after static-api.js and before app.js.
// What each person may see is decided by the database (RLS), not by this page: the page only hides buttons that would be refused.
// Page «Пользователи» (#/users): the team the signed-in person can see; admin and РОП add people, set roles, regions, passwords.
window.AUTH = (() => {
  const URL_ = 'https://oxchgcfyzszemqlvdjjr.supabase.co';
  const KEY = 'sb_publishable_FlwHIDb04LSfDA18DFo_Yw_YesRxk9g'; // public key: safe in the page, the database rules protect the data
  const DOMAIN = 'mital.crm';
  const ROLE_RU = { admin: 'Администратор', rop: 'РОП', supervisor: 'Супервайзер', agent: 'Агент', store: 'Завсклад' };
  const ROLE_ORDER = { admin: 0, rop: 1, supervisor: 2, agent: 3, store: 4 };
  const CACHE = 'crm_me';
  const sb = window.supabase?.createClient ? window.supabase.createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm_auth' } }) : null;
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { profile = null; }
  const remember = p => { profile = p; try { p ? localStorage.setItem(CACHE, JSON.stringify(p)) : localStorage.removeItem(CACHE); } catch { /* storage blocked */ } };
  const email = login => (login.includes('@') ? login : `${login}@${DOMAIN}`).trim().toLowerCase();

  // the profile of the signed-in person; offline (library not loaded / no network) the last known one is used
  async function load() {
    if (!sb) return profile;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { remember(null); return null; }
    try {
      const { data, error } = await sb.from('profiles').select('id, login, full_name, role, supervisor_id, region_id, is_active').eq('id', session.user.id).maybeSingle();
      if (error) throw error;
      if (!data || !data.is_active) { await sb.auth.signOut(); remember(null); return null; }
      remember(data); return data;
    } catch (e) {
      if (profile && profile.id === session.user.id) return profile; // network trouble: keep working with the saved profile
      throw e;
    }
  }

  // what app.js expects from /api/me
  const meJson = p => ({ name: p.full_name, login: p.login, role: ROLE_RU[p.role] || p.role, crmRole: p.role, branch: '', demo: false,
    perms: ['stock.view', 'stock.edit', 'agents.view', 'agents.edit', ...(['admin', 'rop'].includes(p.role) ? ['team.view'] : [])] }); // team: the country overview and the journal

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const prevFetch = window.fetch;
  window.fetch = async (input, opts = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    let path = '';
    try { const u = new URL(raw, location.href); if (u.origin === location.origin) path = u.pathname.slice(u.pathname.indexOf('/api/')); } catch { /* not ours */ }
    if (path === '/api/me') {
      try { const p = await load(); return p ? json(meJson(p)) : json({ error: 'auth' }, 401); }
      catch { return json({ error: 'auth' }, 401); }
    }
    if (path === '/api/login') {
      if (!sb) return json({ error: 'Нет связи с сервером входа. Проверьте интернет и обновите страницу.' });
      let b = {}; try { b = JSON.parse(opts.body || '{}'); } catch { /* empty */ }
      if (!b.login || !b.password) return json({ error: 'Введите логин и пароль' });
      const { error } = await sb.auth.signInWithPassword({ email: email(String(b.login)), password: String(b.password) });
      if (error) return json({ error: /invalid/i.test(error.message) ? 'Неверный логин или пароль' : /banned/i.test(error.message) ? 'Аккаунт заблокирован. Обратитесь к администратору.' : error.message });
      try { const p = await load(); if (!p) return json({ error: 'Аккаунт не настроен: обратитесь к администратору' }); setTimeout(() => dispatchEvent(new Event('crm:login')), 0); return json({ token: 'sb', user: meJson(p) }); }
      catch (e) { return json({ error: 'Не удалось загрузить профиль: ' + (e.message || e) }); }
    }
    if (path === '/api/logout') {
      try { if (window.CLOUD?.store?.() === 'sb' && CLOUD.status().dirty) await CLOUD.sync({ quiet: true }); } catch { /* sent later */ } // unsent changes go first
      try { await sb?.auth.signOut(); } catch { /* offline */ }
      remember(null); dispatchEvent(new Event('crm:logout')); return json({ ok: true });
    }
    if (path === '/api/me/password') {
      let b = {}; try { b = JSON.parse(opts.body || '{}'); } catch { /* empty */ }
      if (!sb || !profile) return json({ error: 'Нет связи с сервером' });
      if (String(b.new || '').length < 8) return json({ error: 'Новый пароль — минимум 8 символов' });
      const check = await sb.auth.signInWithPassword({ email: email(profile.login), password: String(b.old || '') });
      if (check.error) return json({ error: 'Текущий пароль неверный' });
      const { error } = await sb.auth.updateUser({ password: String(b.new) });
      return json(error ? { error: error.message } : { ok: true });
    }
    return prevFetch(input, opts);
  };

  // calls the account server function; returns the JSON, throws a readable error
  async function admin(body) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* no body */ } throw new Error(msg); }
    return data;
  }

  const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789', v = new Uint32Array(10); crypto.getRandomValues(v); return [...v].map(x => a[x % a.length]).join(''); };

  return { sb, ROLE_RU, ROLE_ORDER, admin, genPassword, get profile() { return profile; }, role: () => profile?.role || null, isManager: () => ['admin', 'rop'].includes(profile?.role) };
})();

// ---------- page «Пользователи» ----------
window.EXT_PAGES = window.EXT_PAGES || {};
window.EXT_PAGES.users = async el => {
  const { sb, ROLE_RU, ROLE_ORDER } = AUTH;
  if (!sb) { el.innerHTML = UI.empty('Нет связи', 'Раздел работает только с интернетом.'); return; }
  el.innerHTML = '<div class="soon">Загрузка…</div>';
  const at = location.hash;
  // agent names from the CRM data of this device (only when the data is the signed-in person's own) — «Имя в LINKO» is picked from them
  const crmNames = (async () => { try { if (window.CLOUD?.gate?.() || typeof REP === 'undefined') return []; const d = await REP.load(); return d.empty ? [] : d.agents.map(a => a.agent).filter(n => n && n !== 'Без агента'); } catch { return []; } })();
  const [p, r, l, cb, names] = await Promise.all([sb.from('profiles').select('*'), sb.from('regions').select('*').order('name'), sb.from('supervisor_regions').select('*'),
    sb.from('agent_cabinets').select('agent_id, updated_at'), crmNames]);
  if (!el.isConnected || location.hash !== at) return; // the person went to another page while this one loaded: do not draw over it
  let whs = []; try { if (!window.CLOUD?.gate?.()) whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* no warehouses */ }
  const err = p.error || r.error || l.error;
  const cabAt = Object.fromEntries((cb.data || []).map(x => [x.agent_id, x.updated_at]));
  const norm = v => String(v || '').toLowerCase().replace(/[’ʻʼ`´‘]/g, "'").replace(/\s+/g, ' ').trim(), known = new Set(names.map(norm));
  // the agent's cabinet: when it was last sent, or why it cannot be
  const cabText = x => {
    if (x.role === 'store') return x.linko_name ? (cabAt[x.id] ? `<span title="последнее обновление">✓ ${new Date(cabAt[x.id]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>` : UI.pill('muted', 'ещё не отправлен')) : UI.pill('warn', 'нет склада');
    if (x.role !== 'agent') return '';
    if (!x.linko_name) return UI.pill('warn', 'нет имени в LINKO');
    if (names.length && !known.has(norm(x.linko_name))) return UI.pill('crit', 'имя не найдено в LINKO');
    return cabAt[x.id] ? `<span title="последнее обновление">✓ ${new Date(cabAt[x.id]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>` : UI.pill('muted', 'ещё не отправлен');
  };
  if (err) { el.innerHTML = UI.empty('Не удалось загрузить', esc(err.message)); return; }
  const people = p.data.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.full_name.localeCompare(b.full_name, 'ru'));
  const regions = r.data, links = l.data, byId = Object.fromEntries(people.map(x => [x.id, x])), regName = Object.fromEntries(regions.map(x => [x.id, x.name]));
  const myRole = AUTH.role(), manager = AUTH.isManager(), isAdmin = myRole === 'admin';
  const svRegions = id => links.filter(x => x.supervisor_id === id).map(x => x.region_id);
  const LEADS = ['supervisor', 'admin', 'rop']; // may lead a team of agents and have own regions
  const whereText = x => {
    if (x.role === 'agent' || x.role === 'store') return regName[x.region_id] || '—';
    const own = svRegions(x.id).map(id => regName[id]).filter(Boolean).join(', ');
    return x.role === 'supervisor' ? own || '—' : own ? `вся страна · ведёт: ${own}` : 'вся страна';
  };
  const canEdit = x => manager && (isAdmin || x.role !== 'admin');
  const seeText = { admin: 'Вы видите всех и можете всё менять.', rop: 'Вы видите всю страну и можете менять данные. Администраторов меняет только администратор.',
    supervisor: 'Вы видите себя, своих агентов и завскладов. Добавлять людей могут администратор и РОП.', agent: 'Вы видите себя и своего супервайзера.', store: 'Вы видите себя и своего супервайзера.' }[myRole] || '';

  el.innerHTML = `<div class="page-head"><div><h2>Пользователи</h2><div class="sub">${esc(seeText)}</div></div>
      <div class="tools">${names.length ? '<button class="btn gray" id="ucab" title="Отправить агентам их кабинеты сейчас, не дожидаясь новых данных">↻ Обновить кабинеты агентов</button>' : ''}${manager ? '<button class="btn" id="uadd">+ Добавить человека</button>' : ''}<button class="btn gray" id="uout">Выйти из аккаунта</button></div></div>
    <div class="grid">
    ${UI.panel('Команда', `<div class="tscroll"><table><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Супервайзер</th><th>Регион</th><th>Имя в LINKO</th><th>Кабинет</th><th>Статус</th>${manager ? '<th></th>' : ''}</tr></thead><tbody>
      ${people.map(x => `<tr${x.is_active ? '' : ' class="mut"'}><td><b>${esc(x.full_name)}</b>${x.id === AUTH.profile?.id ? ' <span class="mut">(вы)</span>' : ''}</td><td>${esc(x.login)}</td><td>${esc(ROLE_RU[x.role])}</td>
        <td>${esc(byId[x.supervisor_id]?.full_name || '')}</td><td>${esc(whereText(x))}</td><td>${esc(x.linko_name || '')}</td><td>${cabText(x)}</td>
        <td>${x.is_active ? UI.pill('good', 'активен') : UI.pill('crit', 'заблокирован')}</td>
        ${manager ? `<td>${canEdit(x) ? `<button class="btn gray sm" data-edit="${x.id}">Изменить</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`, { sub: `${people.length} ${UI.plural(people.length, 'человек', 'человека', 'человек')}` })}
    ${UI.panel('Регионы', `<p class="mut" style="margin-top:0">${regions.map(x => `${esc(x.name)}${x.status === 'opening' ? ' <span class="mut">(открывается)</span>' : ''}`).join(' · ') || 'Нет регионов'}</p>
      ${manager ? '<div class="bar"><input id="rname" placeholder="Новый регион, например Самарканд" style="flex:1"><select id="rstat"><option value="active">работает</option><option value="opening">открывается</option></select><button class="btn gray" id="radd">Добавить регион</button></div>' : ''}`, { cls: 'w12' })}
    </div>`;

  const again = () => EXT_PAGES.users(el);
  const cbBtn = $('#ucab', el);
  if (cbBtn) cbBtn.onclick = async () => {
    cbBtn.disabled = true;
    try {
      const r = await AC.publishDb({ force: true });
      const st = typeof WC !== 'undefined' && WC.publishSb ? await WC.publishSb({ force: true }).catch(e => { toast('Завсклад: ' + (e.message || e)); return 0; }) : 0;
      toast(`Кабинетов отправлено: ${r.n}${st ? ` + завсклад: ${st}` : ''}` + (r.missing?.length ? `. Не найдены в LINKO: ${r.missing.join(', ')} — исправьте «Имя в LINKO»` : ''));
      again();
    } catch (e) { toast('Не удалось: ' + (e.message || e)); cbBtn.disabled = false; }
  };
  $('#uout', el).onclick = async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch { /* offline */ } signOut(); };

  if (manager) {
    $('#radd', el).onclick = async () => {
      const name = $('#rname', el).value.trim(); if (!name) return;
      const { error } = await sb.from('regions').insert({ name, status: $('#rstat', el).value });
      if (error) return toast(/duplicate/i.test(error.message) ? 'Такой регион уже есть' : error.message);
      again();
    };
    $('#uadd', el).onclick = () => form(null);
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(byId[b.dataset.edit]));
  }

  function form(x) {
    const isNew = !x, sups = people.filter(s => LEADS.includes(s.role) && s.is_active && (s.role === 'supervisor' || svRegions(s.id).length));
    const roleOpts = Object.entries(ROLE_RU).filter(([k]) => isAdmin || k !== 'admin');
    const mine = x ? svRegions(x.id) : [];
    const team = x && LEADS.includes(x.role) ? people.filter(t => t.supervisor_id === x.id && t.is_active) : []; // his agents and store keepers
    const m = modal(`<h3>${isNew ? 'Новый человек' : esc(x.full_name)}</h3>
      <div class="form">
        <label>Имя и фамилия<input id="f_name" value="${esc(x?.full_name || '')}"></label>
        ${isNew ? `<label>Логин для входа (латиницей)<input id="f_login" placeholder="например aziz.karimov" autocomplete="off"></label>
          <label>Пароль (минимум 8 символов)<span class="bar" style="margin:0"><input id="f_pass" value="${AUTH.genPassword()}" autocomplete="off" style="flex:1"><button class="btn gray sm" type="button" id="f_gen">Другой</button></span></label>` : `<label>Логин<input value="${esc(x.login)}" disabled></label>`}
        <label>Роль<select id="f_role" ${x && x.id === AUTH.profile?.id ? 'disabled' : ''}>${roleOpts.map(([k, v]) => `<option value="${k}" ${(x?.role || 'agent') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div id="f_agent"><label>Супервайзер<select id="f_sv"><option value="">— выберите —</option>${sups.map(s => `<option value="${s.id}" ${x?.supervisor_id === s.id ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('')}</select></label>
          <label>Регион<select id="f_reg"><option value="">— выберите —</option>${regions.map(g => `<option value="${g.id}" ${x?.region_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label></div>
        <div id="f_sup"><label>Регионы, которые он ведёт сам (его команда агентов)</label>${regions.map(g => `<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-reg="${g.id}" ${mine.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div>
        <label id="f_linkoL">Имя в LINKO (выберите из списка — по нему агент получает свой кабинет)<input id="f_linko" list="f_names" autocomplete="off" value="${esc(x?.linko_name || '')}"></label>
        <datalist id="f_names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <datalist id="f_whs">${whs.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <label>Телефон<input id="f_phone" value="${esc(x?.phone || '')}"></label>
        ${team.length ? `<label style="grid-column:1/-1">Если он перестанет быть руководителем или будет заблокирован, его люди (${team.length}: ${esc(team.map(t => t.full_name).join(', '))}) перейдут к
          <select id="f_hand"><option value="">— выберите —</option>${sups.filter(s => s.id !== x.id).map(s => `<option value="${s.id}">${esc(s.full_name)}</option>`).join('')}</select></label>` : ''}
      </div><small id="f_err" class="neg" role="alert"></small>
      ${isNew ? '<p class="mut" style="margin:8px 0 0">Запишите логин и пароль и передайте человеку лично. Пароль он сможет сменить сам: клик по своему имени вверху.</p>' : ''}
      <div class="bar" style="margin-top:12px">${!isNew && x.id !== AUTH.profile?.id ? `<button class="btn gray" id="f_pw">Новый пароль</button><button class="btn ${x.is_active ? 'danger' : 'gray'}" id="f_act">${x.is_active ? 'Заблокировать' : 'Разблокировать'}</button>` : ''}
        <span class="spacer"></span><button class="btn gray" id="f_x">Закрыть</button><button class="btn" id="f_ok">${isNew ? 'Создать' : 'Сохранить'}</button></div>`);
    const q = s => $(s, m.el);
    // a store keeper: supervisor + his warehouse (in «Имя в LINKO» — the warehouse name, picked from the CRM warehouses)
    const sync = () => { const role = q('#f_role').value, st = role === 'store'; q('#f_agent').hidden = role !== 'agent' && !st; q('#f_sup').hidden = !LEADS.includes(role);
      q('#f_linkoL').firstChild.textContent = st ? 'Склад завсклада (как в LINKO — выберите из списка)' : 'Имя в LINKO (выберите из списка — по нему агент получает свой кабинет)';
      q('#f_linko').setAttribute('list', st ? 'f_whs' : 'f_names'); };
    q('#f_role').onchange = sync; sync();
    if (isNew) q('#f_gen').onclick = () => { q('#f_pass').value = AUTH.genPassword(); };
    q('#f_x').onclick = m.close;
    const busy = async (btn, fn) => { btn.disabled = true; q('#f_err').textContent = ''; try { await fn(); } catch (e) { q('#f_err').textContent = e.message || String(e); } finally { btn.disabled = false; } };
    q('#f_ok').onclick = () => busy(q('#f_ok'), async () => {
      const body = { full_name: q('#f_name').value, role: q('#f_role').value, linko_name: q('#f_linko').value, phone: q('#f_phone').value,
        supervisor_id: q('#f_sv').value || null, region_id: q('#f_reg').value || null, region_ids: [...m.el.querySelectorAll('[data-reg]:checked')].map(c => c.dataset.reg) };
      if (isNew) await AUTH.admin({ action: 'create', login: q('#f_login').value, password: q('#f_pass').value, ...body });
      else await AUTH.admin({ action: 'update', id: x.id, ...body, reassign_to: q('#f_hand')?.value || null });
      m.close(); toast(isNew ? 'Аккаунт создан' : 'Сохранено'); again();
    });
    if (!isNew && x.id !== AUTH.profile?.id) {
      q('#f_pw').onclick = () => busy(q('#f_pw'), async () => {
        const pw = prompt('Новый пароль для ' + x.full_name + ' (минимум 8 символов):', AUTH.genPassword()); if (!pw) return;
        await AUTH.admin({ action: 'set_password', id: x.id, password: pw }); toast('Пароль изменён. Передайте его человеку лично.');
      });
      q('#f_act').onclick = () => busy(q('#f_act'), async () => {
        if (x.is_active && !confirm(`Заблокировать ${x.full_name}? Он не сможет войти, пока вы не разблокируете.`)) return;
        await AUTH.admin({ action: 'set_active', id: x.id, active: !x.is_active, reassign_to: q('#f_hand')?.value || null }); m.close(); again();
      });
    }
  }
};
