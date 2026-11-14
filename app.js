// Frontend: hash router + menu mirroring LINKO. Add a screen = add a MENU entry + a PAGES function.
const $ = (s, el = document) => el.querySelector(s);
const fmt = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const cls = n => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let token = localStorage.getItem('token');
// Selected branch ('' = all). Sent as X-Branch (URL-encoded: header values must be ASCII-safe) with every API call.
let branch = '';
try { branch = localStorage.getItem('branch') || ''; } catch { /* storage unavailable */ }

// Current user from /api/me: {name, login, role, branch, perms[]}. The server enforces everything; the UI only hides what would be refused.
let me = null;
const can = p => !!me && me.perms.includes(p);

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
function signOut() { token = null; me = null; try { localStorage.removeItem('token'); } catch { /* ignore */ } render(); }

async function api(url, opts = {}) {
  let r;
  try { r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Branch': encodeURIComponent(branch) }, body: opts.body && JSON.stringify(opts.body) }); }
  catch (e) { toast('Нет связи с сервером. Запустите start.bat и не закрывайте его окно.'); throw e; } // the server window was closed or never started
  if (r.status === 401) { signOut(); throw new Error('auth'); }
  const data = await r.json();
  if (r.status === 403) toast(data.error || 'Недостаточно прав');
  return data;
}

// route -> permission section. A page needs "<section>.view"; write buttons are hidden (body.ro) without "<section>.edit".
const PAGE_PERM = { wh: 'stock', whstock: 'stock', whlow: 'stock', whmove: 'stock', whup: 'stock', agents: 'agents', leaders: 'agents', aclients: 'agents', atasks: 'agents', aup: 'agents' };
const DEMO_ROUTES = [];
const canOpen = r => (!DEMO_ROUTES.includes(r) || me?.demo !== false) && (!PAGE_PERM[r] || can(PAGE_PERM[r] + '.view'));
const landing = () => ['my', 'rday', 'agents', 'wh'].find(canOpen);

// Menu: your own data first (warehouse stock, agents), then the demo sections that mirror the old LINKO menu. top item -> groups -> [title, route]
const MENU = {};
if (window.EXT_MENU) { for (const k of Object.keys(MENU)) delete MENU[k]; Object.assign(MENU, window.EXT_MENU); } // static (serverless) version: its own, shorter menu

const table = (heads, rows) => `<table><thead><tr>${heads.map(([h, n]) => `<th class="${n ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const money = v => `<td class="n ${cls(v)}">${fmt(v)}</td>`;

function modal(html) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = e => { if (e.target === bg) bg.remove(); }; // a handler returning false would cancel clicks on checkboxes inside
  document.body.appendChild(bg);
  return { el: bg.firstChild, close: () => bg.remove() };
}

const today = () => new Date().toISOString().slice(0, 10);
const dm = d => d.slice(8) + '.' + d.slice(5, 7);
const PAGES = {
  soon: el => el.innerHTML = '<div class="soon">Этот раздел ещё не реализован</div>',
};
Object.assign(PAGES, window.EXT_PAGES); // warehouse and agents pages (wh.js, ag.js)

