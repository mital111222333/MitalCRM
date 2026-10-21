/**
 * MITAL CRM — автозагрузка из LINKO (Google Apps Script, бесплатно).
 * Каждые 5 минут (с 7 до 22) берёт из LINKO баланс клиентов (с начала периода плана по сегодня) и остатки всех складов
 * и кладёт их в ваш приватный репозиторий mitalcrm-data (файл linko-latest.json), а копию каждого дня — в папку archive/.
 * Оплаты — тоже каждые 5 минут (файл linko-fast.json; какие разделы быстрые, решает CRM: "every": 5 в linko-jobs.json).
 * Раз в 30 минут — заказы, товары, возвраты, долги по срокам, работу агентов и др. (файл linko-extra.json).
 * CRM на любом устройстве, включая телефон, при открытии сама забирает эти данные.
 * Кнопка «🔄 Обновить» в CRM: если скрипт опубликован как веб-приложение (см. doGet ниже), он по нажатию сразу
 * берёт ВСЁ из LINKO — баланс, остатки, заказы, оплаты, долги — одновременно (параллельно) и отдаёт прямо в CRM.
 *
 * Как поставить: см. CRM → «Данные → Синхронизация и настройки» → «Автозагрузка из LINKO».
 * Заполните 3 строки ниже, сохраните (Ctrl+S), выберите функцию «setup» и нажмите «Выполнить».
 */
const CFG = {
  LINKO_TOKEN: 'ВСТАВЬТЕ_КЛЮЧ_LINKO',      // 40 символов, из консоли LINKO (см. инструкцию в CRM)
  GH_TOKEN: 'ВСТАВЬТЕ_КЛЮЧ_GITHUB',        // тот же ключ github_pat_…, что вы вставляли в CRM для синхронизации
  PLAN_DAY: 16,                            // с какого числа начинается период плана
  GH_OWNER: 'mital111222333',
  GH_REPO: 'mitalcrm-data',
  LINKO_API: 'https://mital.linko.uz/ru/api/v1/',
  TZ: 'Asia/Tashkent',
  CRM_URL: 'https://mital111222333.github.io/MitalCRM/', // отсюда скрипт берёт список разделов LINKO (linko-jobs.json)
  GPS_URL: 'http://gps.logic.uz',         // GPS-платформа агентов
  GPS_EMAIL: '',                           // логин от GPS (вписывается из CRM)
  GPS_PASSWORD: '',                        // пароль от GPS
  EXTRA_MIN: 30,                           // заказы, товары, оплаты, долги, работа агентов — раз в 30 минут
  TG_BOT: '',                              // токен Telegram-бота (вписывается из CRM): сообщит о сбое и о заказе клиенту на стопе
  TG_CHAT: '',                             // необязательно: ваш chat id
  WEB_KEY: 'ВСТАВЬТЕ_КЛЮЧ_КНОПКИ',          // секрет кнопки «Обновить» (вписывается из CRM) — без него веб-приложение никому не отвечает
};

function setup() {
  // only this loader's own timer is replaced — the reminders' trigger (remind.gs) stays as it is
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().deleteAllProperties();
  run();
  Logger.log('Готово: автозагрузка будет работать каждые 5 минут (с 7 до 22).');
}

function run() {
  const hour = Number(Utilities.formatDate(new Date(), CFG.TZ, 'H'));
  if (hour < 7 || hour > 22) return; // ночью данные не меняются
  const lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) { Logger.log('Сейчас идёт обновление по кнопке — пропускаю'); return; }
  try { run0_(); } finally { lock.releaseLock(); }
}
function run0_() {
  base_();
  try { gps_(); } catch (e) { Logger.log('GPS: ' + mask_(e.message || e)); }
  let jobs = null; try { jobs = jobs_(); } catch (e) { Logger.log('Список разделов: ' + mask_(e.message || e)); }
  if (jobs) try { fast_(jobs); } catch (e) { Logger.log('Оплаты: ' + mask_(e.message || e)); }
  if (jobs) try { extra_(jobs); } catch (e) { Logger.log('Доп. данные: ' + mask_(e.message || e)); }
}

function base_() {
  let snap;
  try { snap = collect_(); }
  catch (e) {
    snap = { at: new Date().toISOString(), error: mask_(e.message || e), files: [] };
    const P0 = PropertiesService.getScriptProperties();
    const fails = Number(P0.getProperty('failN') || 0) + 1; P0.setProperty('failN', String(fails));
    if (fails < 3) { Logger.log('Сбой связи с LINKO (' + fails + '-й раз подряд), попробую через 5 минут: ' + snap.error); return; }
    // tell about an error once, not every 5 minutes
    if (P0.getProperty('lastErr') !== snap.error) { notify_('⚠ MITAL CRM: автозагрузка из LINKO не сработала — ' + snap.error); P0.setProperty('lastErr', snap.error); }
  }
  if (!snap.error) { PropertiesService.getScriptProperties().deleteProperty('lastErr'); PropertiesService.getScriptProperties().deleteProperty('failN'); }
  // write to GitHub only when something changed in LINKO (or once an hour as a heartbeat) — keeps quotas and history small
  const P = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([snap.error || '', snap.files]), Utilities.Charset.UTF_8));
  const last = Number(P.getProperty('savedAt') || 0);
  if (hash === P.getProperty('hash') && Date.now() - last < 3600 * 1000) { Logger.log('Без изменений — пропускаю'); return; }
  const txt = JSON.stringify(snap); saveToGithub_('linko-latest.json', txt); try { archive_('latest', txt); } catch (e) { Logger.log('Архив: ' + mask_(e.message || e)); }
  P.setProperties({ hash: hash, savedAt: String(Date.now()) });
  Logger.log(snap.error ? 'Ошибка: ' + snap.error : 'Сохранено файлов: ' + snap.files.length);
}

