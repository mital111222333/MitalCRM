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
const PAGE_PERM = { home: 'dashboard', overview: 'dashboard', clients: 'clients', zones: 'clients', routes: 'clients', orders: 'orders', returns: 'orders', bonus: 'bonus', payments: 'payments',
  balance: 'finance', cash: 'cash', stock: 'stock', stockdate: 'stock', transfers: 'transfers', logistics: 'logistics', staff: 'staff', activity: 'staff', tracking: 'staff', settings: 'settings',
  // your own uploaded data
  wh: 'stock', whstock: 'stock', whlow: 'stock', whmove: 'stock', whup: 'stock', agents: 'agents', leaders: 'agents', aclients: 'agents', atasks: 'agents', aup: 'agents' };
// Sections that run on the built-in demo data. They disappear once the demo data is deleted (Настройки → Данные).
const DEMO_ROUTES = ['home', 'overview', 'logistics', 'payments', 'clients', 'zones', 'routes', 'orders', 'returns', 'bonus', 'staff', 'activity', 'tracking', 'stock', 'stockdate', 'transfers', 'balance', 'cash'];
const canOpen = r => (!DEMO_ROUTES.includes(r) || me?.demo !== false) && (!PAGE_PERM[r] || can(PAGE_PERM[r] + '.view'));
const landing = () => ['rday', 'agents', 'wh', 'home', 'orders', 'clients', 'payments', 'balance', 'stock', 'logistics', 'transfers', 'staff', 'settings'].find(canOpen);

// Menu: your own data first (warehouse stock, agents), then the demo sections that mirror the old LINKO menu. top item -> groups -> [title, route]
const MENU = {
  'Склад': { 'Остатки и анализ': [['Обзор склада', 'wh'], ['Остатки по складам', 'whstock'], ['Что заканчивается', 'whlow'], ['Движение склада', 'whmove'], ['Загрузки', 'whup']],
    'Демо-данные': [['Остаток (демо)', 'stock'], ['Остаток на дату (демо)', 'stockdate'], ['Передачи между складами (демо)', 'transfers']] },
  'Агенты': { 'Аналитика': [['Сводка по агентам', 'agents'], ['Лидерборд', 'leaders']], 'Клиенты и задания': [['Клиенты и долги', 'aclients'], ['Задания агентам', 'atasks']], 'Данные': [['Загрузки', 'aup']] },
  'Аналитика': { 'Склад и Логистика': [['Контроль логистики', 'logistics']], 'Финанс и касса': [['Оплаты от клиентов', 'payments']], 'Общее': [['Обзор и анализ', 'overview'], ['Виджеты', 'home']] },
  'Клиенты': { 'Контрагенты': [['Клиенты', 'clients']], 'Территория': [['Территория', 'zones'], ['Маршруты', 'routes']] },
  'Продажи': { 'Заказ': [['Заказы', 'orders'], ['Возвраты', 'returns']], 'Маркетинг': [['Бонусы клиентов', 'bonus']] },
  'Персонал': { '': [['Контроль', 'staff'], ['Активность', 'activity'], ['Отслеживание', 'tracking']] },
  'Финансы': { 'Баланс': [['Баланс клиентов', 'balance']], 'Работа с кассой': [['Управление кассой', 'cash'], ['Оплаты от клиентов', 'payments']] },
};
if (window.EXT_MENU) { for (const k of Object.keys(MENU)) delete MENU[k]; Object.assign(MENU, window.EXT_MENU); } // static (serverless) version: its own, shorter menu

const table = (heads, rows) => `<table><thead><tr>${heads.map(([h, n]) => `<th class="${n ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const money = v => `<td class="n ${cls(v)}">${fmt(v)}</td>`;

const STATUS = { new: 'Новый', delivered: 'Доставлен', cancelled: 'Отменён' };

function modal(html) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = e => e.target === bg && bg.remove();
  document.body.appendChild(bg);
  return { el: bg.firstChild, close: () => bg.remove() };
}

async function orderModal(id, onChange) {
  const o = await api('/api/orders/' + id);
  const m = modal(`<h3>${o.kind === 'sale' ? 'Заказ' : 'Возврат'} №${o.id} <span class="badge ${o.status}">${STATUS[o.status]}</span></h3>
    <p>${esc(o.client)} · ${esc(o.phone)}<br>${o.date} · склад: ${esc(o.warehouse)}${o.comment ? `<br><i>${esc(o.comment)}</i>` : ''}</p>` +
    table([['Товар'], ['Кол-во', 1], ['Цена', 1], ['Сумма', 1]], o.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${fmt(i.price)}</td><td class="n">${fmt(i.qty * i.price)}</td></tr>`)) +
    `<p><b>Итого: ${fmt(o.amount)} USD</b></p><div class="bar">${Object.entries(STATUS).filter(([k]) => k !== o.status).map(([k, v]) => `<button class="btn ${k === 'cancelled' ? 'danger' : ''}" data-st="${k}">${v}</button>`).join('')}<span class="spacer"></span><button class="btn gray" id="x">Закрыть</button></div>`);
  m.el.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { await api(`/api/orders/${id}/status`, { method: 'POST', body: { status: b.dataset.st } }); m.close(); onChange(); });
  $('#x', m.el).onclick = m.close;
}

async function newOrderModal(kind, onSaved) {
  const [clients, products, stock, warehouses, staff] = await Promise.all([api('/api/clients'), api('/api/products'), api('/api/stock'), api('/api/warehouses'), api('/api/staff')]);
  const m = modal(`<h3>${kind === 'sale' ? 'Новый заказ' : 'Новый возврат'}</h3>
    <div class="form">
      <label>Клиент<select id="cl">${clients.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.zone)})</option>`).join('')}</select></label>
      <label>Склад<select id="wh">${warehouses.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
      <label>Дата<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Комментарий<input id="cm"></label>
      <label>Агент<select id="ag">${staff.map(s => `<option>${esc(s.name)}</option>`).join('')}</select></label>
    </div>
    <table><thead><tr><th>Товар</th><th class="n">Доступно</th><th class="n">Кол-во</th><th class="n">Цена</th><th class="n">Сумма</th><th></th></tr></thead><tbody id="lines"></tbody></table>
    <div class="bar"><button class="btn gray" id="addl">+ Товар</button><span class="spacer"></span><b id="total">Итого: 0 USD</b></div>
    <small id="err" class="neg"></small>
    <div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="save">Сохранить</button></div>`);
  const avail = (pid) => stock.find(s => s.product_id === pid && s.warehouse === $('#wh', m.el).value)?.qty ?? 0;
  const lines = $('#lines', m.el);
  const recalc = () => {
    let t = 0;
    lines.querySelectorAll('tr').forEach(tr => {
      const pid = +tr.querySelector('.p').value, q = +tr.querySelector('.q').value, pr = +tr.querySelector('.pr').value;
      tr.querySelector('.av').textContent = avail(pid); tr.querySelector('.sum').textContent = fmt(q * pr); t += q * pr;
    });
    $('#total', m.el).textContent = `Итого: ${fmt(t)} USD`;
  };
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><select class="p">${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></td><td class="n av"></td>
      <td><input class="q n" type="number" min="1" value="1"></td><td><input class="pr n" type="number" min="0" step="0.01"></td><td class="n sum"></td><td><button class="btn danger rm">×</button></td>`;
    const setPrice = () => tr.querySelector('.pr').value = products.find(p => p.id === +tr.querySelector('.p').value).price;
    tr.querySelector('.p').onchange = () => { setPrice(); recalc(); };
    tr.querySelectorAll('input').forEach(i => i.oninput = recalc);
    tr.querySelector('.rm').onclick = () => { tr.remove(); recalc(); };
    lines.appendChild(tr); setPrice(); recalc();
  };
  const syncAgent = () => { const a = clients.find(c => c.id === +$('#cl', m.el).value)?.agent; if (a) $('#ag', m.el).value = a; };
  $('#cl', m.el).onchange = syncAgent; syncAgent();
  $('#wh', m.el).onchange = recalc; $('#addl', m.el).onclick = addLine; $('#x', m.el).onclick = m.close; addLine();
  $('#save', m.el).onclick = async () => {
    const items = [...lines.querySelectorAll('tr')].map(tr => ({ product_id: +tr.querySelector('.p').value, qty: +tr.querySelector('.q').value, price: +tr.querySelector('.pr').value }));
    const d = await api('/api/orders', { method: 'POST', body: { kind, agent: $('#ag', m.el).value, client_id: +$('#cl', m.el).value, warehouse: $('#wh', m.el).value, date: $('#dt', m.el).value, comment: $('#cm', m.el).value, items } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function nameModal(title, value, onOk) {
  const m = modal(`<h3>${title}</h3><div class="form"><label>Название<input id="nm" value="${esc(value)}"></label></div><small id="err" class="neg"></small><div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close; $('#nm', m.el).focus();
  $('#ok', m.el).onclick = async () => { const err = await onOk($('#nm', m.el).value); if (err) $('#err', m.el).textContent = err; else m.close(); };
}