function profileModal() {
  const m = modal(`<h3>Профиль</h3><p><b>${esc(me.name)}</b> · ${esc(me.login)}<br>Роль: ${esc(me.role)}<br>Филиал: ${esc(me.branch || 'все филиалы')}</p>
    <h4>Сменить пароль</h4><div class="form"><label>Текущий пароль<input id="po" type="password" autocomplete="current-password"></label><label>Новый пароль (минимум 8 символов)<input id="pn" type="password" autocomplete="new-password"></label>
    <label>Повторите новый пароль<input id="pr" type="password" autocomplete="new-password"></label></div><small id="err" class="neg"></small>
    <div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Закрыть</button><button class="btn" id="pwok">Сменить пароль</button></div>`);
  $('#x', m.el).onclick = m.close;
  $('#pwok', m.el).onclick = async () => {
    if ($('#pn', m.el).value !== $('#pr', m.el).value) return $('#err', m.el).textContent = 'Новые пароли не совпадают';
    const d = await api('/api/me/password', { method: 'POST', body: { old: $('#po', m.el).value, new: $('#pn', m.el).value } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); toast('Пароль изменён. Другие устройства выйдут из системы.');
  };
}

function render() {
  const app = $('#app');
  if (!token || !me) {
    app.innerHTML = `<form class="login"><h3>Вход</h3><input name="login" placeholder="Логин" autocomplete="username" autofocus><input name="password" type="password" placeholder="Пароль" autocomplete="current-password"><button class="btn">Войти</button><small id="err" class="neg" role="alert"></small></form>`;
    $('form').onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: e.target.login.value, password: e.target.password.value }) });
      const d = await r.json();
      if (!d.token) return $('#err').textContent = d.error;
      token = d.token; me = d.user; try { localStorage.setItem('token', token); } catch { /* ignore */ }
      if (me.branch) branch = ''; // a locked user is always scoped by the server
      location.hash = '#/' + (landing() || 'home'); render();
    };
    return;
  }
  // left sidebar (computer) / drawer + bottom tab bar (phone)
  const sections = Object.entries(MENU).map(([top, groups]) => {
    const items = Object.values(groups).flat().filter(([, r]) => canOpen(r) && !(window.MENU_HIDDEN && MENU_HIDDEN(r)));
    return items.length ? `<div class="sgrp"><div class="sh">${esc(top.replace(/^[^\p{L}]+/u, ''))}</div>${items.map(([t, r]) => `<a href="#/${r}" data-r="${r}">${esc(t.replace(/^[^\p{L}]+/u, ''))}</a>`).join('')}</div>` : '';
  }).join('');
  const ICON = {
    up: '<path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14"/>',
    rday: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
    leaders: '<path d="M8 21h8m-4-4v4m-6-17h12v5a6 6 0 0 1-12 0zM6 6H3a3 3 0 0 0 3 4m12-4h3a3 3 0 0 1-3 4"/>',
    amap: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14"/>',
    more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    my: '<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
    collect: '<path d="M12 3v18M16.5 7.5C16.5 5.6 14.5 5 12 5S7.5 5.8 7.5 8s2 3 4.5 3.5 4.5 1.3 4.5 3.5-2 3-4.5 3-4.5-.6-4.5-2.5"/>',
    lxpay: '<path d="M3 7h18v10H3zM3 11h18M7 15h3"/>',
    lxday: '<path d="M6 6h15l-2 8H7zM6 6 5 3H2M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1"/>',
    agents: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0m1-10a3 3 0 1 0 0-6m2 16h3a6 6 0 0 0-4-5.6"/>',
  };
  const tab = (r, t) => `<a href="#/${r}" data-r="${r}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[r]}</svg><span>${t}</span></a>`;
  app.innerHTML = `<aside class="side" id="side" aria-label="Разделы"><a class="brandmark" href="#/${landing() || 'home'}"><b>mital</b><span>CRM супервайзера</span></a><nav class="sidenav">${sections}</nav></aside>
    <div class="shell"><nav class="top"><button class="burger" id="burger" aria-label="Меню" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.more}</svg></button><a class="logo" href="#/${landing() || 'home'}">mital</a><span class="crumb" id="crumb"></span><span class="spacer"></span>
    ${me.branch ? `<span class="branchlock" title="Ваш доступ ограничен этим филиалом">Филиал: ${esc(me.branch)}</span>` : '<select id="branch" class="branch" title="Филиал" aria-label="Филиал"><option value="">Все филиалы</option></select>'}
        <span class="user" id="me" title="Профиль и смена пароля">${esc(me.name)}<span class="role"> · ${esc(me.role)}</span></span><span class="user" id="out">Выйти</span></nav><div class="hubwrap"><nav class="tabs no-print" id="hubtabs" aria-label="Вкладки раздела" hidden></nav></div><main id="page"></main></div>
    <nav class="tabbar" aria-label="Быстрые разделы">${tab('my', 'Мой день')}${tab('collect', 'Сбор')}${tab('lxpay', 'Оплаты')}${tab('leaders', 'Лидеры')}<a href="#" id="tbMore"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.more}</svg><span>Ещё</span></a></nav>
    <div class="scrim" id="scrim"></div>`;
  const burger = $('#burger'), side = $('#side');
  const setOpen = open => { document.body.classList.toggle('drawer', open); burger.setAttribute('aria-expanded', open); };
  burger.onclick = () => setOpen(!document.body.classList.contains('drawer'));
  $('#tbMore').onclick = e => { e.preventDefault(); setOpen(!document.body.classList.contains('drawer')); };
  $('#scrim').onclick = () => setOpen(false);
  side.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  $('#me').onclick = profileModal;
  $('#out').onclick = async () => { try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* already signed out */ } signOut(); };
  if (!me.branch) api('/api/branches').then(list => {
    const sel = $('#branch'); if (!sel || !Array.isArray(list)) return;
    sel.innerHTML = `<option value="">Все филиалы</option>${list.map(n => `<option ${n === branch ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    if (branch && !list.includes(branch)) { branch = ''; try { localStorage.removeItem('branch'); } catch { /* ignore */ } }
    sel.onchange = () => { branch = sel.value; try { localStorage.setItem('branch', branch); } catch { /* ignore */ } route(); };
  }).catch(() => {});
  route();
}
function route() {
  const el = $('#page'); if (!el) return;
  const name = location.hash.replace('#/', '') || 'my';
  const hub = (window.HUBS || []).find(h => h.some(x => x[0] === name)), inMenu = r => !!document.querySelector(`.sidenav a[data-r="${r}"]`);
  const head = hub ? (inMenu(name) ? name : (hub.find(x => inMenu(x[0])) || hub[0])[0]) : name; // the menu line this page belongs to
  document.querySelectorAll('.sidenav a, .tabbar a[data-r]').forEach(x => x.classList.toggle('on', x.dataset.r === head || x.dataset.r === name));
  const cur = document.querySelector(`.sidenav a[data-r="${head}"]`), cr = document.getElementById('crumb');
  if (cr) cr.textContent = cur ? cur.textContent : '';
  const ht = document.getElementById('hubtabs');
  if (ht) { const tabs = hub ? hub.filter(x => canOpen(x[0])) : []; ht.hidden = tabs.length < 2; ht.innerHTML = tabs.map(([r, t]) => `<a href="#/${r}" class="${r === name ? 'on' : ''}">${esc(t)}</a>`).join(''); const on = ht.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  if (route.last !== name) { route.last = name; window.scrollTo(0, 0); }
  document.body.classList.toggle('ro', !!PAGE_PERM[name] && !can(PAGE_PERM[name] + '.edit'));
  if (!canOpen(name)) {
    const to = landing();
    if (to && to !== name) { location.hash = '#/' + to; return; }
    el.innerHTML = '<div class="soon">Для вашей роли нет доступных разделов. Обратитесь к администратору.</div>'; return;
  }
  (PAGES[name] || PAGES.soon)(el);
}
window.onhashchange = route;

(async function boot() {
  if (token) {
    try { const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } }); me = r.ok ? await r.json() : null; } catch { me = null; }
    if (!me) { token = null; try { localStorage.removeItem('token'); } catch { /* ignore */ } } else if (me.branch) branch = '';
  }
  render();
})();