function collect_() {
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const from = planFrom_(today), files = [];
  const q = 'only_out_stock=False&is_only_delivered=False&last_status=False&exclude_closed_clients=false&only_payment_with_invoice=false&begin_date=' + from + '&end_date=' + today;
  // 1) client balance: LINKO's Excel export (it has agents), otherwise the same numbers from the API
  let got = false;
  for (const u of [CFG.LINKO_API + 'stats/client_balances_expanded/export/?token=' + CFG.LINKO_TOKEN + '&' + q, CFG.LINKO_API + 'stats/client_balances_expanded/export/?' + q]) {
    let r; try { r = fetch_(u, { headers: auth_(), muteHttpExceptions: true, followRedirects: true }); } catch (e) { continue; }
    const b = r.getContent();
    if (r.getResponseCode() === 200 && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b) { files.push({ name: 'balance - ' + today + 'T000000.xlsx', b64: Utilities.base64Encode(b) }); got = true; break; }
  }
  if (!got) {
    const list = all_('stats/client_balances_expanded/?' + q + '&page=1&page_size=500');
    const rows = [['№', 'Клиент', 'Агент', 'Баланс на начало периода', 'Продано', 'Возврат', 'Оплачено', 'Прочие приходы', 'Прочие расходы', 'Баланс на конец']];
    list.forEach(c => { const u = (c.currencies || []).filter(x => x.name === 'USD')[0] || {}; rows.push([c.client_id || c.id, c.name, '', n_(u.begin_balance), n_(u.order), n_(u.order_return), n_(u.payment), n_(u.none_type_plus), n_(u.none_type_minus), n_(u.end_balance)]); });
    files.push({ name: 'balance - ' + today + 'T000000.csv', b64: Utilities.base64Encode(csv_(rows), Utilities.Charset.UTF_8) });
  }
  // 2) stock of every warehouse (branch) that has goods; the list of branches is looked up once every 6 hours
  const P = PropertiesService.getScriptProperties();
  let known = null; try { known = JSON.parse(P.getProperty('branches') || 'null'); } catch (e) { known = null; }
  const fresh = known && Date.now() - Number(P.getProperty('branchesAt') || 0) < 6 * 3600 * 1000;
  const probe = fresh ? known : Array.from({ length: 20 }, (_, i) => i + 1), found = [];
  for (const br of probe) {
    let list; try { list = all_('stock/all_balances/?in_way=true&page=1&branch=' + br + '&page_size=500&show_in=amount'); } catch (e) { if (/ключ/.test(e.message)) throw e; continue; }
    const wasKnown = !!(known && known.indexOf(br) >= 0);
    if (!wasKnown && (!list.length || !list.some(p => n_(p.balance) || n_(p.reserved)))) continue;
    found.push(br);
    const rows = [['Продукт', 'Код', 'Aртикул', 'Тип продукта', 'Бренд', 'Ед. изм.', 'Всего товаров', 'В пути', 'Зарезервированный', 'Доступный']];
    list.forEach(p => rows.push([p.title, p.product_code || '', p.vendor_code || '', (p.type || {}).name || '', (p.brand || {}).brand || '', (p.measurement || {}).name || '', n_(p.balance), n_(p.in_way), n_(p.reserved), n_(p.available)]));
    files.push({ name: 'stock LINKO branch ' + br + '.csv', b64: Utilities.base64Encode(csv_(rows), Utilities.Charset.UTF_8) });
  }
  if (!fresh && found.length) P.setProperties({ branches: JSON.stringify(found), branchesAt: String(Date.now()) });
  if (fresh && !found.length) P.deleteProperty('branchesAt'); // nothing found among known branches — look them all up next time
  if (!files.length) throw new Error('LINKO ничего не отдал');
  return { at: new Date().toISOString(), from: from, to: today, files: files };
}