async function routeModal(id, onSaved) {
  const [clients, zones, route] = await Promise.all([api('/api/clients'), api('/api/zones'), id ? api('/api/routes/' + id) : null]);
  const agents = [...new Set(clients.map(c => c.agent))].sort();
  let sel = route ? route.clients.map(c => c.id) : [];
  const byId = Object.fromEntries(clients.map(c => [c.id, c]));
  const m = modal(`<h3>${id ? 'Маршрут' : 'Новый маршрут'}</h3>
    <div class="form">
      <label>Название<input id="nm" value="${esc(route?.name || '')}"></label>
      <label>Агент<input id="ag" list="agl" value="${esc(route?.agent || '')}"><datalist id="agl">${agents.map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>
      <label>День недели<select id="wd">${WEEKDAYS.map(d => `<option ${route?.weekday === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Территория<select id="zn">${zones.map(z => `<option ${route?.zone === z.name ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></label>
    </div>
    <div class="bar"><select id="pick" style="flex:1"></select><button class="btn" id="add">+ Добавить клиента</button><button class="btn gray" id="all">Все клиенты территории</button></div>
    <div id="list"></div><small id="err" class="neg"></small>
    <div class="bar">${id ? '<button class="btn danger" id="del">Удалить маршрут</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="save">Сохранить</button></div>`);
  const drawPick = () => {
    const z = $('#zn', m.el).value;
    $('#pick', m.el).innerHTML = clients.filter(c => c.zone === z && !sel.includes(c.id)).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">Нет доступных клиентов</option>';
  };
  const drawList = () => {
    $('#list', m.el).innerHTML = table([['№'], ['Клиент'], ['Зона'], ['']], sel.map((cid, i) => `<tr><td>${i + 1}</td><td>${esc(byId[cid].name)}</td><td>${esc(byId[cid].zone)}</td>
      <td class="n"><button class="btn gray" data-up="${i}">↑</button> <button class="btn gray" data-dn="${i}">↓</button> <button class="btn danger" data-rm="${i}">×</button></td></tr>`)) || '';
    const swap = (i, j) => { if (j < 0 || j >= sel.length) return; [sel[i], sel[j]] = [sel[j], sel[i]]; drawList(); };
    m.el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => swap(+b.dataset.up, +b.dataset.up - 1));
    m.el.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => swap(+b.dataset.dn, +b.dataset.dn + 1));
    m.el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sel.splice(+b.dataset.rm, 1); drawList(); drawPick(); });
  };
  $('#zn', m.el).onchange = drawPick;
  $('#add', m.el).onclick = () => { const v = +$('#pick', m.el).value; if (v) { sel.push(v); drawList(); drawPick(); } };
  $('#all', m.el).onclick = () => { const z = $('#zn', m.el).value; sel.push(...clients.filter(c => c.zone === z && !sel.includes(c.id)).map(c => c.id)); drawList(); drawPick(); };
  $('#x', m.el).onclick = m.close;
  if (id) $('#del', m.el).onclick = async () => { if (!confirm('Удалить маршрут?')) return; await api(`/api/routes/${id}/delete`, { method: 'POST', body: {} }); m.close(); onSaved(); };
  $('#save', m.el).onclick = async () => {
    const d = await api('/api/routes', { method: 'POST', body: { id, name: $('#nm', m.el).value, agent: $('#ag', m.el).value, weekday: $('#wd', m.el).value, zone: $('#zn', m.el).value, client_ids: sel } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
  drawList(); drawPick();
}

const BONUS_KIND = { accrual: 'За заказ', manual: 'Начислено вручную', spend: 'Списание' };

function bonusOpModal(client, onSaved) {
  const m = modal(`<h3>Бонусы: ${esc(client.name)}</h3><p>Баланс: <b>${fmt(client.balance)}</b></p>
    <div class="form"><label>Операция<select id="kd"><option value="manual">Начислить</option><option value="spend">Списать</option></select></label><label>Сумма<input id="am" type="number" min="0" step="0.01"></label>
    <label>Дата<input id="dt" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Комментарий<input id="cm"></label></div>
    <small id="err" class="neg"></small><div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  $('#ok', m.el).onclick = async () => {
    const d = await api('/api/bonus/ops', { method: 'POST', body: { client_id: client.id, kind: $('#kd', m.el).value, amount: +$('#am', m.el).value, date: $('#dt', m.el).value, comment: $('#cm', m.el).value } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

function ruleModal(rule, onSaved) {
  const m = modal(`<h3>${rule ? 'Правило' : 'Новое правило'}</h3><div class="form"><label>Название<input id="nm" value="${esc(rule?.name || '')}"></label><label>Процент от суммы заказа<input id="pc" type="number" min="0" step="0.1" value="${rule?.percent ?? ''}"></label>
    <label>Минимальная сумма заказа<input id="mn" type="number" min="0" value="${rule?.min_amount ?? 0}"></label><label>Активно<select id="ac"><option value="1">Да</option><option value="0" ${rule && !rule.active ? 'selected' : ''}>Нет</option></select></label></div>
    <small id="err" class="neg"></small><div class="bar">${rule ? '<button class="btn danger" id="del">Удалить</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  if (rule) $('#del', m.el).onclick = async () => { if (!confirm('Удалить правило? Уже начисленные бонусы останутся.')) return; await api(`/api/bonus/rules/${rule.id}/delete`, { method: 'POST', body: {} }); m.close(); onSaved(); };
  $('#ok', m.el).onclick = async () => {
    const d = await api('/api/bonus/rules', { method: 'POST', body: { id: rule?.id, name: $('#nm', m.el).value, percent: +$('#pc', m.el).value, min_amount: +$('#mn', m.el).value, active: $('#ac', m.el).value === '1' } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

const DSTATUS = { pending: 'Не назначен', assigned: 'Назначен', in_transit: 'В пути', delivered: 'Доставлен', failed: 'Не доставлен' };
const today = () => new Date().toISOString().slice(0, 10);
const isLate = r => r.status !== 'delivered' && r.delivery_date && r.delivery_date < today();

async function deliveryModal(row, drivers, onSaved) {
  const m = modal(`<h3>Доставка заказа №${row.id} <span class="badge ${row.delivery_status}">${DSTATUS[row.delivery_status]}</span></h3>
    <p>${esc(row.client)} · ${esc(row.phone)} · ${esc(row.zone)}<br>Сумма: ${fmt(row.amount)} USD · склад: ${esc(row.warehouse)}</p>
    <div class="form"><label>Водитель<select id="dr"><option value="">— не назначен —</option>${drivers.map(d => `<option ${d.name === row.driver ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label>Плановая дата доставки<input type="date" id="dd" value="${row.delivery_date || ''}"></label>
    <label>Статус<select id="st">${Object.entries(DSTATUS).map(([k, v]) => `<option value="${k}" ${k === row.delivery_status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Примечание / причина<input id="nt" value="${esc(row.delivery_note || '')}"></label></div>
    <small id="err" class="neg"></small><div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  $('#ok', m.el).onclick = async () => {
    let st = $('#st', m.el).value; const driver = $('#dr', m.el).value;
    if (st === 'pending' && driver) st = 'assigned'; // picking a driver on a pending order assigns it
    const d = await api('/api/logistics/' + row.id, { method: 'POST', body: { driver, delivery_date: $('#dd', m.el).value || null, delivery_status: st, delivery_note: $('#nt', m.el).value } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

const MOVE_KIND = { opening: 'Начальный остаток', sale: 'Продажа', return: 'Возврат', transfer_out: 'Передача: отправка', transfer_in: 'Передача: приём' };
const TSTATUS = { in_transit: 'В пути', received: 'Принято', cancelled: 'Отменено' };

async function transferModal(id, onChange) {
  const t = await api('/api/transfers/' + id);
  const m = modal(`<h3>Передача №${t.id} <span class="badge ${t.status === 'in_transit' ? 'in_transit' : t.status === 'received' ? 'delivered' : 'cancelled'}">${TSTATUS[t.status]}</span></h3>
    <p>${esc(t.from_wh)} → ${esc(t.to_wh)}<br>Отправлено: ${t.date}${t.received_date ? ` · принято: ${t.received_date}` : ''}${t.comment ? `<br><i>${esc(t.comment)}</i>` : ''}</p>` +
    table([['Товар'], ['Кол-во', 1]], t.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td></tr>`)) +
    (t.status === 'in_transit' ? `<div class="bar"><label>Дата приёма <input type="date" id="rd" value="${today() < t.date ? t.date : today()}"></label></div><small id="err" class="neg"></small>` : '') +
    `<div class="bar">${t.status === 'in_transit' ? '<button class="btn" id="rcv">Принять на склад</button><button class="btn danger" id="cnl">Отменить передачу</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">Закрыть</button></div>`);
  $('#x', m.el).onclick = m.close;
  const act = async (a, body) => { const d = await api(`/api/transfers/${id}/${a}`, { method: 'POST', body }); if (d.error) return $('#err', m.el).textContent = d.error; m.close(); onChange(); };
  if (t.status === 'in_transit') {
    $('#rcv', m.el).onclick = () => act('receive', { date: $('#rd', m.el).value });
    $('#cnl', m.el).onclick = () => confirm('Отменить передачу? Товар вернётся на склад отправки.') && act('cancel', {});
  }
}

async function newTransferModal(onSaved) {
  const [products, stock, wh] = await Promise.all([api('/api/products'), api('/api/stock'), api('/api/warehouses')]);
  const m = modal(`<h3>Новая передача</h3><div class="form">
    <label>Со склада<select id="fr">${wh.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
    <label>На склад<select id="to">${wh.map((w, i) => `<option ${i === 1 ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
    <label>Дата отправки<input type="date" id="dt" value="${today()}"></label><label>Комментарий<input id="cm"></label></div>
    <table><thead><tr><th>Товар</th><th class="n">Доступно</th><th class="n">Кол-во</th><th></th></tr></thead><tbody id="lines"></tbody></table>
    <div class="bar"><button class="btn gray" id="addl">+ Товар</button></div><small id="err" class="neg"></small>
    <div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="save">Отправить</button></div>`);
  const lines = $('#lines', m.el);
  const avail = pid => stock.find(s => s.product_id === pid && s.warehouse === $('#fr', m.el).value)?.qty ?? 0;
  const recalc = () => lines.querySelectorAll('tr').forEach(tr => tr.querySelector('.av').textContent = avail(+tr.querySelector('.p').value));
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><select class="p">${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></td><td class="n av"></td><td><input class="q n" type="number" min="1" value="1"></td><td><button class="btn danger rm">×</button></td>`;
    tr.querySelector('.p').onchange = recalc; tr.querySelector('.rm').onclick = () => tr.remove();
    lines.appendChild(tr); recalc();
  };
  $('#fr', m.el).onchange = recalc; $('#addl', m.el).onclick = addLine; $('#x', m.el).onclick = m.close; addLine();
  $('#save', m.el).onclick = async () => {
    const items = [...lines.querySelectorAll('tr')].map(tr => ({ product_id: +tr.querySelector('.p').value, qty: +tr.querySelector('.q').value }));
    const d = await api('/api/transfers', { method: 'POST', body: { from_wh: $('#fr', m.el).value, to_wh: $('#to', m.el).value, date: $('#dt', m.el).value, comment: $('#cm', m.el).value, items } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

const VRESULT = { order: 'Заказ', no_order: 'Без заказа', closed: 'Закрыто' };
const ATYPE = { order: 'Заказ', return: 'Возврат', payment: 'Оплата', visit: 'Визит' };

function staffModal(s, onSaved) {
  const m = modal(`<h3>${s ? esc(s.name) : 'Новый сотрудник'}</h3><div class="form"><label>Имя (агент)<input id="nm" value="${esc(s?.name || '')}" ${s ? 'disabled' : ''}></label><label>Телефон<input id="ph" value="${esc(s?.phone || '')}"></label>
    <label>План продаж в месяц, USD<input id="pl" type="number" min="0" value="${s?.plan ?? 0}"></label><label>Активен<select id="ac"><option value="1">Да</option><option value="0" ${s && !s.active ? 'selected' : ''}>Нет</option></select></label></div>
    <small id="err" class="neg"></small><div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  $('#ok', m.el).onclick = async () => {
    const d = await api('/api/staff', { method: 'POST', body: { id: s?.id, name: $('#nm', m.el).value, phone: $('#ph', m.el).value, plan: +$('#pl', m.el).value, active: $('#ac', m.el).value === '1' } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

// Schematic track map: plain SVG (no map tiles / external services). Projects lat/lng onto the box of the day's points.
function trackSvg(day) {
  const pts = day.points, vs = day.visits;
  if (!pts.length) return '<div class="soon">Нет данных о перемещениях за этот день</div>';
  const all = [...pts, ...vs], W = 720, H = 420, pad = 36;
  const minLat = Math.min(...all.map(p => p.lat)), maxLat = Math.max(...all.map(p => p.lat)), minLng = Math.min(...all.map(p => p.lng)), maxLng = Math.max(...all.map(p => p.lng));
  const kx = Math.cos((minLat + maxLat) / 2 * Math.PI / 180), spanX = Math.max((maxLng - minLng) * kx, 1e-4), spanY = Math.max(maxLat - minLat, 1e-4);
  const sc = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY), ox = (W - spanX * sc) / 2, oy = (H - spanY * sc) / 2;
  const X = lng => ox + (lng - minLng) * kx * sc, Y = lat => H - oy - (lat - minLat) * sc;
  const line = pts.map(p => `${X(p.lng).toFixed(1)},${Y(p.lat).toFixed(1)}`).join(' ');
  const col = { order: '#1f9d55', no_order: '#e0a100', closed: '#d9534f' };
  return `<svg viewBox="0 0 ${W} ${H}" class="trackmap" role="img" aria-label="Схема маршрута агента">
    <rect width="${W}" height="${H}" fill="#f7f9fc" rx="8"/>
    <polyline points="${line}" fill="none" stroke="#4a6cdb" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="6 4" opacity=".8"/>
    <circle cx="${X(pts[0].lng)}" cy="${Y(pts[0].lat)}" r="7" fill="#1f9d55"><title>Старт ${pts[0].time}</title></circle>
    <circle cx="${X(pts.at(-1).lng)}" cy="${Y(pts.at(-1).lat)}" r="7" fill="#222"><title>Финиш ${pts.at(-1).time}</title></circle>
    ${vs.map((v, i) => `<g><circle cx="${X(v.lng)}" cy="${Y(v.lat)}" r="11" fill="${col[v.result]}" stroke="#fff" stroke-width="2"/><text x="${X(v.lng)}" y="${Y(v.lat) + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text><title>${i + 1}. ${esc(v.client)} · ${v.time_in}–${v.time_out} · ${VRESULT[v.result]}</title></g>`).join('')}
  </svg>`;
}

// ---------- Dashboard widgets ----------
const addDaysC = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dm = d => d.slice(8) + '.' + d.slice(5, 7);
const PERIODS = { today: 'Сегодня', yesterday: 'Вчера', week: 'Последние 7', month: 'Месяц', custom: 'Своя' };
function periodRange(key, custom) {
  const t = today();
  return { today: [t, t], yesterday: [addDaysC(t, -1), addDaysC(t, -1)], week: [addDaysC(t, -6), t], month: [t.slice(0, 8) + '01', t], custom }[key];
}
const pctDelta = (cur, prev) => prev ? (cur - prev) / prev * 100 : (cur ? null : 0);
function deltaChip(cur, prev, inverse = false) {
  const p = pctDelta(cur, prev);
  if (p === null) return '<span class="delta flat" title="В прошлом периоде данных не было">новое</span>';
  if (Math.abs(p) < 0.5) return '<span class="delta flat" title="Без изменений к прошлому периоду">0%</span>';
  const good = (p > 0) !== inverse;
  return `<span class="delta ${good ? 'up' : 'down'}" title="К предыдущему периоду такой же длины">${p > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p))}%</span>`;
}
const kpiCard = (label, value, prev, series, color, { inverse = false, suffix = '', raw } = {}) =>
  `<div class="widget kpi w2"><small>${label}</small><div class="kv">${raw ?? fmt(value)}${suffix}</div><div class="row2">${deltaChip(value, prev, inverse)}${series ? CH.sparkline(series, color) : ''}</div></div>`;

const wrap = (title, body, span) => `<div class="widget ${span}"><h4>${title}${body.includes('class="tableview"') ? '<button class="twin" type="button" aria-pressed="false" title="Показать данные таблицей">Таблица</button>' : ''}</h4>${body}</div>`;
const WIDGETS = [
  { id: 'kpi', title: 'Ключевые показатели', render: c => { const { current: a, previous: b, daily } = c.ov, col = k => daily.map(d => d[k]);
      return `<div class="grid-w w12" style="grid-column:span 12;display:contents">${kpiCard('Продажи, USD', a.sales, b.sales, col('sales'), 'var(--c1)')}${kpiCard('Заказы', a.orders, b.orders, col('orders'), 'var(--c4)')}${kpiCard('Оплаты, USD', a.payments, b.payments, col('payments'), 'var(--c2)')}${kpiCard('Возвраты, USD', a.returns, b.returns, col('returns'), 'var(--c7)', { inverse: true })}${kpiCard('Средний чек, USD', a.avg_check, b.avg_check, daily.map(d => d.orders ? d.sales / d.orders : 0), 'var(--c5)')}${kpiCard('Активных клиентов', a.clients, b.clients, null)}</div>`; } },
  { id: 'trend', title: 'Динамика продаж, оплат и возвратов', span: 'w8', render: c => CH.area(c.ov.daily.map(d => dm(d.date)), [{ name: 'Продажи', color: 'var(--c1)', values: c.ov.daily.map(d => d.sales) }, { name: 'Оплаты', color: 'var(--c2)', values: c.ov.daily.map(d => d.payments) }, { name: 'Возвраты', color: 'var(--c7)', values: c.ov.daily.map(d => d.returns) }]) },
  { id: 'brands', title: 'Продажи по брендам', span: 'w4', render: c => CH.donut(c.brand, { unit: ' USD' }) },
  { id: 'plan', title: 'Выполнение плана агентами', span: 'w4', need: 'staff.view', render: c => {
      const tot = c.control.reduce((a, r) => a + r.sales, 0), plan = c.control.reduce((a, r) => a + r.plan_period, 0);
      return `<div class="gauges">${CH.gauge(plan ? Math.round(tot / plan * 100) : null, 'Команда', `${CH.compact(tot)} из ${CH.compact(plan)}`)}${c.control.map(r => CH.gauge(r.percent, r.name, `${CH.compact(r.sales)} из ${CH.compact(r.plan_period)}`)).join('')}</div>`; } },
  { id: 'products', title: 'Топ товаров по продажам', span: 'w4', render: c => CH.hbars(c.product.slice(0, 6).map(p => ({ label: p.label, value: p.value })), { color: 'var(--c4)' }) },
  { id: 'zones', title: 'Продажи по территориям', span: 'w4', render: c => CH.vbars(c.zone.map(z => ({ label: z.label, value: z.value })), { colors: CH.colors }) },
  { id: 'delivery', title: 'Статусы доставки', span: 'w4', render: c => { const m = Object.fromEntries(c.ov.delivery.map(d => [d.st, d.n]));
      return CH.stack([['pending', 'Не назначен', 'var(--c-other)'], ['assigned', 'Назначен', 'var(--st-warn)'], ['in_transit', 'В пути', 'var(--c1)'], ['delivered', 'Доставлен', 'var(--st-good)'], ['failed', 'Не доставлен', 'var(--st-crit)']].map(([k, label, color]) => ({ label, color, value: m[k] || 0 }))); } },
  { id: 'cash', title: 'Остатки в кассах, USD', span: 'w4', render: c => CH.hbars(c.ov.cashboxes.map(b => ({ label: b.name.replace('Касса ', ''), value: b.balance })), { color: 'var(--c2)' }) },
  { id: 'lowstock', title: 'Самые низкие остатки', span: 'w4', render: c => `<ul class="list-w">${c.ov.lowStock.map(s => `<li><span>${esc(s.name)} · ${esc(s.warehouse)}</span><b class="${s.qty < 150 ? 'neg' : ''}">${s.qty} шт.</b></li>`).join('')}</ul>` },
  { id: 'clients', title: 'Топ клиентов по продажам', span: 'w6', render: c => CH.hbars(c.client.slice(0, 6).map(p => ({ label: p.label, value: p.value })), { color: 'var(--c5)' }) },
  { id: 'debtors', title: 'Крупнейшие долги клиентов, USD', span: 'w6', render: c => CH.hbars(c.clients.filter(x => x.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, 6).map(x => ({ label: x.name, value: x.balance })), { color: 'var(--c7)', empty: 'Долгов нет' }) },
];
const hiddenWidgets = () => { try { return JSON.parse(localStorage.getItem('hidden_widgets') || '[]'); } catch { return []; } };

// ---------- Settings: users & roles ----------
async function userModal(u, roles, branches, onSaved) {
  const m = modal(`<h3>${u ? 'Пользователь ' + esc(u.login) : 'Новый пользователь'}</h3><div class="form">
    <label>Логин<input id="lg" value="${esc(u?.login || '')}" ${u ? 'disabled' : ''} autocomplete="off" placeholder="латиница, цифры, . - _"></label>
    <label>Имя<input id="nm" value="${esc(u?.name || '')}"></label>
    <label>${u ? 'Новый пароль (пусто — не менять)' : 'Пароль (минимум 8 символов)'}<input id="pw" type="password" autocomplete="new-password"></label>
    <label>Роль<select id="rl">${roles.map(r => `<option value="${r.id}" ${r.id === u?.role_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
    <label>Филиал<select id="br"><option value="">Все филиалы (без ограничения)</option>${branches.map(b => `<option ${b === u?.branch ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
    <label>Статус<select id="ac"><option value="1">Активен</option><option value="0" ${u && !u.active ? 'selected' : ''}>Отключён</option></select></label></div>
    <small>Пользователь с филиалом видит и меняет данные только этого филиала.</small><br><small id="err" class="neg" role="alert"></small>
    <div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
  $('#x', m.el).onclick = m.close;
  $('#ok', m.el).onclick = async () => {
    const d = await api('/api/users', { method: 'POST', body: { id: u?.id, login: $('#lg', m.el).value, name: $('#nm', m.el).value, password: $('#pw', m.el).value, role_id: +$('#rl', m.el).value, branch: $('#br', m.el).value, active: $('#ac', m.el).value === '1' } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

async function roleModal(r, sections, onSaved) {
  const has = p => r?.perms.includes(p), locked = !!r?.system;
  const m = modal(`<h3>${r ? 'Роль' : 'Новая роль'}</h3><div class="form"><label>Название<input id="nm" value="${esc(r?.name || '')}" ${locked ? 'disabled' : ''}></label></div>
    ${locked ? '<p><small>Встроенная роль «Администратор» всегда имеет все права и не редактируется.</small></p>' : ''}
    <table class="matrix"><thead><tr><th>Раздел</th><th class="n">Просмотр</th><th class="n">Изменение</th></tr></thead><tbody>${sections.map(s => `<tr><td>${esc(s.label)}</td>
      <td class="n"><input type="checkbox" data-p="${s.key}.view" aria-label="Просмотр: ${esc(s.label)}" ${has(`${s.key}.view`) ? 'checked' : ''} ${locked ? 'disabled' : ''}></td>
      <td class="n"><input type="checkbox" data-p="${s.key}.edit" aria-label="Изменение: ${esc(s.label)}" ${has(`${s.key}.edit`) ? 'checked' : ''} ${locked ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table>
    <small>«Изменение» включает «Просмотр». Раздел «Пользователи и роли» — управление доступом.</small><br><small id="err" class="neg" role="alert"></small>
    <div class="bar">${r && !locked && !r.users ? '<button class="btn danger" id="del">Удалить роль</button>' : ''}<span class="spacer"></span><button class="btn gray" id="x">${locked ? 'Закрыть' : 'Отмена'}</button>${locked ? '' : '<button class="btn" id="ok">Сохранить</button>'}</div>`);
  const box = p => m.el.querySelector(`[data-p="${p}"]`);
  m.el.querySelectorAll('[data-p]').forEach(c => c.onchange = () => {
    const [k, kind] = c.dataset.p.split('.');
    if (kind === 'edit' && c.checked) box(`${k}.view`).checked = true;
    if (kind === 'view' && !c.checked) box(`${k}.edit`).checked = false;
  });
  $('#x', m.el).onclick = m.close;
  if (r && !locked && !r.users) $('#del', m.el).onclick = async () => { if (!confirm('Удалить роль?')) return; const d = await api(`/api/roles/${r.id}/delete`, { method: 'POST', body: {} }); if (d.error) return $('#err', m.el).textContent = d.error; m.close(); onSaved(); };
  if (!locked) $('#ok', m.el).onclick = async () => {
    const d = await api('/api/roles', { method: 'POST', body: { id: r?.id, name: $('#nm', m.el).value, perms: [...m.el.querySelectorAll('[data-p]:checked')].map(c => c.dataset.p) } });
    if (d.error) return $('#err', m.el).textContent = d.error;
    m.close(); onSaved();
  };
}

const PAGES = {
  async settings(el, tab = 'users') {
    el.innerHTML = `<h2>Настройки</h2><div class="bar"><button class="btn ${tab === 'users' ? '' : 'gray'}" data-tab="users">Пользователи</button><button class="btn ${tab === 'roles' ? '' : 'gray'}" data-tab="roles">Роли и права</button><button class="btn ${tab === 'data' ? '' : 'gray'}" data-tab="data">Данные</button></div><div id="out"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => PAGES.settings(el, b.dataset.tab));
    const out = $('#out', el), again = () => PAGES.settings(el, tab);
    if (tab === 'data') {
      const info = await api('/api/admin/info'), n = info.counts, any = n.clients + n.orders + n.products + n.payments;
      out.innerHTML = `<div class="grid"><div class="panel w7"><div class="ph"><h4>Демо-данные</h4></div>${info.demo
        ? `<p style="margin-top:0">В приложении есть учебные данные: ${UI.fmt0(n.clients)} клиентов, ${UI.fmt0(n.products)} товаров, ${UI.fmt0(n.orders)} заказов, ${UI.fmt0(n.payments)} оплат. Они нужны, только чтобы посмотреть, как всё выглядит.</p><p>Когда загрузите свои данные (разделы «Склад» и «Агенты»), демо-данные можно удалить: останутся ваши загрузки, пользователи и роли. Разделы на демо-данных (заказы, касса, логистика и др.) после этого скроются, а сами демо-данные больше не создаются при запуске.</p><p class="neg"><b>Это нельзя отменить.</b></p>
          <div class="form"><label>Для подтверждения введите слово УДАЛИТЬ<input id="cf" autocomplete="off"></label></div><small id="err" class="neg" role="alert"></small><div class="bar"><button class="btn danger needs-edit" id="purge">Удалить демо-данные</button></div>`
        : `<p style="margin-top:0">Демо-данные удалены${any ? ` (осталось записей: ${any})` : ''}. Видны только разделы с вашими данными.</p>`}</div>
        <div class="panel w5"><div class="ph"><h4>Ваши загрузки</h4></div><p style="margin-top:0">Склад: <b>${info.uploads.wh}</b> загрузок остатков<br>Агенты: <b>${info.uploads.ag}</b> загрузок клиентов</p><p class="mut">Копию базы делайте командой <code>npm run backup</code>.</p></div></div>`;
      const b = $('#purge', out);
      if (b) b.onclick = async () => { const d = await api('/api/admin/purge-demo', { method: 'POST', body: { confirm: $('#cf', out).value.trim() } }); if (d.error) return $('#err', out).textContent = d.error; me.demo = false; toast('Демо-данные удалены'); location.hash = '#/' + (landing() || 'settings'); render(); };
      return;
    }
    const [roles, sections] = await Promise.all([api('/api/roles'), api('/api/permissions')]);
    if (tab === 'users') {
      const [users, branches] = await Promise.all([api('/api/users'), api('/api/branches')]);
      out.innerHTML = `<div class="bar"><span class="spacer"></span><button class="btn" id="new">+ Пользователь</button></div>` + table([['Логин'], ['Имя'], ['Роль'], ['Филиал'], ['Статус'], ['Последний вход']],
        users.map(u => `<tr class="row" data-id="${u.id}"><td>${esc(u.login)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${esc(u.branch || 'все')}</td><td><span class="badge ${u.active ? 'delivered' : 'cancelled'}">${u.active ? 'Активен' : 'Отключён'}</span></td><td>${esc(u.last_login || '—')}</td></tr>`));
      $('#new', out).onclick = () => userModal(null, roles, branches, again);
      out.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => userModal(users.find(u => u.id === +tr.dataset.id), roles, branches, again));
    } else {
      out.innerHTML = `<div class="bar"><small>Пользователь получает права своей роли. Кнопки действий скрываются, а сервер отклоняет запрещённые операции.</small><span class="spacer"></span><button class="btn" id="new">+ Роль</button></div>` + table([['Роль'], ['Пользователей', 1], ['Просмотр', 1], ['Изменение', 1], ['']],
        roles.map(r => `<tr class="row" data-id="${r.id}"><td>${esc(r.name)}</td><td class="n">${r.users}</td><td class="n">${r.perms.filter(p => p.endsWith('.view')).length} из ${sections.length}</td><td class="n">${r.perms.filter(p => p.endsWith('.edit')).length} из ${sections.length}</td><td>${r.system ? '<span class="badge">встроенная</span>' : ''}</td></tr>`));
      $('#new', out).onclick = () => roleModal(null, sections, again);
      out.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => roleModal(roles.find(r => r.id === +tr.dataset.id), sections, again));
    }
  },
  async home(el, state = { key: 'week' }) {
    const [from, to] = periodRange(state.key, state.custom || [today(), today()]), qs = `from=${from}&to=${to}`;
    const grp = (by, extra = '') => api(`/api/analytics/group?${qs}&by=${by}&measure=amount${extra}`);
    const [ov, brand, product, zone, client, control, clients] = await Promise.all([api('/api/analytics/overview?' + qs), grp('brand'), grp('product'), grp('zone'), grp('client', '&limit=10'), api('/api/staff/control?' + qs), api('/api/clients')]);
    // Widgets fed by sections the role cannot read (e.g. staff plan) are dropped; a refused request comes back as {error}, not an array.
    const ctx = { ov, brand, product, zone, client, control: Array.isArray(control) ? control : [], clients: Array.isArray(clients) ? clients : [] };
    const hidden = hiddenWidgets(), visible = WIDGETS.filter(w => !w.need || can(w.need));
    el.innerHTML = `<h2>Виджеты</h2><div class="periods">${Object.entries(PERIODS).map(([k, v]) => `<button class="btn ${k === state.key ? 'on' : 'gray'}" data-p="${k}">${v}</button>`).join('')}
      ${state.key === 'custom' ? `<input type="date" id="cf" value="${from}"> — <input type="date" id="ct" value="${to}"><button class="btn" id="cgo">Применить</button>` : `<small>${from === to ? from : from + ' — ' + to}</small>`}<span class="spacer"></span><button class="btn gray" id="cfg">Настроить виджеты</button></div>
      <div class="grid-w">${visible.filter(w => !hidden.includes(w.id)).map(w => w.id === 'kpi' ? w.render(ctx) : wrap(w.title, w.render(ctx), w.span)).join('') || '<div class="soon w12">Все виджеты скрыты — включите нужные в «Настроить виджеты»</div>'}</div>`;
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => PAGES.home(el, { key: b.dataset.p, custom: state.custom || [from, to] }));
    if (state.key === 'custom') $('#cgo', el).onclick = () => PAGES.home(el, { key: 'custom', custom: [$('#cf', el).value, $('#ct', el).value] });
    $('#cfg', el).onclick = () => {
      const m = modal(`<h3>Настройка виджетов</h3>${visible.map(w => `<label class="chk"><input type="checkbox" data-w="${w.id}" ${hidden.includes(w.id) ? '' : 'checked'}>${w.title}</label>`).join('')}<div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="wok">Сохранить</button></div>`); // #wok, not #ok: this is a personal preference and must stay usable in read-only mode
      $('#x', m.el).onclick = m.close;
      $('#wok', m.el).onclick = () => { try { localStorage.setItem('hidden_widgets', JSON.stringify([...m.el.querySelectorAll('[data-w]')].filter(c => !c.checked).map(c => c.dataset.w))); } catch { /* storage unavailable */ } m.close(); PAGES.home(el, state); };
    };
  },
  async overview(el) {
    const GROUP_BY = { brand: 'Бренды', product: 'Товары', zone: 'Территории', agent: 'Агенты', client: 'Клиенты', warehouse: 'Склады' }, MEASURE = { amount: 'Сумма, USD', qty: 'Количество, шт.', orders: 'Число заказов' }, WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const sel = (id, o, v) => `<select id="${id}">${Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    el.innerHTML = `<h2>Обзор и анализ</h2><div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="${today()}">
      Группировка ${sel('by', GROUP_BY, 'product')} Измерять ${sel('ms', MEASURE, 'amount')} ${sel('kd', { sale: 'Продажи', return: 'Возвраты' }, 'sale')}<button class="btn" id="go">Показать</button><span class="spacer"></span><button class="btn gray" id="csv">Скачать CSV</button></div><div class="grid-w" id="out"></div>`;
    let rows = [];
    const load = async () => {
      const f = $('#f', el).value, t = $('#t', el).value, by = $('#by', el).value, ms = $('#ms', el).value, kd = $('#kd', el).value, q = `from=${f}&to=${t}&kind=${kd}`;
      const unit = { amount: ' USD', qty: ' шт.', orders: ' зак.' }[ms];
      const [g, abc, wd, ov] = await Promise.all([api(`/api/analytics/group?${q}&by=${by}&measure=${ms}`), api(`/api/analytics/group?${q}&by=product&measure=amount`), api(`/api/analytics/group?${q}&by=weekday&measure=${ms}`), api(`/api/analytics/overview?from=${f}&to=${t}`)]);
      rows = g; const total = g.reduce((a, r) => a + r.value, 0), c = ov.current, wdMap = Object.fromEntries(wd.map(r => [r.label, r.value]));
      $('#out', el).innerHTML =
        wrap(`${GROUP_BY[by]} — ${MEASURE[ms].toLowerCase()} (${kd === 'sale' ? 'продажи' : 'возвраты'})`, `<div class="grid-w"><div style="grid-column:span 5;min-width:0">${CH.donut(g, { unit })}</div><div style="grid-column:span 7;min-width:0"><div class="tscroll">${table([['№'], [GROUP_BY[by]], [MEASURE[ms], 1], ['Доля', 1], ['']], g.slice(0, 15).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td class="n">${fmt(r.value)}</td><td class="n">${(r.value / total * 100).toFixed(1)}%</td><td style="width:90px"><div class="bartrack"><div class="barfill ok" style="width:${r.value / g[0].value * 100}%;background:${CH.colors[i % 8]}"></div></div></td></tr>`))}</div></div></div>`, 'w12') +
        wrap('ABC-анализ товаров по сумме продаж', CH.pareto(abc.filter(r => r.value > 0)), 'w12') +
        wrap(`Продажи по дням недели (${MEASURE[ms].toLowerCase()})`, CH.vbars([1, 2, 3, 4, 5, 6, 0].map(d => ({ label: WD[d], value: wdMap[String(d)] || 0 })), { color: 'var(--c4)' }), 'w6') +
        wrap('Деньги за период', `${CH.hbars([{ label: 'Продажи', value: c.sales, color: 'var(--c1)' }, { label: 'Оплаты', value: c.payments, color: 'var(--c2)' }, { label: 'Возвраты', value: c.returns, color: 'var(--c7)' }])}
          <div class="gauges" style="margin-top:12px">${CH.gauge(c.sales ? Math.round(c.payments / c.sales * 100) : null, 'Собираемость оплат', 'оплаты / продажи')}${CH.gauge(c.sales ? Math.round(c.returns / c.sales * 100) : null, 'Доля возвратов', 'возвраты / продажи')}</div>`, 'w6');
    };
    $('#go', el).onclick = load;
    $('#csv', el).onclick = () => {
      const csv = [['Группа', 'Значение'], ...rows.map(r => [r.label, r.value])].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `analysis_${$('#by', el).value}.csv`; a.click();
    };
    load();
  },
  async staff(el) {
    el.innerHTML = `<h2>Контроль персонала</h2><div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="${today()}"><button class="btn" id="go">Показать</button><span class="spacer"></span><button class="btn" id="new">+ Сотрудник</button></div><div id="out"></div>`;
    const load = async () => {
      const rows = await api(`/api/staff/control?from=${$('#f', el).value}&to=${$('#t', el).value}`), sum = k => rows.reduce((a, r) => a + r[k], 0);
      $('#out', el).innerHTML = `<div class="cards"><div class="card"><small>Продажи команды</small><b>${fmt(sum('sales'))} USD</b></div><div class="card"><small>План за период</small><b>${fmt(sum('plan_period'))} USD</b></div><div class="card"><small>Собрано оплат</small><b class="pos">${fmt(sum('paid'))} USD</b></div><div class="card"><small>Визитов</small><b>${sum('visits')}</b></div></div>` +
        table([['Агент'], ['Телефон'], ['План', 1], ['Продажи', 1], ['Выполнение'], ['Заказов', 1], ['Возвраты', 1], ['Оплаты', 1], ['Визитов', 1], ['С заказом', 1], ['Статус']],
          rows.map(r => `<tr class="row" data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td class="n">${fmt(r.plan_period)}</td><td class="n">${fmt(r.sales)}</td>
            <td><div class="bartrack"><div class="barfill ${r.percent >= 100 ? 'ok' : r.percent >= 60 ? 'mid' : 'low'}" style="width:${Math.min(r.percent ?? 0, 100)}%"></div></div><small>${r.percent ?? '—'}%</small></td>
            <td class="n">${r.orders}</td><td class="n">${fmt(r.returns)}</td><td class="n">${fmt(r.paid)}</td><td class="n">${r.visits}</td><td class="n">${r.visits_with_order}</td><td><span class="badge ${r.active ? 'delivered' : ''}">${r.active ? 'Активен' : 'Отключён'}</span></td></tr>`));
      el.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => staffModal(rows.find(r => r.id === +tr.dataset.id), load));
    };
    $('#go', el).onclick = load; $('#new', el).onclick = () => staffModal(null, load); load();
  },
  async activity(el) {
    const staff = await api('/api/staff');
    el.innerHTML = `<h2>Активность персонала</h2><div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="${today()}">
      <select id="ag"><option value="">Все сотрудники</option>${staff.map(s => `<option>${esc(s.name)}</option>`).join('')}</select>
      <select id="ty"><option value="">Все события</option>${Object.entries(ATYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn" id="go">Показать</button></div><div id="out"></div>`;
    const load = async () => {
      const rows = await api('/api/activity?' + new URLSearchParams({ from: $('#f', el).value, to: $('#t', el).value, agent: $('#ag', el).value, type: $('#ty', el).value }));
      const n = t => rows.filter(r => r.type === t).length;
      $('#out', el).innerHTML = `<div class="cards">${Object.entries(ATYPE).map(([k, v]) => `<div class="card"><small>${v}</small><b>${n(k)}</b></div>`).join('')}</div>` +
        table([['Дата'], ['Время'], ['Сотрудник'], ['Событие'], ['Описание']], rows.map(r => `<tr><td>${r.date}</td><td>${r.time || '—'}</td><td>${esc(r.agent || '—')}</td><td><span class="badge ${r.type === 'order' ? 'delivered' : r.type === 'return' ? 'cancelled' : r.type === 'payment' ? 'in_transit' : 'assigned'}">${ATYPE[r.type]}</span></td><td>${esc(r.text)}</td></tr>`));
    };
    $('#go', el).onclick = load; load();
  },
  async tracking(el) {
    const staff = await api('/api/staff');
    el.innerHTML = `<h2>Отслеживание</h2><div class="bar"><select id="ag">${staff.map(s => `<option>${esc(s.name)}</option>`).join('')}</select><input type="date" id="dt" value="${today()}"><button class="btn" id="go">Показать</button></div><div id="sum"></div><div id="out"></div>`;
    const load = async () => {
      const date = $('#dt', el).value, agent = $('#ag', el).value;
      const [d, sm] = await Promise.all([api(`/api/track/day?agent=${encodeURIComponent(agent)}&date=${date}`), api('/api/track/summary?date=' + date)]);
      $('#sum', el).innerHTML = `<h3>Все сотрудники за ${date}</h3>` + table([['Сотрудник'], ['Начало'], ['Конец'], ['Визитов', 1], ['С заказом', 1], ['Пройдено, км', 1]], sm.map(s => `<tr class="row" data-a="${esc(s.agent)}"><td>${esc(s.agent)}</td><td>${s.first || '—'}</td><td>${s.last || '—'}</td><td class="n">${s.visits}</td><td class="n">${s.with_order}</td><td class="n">${s.km}</td></tr>`));
      el.querySelectorAll('#sum tr.row').forEach(tr => tr.onclick = () => { $('#ag', el).value = tr.dataset.a; load(); });
      const last = d.points.at(-1);
      $('#out', el).innerHTML = `<h3>${esc(agent)} · ${date}</h3><div class="cards"><div class="card"><small>Пройдено</small><b>${d.km} км</b></div><div class="card"><small>Визитов</small><b>${d.visits.length}</b></div><div class="card"><small>Точек трека</small><b>${d.points.length}</b></div>${last ? `<div class="card"><small>Последняя точка ${last.time}</small><a href="https://www.openstreetmap.org/?mlat=${last.lat}&mlon=${last.lng}#map=15/${last.lat}/${last.lng}" target="_blank" rel="noopener">Открыть на карте</a></div>` : ''}</div>` +
        trackSvg(d) + `<div class="legend"><span class="dot" style="background:#1f9d55"></span>заказ <span class="dot" style="background:#e0a100"></span>без заказа <span class="dot" style="background:#d9534f"></span>закрыто · зелёная точка — старт, чёрная — финиш (схема без подложки карты)</div>` +
        (d.visits.length ? table([['№'], ['Время'], ['Клиент'], ['Территория'], ['Результат']], d.visits.map((v, i) => `<tr><td>${i + 1}</td><td>${v.time_in}–${v.time_out}</td><td>${esc(v.client)}</td><td>${esc(v.zone)}</td><td>${VRESULT[v.result]}</td></tr>`)) : '');
    };
    $('#go', el).onclick = load; load();
  },
  async transfers(el) {
    const wh = await api('/api/warehouses');
    el.innerHTML = `<h2>Передачи между складами</h2><div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="${today()}">
      <select id="st"><option value="">Все статусы</option>${Object.entries(TSTATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="wh"><option value="">Все склады</option>${wh.map(w => `<option>${esc(w)}</option>`).join('')}</select><button class="btn" id="go">Показать</button><span class="spacer"></span><button class="btn" id="new">+ Новая передача</button></div><div id="out"></div>`;
    const load = async () => {
      const qs = new URLSearchParams({ from: $('#f', el).value, to: $('#t', el).value, status: $('#st', el).value, warehouse: $('#wh', el).value });
      const rows = await api('/api/transfers?' + qs), n = s => rows.filter(r => r.status === s).length;
      $('#out', el).innerHTML = `<div class="cards"><div class="card"><small>Всего передач</small><b>${rows.length}</b></div><div class="card"><small>В пути</small><b>${n('in_transit')}</b></div><div class="card"><small>Принято</small><b class="pos">${n('received')}</b></div><div class="card"><small>Отменено</small><b>${n('cancelled')}</b></div></div>` +
        table([['№'], ['Отправлено'], ['Откуда'], ['Куда'], ['Позиций', 1], ['Всего шт.', 1], ['Принято'], ['Статус']], rows.map(r => `<tr class="row" data-id="${r.id}"><td>${r.id}</td><td>${r.date}</td><td>${esc(r.from_wh)}</td><td>${esc(r.to_wh)}</td><td class="n">${r.items}</td><td class="n">${r.total_qty}</td><td>${r.received_date || '—'}</td><td><span class="badge ${r.status === 'in_transit' ? 'in_transit' : r.status === 'received' ? 'delivered' : 'cancelled'}">${TSTATUS[r.status]}</span></td></tr>`));
      el.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => transferModal(+tr.dataset.id, load));
    };
    $('#go', el).onclick = load; $('#new', el).onclick = () => newTransferModal(load); load();
  },
  async stockdate(el) {
    const wh = await api('/api/warehouses');
    el.innerHTML = `<h2>Остаток на определённую дату</h2><div class="bar">
      Движение с <input type="date" id="f" value="2026-10-01"> Остаток на <input type="date" id="t" value="${today()}">
      <select id="wh"><option value="">Все склады</option>${wh.map(w => `<option>${esc(w)}</option>`).join('')}</select><input id="q" placeholder="Товар">
      <label><input type="checkbox" id="sum"> Итого по товарам</label><button class="btn" id="go">Показать</button><span class="spacer"></span><button class="btn gray" id="csv">Скачать CSV</button></div><div id="out"></div>`;
    let rows = [];
    const view = () => {
      let list = rows;
      if ($('#sum', el).checked) {
        const by = {};
        for (const r of rows) {
          const a = by[r.product_id] ||= { ...r, warehouse: 'Все склады', opening: 0, income: 0, outcome: 0, closing: 0, current: 0 };
          for (const k of ['opening', 'income', 'outcome', 'closing', 'current']) a[k] += r[k];
        }
        list = Object.values(by);
      }
      return list;
    };
    const draw = () => {
      const list = view(), t = k => list.reduce((a, r) => a + r[k], 0), value = list.reduce((a, r) => a + r.closing * r.price, 0);
      $('#out', el).innerHTML = `<div class="cards"><div class="card"><small>Остаток на ${$('#t', el).value}, шт.</small><b>${fmt(t('closing'))}</b></div><div class="card"><small>Стоимость остатка</small><b>${fmt(value)} USD</b></div><div class="card"><small>Приход за период</small><b class="pos">+${fmt(t('income'))}</b></div><div class="card"><small>Расход за период</small><b class="neg">−${fmt(t('outcome'))}</b></div><div class="card"><small>Текущий остаток</small><b>${fmt(t('current'))}</b></div></div>` +
        table([['Товар'], ['Бренд'], ['Склад'], ['На начало', 1], ['Приход', 1], ['Расход', 1], ['На дату', 1], ['Сейчас', 1]],
          list.map((r, i) => `<tr class="row" data-i="${i}"><td>${esc(r.name)}</td><td>${esc(r.brand)}</td><td>${esc(r.warehouse)}</td><td class="n">${fmt(r.opening)}</td><td class="n pos">${r.income ? '+' + fmt(r.income) : 0}</td><td class="n neg">${r.outcome ? '−' + fmt(r.outcome) : 0}</td><td class="n"><b>${fmt(r.closing)}</b></td><td class="n">${fmt(r.current)}</td></tr>`));
      el.querySelectorAll('tr.row').forEach(tr => tr.onclick = async () => {
        const r = list[+tr.dataset.i]; if (r.warehouse === 'Все склады') return;
        const mv = await api(`/api/stock/moves?product_id=${r.product_id}&warehouse=${encodeURIComponent(r.warehouse)}&from=${$('#f', el).value}&to=${$('#t', el).value}`);
        const m = modal(`<h3>${esc(r.name)} · ${esc(r.warehouse)}</h3><p>Движение за период ${$('#f', el).value} — ${$('#t', el).value}</p>` +
          (mv.length ? table([['Дата'], ['Тип'], ['Документ'], ['Клиент / склад'], ['Кол-во', 1]], mv.map(x => `<tr><td>${x.date}</td><td>${MOVE_KIND[x.kind]}</td><td>${x.order_id ? 'Заказ №' + x.order_id : x.transfer_id ? 'Передача №' + x.transfer_id : ''}</td><td>${esc(x.client || (x.transfer_id ? (x.kind === 'transfer_out' ? '→ ' + x.to_wh : '← ' + x.from_wh) : ''))}</td>${money(x.qty)}</tr>`)) : '<p>Движений нет</p>') +
          `<div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Закрыть</button></div>`);
        $('#x', m.el).onclick = m.close;
      });
    };
    const load = async () => {
      const qs = new URLSearchParams({ from: $('#f', el).value, to: $('#t', el).value, warehouse: $('#wh', el).value, q: $('#q', el).value });
      rows = await api('/api/stock/report?' + qs); draw();
    };
    $('#go', el).onclick = load; $('#sum', el).onchange = draw; $('#q', el).onkeydown = e => e.key === 'Enter' && load();
    $('#csv', el).onclick = () => {
      const head = ['Товар', 'Бренд', 'Склад', 'На начало', 'Приход', 'Расход', 'На дату', 'Сейчас'];
      const csv = [head, ...view().map(r => [r.name, r.brand, r.warehouse, r.opening, r.income, r.outcome, r.closing, r.current])].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `stock_${$('#t', el).value}.csv`; a.click();
    };
    load();
  },
  async logistics(el, tab = 'deliveries') {
    el.innerHTML = `<h2>Контроль логистики</h2><div class="bar"><button class="btn ${tab === 'deliveries' ? '' : 'gray'}" data-tab="deliveries">Доставки</button><button class="btn ${tab === 'drivers' ? '' : 'gray'}" data-tab="drivers">Водители</button></div><div id="out"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => PAGES.logistics(el, b.dataset.tab));
    const out = $('#out', el);
    if (tab === 'drivers') {
      const load = async () => {
        const rows = await api('/api/drivers');
        out.innerHTML = `<div class="bar"><input id="nm" placeholder="Имя"><input id="ph" placeholder="Телефон"><input id="vh" placeholder="Машина"><button class="btn" id="add">+ Добавить водителя</button></div><small id="err" class="neg"></small>` +
          table([['Водитель'], ['Телефон'], ['Машина'], ['Активных доставок', 1], ['']], rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.vehicle)}</td><td class="n">${r.active}</td><td class="n"><button class="btn danger" data-del="${esc(r.name)}">Удалить</button></td></tr>`));
        $('#add', out).onclick = async () => { const d = await api('/api/drivers', { method: 'POST', body: { name: $('#nm', out).value, phone: $('#ph', out).value, vehicle: $('#vh', out).value } }); d.error ? $('#err', out).textContent = d.error : load(); };
        out.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Удалить водителя?')) return; const d = await api('/api/drivers/delete', { method: 'POST', body: { name: b.dataset.del } }); d.error ? alert(d.error) : load(); });
      };
      return load();
    }
    const drivers = await api('/api/drivers'), zones = await api('/api/zones');
    out.innerHTML = `<div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="2026-10-08">
      <select id="dv"><option value="">Все водители</option>${drivers.map(d => `<option>${esc(d.name)}</option>`).join('')}</select>
      <select id="ds"><option value="">Все статусы</option>${Object.entries(DSTATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="zn"><option value="">Все территории</option>${zones.map(z => `<option>${esc(z.name)}</option>`).join('')}</select><button class="btn" id="go">Показать</button></div>
      <div id="cards"></div>
      <div class="bar"><b id="cnt">Выбрано: 0</b><select id="adr">${drivers.map(d => `<option>${esc(d.name)}</option>`).join('')}</select><input type="date" id="adt" value="${today()}"><button class="btn" id="asg">Назначить выбранным</button><small id="err" class="neg"></small></div><div id="tbl"></div>`;
    let rows = [];
    const draw = () => {
      const n = s => rows.filter(r => r.delivery_status === s).length, late = rows.filter(isLate).length;
      $('#cards', out).innerHTML = `<div class="cards"><div class="card"><small>Всего заказов</small><b>${rows.length}</b></div><div class="card"><small>Не назначены</small><b>${n('pending')}</b></div><div class="card"><small>Назначены</small><b>${n('assigned')}</b></div><div class="card"><small>В пути</small><b>${n('in_transit')}</b></div><div class="card"><small>Доставлено</small><b class="pos">${n('delivered')}</b></div><div class="card ${n('failed') ? 'warn' : ''}"><small>Не доставлено</small><b>${n('failed')}</b></div><div class="card ${late ? 'warn' : ''}"><small>Просрочено</small><b>${late}</b></div></div>`;
      $('#tbl', out).innerHTML = table([[`<input type="checkbox" id="all">`], ['№'], ['Дата'], ['Клиент'], ['Территория'], ['Сумма', 1], ['Водитель'], ['План'], ['Статус']],
        rows.map(r => `<tr class="row ${isLate(r) ? 'late' : ''}" data-id="${r.id}"><td><input type="checkbox" class="sel" value="${r.id}"></td><td>${r.id}</td><td>${r.date}</td><td>${esc(r.client)}</td><td>${esc(r.zone)}</td><td class="n">${fmt(r.amount)}</td><td>${esc(r.driver || '—')}</td><td>${r.delivery_date || '—'}</td><td><span class="badge ${r.delivery_status}">${DSTATUS[r.delivery_status]}</span></td></tr>`));
      const count = () => $('#cnt', out).textContent = `Выбрано: ${out.querySelectorAll('.sel:checked').length}`;
      out.querySelectorAll('.sel').forEach(c => { c.onclick = e => { e.stopPropagation(); count(); }; });
      $('#all', out).onclick = e => { out.querySelectorAll('.sel').forEach(c => c.checked = e.target.checked); count(); };
      out.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => deliveryModal(rows.find(r => r.id === +tr.dataset.id), drivers, load));
    };
    const load = async () => {
      const qs = new URLSearchParams({ from: $('#f', out).value, to: $('#t', out).value, driver: $('#dv', out).value, dstatus: $('#ds', out).value, zone: $('#zn', out).value });
      rows = await api('/api/logistics?' + qs); draw();
    };
    $('#go', out).onclick = load;
    $('#asg', out).onclick = async () => {
      const ids = [...out.querySelectorAll('.sel:checked')].map(c => +c.value);
      const d = await api('/api/logistics/assign', { method: 'POST', body: { ids, driver: $('#adr', out).value, delivery_date: $('#adt', out).value } });
      d.error ? $('#err', out).textContent = d.error : load();
    };
    load();
  },
  async bonus(el, tab = 'clients') {
    const tabs = [['clients', 'Клиенты'], ['ops', 'История'], ['rules', 'Правила']];
    el.innerHTML = `<h2>Бонусы клиентов</h2><div class="bar">${tabs.map(([k, t]) => `<button class="btn ${k === tab ? '' : 'gray'}" data-tab="${k}">${t}</button>`).join('')}</div><div id="out"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => PAGES.bonus(el, b.dataset.tab));
    const out = $('#out', el), again = () => PAGES.bonus(el, tab);
    if (tab === 'clients') {
      const rows = await api('/api/bonus/clients');
      const sum = k => rows.reduce((a, r) => a + r[k], 0);
      out.innerHTML = `<div class="cards"><div class="card"><small>Начислено всего</small><b>${fmt(sum('earned'))}</b></div><div class="card"><small>Списано</small><b>${fmt(sum('spent'))}</b></div><div class="card"><small>Остаток у клиентов</small><b class="pos">${fmt(sum('balance'))}</b></div></div><div class="bar"><input id="q" placeholder="Поиск клиента"></div><div id="t"></div>`;
      const draw = q => {
        const list = rows.filter(r => r.name.toLowerCase().includes(q));
        $('#t', out).innerHTML = table([['Клиент'], ['Территория'], ['Начислено', 1], ['Списано', 1], ['Баланс', 1]], list.map(r => `<tr class="row" data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.zone)}</td><td class="n">${fmt(r.earned)}</td><td class="n">${fmt(r.spent)}</td><td class="n pos">${fmt(r.balance)}</td></tr>`));
        out.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => bonusOpModal(rows.find(r => r.id === +tr.dataset.id), again));
      };
      $('#q', out).oninput = e => draw(e.target.value.toLowerCase()); draw('');
    } else if (tab === 'ops') {
      const rows = await api('/api/bonus/ops');
      out.innerHTML = table([['Дата'], ['Клиент'], ['Тип'], ['Комментарий'], ['Сумма', 1]], rows.map(r => `<tr><td>${r.date}</td><td>${esc(r.client)}</td><td>${BONUS_KIND[r.kind]}</td><td>${esc(r.comment)}</td>${money(r.amount)}</tr>`));
    } else {
      const rows = await api('/api/bonus/rules');
      out.innerHTML = `<div class="bar"><small>Бонус за заказ считается по правилу с наибольшим процентом, чья минимальная сумма не больше суммы заказа. Начисляется, когда заказ получает статус «Доставлен».</small><span class="spacer"></span><button class="btn" id="new">+ Новое правило</button></div>` +
        table([['Название'], ['Процент', 1], ['Мин. сумма заказа', 1], ['Статус']], rows.map(r => `<tr class="row" data-id="${r.id}"><td>${esc(r.name)}</td><td class="n">${r.percent}%</td><td class="n">${fmt(r.min_amount)}</td><td><span class="badge ${r.active ? 'delivered' : ''}">${r.active ? 'Активно' : 'Выключено'}</span></td></tr>`));
      $('#new', out).onclick = () => ruleModal(null, again);
      out.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => ruleModal(rows.find(r => r.id === +tr.dataset.id), again));
    }
  },
  async zones(el) {
    const load = async () => {
      const rows = await api('/api/zones');
      el.innerHTML = `<h2>Территория</h2><div class="bar"><span class="spacer"></span><button class="btn" id="new">+ Новая территория</button></div>` +
        table([['Территория'], ['Клиентов', 1], ['Маршрутов', 1], ['Баланс клиентов', 1], ['']], rows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${r.clients}</td><td class="n">${r.routes}</td>${money(r.balance)}
          <td class="n"><button class="btn gray" data-rn="${esc(r.name)}">Переименовать</button> <button class="btn danger" data-del="${esc(r.name)}">Удалить</button></td></tr>`));
      $('#new', el).onclick = () => nameModal('Новая территория', '', async n => (await api('/api/zones/create', { method: 'POST', body: { name: n } })).error || load());
      el.querySelectorAll('[data-rn]').forEach(b => b.onclick = () => nameModal('Переименовать территорию', b.dataset.rn, async n => (await api('/api/zones/rename', { method: 'POST', body: { name: b.dataset.rn, new_name: n } })).error || load()));
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm(`Удалить территорию «${b.dataset.del}»?`)) return; const d = await api('/api/zones/delete', { method: 'POST', body: { name: b.dataset.del } }); d.error ? alert(d.error) : load(); });
    };
    load();
  },
  async routes(el) {
    const rows = await api('/api/routes');
    const uniq = k => [...new Set(rows.map(r => r[k]))].filter(Boolean).sort();
    const opt = (label, list) => `<select data-f="${label[0]}"><option value="">${label[1]}</option>${list.map(v => `<option>${esc(v)}</option>`).join('')}</select>`;
    el.innerHTML = `<h2>Маршруты</h2><div class="bar">${opt(['zone', 'Все территории'], uniq('zone'))}${opt(['agent', 'Все агенты'], uniq('agent'))}${opt(['weekday', 'Все дни'], WEEKDAYS)}<span class="spacer"></span><button class="btn" id="new">+ Новый маршрут</button></div><div id="out"></div>`;
    const draw = () => {
      const f = Object.fromEntries([...el.querySelectorAll('[data-f]')].map(s => [s.dataset.f, s.value]));
      const list = rows.filter(r => Object.entries(f).every(([k, v]) => !v || r[k] === v)).sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.name.localeCompare(b.name));
      $('#out', el).innerHTML = table([['Маршрут'], ['Территория'], ['Агент'], ['День'], ['Клиентов', 1]], list.map(r => `<tr class="row" data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.zone)}</td><td>${esc(r.agent)}</td><td>${r.weekday}</td><td class="n">${r.clients}</td></tr>`));
      el.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => routeModal(+tr.dataset.id, () => PAGES.routes(el)));
    };
    el.querySelectorAll('[data-f]').forEach(s => s.onchange = draw);
    $('#new', el).onclick = () => routeModal(null, () => PAGES.routes(el));
    draw();
  },
  async clients(el) {
    const rows = await api('/api/clients');
    el.innerHTML = `<h2>Клиенты</h2><div class="bar"><input id="q" placeholder="Поиск по названию"></div><div id="t"></div>`;
    const draw = q => $('#t', el).innerHTML = table([['Название'], ['Телефон'], ['Тип'], ['Зона'], ['Агент'], ['Баланс', 1]],
      rows.filter(r => r.name.toLowerCase().includes(q)).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.type)}</td><td>${esc(r.zone)}</td><td>${esc(r.agent)}</td>${money(r.balance)}</tr>`));
    $('#q', el).oninput = e => draw(e.target.value.toLowerCase()); draw('');
  },
  async balance(el) {
    el.innerHTML = `<h2>Баланс клиентов</h2><div class="bar">С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="2026-10-08"><button class="btn" id="go">Показать</button></div><div id="out"></div>`;
    const load = async () => {
      const d = await api(`/api/balance?from=${$('#f', el).value}&to=${$('#t', el).value}`), s = d.summary;
      const card = (l, v) => `<div class="card"><small>${l}</small><b class="${cls(v)}">${fmt(v)} ${d.currency}</b></div>`;
      $('#out', el).innerHTML = `<div class="cards">${card('Баланс на начало', s.opening)}${card('Продажи', -s.sold)}${card('Возврат', s.returned)}${card('Оплачено', s.paid)}${card('Баланс на конец', s.closing)}</div>` +
        table([['Клиент'], ['Баланс на начало', 1], ['Продано', 1], ['Возврат', 1], ['Оплачено', 1], ['Баланс на конец', 1]],
          d.rows.map(r => `<tr><td>${esc(r.name)}</td>${money(r.opening)}${money(-r.sold)}${money(r.returned)}${money(r.paid)}${money(r.closing)}</tr>`));
    };
    $('#go', el).onclick = load; load();
  },
  async orders(el, kind = 'sale') {
    const title = kind === 'sale' ? 'Заказы' : 'Возвраты';
    el.innerHTML = `<h2>${title}</h2><div class="bar">
      С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="2026-10-08">
      <select id="st"><option value="">Все статусы</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="q" placeholder="Клиент"><button class="btn" id="go">Показать</button><span class="spacer"></span>
      <button class="btn" id="new">+ ${kind === 'sale' ? 'Новый заказ' : 'Новый возврат'}</button></div><div id="out"></div>`;
    const load = async () => {
      const qs = new URLSearchParams({ kind, from: $('#f', el).value, to: $('#t', el).value, status: $('#st', el).value, q: $('#q', el).value });
      const rows = await api('/api/orders?' + qs);
      $('#out', el).innerHTML = `<div class="cards"><div class="card"><small>Количество</small><b>${rows.length}</b></div><div class="card"><small>Сумма (без отменённых)</small><b>${fmt(rows.filter(r => r.status !== 'cancelled').reduce((a, r) => a + r.amount, 0))} USD</b></div></div>` +
        table([['№'], ['Дата'], ['Клиент'], ['Склад'], ['Позиций', 1], ['Сумма', 1], ['Статус']],
          rows.map(r => `<tr class="row" data-id="${r.id}"><td>${r.id}</td><td>${r.date}</td><td>${esc(r.client)}</td><td>${esc(r.warehouse)}</td><td class="n">${r.items}</td><td class="n">${fmt(r.amount)}</td><td><span class="badge ${r.status}">${STATUS[r.status]}</span></td></tr>`));
      el.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => orderModal(+tr.dataset.id, load));
    };
    $('#go', el).onclick = load; $('#q', el).onkeydown = e => e.key === 'Enter' && load();
    $('#new', el).onclick = () => newOrderModal(kind, load);
    load();
  },
  returns: el => PAGES.orders(el, 'return'),
  async stock(el) {
    const rows = await api('/api/stock');
    el.innerHTML = `<h2>Остаток</h2>` + table([['Товар'], ['Бренд'], ['Склад'], ['Кол-во', 1]], rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.brand)}</td><td>${esc(r.warehouse)}</td><td class="n">${r.qty}</td></tr>`));
  },
  async payments(el) {
    const [rows, clients, boxes] = await Promise.all([api('/api/payments'), api('/api/clients'), api('/api/cashboxes')]);
    el.innerHTML = `<h2>Оплаты от клиентов</h2><div class="bar"><select id="c">${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><select id="box">${boxes.map(b => `<option>${esc(b.name)}</option>`).join('')}</select><input id="a" type="number" placeholder="Сумма"><button class="btn" id="add">Добавить оплату</button></div>` +
      table([['Дата'], ['Клиент'], ['Касса'], ['Сумма', 1]], rows.map(r => `<tr><td>${r.date}</td><td>${esc(r.client)}</td><td>${esc(r.cashbox)}</td><td class="n pos">${fmt(r.amount)}</td></tr>`));
    $('#add', el).onclick = async () => { const a = +$('#a', el).value; if (!a) return; await api('/api/payments', { method: 'POST', body: { client_id: +$('#c', el).value, amount: a, cashbox: $('#box', el).value } }); PAGES.payments(el); };
  },
  async cash(el) {
    el.innerHTML = `<h2>Управление кассой</h2><div class="bar">
      С <input type="date" id="f" value="2026-10-01"> по <input type="date" id="t" value="2026-10-08">
      <select id="box"><option value="">Все кассы</option></select><button class="btn" id="go">Показать</button><span class="spacer"></span>
      <button class="btn" id="inc">+ Приход</button><button class="btn danger" id="exp">− Расход</button><button class="btn gray" id="trf">⇄ Перевод</button></div><div id="out"></div>`;
    let boxes = [];
    const load = async () => {
      const [f, t, box] = [$('#f', el).value, $('#t', el).value, $('#box', el).value];
      const [bx, ops] = await Promise.all([api(`/api/cashboxes?from=${f}&to=${t}`), api(`/api/cash/ops?from=${f}&to=${t}&cashbox=${encodeURIComponent(box)}`)]);
      boxes = bx;
      if ($('#box', el).options.length === 1) $('#box', el).innerHTML += bx.map(b => `<option>${esc(b.name)}</option>`).join('');
      $('#out', el).innerHTML = `<div class="cards">${bx.map(b => `<div class="card"><small>${esc(b.name)}</small><b class="${cls(b.balance)}">${fmt(b.balance)} USD</b><small>за период: <span class="pos">+${fmt(b.income)}</span> / <span class="neg">−${fmt(b.expense)}</span></small></div>`).join('')}
        <div class="card"><small>Всего в кассах</small><b>${fmt(bx.reduce((a, b) => a + b.balance, 0))} USD</b></div></div>` +
        table([['Дата'], ['Касса'], ['Категория'], ['Комментарий'], ['Сумма', 1]], ops.map(o => `<tr><td>${o.date}</td><td>${esc(o.cashbox)}</td><td>${esc(o.category)}</td><td>${esc(o.comment)}</td>${money(o.amount)}</tr>`));
    };
    const form = (title, fields, path, mk) => () => {
      const m = modal(`<h3>${title}</h3><div class="form">${fields(boxes)}<label>Сумма<input id="am" type="number" min="0" step="0.01"></label><label>Дата<input id="dt" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Комментарий<input id="cm"></label></div><small id="err" class="neg"></small><div class="bar"><span class="spacer"></span><button class="btn gray" id="x">Отмена</button><button class="btn" id="ok">Сохранить</button></div>`);
      $('#x', m.el).onclick = m.close;
      $('#ok', m.el).onclick = async () => {
        const d = await api('/api/cash/' + path, { method: 'POST', body: { ...mk(m.el), amount: +$('#am', m.el).value, date: $('#dt', m.el).value, comment: $('#cm', m.el).value } });
        if (d.error) return $('#err', m.el).textContent = d.error;
        m.close(); load();
      };
    };
    const opts = b => b.map(x => `<option>${esc(x.name)}</option>`).join('');
    $('#inc', el).onclick = form('Приход в кассу', b => `<label>Касса<select id="cb">${opts(b)}</select></label><label>Категория<input id="cat" placeholder="Например: Взнос"></label>`, 'income', m => ({ cashbox: $('#cb', m).value, category: $('#cat', m).value }));
    $('#exp', el).onclick = form('Расход из кассы', b => `<label>Касса<select id="cb">${opts(b)}</select></label><label>Категория<input id="cat" placeholder="Например: Бензин"></label>`, 'expense', m => ({ cashbox: $('#cb', m).value, category: $('#cat', m).value }));
    $('#trf', el).onclick = form('Перевод между кассами', b => `<label>Из кассы<select id="fr">${opts(b)}</select></label><label>В кассу<select id="to">${opts(b)}</select></label>`, 'transfer', m => ({ from: $('#fr', m).value, to: $('#to', m).value }));
    $('#go', el).onclick = load; load();
  },
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
  const menu = Object.entries(MENU).map(([top, groups]) => {
    const gs = Object.entries(groups).map(([g, items]) => [g, items.filter(([, r]) => canOpen(r))]).filter(([, items]) => items.length);
    return gs.length ? `<div class="menu"><button>${top}</button><div class="drop">${gs.map(([g, items]) => `<div>${g ? `<h4>${g}</h4>` : ''}${items.map(([t, r]) => `<a href="#/${r}">${t}</a>`).join('')}</div>`).join('')}</div></div>` : '';
  }).join('');
  app.innerHTML = `<nav class="top"><button class="burger" id="burger" aria-label="Меню" aria-expanded="false">☰</button><a class="logo" href="#/${landing() || 'home'}">crm</a><div class="menus">${menu}</div><span class="spacer"></span>
    ${me.branch ? `<span class="branchlock" title="Ваш доступ ограничен этим филиалом">Филиал: ${esc(me.branch)}</span>` : '<select id="branch" class="branch" title="Филиал" aria-label="Филиал"><option value="">Все филиалы</option></select>'}
    ${can('settings.view') ? '<a class="gear" href="#/settings" title="Настройки: пользователи и роли" aria-label="Настройки">⚙</a>' : ''}
    <span class="user" id="me" title="Профиль и смена пароля">${esc(me.name)}<span class="role"> · ${esc(me.role)}</span></span><span class="user" id="out">Выйти</span></nav><main id="page"></main>`;
  const nav = $('nav.top'), burger = $('#burger');
  burger.onclick = () => { const open = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', open); };
  nav.querySelectorAll('.drop a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); a.blur(); }));
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
  const name = location.hash.replace('#/', '') || 'home';
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