// agents' positions from the GPS platform (GPS Server / GPSWOX API) → gps-latest.json
function gps_() {
  if (!CFG.GPS_EMAIL || !CFG.GPS_PASSWORD) return;
  const P = PropertiesService.getScriptProperties(), url0 = CFG.GPS_URL.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');
  // gps.logic.uz may work only over http (or only https): try both and remember the one that answers
  const both = [url0, url0.indexOf('https:') === 0 ? url0.replace('https:', 'http:') : url0.replace('http:', 'https:')];
  let base = P.getProperty('gpsBase') || url0;
  const login = () => {
    let r = null, err = '';
    for (const b of [base].concat(both.filter(x => x !== base))) {
      try { r = fetch_(b + '/api/login', { method: 'post', payload: { email: CFG.GPS_EMAIL, password: CFG.GPS_PASSWORD }, muteHttpExceptions: true, followRedirects: true }); base = b; P.setProperty('gpsBase', b); break; }
      catch (e) { err = String(e.message || e); r = null; }
    }
    if (!r) throw new Error('GPS-платформа не отвечает Google (' + mask_(err) + ')');
    let j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error('GPS: вход не удался (' + r.getResponseCode() + ')'); }
    if (!j.user_api_hash) throw new Error('GPS: неверный логин или пароль');
    P.setProperty('gpsHash', j.user_api_hash); return j.user_api_hash;
  };
  const call = (path, hash) => fetch_(base + '/api/' + path + (path.indexOf('?') < 0 ? '?' : '&') + 'lang=ru&user_api_hash=' + encodeURIComponent(hash), { muteHttpExceptions: true });
  let snap;
  try {
    let hash = P.getProperty('gpsHash') || login(), r;
    try { r = call('get_devices', hash); } catch (e) { P.deleteProperty('gpsBase'); base = url0; hash = login(); r = call('get_devices', hash); }
    if (r.getResponseCode() === 401 || r.getResponseCode() === 403 || /"status"\s*:\s*0/.test(r.getContentText().slice(0, 200))) { hash = login(); r = call('get_devices', hash); }
    if (r.getResponseCode() !== 200) throw new Error('GPS ответил ' + r.getResponseCode());
    const devices = [];
    JSON.parse(r.getContentText()).forEach(g => (g.items || []).forEach(d => devices.push({ id: d.id, name: d.name, group: g.title, online: d.online, time: d.time, timestamp: d.timestamp, lat: d.lat, lng: d.lng, speed: d.speed, course: d.course, stop_duration: d.stop_duration, address: d.address, tail: (d.tail || []).slice(-15) })));
    snap = { at: new Date().toISOString(), devices: devices.map(d => ({ ...d, id: String(d.id) })), live: { url: base, hash: hash } };
    // clients marked on the GPS map: points (map icons) and zones (geofences) — once an hour
    if (Date.now() - Number(P.getProperty('poiAt') || 0) > 3600 * 1000) {
      P.setProperty('poiAt', String(Date.now()));
      const pois = [], info = [];
      ['get_user_map_icons', 'get_geofences'].forEach(path => {
        try {
          const m = call(path, hash); info.push(path + ' ' + m.getResponseCode());
          if (m.getResponseCode() === 200) pointsOf_(JSON.parse(m.getContentText())).forEach(p => pois.push(p));
        } catch (e) { info.push(path + ' ' + (e.message || e)); }
      });
      snap.pois = pois; snap.poisInfo = info.join(', ');
    }
  } catch (e) { snap = { at: new Date().toISOString(), error: mask_(e.message || e), devices: [] }; }
  if (snap.pois) { saveToGithub_('gps-pois.json', JSON.stringify({ at: snap.at, pois: snap.pois })); snap.poisCount = snap.pois.length; delete snap.pois; }
  saveToGithub_('gps-latest.json', JSON.stringify(snap));
  Logger.log(snap.error ? 'GPS ошибка: ' + snap.error : 'GPS: устройств ' + snap.devices.length + (snap.poisCount != null ? ', клиентов на карте ' + snap.poisCount + ' (' + snap.poisInfo + ')' : ''));
}

// finds named places with coordinates anywhere in a GPS answer: {name, lat, lng} | {coordinates:{lat,lng}|"json"} | {center} | polygon
function pointsOf_(j) {
  const out = [], seen = {};
  const coord = v => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } } if (Array.isArray(v) && v.length) { let la = 0, ln = 0, n = 0; v.forEach(p => { const c = coord(p); if (c) { la += c.lat; ln += c.lng; n++; } }); return n ? { lat: la / n, lng: ln / n } : null; } if (v && typeof v === 'object') { const la = Number(v.lat != null ? v.lat : v.latitude), ln = Number(v.lng != null ? v.lng : v.lon != null ? v.lon : v.longitude); if (la && ln) return { lat: la, lng: ln }; } return null; };
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 6) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, d + 1)); return; }
    const name = o.name || o.title;
    if (name && typeof name === 'string') { const c = coord(o.center) || coord(o.coordinates) || coord(o.polygon) || coord(o); if (c && !seen[name]) { seen[name] = 1; out.push({ name: name, lat: c.lat, lng: c.lng }); return; } }
    Object.keys(o).forEach(k => walk(o[k], d + 1));
  };
  walk(j, 0); return out;
}

// the list of LINKO sections comes from the CRM site, so new data needs no new script
function jobs_() { return JSON.parse(fetch_(CFG.CRM_URL + 'linko-jobs.json?t=' + Date.now(), { muteHttpExceptions: true }).getContentText()); }
function runJobs_(jobs, from, to, data, errors) {
  jobs.forEach(j => {
    try {
      const path = j.path.replace(/\{from\}/g, from).replace(/\{to\}/g, to);
      let rows = [], next = path, n = 0;
      while (next && n++ < 60) { const r = get_(next); if (Array.isArray(r)) { rows = rows.concat(r); next = null; } else if (r && Array.isArray(r.results)) { rows = rows.concat(r.results); next = r.next; } else { rows.push(r); next = null; } }
      data[j.id] = rows.map(r => pick_(r, j.pick));
    } catch (e) { errors[j.id] = mask_(e.message || e); if (/ключ/.test(errors[j.id])) throw e; }
  });
}
// sections marked "every": 5 in linko-jobs.json (payments) — every run, into their own small file
function fast_(all) {
  const jobs = all.filter(j => j.every && j.every < CFG.EXTRA_MIN); if (!jobs.length) return;
  const P = PropertiesService.getScriptProperties();
  const to = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), from = planFrom_(to), data = {}, errors = {};
  runJobs_(jobs, from, to, data, errors);
  try { stop_(data); } catch (e) { Logger.log('Стоп-отгрузка: ' + mask_(e.message || e)); }
  if (!Object.keys(data).length) return;
  const body = JSON.stringify({ data: data, from: from });
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, body, Utilities.Charset.UTF_8));
  if (hash === P.getProperty('fastHash') && Date.now() - Number(P.getProperty('fastSavedAt') || 0) < 15 * 60000) return;
  const txt = JSON.stringify({ at: new Date().toISOString(), from: from, to: to, data: data, errors: errors }); saveToGithub_('linko-fast.json', txt); try { archive_('fast', txt); } catch (e) { Logger.log('Архив: ' + mask_(e.message || e)); }
  P.setProperties({ fastHash: hash, fastSavedAt: String(Date.now()) });
  Logger.log('Оплаты сохранены: ' + Object.keys(data).map(k => k + ' ' + data[k].length).join(', '));
}
function extra_(all) {
  const P = PropertiesService.getScriptProperties();
  if (Date.now() - Number(P.getProperty('extraAt') || 0) < CFG.EXTRA_MIN * 60000) return;
  P.setProperty('extraAt', String(Date.now()));
  const jobs = all.filter(j => !(j.every && j.every < CFG.EXTRA_MIN));
  const to = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), from = planFrom_(to), data = {}, errors = {};
  runJobs_(jobs, from, to, data, errors);
  if (Object.keys(errors).length > jobs.length / 2) { P.deleteProperty('extraAt'); Logger.log('Доп. данные: LINKO не отвечает, попробую через 5 минут'); return; }
  const body = JSON.stringify({ data: data, errors: errors });
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, body, Utilities.Charset.UTF_8));
  if (hash === P.getProperty('extraHash')) { Logger.log('Доп. данные без изменений'); return; }
  const txt = JSON.stringify({ at: new Date().toISOString(), from: from, to: to, data: data, errors: errors }); saveToGithub_('linko-extra.json', txt); try { archive_('extra', txt); } catch (e) { Logger.log('Архив: ' + mask_(e.message || e)); }
  P.setProperty('extraHash', hash);
  Logger.log('Доп. данные сохранены: ' + Object.keys(data).map(k => k + ' ' + data[k].length).join(', ') + (Object.keys(errors).length ? ' · ошибки: ' + Object.keys(errors).map(k => k + ' (' + String(errors[k]).slice(0, 80) + ')').join(', ') : ''));
}
function get2_(o, k) { if (o == null) return undefined; if (Object.prototype.hasOwnProperty.call(o, k)) return o[k]; return k.split('.').reduce((v, p) => (v == null ? undefined : v[p]), o); }
function pick_(row, keys) { if (!keys || !keys.length || row == null || typeof row !== 'object') return row; const o = {}; keys.forEach(k => { const v = get2_(row, k); if (v !== undefined && v !== null && v !== '') o[k] = v; }); return o; }

// never let a key get into a message: LINKO key, GPS key and GitHub key are replaced by ***
function mask_(t) { return String(t).replace(/(token|user_api_hash|hash)=[^&\s]+/gi, '$1=***').replace(/\b[0-9a-f]{40}\b/gi, '***').replace(/github_pat_\w+/g, '***').replace(/Token [^\s"]+/g, 'Token ***'); }
// a network hiccup ("Address unavailable", timeouts) is retried twice before giving up
function fetch_(url, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return UrlFetchApp.fetch(url, opts); }
    catch (e) { last = e; Utilities.sleep(1500 * (i + 1)); }
  }
  throw new Error(mask_((last && last.message) || last));
}

// ---------- «🔄 Обновить» в CRM: веб-приложение, которое по нажатию сразу берёт всё из LINKO ----------
// Опубликовать: «Начать развёртывание» → «Новое развёртывание» → тип «Веб-приложение», запуск от «Меня»,
// доступ «Все» → «Начать развёртывание» → скопировать URL и вставить в CRM («Данные → Синхронизация и настройки»).
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.agent) return json_(agent_(p.agent)); // кабинет агента: только его файл, без ключа кнопки
  if (!CFG.WEB_KEY || CFG.WEB_KEY.indexOf('ВСТАВЬТЕ') === 0 || p.k !== CFG.WEB_KEY) return json_({ error: 'Нет доступа: ключ кнопки не совпадает. Скопируйте скрипт из CRM заново.' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return json_({ error: 'LINKO сейчас уже обновляется — нажмите ещё раз через минуту' });
  try { return json_(now_()); }
  catch (err) { return json_({ error: mask_(err.message || err) }); }
  finally { lock.releaseLock(); }
}
// ---------- кабинет агента: по личному коду отдаётся только его файл agents/<sha256(код)>.json (его готовит CRM руководителя) ----------
function agent_(code) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(code))) return { error: 'Ссылка неверная — попросите руководителя прислать её заново' };
  const hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(code), Utilities.Charset.UTF_8).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
  const cache = CacheService.getScriptCache(), hit = cache.get('ag_' + hex); if (hit) return JSON.parse(hit);
  const r = fetch_('https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/agents/' + hex + '.json', { headers: { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return { error: 'Доступ закрыт или ссылка устарела — попросите руководителя прислать новую' };
  if (r.getResponseCode() !== 200) return { error: 'Не удалось получить данные, попробуйте через минуту' };
  const out = JSON.stringify(live_(JSON.parse(r.getContentText()))); // + свежие остатки, долги и сегодняшний отчёт
  if (out.length < 90000) cache.put('ag_' + hex, out, 60); // минута: чтобы частые открытия не нагружали GitHub
  return JSON.parse(out);
}
// Свежие данные в кабинет агента: поверх файла, который подготовила CRM руководителя, подставляются остатки его склада и долги его
// клиентов из linko-latest / linko-fast (обновляются каждые 5 минут) и сегодняшний первый отчёт из linko-extra. Ошибка здесь не мешает:
// агент тогда видит данные из последнего расчёта CRM.
function live_(snap) {
  const read = name => { const r = fetch_('https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + name, { headers: { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, muteHttpExceptions: true }); return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null; };
  const live = {};
  // 1) остатки склада агента
  if (snap.stock && snap.stock.branch) try {
    const L = read('linko-latest.json'), f = L && (L.files || []).filter(x => x.name === 'stock LINKO branch ' + snap.stock.branch + '.csv')[0];
    if (f) {
      const text = Utilities.newBlob(Utilities.base64Decode(f.b64)).getDataAsString('UTF-8').replace(/^﻿/, '');
      const rows = Utilities.parseCsv(text, ';'), h = rows[0] || [], col = n => h.indexOf(n);
      const iName = col('Продукт'), iArt = col('Aртикул'), iBrand = col('Бренд'), iTotal = col('Всего товаров'), iAv = col('Доступный');
      const items = rows.slice(1).filter(r => r[iName]).map(r => ({ name: r[iName], art: r[iArt] || '', brand: r[iBrand] || '', available: n_(String(r[iAv]).replace(',', '.')), total: n_(String(r[iTotal]).replace(',', '.')) }))
        .filter(i => i.total || i.available).sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
      if (items.length) { snap.stock.items = items; snap.stock.at = String(L.at || '').slice(0, 10); live.stock = L.at; }
    }
  } catch (e) { Logger.log('Кабинет, остатки: ' + mask_(e.message || e)); }
  // 2) долги клиентов агента
  try {
    const F = read('linko-fast.json'), norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    if (F && F.data && F.data.debtors) {
      const debt = {};
      F.data.debtors.forEach(d => { const cs = Array.isArray(d.currencies) ? d.currencies : [], c = cs.filter(x => /usd|\$|долл/i.test(x.name || ''))[0] || cs[0] || {}; debt[norm(d['client.name'])] = Math.round(Math.abs(n_(c.debt_total))); });
      let sum = 0, cnt = 0;
      (snap.clients || []).forEach(c => { const k = norm(c.name); c.debt = k in debt ? debt[k] : 0; sum += c.debt; if (c.debt > 0) cnt++; });
      (snap.clients || []).sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));
      snap.kpi.debt = sum; snap.kpi.debtors = cnt; live.debt = F.at;
    }
  } catch (e) { Logger.log('Кабинет, долги: ' + mask_(e.message || e)); }
  // 3) сегодняшний первый отчёт и штраф
  if (snap.disc) try {
    const X = read('linko-extra.json'), words = s => String(s || '').toLowerCase().split(/\s+/).filter(String).sort().join(' ');
    const me = words(snap.agent), w = X && X.data && (X.data.workday || []).filter(r => words([r.first_name, r.second_name].join(' ')) === me)[0];
    const t = w && String(w['first_done_task_time.date'] || ''), today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
    if (t && t.slice(0, 10) === today) {
      const hm = t.slice(11, 16), m = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)), late = Math.max(0, m(hm) - m(snap.disc.start || '08:45'));
      const before = (snap.disc.days || []).filter(d => d.day === today)[0], was = before ? before.late || 0 : 0;
      snap.disc.minutes = (snap.disc.minutes || 0) - was + late; snap.disc.fine = snap.disc.minutes * (snap.disc.rate || 0);
      snap.disc.late = (snap.disc.late || 0) - (was ? 1 : 0) + (late ? 1 : 0);
      snap.disc.today = { first: hm, late: late };
      snap.disc.days = (snap.disc.days || []).filter(d => d.day !== today).concat([{ day: today, first: hm, late: late, plan: n_(w.total_tasks_by_market), done: n_(w.total_tasks_done_by_market) }]);
      live.disc = X.at;
    }
  } catch (e) { Logger.log('Кабинет, дисциплина: ' + mask_(e.message || e)); }
  snap.live = live;
  return snap;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// everything at once: the balance export, every warehouse and every LINKO section are asked in parallel,
// then only the next pages of long lists — so a press takes about as long as the slowest single LINKO answer
function now_() {
  const t0 = Date.now(), at = new Date().toISOString();
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), from = planFrom_(today);
  let jobs = []; try { jobs = jobs_(); } catch (e) { Logger.log('Список разделов: ' + mask_(e.message || e)); }
  const P = PropertiesService.getScriptProperties();
  let known = null; try { known = JSON.parse(P.getProperty('branches') || 'null'); } catch (e) { known = null; }
  const branches = known && known.length ? known : Array.from({ length: 20 }, (_, i) => i + 1);
  const q = 'only_out_stock=False&is_only_delivered=False&last_status=False&exclude_closed_clients=false&only_payment_with_invoice=false&begin_date=' + from + '&end_date=' + today;
  const lists = [];
  branches.forEach(br => lists.push({ key: 'st' + br, br: br, url: 'stock/all_balances/?in_way=true&page=1&branch=' + br + '&page_size=500&show_in=amount' }));
  jobs.forEach(j => lists.push({ key: 'job:' + j.id, job: j, url: j.path.replace(/\{from\}/g, from).replace(/\{to\}/g, today) }));
  const balUrl = CFG.LINKO_API + 'stats/client_balances_expanded/export/?token=' + CFG.LINKO_TOKEN + '&' + q;
  const got = pages_(lists, [{ url: balUrl, headers: auth_(), muteHttpExceptions: true, followRedirects: true }]);
  const files = [], br = got.raw[0];
  // 1) client balance
  const b = br && br.getContent ? br.getContent() : null;
  if (br && br.getResponseCode && br.getResponseCode() === 200 && b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b) files.push({ name: 'balance - ' + today + 'T000000.xlsx', b64: Utilities.base64Encode(b) });
  else {
    const list = all_('stats/client_balances_expanded/?' + q + '&page=1&page_size=500');
    const rows = [['№', 'Клиент', 'Агент', 'Баланс на начало периода', 'Продано', 'Возврат', 'Оплачено', 'Прочие приходы', 'Прочие расходы', 'Баланс на конец']];
    list.forEach(c => { const u = (c.currencies || []).filter(x => x.name === 'USD')[0] || {}; rows.push([c.client_id || c.id, c.name, '', n_(u.begin_balance), n_(u.order), n_(u.order_return), n_(u.payment), n_(u.none_type_plus), n_(u.none_type_minus), n_(u.end_balance)]); });
    files.push({ name: 'balance - ' + today + 'T000000.csv', b64: Utilities.base64Encode(csv_(rows), Utilities.Charset.UTF_8) });
  }
  // 2) warehouses
  const found = [];
  lists.filter(l => l.br).forEach(l => {
    const r = got.out[l.key]; if (!r || r.error) return;
    const wasKnown = !!(known && known.indexOf(l.br) >= 0);
    if (!wasKnown && (!r.rows.length || !r.rows.some(p => n_(p.balance) || n_(p.reserved)))) return;
    found.push(l.br);
    const rows = [['Продукт', 'Код', 'Aртикул', 'Тип продукта', 'Бренд', 'Ед. изм.', 'Всего товаров', 'В пути', 'Зарезервированный', 'Доступный']];
    r.rows.forEach(p => rows.push([p.title, p.product_code || '', p.vendor_code || '', (p.type || {}).name || '', (p.brand || {}).brand || '', (p.measurement || {}).name || '', n_(p.balance), n_(p.in_way), n_(p.reserved), n_(p.available)]));
    files.push({ name: 'stock LINKO branch ' + l.br + '.csv', b64: Utilities.base64Encode(csv_(rows), Utilities.Charset.UTF_8) });
  });
  if (!(known && known.length) && found.length) P.setProperties({ branches: JSON.stringify(found), branchesAt: String(Date.now()) });
  // 3) sections: the fast ones (payments, orders, debts) and the rest
  const fast = { at: at, from: from, to: today, data: {}, errors: {} }, extra = { at: at, from: from, to: today, data: {}, errors: {} };
  lists.filter(l => l.job).forEach(l => {
    const r = got.out[l.key], box = l.job.every && l.job.every < CFG.EXTRA_MIN ? fast : extra;
    if (!r || r.error) box.errors[l.job.id] = (r && r.error) || 'нет ответа'; else box.data[l.job.id] = r.rows.map(x => pick_(x, l.job.pick));
  });
  if (Object.values(got.out).some(r => r && /ключ/.test(r.error || ''))) throw new Error('LINKO не принял ключ (401): возьмите новый ключ LINKO и вставьте в скрипт');
  Logger.log('Обновление по кнопке: ' + (Date.now() - t0) + ' мс, файлов ' + files.length + ', разделов ' + (Object.keys(fast.data).length + Object.keys(extra.data).length));
  return { at: at, ms: Date.now() - t0, latest: { at: at, from: from, to: today, files: files }, fast: fast, extra: extra };
}
// all pages of many LINKO lists at once: round 1 asks every first page (plus `raw` requests) in parallel,
// next rounds ask only the following pages of the lists that have them
function pages_(lists, raw) {
  const out = {}, nexts = {};
  lists.forEach(l => { out[l.key] = { rows: [] }; nexts[l.key] = l.url; });
  let rawRes = [], round = 0;
  while (round < 60) {
    const keys = Object.keys(nexts).filter(k => nexts[k]);
    const reqs = keys.map(k => { const u = nexts[k]; return { url: u.indexOf('http') === 0 ? u : CFG.LINKO_API + u, headers: auth_(), muteHttpExceptions: true }; });
    const extraReqs = round === 0 ? (raw || []) : [];
    if (!reqs.length && !extraReqs.length) break;
    const res = fetchAll_(extraReqs.concat(reqs));
    if (round === 0) rawRes = res.slice(0, extraReqs.length);
    res.slice(extraReqs.length).forEach((r, i) => {
      const k = keys[i]; nexts[k] = null;
      if (r instanceof Error) { out[k].error = mask_(r.message); return; }
      const code = r.getResponseCode();
      if (code === 401) { out[k].error = 'LINKO не принял ключ (401)'; return; }
      if (code !== 200) { out[k].error = 'LINKO ответил ' + code; return; }
      let j; try { j = JSON.parse(r.getContentText()); } catch (e) { out[k].error = 'LINKO прислал не JSON'; return; }
      if (Array.isArray(j)) out[k].rows = out[k].rows.concat(j);
      else if (j && Array.isArray(j.results)) { out[k].rows = out[k].rows.concat(j.results); nexts[k] = j.next || null; }
      else out[k].rows.push(j);
    });
    round++;
  }
  return { out: out, raw: rawRes };
}
// UrlFetchApp.fetchAll, but one network hiccup does not break the whole batch: the failed ones are retried one by one
function fetchAll_(reqs) {
  if (!reqs.length) return [];
  try { return UrlFetchApp.fetchAll(reqs); }
  catch (e) { return reqs.map(r => { try { const o = Object.assign({}, r); delete o.url; return fetch_(r.url, o); } catch (e2) { return e2 instanceof Error ? e2 : new Error(String(e2)); } }); }
}

function planFrom_(d) {
  let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (Number(d.slice(8, 10)) < CFG.PLAN_DAY) { m--; if (!m) { m = 12; y--; } }
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + CFG.PLAN_DAY).slice(-2);
}
function auth_() { return { Authorization: 'Token ' + CFG.LINKO_TOKEN }; }
function get_(u) {
  const r = fetch_(u.indexOf('http') === 0 ? u : CFG.LINKO_API + u, { headers: auth_(), muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 401) throw new Error('LINKO не принял ключ (401): возьмите новый ключ LINKO и вставьте в скрипт');
  if (code === 403) throw new Error('LINKO: нет доступа к разделу (403)');
  if (code !== 200) throw new Error('LINKO ответил ' + code);
  return JSON.parse(r.getContentText());
}
function all_(u) { let out = [], next = u; while (next) { const j = get_(next); out = out.concat(j.results || []); next = j.next; } return out; }
function n_(v) { return Number(v) || 0; }
function csv_(rows) { return '﻿' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\n'); }

function saveToGithub_(path, text) {
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + path;
  const h = { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const cur = fetch_(url, { headers: h, muteHttpExceptions: true });
  const sha = cur.getResponseCode() === 200 ? JSON.parse(cur.getContentText()).sha : undefined;
  const body = { message: 'LINKO: автозагрузка', content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (sha) body.sha = sha;
  const r = fetch_(url, { method: 'put', headers: h, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('GitHub не принял файл: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
}
// ---------- стоп-отгрузка: заказ клиенту на стопе → сообщение в Telegram (правила — credit-rules.json из CRM) ----------
// Клиент на стопе: долг больше его лимита или есть долг старше выбранного срока LINKO. Каждый заказ сообщается один раз.
function stop_(data) {
  if (!CFG.TG_BOT || !CFG.TG_CHAT || !data.orders || !data.debtors) return;
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/credit-rules.json';
  const r = fetch_(url, { headers: { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return; // правила ещё не заданы в CRM
  const R = JSON.parse(r.getContentText()); if (!R || !R.on) return;
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const own = {}; Object.keys(R.clients || {}).forEach(k => { own[norm(k)] = R.clients[k]; });
  const debt = {};
  data.debtors.forEach(d => {
    const cs = Array.isArray(d.currencies) ? d.currencies : [], c = cs.filter(x => /usd|\$|долл/i.test(x.name || ''))[0] || cs[0] || {};
    const raw = [c.debt_first, c.debt_second, c.debt_third, c.debt_fourth].map(v => Math.abs(n_(v)));
    const total = Math.abs(n_(c.debt_total)) || raw.reduce((a, b) => a + b, 0);
    let left = total; const b = raw.map(v => { const t = Math.min(v, left); left -= t; return t; }); // оплаты закрывают самые старые заказы
    if (left > 1e-9) b[0] += left;
    debt[norm(d['client.name'])] = { total: total, old: b.slice(R.age || 2).reduce((a, v) => a + v, 0) };
  });
  const P = PropertiesService.getScriptProperties(), seen = JSON.parse(P.getProperty('stopSeen') || '[]'), first = !P.getProperty('stopSeen');
  const fresh = [];
  data.orders.forEach(o => {
    if (!o.id || seen.indexOf(o.id) >= 0 || /cancel|reject|return|отмен|отклон|возвр/i.test(String(o.status))) return;
    const k = norm(o['client.name']), x = own[k] || {}, d = debt[k]; if (!d || x.ex) return;
    const limit = x.limit != null ? x.limit : (R.limit || 0), why = [];
    if (d.old >= (R.minOld || 0) && d.old > 0.005) why.push('долг ' + (R.ageLabel || 'старый') + ': $' + Math.round(d.old));
    if (limit > 0 && d.total > limit) why.push('долг $' + Math.round(d.total) + ' больше лимита $' + Math.round(limit));
    if (!why.length) return;
    seen.push(o.id);
    if (first) return; // первый запуск: уже существующие заказы только запоминаем
    fresh.push('🛑 Заказ клиенту на стопе\n' + o['client.name'] + ' — агент ' + [o['user.first_name'], o['user.second_name']].filter(String).join(' ') + '\nЗаказ $' + Math.round(n_(o.total_price)) + ' · ' + String(o.created_date || '').slice(0, 16).replace('T', ' ') + '\nПочему стоп: ' + why.join('; ') + (R.crm ? '\n' + R.crm + '#/credit' : ''));
  });
  P.setProperty('stopSeen', JSON.stringify(seen.slice(-400)));
  if (first) { notify_('🛑 Стоп-отгрузка включена. Заказов клиентам на стопе в этом периоде: ' + (seen.length) + '. Про каждый новый такой заказ напишу сюда' + (R.crm ? '\n' + R.crm + '#/credit' : '')); return; }
  fresh.slice(0, 10).forEach(t => notify_(t));
  if (fresh.length > 10) notify_('…и ещё ' + (fresh.length - 10) + ' заказов клиентам на стопе — смотрите в CRM');
  if (fresh.length) Logger.log('Стоп-отгрузка: сообщений ' + fresh.length);
}

// ---------- архив: всё, что пришло из LINKO, сохраняется по дням и никогда не удаляется ----------
// archive/ГГГГ/ММ/ГГГГ-ММ-ДД/<latest|fast|extra>.json.gz — сжатая копия того же, что лежит в linko-*.json.
// За день файл обновляется не чаще раза в 30 минут (после 21:00 — каждый раз), так что в архиве остаётся состояние на конец дня.
function archive_(name, text) {
  const P = PropertiesService.getScriptProperties(), now = new Date();
  const day = Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd'), hour = Number(Utilities.formatDate(now, CFG.TZ, 'H'));
  let last = {}; try { last = JSON.parse(P.getProperty('arch_' + name) || '{}'); } catch (e) { last = {}; }
  if (last.day === day && Date.now() - (last.at || 0) < 30 * 60000 && hour < 21) return;
  const bytes = Utilities.gzip(Utilities.newBlob(text, 'application/json', name + '.json')).getBytes();
  saveB64ToGithub_('archive/' + day.slice(0, 4) + '/' + day.slice(5, 7) + '/' + day + '/' + name + '.json.gz', Utilities.base64Encode(bytes), 'Архив ' + day + ': ' + name);
  P.setProperty('arch_' + name, JSON.stringify({ day: day, at: Date.now() }));
}
function saveB64ToGithub_(path, b64, message) {
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + path;
  const h = { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const cur = fetch_(url, { headers: h, muteHttpExceptions: true });
  const sha = cur.getResponseCode() === 200 ? JSON.parse(cur.getContentText()).sha : undefined;
  const body = { message: message, content: b64 }; if (sha) body.sha = sha;
  const r = fetch_(url, { method: 'put', headers: h, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('GitHub не принял архив: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
}
function notify_(text) {
  if (!CFG.TG_BOT || !CFG.TG_CHAT) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: CFG.TG_CHAT, text: text }), muteHttpExceptions: true });
}
