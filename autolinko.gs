/**
 * MITAL CRM — автозагрузка из LINKO (Google Apps Script, бесплатно).
 * Каждые 5 минут (с 7 до 22) берёт из LINKO баланс клиентов (с начала периода плана по сегодня) и остатки всех складов
 * и кладёт их в ваш приватный репозиторий mitalcrm-data (файл linko-latest.json), а копию каждого дня — в папку archive/.
 * Оплаты — тоже каждые 5 минут (файл linko-fast.json; какие разделы быстрые, решает CRM: "every": 5 в linko-jobs.json).
 * Раз в 30 минут — заказы, товары, возвраты, долги по срокам, работу агентов и др. (файл linko-extra.json)
 * и визиты агентов к клиентам — кто, к кому, во сколько вошёл и вышел, что сделал (файл linko-visits.json).
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
  try { storesRemind_(); } catch (e) { Logger.log('Сверка, напоминание: ' + mask_(e.message || e)); }
  try { discNotify_(); } catch (e) { Logger.log('Дисциплина, сообщения: ' + mask_(e.message || e)); }
  if (jobs) try { extra_(jobs); } catch (e) { Logger.log('Доп. данные: ' + mask_(e.message || e)); }
  try { visits_(); } catch (e) { Logger.log('Визиты: ' + mask_(e.message || e)); }
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
  try { inst_(data); } catch (e) { Logger.log('Рассрочка: ' + mask_(e.message || e)); }
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
  if (p.tg) return json_(tgAgent_(p.tg));     // кабинет агента из Telegram (мини-приложение бота)
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
      // a status of the day set by the manager (больничный, отпросился, свободный график…) — no fine
      const st = (snap.disc.marks || {})[today] || (snap.disc.free ? 'free' : '') || (snap.disc.skip ? 'skip' : ''); // skip — not counted in discipline
      const hm = t.slice(11, 16), m = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)), late = st ? 0 : Math.max(0, m(hm) - m(snap.disc.start || '08:45'));
      const before = (snap.disc.days || []).filter(d => d.day === today)[0], was = before ? before.late || 0 : 0;
      snap.disc.minutes = (snap.disc.minutes || 0) - was + late; snap.disc.fine = snap.disc.minutes * (snap.disc.rate || 0);
      snap.disc.late = (snap.disc.late || 0) - (was ? 1 : 0) + (late ? 1 : 0);
      const stTxt = (snap.disc.today && snap.disc.today.st) || (before && before.st) || '';
      snap.disc.today = { first: hm, late: late, st: stTxt };
      snap.disc.days = (snap.disc.days || []).filter(d => d.day !== today).concat([{ day: today, first: hm, late: late, plan: n_(w.total_tasks_by_market), done: n_(w.total_tasks_done_by_market), st: stTxt }]);
      live.disc = X.at;
    }
  } catch (e) { Logger.log('Кабинет, дисциплина: ' + mask_(e.message || e)); }
  snap.live = live;
  return snap;
}
// ---------- вход из Telegram: проверка подписи initData ключом бота (как требует Telegram), затем файл agents/tg/<id>.json ----------
function tgAgent_(initData) {
  const u = tgUser_(initData); if (u.error) return u;
  const cache = CacheService.getScriptCache(), hit = cache.get('tg_' + u.id); if (hit) return JSON.parse(hit);
  const f = ghRaw_('agents/tg/' + u.id + '.json');
  if (f.code === 404) return { error: 'Доступ к кабинету не открыт — попросите руководителя' };
  if (f.code !== 200) return { error: 'Не удалось получить данные, попробуйте через минуту' };
  const s0 = JSON.parse(f.text), store = s0.role === 'store';
  const out = JSON.stringify(store ? storeLive_(s0) : live_(s0)); // кабинет склада — список товаров без количества
  if (out.length < 90000 && !store) cache.put('tg_' + u.id, out, 60);
  return JSON.parse(out);
}
// ---------- отметки агентов: «Выполнено» из кабинета (комментарий, фото) → inbox/ в приватном репозитории + сообщение руководителю ----------
// Агент определяется так же, как при открытии кабинета: по подписи Telegram или по личному коду. Писать агент может только это.
function tgUser_(initData) {
  if (!CFG.TG_BOT) return { error: 'В скрипте не задан бот — скопируйте скрипт из CRM заново' };
  const pairs = String(initData).split('&').map(s => { const i = s.indexOf('='); return [decodeURIComponent(s.slice(0, i)), decodeURIComponent(s.slice(i + 1).replace(/\+/g, ' '))]; });
  const map = {}; pairs.forEach(p => { map[p[0]] = p[1]; });
  if (!map.hash) return { error: 'Откройте кабинет кнопкой в боте' };
  const check = pairs.filter(p => p[0] !== 'hash').map(p => p[0] + '=' + p[1]).sort().join('\n');
  const hex = b => b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
  const secret = Utilities.computeHmacSha256Signature(Utilities.newBlob(CFG.TG_BOT).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  if (hex(Utilities.computeHmacSha256Signature(Utilities.newBlob(check).getBytes(), secret)) !== map.hash) return { error: 'Не удалось подтвердить вход через Telegram — откройте кабинет кнопкой в боте ещё раз' };
  if (Date.now() / 1000 - Number(map.auth_date || 0) > 86400) return { error: 'Вход устарел — закройте и снова откройте кабинет в боте' };
  let user = {}; try { user = JSON.parse(map.user || '{}'); } catch (e) { user = {}; }
  if (!/^\d+$/.test(String(user.id || ''))) return { error: 'Telegram не передал пользователя' };
  return { id: String(user.id) };
}
function ghRaw_(path) {
  const r = fetch_('https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + path, { headers: { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }, muteHttpExceptions: true });
  return { code: r.getResponseCode(), text: r.getResponseCode() === 200 ? r.getContentText() : '' };
}
function doPost(e) {
  let p = {}; try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ error: 'Неверный запрос' }); }
  try {
    let path;
    if (p.tg) { const u = tgUser_(p.tg); if (u.error) return json_(u); path = 'agents/tg/' + u.id + '.json'; }
    else if (/^[A-Za-z0-9_-]{20,64}$/.test(String(p.k || ''))) path = 'agents/' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(p.k), Utilities.Charset.UTF_8).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('') + '.json';
    else return json_({ error: 'Откройте кабинет кнопкой в боте' });
    const f = ghRaw_(path); if (f.code !== 200) return json_({ error: 'Доступ к кабинету не открыт' });
    const snap = JSON.parse(f.text);
    if (p.act === 'count_start' || p.act === 'count') return json_(countAct_(p, snap)); // сверка склада
    if (p.act === 'order') return json_(cntOrder_(p, snap));                            // порядок товаров как на полках
    if (p.act === 'absreq') return json_(absReq_(p, snap));                             // заявка агента на отсутствие (Дисциплина)
    const task = (snap.tasks || []).filter(t => t.src === p.src && String(t.id) === String(p.id))[0];
    if (p.act !== 'done' || !task) return json_({ error: 'Задание не найдено — обновите кабинет' });
    const stamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), uid = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    let photo = '';
    if (p.photo && /^[A-Za-z0-9+/=]+$/.test(p.photo) && p.photo.length < 2800000) { photo = 'inbox/photos/' + uid + '.jpg'; saveB64ToGithub_(photo, p.photo, 'Кабинет: фото к заданию'); }
    const rec = { at: new Date().toISOString(), agent: snap.agent, act: 'done', src: p.src, id: p.id, title: task.title || '', comment: String(p.comment || '').slice(0, 1000), photo: photo };
    saveB64ToGithub_('inbox/' + stamp + '/' + uid + '.json', Utilities.base64Encode(JSON.stringify(rec), Utilities.Charset.UTF_8), 'Кабинет: отметка агента');
    const text = '✅ ' + snap.agent + ' выполнил задание\n' + rec.title + (rec.comment ? '\n💬 ' + rec.comment : '');
    try {
      if (photo && CFG.TG_BOT && CFG.TG_CHAT) UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendPhoto', { method: 'post', payload: { chat_id: String(CFG.TG_CHAT), caption: text.slice(0, 1000), photo: Utilities.newBlob(Utilities.base64Decode(p.photo), 'image/jpeg', 'photo.jpg') }, muteHttpExceptions: true });
      else notify_(text);
    } catch (err) { Logger.log('Отметка: сообщение не ушло ' + mask_(err.message || err)); }
    return json_({ ok: true });
  } catch (err) { return json_({ error: 'Не удалось сохранить: ' + mask_(err.message || err) }); }
}
// ---------- сверка склада: завсклад считает в кабинете склада (вслепую), скрипт сравнивает с «Всего» в LINKO ----------
// «Начать сверку» запоминает «Всего» по складу на эту минуту; «Отправить» сохраняет факт в inbox/ и сразу пишет руководителю итог.
// Каждые 5 минут после срока (stores.json от CRM) — напоминание тем, кто не прислал, и руководителю список.
function stockTotals_(branch) {
  const L = JSON.parse(ghRaw_('linko-latest.json').text || '{}'), f = (L.files || []).filter(x => x.name === 'stock LINKO branch ' + branch + '.csv')[0];
  if (!f) return null;
  const rows = Utilities.parseCsv(Utilities.newBlob(Utilities.base64Decode(f.b64)).getDataAsString('UTF-8').replace(/^﻿/, ''), ';'), h = rows[0] || [];
  const iName = h.indexOf('Продукт'), iArt = h.indexOf('Aртикул'), iBrand = h.indexOf('Бренд'), iTotal = h.indexOf('Всего товаров'), out = {};
  rows.slice(1).forEach(r => { if (!r[iName]) return; const k = String(r[iArt] || r[iName]).trim(); out[k] = { name: r[iName], brand: r[iBrand] || '', total: (out[k] ? out[k].total : 0) + n_(String(r[iTotal]).replace(',', '.')) }; });
  return { at: L.at, items: out };
}
// Попытки сверки за день (автоматически, без руководителя):
//  1) полная сверка. Сошлось → завскладу «Сверка прошла успешно, склад в порядке». Есть расхождение → завскладу уходят ТОЛЬКО названия
//     этих товаров (без цифр LINKO и без «больше/меньше») на пересчёт.
//  2) пересчёт только этих товаров. Сошлось → «успешно». Снова расхождение → сверка закрыта, расхождение зафиксировано (недостача/излишек),
//     завскладу — названия, руководителю — цифры. После закрытия в этот день отправить сверку ещё раз нельзя.
// Состояние дня: свойство cntround_<день>_<завсклад> = { status: 'recount' | 'ok' | 'final', round, at, items: [{ art, name }] }.
function cntRound_(day, who, v) {
  const P = PropertiesService.getScriptProperties(), k = 'cntround_' + day + '_' + who;
  if (v === undefined) { try { return JSON.parse(P.getProperty(k) || 'null'); } catch (e) { return null; } }
  P.setProperty(k, JSON.stringify(v)); return v;
}
// сообщение завскладу в Telegram с кнопкой кабинета (адрес кабинета — из stores.json от CRM)
function storeMsg_(who, text) {
  if (!CFG.TG_BOT) return;
  let app = ''; try { const f = ghRaw_('stores.json'); if (f.code === 200) app = (JSON.parse(f.text) || {}).app || ''; } catch (e) { app = ''; }
  const body = { chat_id: who, text: text };
  if (app) body.reply_markup = { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url: app } }]] };
  try { UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true }); } catch (e) { Logger.log('Сверка: сообщение завскладу не ушло ' + mask_(e.message || e)); }
}
// small JSON values in script properties (one value ≤ 9 KB); too big — skipped, the count still works
function cntProp_(k, v) {
  const P = PropertiesService.getScriptProperties();
  if (v === undefined) { try { return JSON.parse(P.getProperty(k) || 'null'); } catch (e) { return null; } }
  try { const t = JSON.stringify(v); if (t.length < 8800) P.setProperty(k, t); else Logger.log('Сверка: ' + k + ' слишком большой (' + t.length + ')'); } catch (e) { Logger.log('Сверка: ' + mask_(e.message || e)); }
  return v;
}
// the order of the goods as they stand on the shelves (set by the store keeper once): a list of articles
function cntOrder_(p, snap) {
  if (snap.role !== 'store') return { error: 'Это не кабинет склада' };
  const order = (Array.isArray(p.order) ? p.order : []).map(String).filter(a => a && a.length < 80).slice(0, 600);
  cntProp_('cntorder_' + snap.who, order);
  return { ok: true, n: order.length };
}
// Короткая сверка (настройка в CRM: snap.mode = 'short'): в обычный день — только товары, у которых со вчерашней сверки менялся
// остаток в LINKO (продажа, приход, перемещение), товары с расхождением в прошлый раз и snap.extra (8) случайных из остальных.
// Полная сверка — в день snap.fullDay (1 = понедельник), если прошлой сверки нет или она старше 7 дней, или если «коротких» и так ≥ 70 %.
// План дня один на весь день: cntplan_<день>_<завсклад> = { short, list: [артикулы] | null, total }.
function cntPlan_(snap, day, s) {
  const k = 'cntplan_' + day + '_' + snap.who, have = cntProp_(k); if (have) return have;
  const all = Object.keys(s.items), last = cntProp_('cntsnap_' + snap.who), dow = Number(Utilities.formatDate(new Date(), CFG.TZ, 'u'));
  let plan = { short: false, list: null, total: all.length };
  const old = !last || !last.day || (Date.parse(day) - Date.parse(last.day)) > 7 * 864e5;
  if (snap.mode === 'short' && !old && dow !== Number(snap.fullDay || 1)) {
    const t = last.t || {}, bad = last.bad || [];
    const must = all.filter(a => (s.items[a].total || 0) !== (t[a] || 0) || bad.indexOf(a) >= 0);
    const rest = all.filter(a => must.indexOf(a) < 0);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
    const list = must.concat(rest.slice(0, Math.max(0, Number(snap.extra) || 8)));
    if (list.length && list.length < all.length * 0.7) plan = { short: true, list: list, total: all.length };
  }
  return cntProp_(k, plan);
}
// the store keeper's file with the product list from LINKO — names only: the count is blind
function storeLive_(snap) {
  let S0 = null;
  try { const s = snap.branch && stockTotals_(snap.branch); S0 = s; if (s) { snap.items = Object.keys(s.items).map(k => ({ art: k, name: s.items[k].name, brand: s.items[k].brand })).sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)); snap.items_at = s.at; } }
  catch (e) { Logger.log('Кабинет склада: ' + mask_(e.message || e)); }
  const P = PropertiesService.getScriptProperties(), day = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), done = P.getProperty('cntdone_' + day + '_' + snap.who);
  snap.today = done ? JSON.parse(done) : null;
  // the list to recount and the result of the day come from here, not from the CRM file: they change the moment the store keeper sends
  const r = cntRound_(day, snap.who);
  snap.round = r ? { status: r.status, round: r.round, at: r.at, items: (r.items || []).map(i => ({ art: i.art, name: i.name })) } : null;
  snap.recount = r && r.status === 'recount' ? snap.round.items : [];
  // today's plan (full / short list), the shelf order, and the store keeper's OWN last counts (to catch typos — never the LINKO numbers)
  try { if (snap.items && snap.items.length) { const pl = S0 && cntPlan_(snap, day, S0); if (pl) snap.plan = { short: pl.short, list: pl.list, total: pl.total }; } } catch (e) { Logger.log('Сверка, план: ' + mask_(e.message || e)); }
  snap.order = cntProp_('cntorder_' + snap.who) || [];
  snap.last = (cntProp_('cntlast_' + snap.who) || {}).f || {};
  return snap;
}
function countAct_(p, snap) {
  if (snap.role !== 'store' || !snap.branch) return { error: 'Это не кабинет склада' };
  const cache = CacheService.getScriptCache(), key = 'cnt_' + snap.who;
  const day = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), round = cntRound_(day, snap.who);
  if (round && (round.status === 'ok' || round.status === 'final')) return { error: 'Сверка за сегодня уже закрыта', round: round.status };
  if (round && round.status === 'recount' && !p.partial) return { error: 'Сначала пересчитайте товары из списка — обновите кабинет' };
  if (p.act === 'count_start') {
    const s = stockTotals_(snap.branch); if (!s) return { error: 'Нет остатков склада из LINKO — попробуйте через 5 минут' };
    const totals = {}; Object.keys(s.items).forEach(k => { totals[k] = s.items[k].total; });
    const pl = p.partial ? null : cntPlan_(snap, day, s);
    cache.put(key, JSON.stringify({ at: new Date().toISOString(), linko_at: s.at, totals: totals, list: pl && pl.short ? pl.list : null }), 6 * 3600);
    return { ok: true, at: new Date().toISOString(), plan: pl ? { short: pl.short, list: pl.list, total: pl.total } : null };
  }
  // act === 'count'
  if (p.partial && !(round && round.status === 'recount')) return { error: 'Список на пересчёт устарел — обновите кабинет' };
  const want = p.partial ? round.items.map(i => i.art) : null; // in a recount only the items from the list count
  const counts = p.counts || {}, arts = Object.keys(counts).filter(a => !want || want.indexOf(a) >= 0); if (!arts.length) return { error: 'Нет посчитанных товаров' };
  if (want && want.some(a => arts.indexOf(a) < 0)) return { error: 'Пересчитайте все товары из списка' };
  let start = null; try { start = JSON.parse(cache.get(key) || 'null'); } catch (e) { start = null; }
  if (!p.partial) { const pl = cntProp_('cntplan_' + day + '_' + snap.who), need = pl && pl.short ? pl.list : null; if (need && need.some(a => arts.indexOf(a) < 0)) return { error: 'Посчитайте все товары из сегодняшнего списка — обновите кабинет' }; }
  const now = stockTotals_(snap.branch); if (!now) return { error: 'Нет остатков склада из LINKO — попробуйте через 5 минут' };
  const base = start ? start.totals : null, items = arts.map(a => ({ art: a, name: (now.items[a] || {}).name || a, linko: base && a in base ? base[a] : ((now.items[a] || {}).total || 0), now: (now.items[a] || {}).total || 0, fact: Math.max(0, Math.round(n_(counts[a]))) }));
  const stamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), uid = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let photo = '';
  if (p.photo && /^[A-Za-z0-9+/=]+$/.test(p.photo) && p.photo.length < 2800000) { photo = 'inbox/photos/' + uid + '.jpg'; saveB64ToGithub_(photo, p.photo, 'Сверка склада: фото'); }
  // a real discrepancy: the fact matches neither the stock at the start nor the stock now (a shipment during the count is not a shortage)
  const diff = items.filter(i => i.fact !== i.linko && i.fact !== i.now), moved = items.filter(i => i.fact !== i.linko && i.fact === i.now);
  // attempt 1 with a discrepancy → recount; attempt 2 with a discrepancy → closed for good; no discrepancy → ok
  const nRound = p.partial ? 2 : 1, result = !diff.length ? 'ok' : nRound === 1 ? 'recount' : 'final';
  const atIso = new Date().toISOString(), names = diff.map(i => ({ art: i.art, name: i.name }));
  const rec = { act: 'count', at: atIso, start_at: start ? start.at : null, who: snap.who, name: snap.name, warehouse: snap.warehouse, partial: !!p.partial, short: !p.partial && !!(start && start.list), total_items: Object.keys(now.items).length, round: nRound, result: result, recount: result === 'recount' ? diff.map(i => i.art) : [], items: items, photo: photo, comment: String(p.comment || '').slice(0, 500) };
  saveB64ToGithub_('inbox/' + stamp + '/' + uid + '.json', Utilities.base64Encode(JSON.stringify(rec), Utilities.Charset.UTF_8), 'Сверка склада: ' + snap.warehouse);
  cache.remove(key);
  cntRound_(stamp, snap.who, { status: result, round: nRound, at: atIso, items: result === 'ok' ? [] : names });
  PropertiesService.getScriptProperties().setProperty('cntdone_' + stamp + '_' + snap.who, JSON.stringify({ at: rec.at, diff: diff.length, partial: rec.partial }));
  // for tomorrow's short count: LINKO stock now + what did not match on the first attempt; the store keeper's own counts (typo check)
  try {
    if (!p.partial) { const t = {}; Object.keys(now.items).forEach(a => { if (now.items[a].total) t[a] = now.items[a].total; }); cntProp_('cntsnap_' + snap.who, { day: stamp, t: t, bad: diff.map(i => i.art) }); }
    const own = cntProp_('cntlast_' + snap.who) || { f: {} }; items.forEach(i => { own.f[i.art] = i.fact; }); own.day = stamp; cntProp_('cntlast_' + snap.who, own);
  } catch (e) { Logger.log('Сверка, снимок: ' + mask_(e.message || e)); }
  const t = Utilities.formatDate(new Date(), CFG.TZ, 'HH:mm');
  // to the store keeper: names only — never the LINKO numbers, nor «more / less»
  const list = names.slice(0, 40).map(i => '• ' + i.name).join('\n') + (names.length > 40 ? '\n…и ещё ' + (names.length - 40) : '');
  const short = diff.filter(i => i.fact < i.linko).length, plus = diff.length - short;
  if (result === 'ok') storeMsg_(snap.who, '✅ Сверка склада ' + snap.warehouse + ' прошла успешно — склад в порядке. Спасибо!');
  else if (result === 'recount') storeMsg_(snap.who, '↻ Сверка склада ' + snap.warehouse + ': есть расхождение. Пересчитайте внимательно ' + names.length + ' поз.:\n' + list + '\n\nОткройте кабинет склада → «Начать пересчёт». Это последняя попытка.');
  else storeMsg_(snap.who, '⚠️ Пересчёт склада ' + snap.warehouse + ' не сошёлся по ' + names.length + ' поз.:\n' + list + '\n\nСверка закрыта, расхождение зафиксировано. Руководитель получил отчёт.');
  // to the supervisor: the numbers
  const lines = diff.slice(0, 15).map(i => '• ' + i.name + ': по LINKO ' + i.linko + ', факт ' + i.fact + ' (' + (i.fact > i.linko ? '+' : '') + (i.fact - i.linko) + ')');
  const verdict = result === 'recount' ? '\n↻ Завскладу автоматически отправлены названия на пересчёт (без цифр).' : result === 'final' ? '\n🔒 Окончательно после пересчёта: ' + (short ? 'недостача ' + short + ' поз.' : '') + (short && plus ? ', ' : '') + (plus ? 'излишек ' + plus + ' поз.' : '') : (nRound === 2 ? '\n✅ После пересчёта всё сошлось — завсклад получил «склад в порядке».' : '\n✅ Завсклад получил «склад в порядке».');
  notify_('📦 ' + snap.warehouse + (rec.partial ? ' — пересчёт ' : rec.short ? ' — короткая сверка ' : ' — сверка ') + t + ' (' + snap.name + ')\n' + (diff.length ? 'Расхождений: ' + diff.length + ' из ' + items.length + '\n' + lines.join('\n') + (diff.length > 15 ? '\n…и ещё ' + (diff.length - 15) : '') : '✓ Всё сходится: ' + items.length + ' позиций') + (moved.length ? '\nℹ Сошлось с LINKO после отгрузки во время сверки: ' + moved.map(i => i.name).slice(0, 5).join(', ') + (moved.length > 5 ? ' и ещё ' + (moved.length - 5) : '') : '') + (rec.comment ? '\n💬 ' + rec.comment : '') + verdict);
  return { ok: true, result: result, round: nRound, total: items.length, items: result === 'ok' ? [] : names };
}
// reminders (stores.json from the CRM): in the morning at «remind» (09:00) to every store keeper who has not sent today's count yet,
// and after the «deadline» (10:00) once more to the late ones + the list to the supervisor. Once a day each; not on Sundays.
function storesRemind_() {
  const P = PropertiesService.getScriptProperties(), now = new Date(), day = Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd'), hm = Utilities.formatDate(now, CFG.TZ, 'HH:mm');
  // once a day: drop the count marks older than 7 days (script properties are limited in size)
  if (P.getProperty('cntclean') !== day) {
    const old = Utilities.formatDate(new Date(now.getTime() - 7 * 864e5), CFG.TZ, 'yyyy-MM-dd');
    Object.keys(P.getProperties()).forEach(k => { const m = /^cnt(?:round|done|morn|rem|plan)_(\d{4}-\d{2}-\d{2})/.exec(k); if (m && m[1] < old) P.deleteProperty(k); });
    P.setProperty('cntclean', day);
  }
  if (Utilities.formatDate(now, CFG.TZ, 'u') === '7') return; // воскресенье
  if (P.getProperty('cntrem_' + day) === 'all') return;
  if (hm < '07:00') return;
  const f = ghRaw_('stores.json'); if (f.code !== 200) return;
  const S = JSON.parse(f.text); if (!S || !S.list || !S.list.length) return;
  const remind = S.remind || '09:00', deadline = S.deadline || '10:00', done = s => P.getProperty('cntdone_' + day + '_' + s.who);
  const send = (who, text) => {
    const body = { chat_id: who, text: text };
    if (S.app) body.reply_markup = { inline_keyboard: [[{ text: '📦 Открыть кабинет склада', web_app: { url: S.app } }]] };
    try { UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true }); } catch (e) { /* not reachable */ }
  };
  // 1) morning reminder
  if (hm >= remind && hm < deadline) {
    S.list.filter(s => !done(s) && !P.getProperty('cntmorn_' + day + '_' + s.who)).forEach(s => {
      send(s.who, '☀️ Доброе утро, ' + s.name + '! Проведите сверку склада ' + s.warehouse + ' до ' + deadline + ': откройте кабинет склада, нажмите «Начать сверку», пересчитайте товары и отправьте.');
      P.setProperty('cntmorn_' + day + '_' + s.who, '1');
    });
    return;
  }
  if (hm < deadline) return;
  // 2) after the deadline
  const late = S.list.filter(s => !done(s) && !P.getProperty('cntrem_' + day + '_' + s.who));
  late.forEach(s => { send(s.who, '⏰ Сверка склада ' + s.warehouse + ' должна была быть до ' + deadline + '. Откройте кабинет склада и отправьте сверку.'); P.setProperty('cntrem_' + day + '_' + s.who, '1'); });
  if (late.length) notify_('⏰ Нет сверки склада к ' + deadline + ': ' + late.map(s => s.warehouse + ' (' + s.name + ')').join(', '));
  if (S.list.every(s => done(s) || P.getProperty('cntrem_' + day + '_' + s.who))) P.setProperty('cntrem_' + day, 'all');
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

function saveToGithub_(path, text) { saveB64ToGithub_(path, Utilities.base64Encode(text, Utilities.Charset.UTF_8), 'LINKO: автозагрузка'); }
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
// dayIn: a past day (yesterday's visits) — saved at once, without touching today's 30-minute limit
function archive_(name, text, dayIn) {
  const P = PropertiesService.getScriptProperties(), now = new Date();
  const today = Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd'), day = dayIn || today, hour = Number(Utilities.formatDate(now, CFG.TZ, 'H'));
  let last = {}; try { last = JSON.parse(P.getProperty('arch_' + name) || '{}'); } catch (e) { last = {}; }
  if (day === today && last.day === day && Date.now() - (last.at || 0) < 30 * 60000 && hour < 21) return;
  const bytes = Utilities.gzip(Utilities.newBlob(text, 'application/json', name + '.json')).getBytes();
  saveB64ToGithub_('archive/' + day.slice(0, 4) + '/' + day.slice(5, 7) + '/' + day + '/' + name + '.json.gz', Utilities.base64Encode(bytes), 'Архив ' + day + ': ' + name);
  if (day === today) P.setProperty('arch_' + name, JSON.stringify({ day: day, at: Date.now() }));
}
// GitHub refuses a write with 409 / 422 when the file changed after we read its version (sha): another copy of the script
// wrote it at the same moment, or GitHub gave an old version from its cache. Then the current version (GitHub names it in the
// answer, otherwise it is read again without the cache) is taken and the write is repeated — up to 4 times, a little apart.
function saveB64ToGithub_(path, b64, message) {
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + path;
  const h = { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const shaNow = () => { const cur = fetch_(url + '?t=' + Date.now(), { headers: h, muteHttpExceptions: true }); return cur.getResponseCode() === 200 ? JSON.parse(cur.getContentText()).sha : undefined; };
  let sha = shaNow(), r = null;
  for (let i = 0; i < 4; i++) {
    const body = { message: message, content: b64 }; if (sha) body.sha = sha;
    r = fetch_(url, { method: 'put', headers: h, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    const code = r.getResponseCode();
    if (code < 300) return;
    if (code !== 409 && code !== 422) break;
    const m = r.getContentText().match(/is at ([0-9a-f]{40})/);
    Utilities.sleep(800 * (i + 1));
    sha = m ? m[1] : shaNow();
  }
  throw new Error('GitHub не принял файл ' + path + ': ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
}
// ---------- визиты агентов (LINKO «Клиенты → Маршруты»): план дня, кто к кому во сколько вошёл и вышел, что сделал ----------
// Раз в 30 минут: сводка по всем агентам за сегодня (market/agent_plans/), по каждому агенту — его визиты за день
// (market/agent_plans/<id>/) и подробности плана (market/detail_plan/). Ответы LINKO сохраняются целиком, без отбора полей,
// в linko-visits.json и в архив (archive/…/visits.json.gz). В первый запуск дня ещё раз забирается вчерашний день целиком.
function visits_() {
  const P = PropertiesService.getScriptProperties(), now = new Date(), day = Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd');
  if (Date.now() - Number(P.getProperty('visitsAt') || 0) < CFG.EXTRA_MIN * 60000) return;
  P.setProperty('visitsAt', String(Date.now()));
  if (P.getProperty('visitsDay') !== day) {
    const y = Utilities.formatDate(new Date(now.getTime() - 86400000), CFG.TZ, 'yyyy-MM-dd');
    try { const v = visitsDay_(y); if (v.n) archive_('visits', JSON.stringify(v.snap), y); } catch (e) { Logger.log('Визиты за вчера: ' + mask_(e.message || e)); }
    P.setProperty('visitsDay', day);
  }
  const v = visitsDay_(day);
  if (!v.n && Object.keys(v.snap.errors).length) { P.deleteProperty('visitsAt'); Logger.log('Визиты: LINKO не ответил — ' + JSON.stringify(v.snap.errors).slice(0, 300)); return; }
  const txt = JSON.stringify(v.snap);
  saveToGithub_('linko-visits.json', txt); try { archive_('visits', txt); } catch (e) { Logger.log('Архив: ' + mask_(e.message || e)); }
  Logger.log('Визиты сохранены: агентов ' + v.n + (Object.keys(v.snap.errors).length ? ' · ошибки: ' + Object.keys(v.snap.errors).join(', ') : ''));
}
function visitsDay_(day) {
  const errors = {}, ask = u => ({ url: CFG.LINKO_API + u, headers: auth_(), muteHttpExceptions: true });
  const read = (r, k) => {
    if (r instanceof Error) { errors[k] = mask_(r.message); return null; }
    const code = r.getResponseCode(); if (code !== 200) { errors[k] = 'LINKO ответил ' + code; return null; }
    try { return visitsTrim_(JSON.parse(r.getContentText())); } catch (e) { errors[k] = 'не JSON'; return null; }
  };
  const res = fetchAll_([ask('market/agent_plans/?date=' + day), ask('staff/working_day/?begin_date=' + day + '&end_date=' + day + '&page=1&page_size=200')]);
  const summary = read(res[0], 'summary'), wd = read(res[1], 'workday');
  // agents: the leaves of the summary tree (branch → supervisor → agent) and the people of the working day
  const ids = {};
  const walk = (x, depth) => {
    if (Array.isArray(x)) { x.forEach(y => walk(y, depth)); return; }
    if (!x || typeof x !== 'object' || depth > 6) return;
    const kids = x.child_data || x.childData;
    if (Array.isArray(kids) && kids.length) { walk(kids, depth + 1); return; }
    if (x.results) { walk(x.results, depth + 1); return; }
    if (Number(x.id) > 0) ids[x.id] = ids[x.id] || String(x.user || x.name || [x.first_name, x.second_name].filter(String).join(' ') || x.id);
  };
  walk(summary, 0);
  ((wd && (wd.results || wd)) || []).forEach(w => { const id = w && (w.id || (w.user && w.user.id)); if (Number(id) > 0 && !ids[id]) ids[id] = [w.first_name, w.second_name].filter(String).join(' ') || String(id); });
  const list = Object.keys(ids).slice(0, 60), agents = {};
  for (let i = 0; i < list.length; i += 10) {
    const part = list.slice(i, i + 10), reqs = [];
    part.forEach(id => { reqs.push(ask('market/agent_plans/' + id + '/?date=' + day + '&with_image=true')); reqs.push(ask('market/detail_plan/?user=' + id + '&date=' + day)); });
    const out = fetchAll_(reqs);
    part.forEach((id, j) => {
      const plan = read(out[2 * j], 'plan_' + id), stats = read(out[2 * j + 1], 'stats_' + id);
      if (plan == null && stats == null) { delete errors['plan_' + id]; delete errors['stats_' + id]; return; } // not an agent with a route
      agents[id] = { name: ids[id], plan: plan, stats: stats };
    });
  }
  return { n: Object.keys(agents).length, snap: { at: new Date().toISOString(), day: day, summary: summary, agents: agents, errors: errors } };
}
// LINKO answers are kept whole; only huge strings (embedded pictures) are cut, so the file stays small
function visitsTrim_(x) {
  if (typeof x === 'string') return x.length > 600 ? x.slice(0, 600) + '…' : x;
  if (Array.isArray(x)) return x.map(visitsTrim_);
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { o[k] = visitsTrim_(x[k]); }); return o; }
  return x;
}
function notify_(text) {
  if (!CFG.TG_BOT || !CFG.TG_CHAT) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: CFG.TG_CHAT, text: text }), muteHttpExceptions: true });
}

// ---------- рассрочка по заказам и договоры (правила — inst-rules.json из CRM «Деньги → 📅 Рассрочка и договоры») ----------
// Каждый заказ клиента сам получает график: N частей (обычно 4) — через 7, 14, 21 день и последняя в день срока (обычно 30-й).
// Сколько оплачено по каждому заказу, считается от текущего долга клиента из LINKO («Должники по срокам»): оплаты закрывают
// самые старые заказы, поэтому долг лежит на самых новых. Долг больше, чем сумма известных заказов, — «старый долг», он весь просрочен.
// Файлы в репозитории данных: inst-orders.json — заказы за 75 дней; inst-bal.json — что клиенты взяли и оплатили по месяцам договоров (из баланса LINKO);
// inst-state.json — расчёт для CRM и готовые тексты. Каждое утро (час — из CRM) агенту приходят его клиенты, у которых сегодня
// срок части или есть просрочка (и договоры, где месяц на исходе, а план не выбран), вам — сводка по всем агентам.
const INST_KEEP = 75;
function inst_(data) {
  if (!data.orders || !data.debtors) return;
  const r = ghRaw_('inst-rules.json'); if (r.code !== 200) return; // в CRM ещё не включено
  const R = JSON.parse(r.text); if (!R || !R.on) return;
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const L = instLedger_(data.orders, today);
  let M = {}; try { M = instMonths_(L, R, today); } catch (e) { Logger.log('Договоры, закупки по месяцам: ' + mask_(e.message || e)); }
  const S = instCalc_(R, L, data.debtors, M, today);
  const P = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([S.clients, S.contracts, S.texts]), Utilities.Charset.UTF_8));
  if (hash !== P.getProperty('instHash')) { saveToGithub_('inst-state.json', JSON.stringify(S)); P.setProperty('instHash', hash); }
  instSend_(R, S, today);
}
function instDay_(d, n) { return Utilities.formatDate(new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5), 'UTC', 'yyyy-MM-dd'); }
function instNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function instR2_(v) { return Math.round(v * 100) / 100; }
function instUsd_(cur) { return !cur || /usd|\$|долл/i.test(cur); }
// a LINKO order (picked or whole) → { id, d, c, cid, a, s, cur }; cancelled / fully returned → null
function instOrder_(o) {
  if (!o || o.id == null || /cancel|reject|отмен|отклон/i.test(String(o.status))) return null;
  const s = n_(get2_(o, 'total_price')) - n_(get2_(o, 'total_return_price'));
  if (!(s > 0.005)) return null;
  return { id: o.id, d: String(get2_(o, 'created_date') || '').slice(0, 10), c: String(get2_(o, 'client.name') || ''), cid: get2_(o, 'client.id') || null,
    a: [get2_(o, 'user.first_name'), get2_(o, 'user.second_name')].filter(String).join(' '), s: instR2_(s), cur: String(get2_(o, 'currency.name') || '') };
}
function instFetch_(from, to) { return all_('sales/order/?begin_date=' + from + '&end_date=' + to + '&page=1&page_size=500').map(instOrder_).filter(Boolean); }
// orders of the last 75 days: the period file has only orders since the plan start, so older ones are kept here
function instLedger_(orders, today) {
  const f = ghRaw_('inst-orders.json'), cut = instDay_(today, -INST_KEEP), map = {};
  let old = null; if (f.code === 200) try { old = JSON.parse(f.text); } catch (e) { old = null; }
  if (old && Array.isArray(old.orders)) old.orders.forEach(o => { map[o.id] = o; });
  else instFetch_(cut, today).forEach(o => { map[o.id] = o; }); // first run: 75 days from LINKO at once
  orders.forEach(o => { const x = instOrder_(o); if (x) map[x.id] = x; else if (o && o.id != null) delete map[o.id]; });
  const list = Object.keys(map).map(k => map[k]).filter(o => o.d >= cut).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : n_(a.id) - n_(b.id)));
  const txt = JSON.stringify({ orders: list });
  if (txt !== f.text) saveToGithub_('inst-orders.json', txt);
  return list;
}
// a contract month is the period from the start date: 30.10–29.11, 30.11–29.12… (the day is kept; 31 → the last day of a short month)
function instPeriod_(start, i) {
  const y = Number(start.slice(0, 4)), m0 = Number(start.slice(5, 7)) - 1, d = Number(start.slice(8, 10));
  const at = k => { const last = new Date(Date.UTC(y, m0 + k + 1, 0)).getUTCDate(); return Utilities.formatDate(new Date(Date.UTC(y, m0 + k, Math.min(d, last))), 'UTC', 'yyyy-MM-dd'); };
  return { from: at(i), to: instDay_(at(i + 1), -1) };
}
// what every client bought (sold − returns) and paid in each contract month — from the LINKO client balance of exactly that period
// («Оплачено» counts cash, card and bank alike): inst-bal.json = { "<from>|<to>": { "<клиент>": { s, p } }, at: { "<from>|<to>": ms } }.
// The running period is asked again every hour, one that ended in the last 5 days every 6 hours, older ones once; up to 4 per run.
function instMonths_(L, R, today) {
  const cs = (R.contracts || []).filter(c => c.start && c.months > 0); if (!cs.length) return {};
  const f = ghRaw_('inst-bal.json'); let B = {}; if (f.code === 200) try { B = JSON.parse(f.text) || {}; } catch (e) { B = {}; }
  const at = B.at || {}, need = {};
  cs.forEach(c => { for (let i = 0; i < Number(c.months); i++) { const p = instPeriod_(c.start, i); if (p.from > today) break; need[p.from + '|' + p.to] = p; } });
  const age = k => Date.now() - (at[k] || 0);
  const stale = k => { const p = need[k]; if (!B[k]) return true; if (p.to >= today) return age(k) > 3600000; return p.to >= instDay_(today, -5) && age(k) > 6 * 3600000; };
  const keys = Object.keys(need).filter(stale).sort((a, b) => (need[b].to >= today) - (need[a].to >= today) || (a < b ? 1 : -1)).slice(0, 4); // running ones first, then the newest
  if (!keys.length) return B;
  keys.forEach(k => {
    const p = need[k], to = p.to < today ? p.to : today, out = {};
    const q = 'only_out_stock=False&is_only_delivered=False&last_status=False&exclude_closed_clients=false&only_payment_with_invoice=false&begin_date=' + p.from + '&end_date=' + to;
    all_('stats/client_balances_expanded/?' + q + '&page=1&page_size=500').forEach(c => {
      const u = (c.currencies || []).filter(x => instUsd_(x.name))[0]; if (!u) return;
      const s = instR2_(n_(u.order) - Math.abs(n_(u.order_return))), pd = instR2_(Math.abs(n_(u.payment)));
      if (s || pd) out[c.name] = { s: s, p: pd };
    });
    B[k] = out; at[k] = Date.now();
  });
  // periods no contract needs any more are dropped, so the file stays small
  Object.keys(B).forEach(k => { if (k !== 'at' && !need[k]) { delete B[k]; delete at[k]; } });
  B.at = at;
  saveToGithub_('inst-bal.json', JSON.stringify(B));
  return B;
}
// one order's schedule: parts of s/N due weekly (7, 14, 21…) with the last one on the term day; with a short term — evenly
function instPlan_(o, left, days, parts, today) {
  const paid = o.s - left, part = o.s / parts, weekly = 7 * (parts - 1) < days, list = [];
  for (let k = 1; k <= parts; k++) {
    const due = instDay_(o.d, k === parts ? days : weekly ? 7 * k : Math.round(days * k / parts));
    const st = paid >= part * k - 0.01 ? 'paid' : due < today ? 'late' : due === today ? 'today' : 'wait';
    list.push({ d: due, s: instR2_(part), st: st });
  }
  const want = d => part * list.filter(p => p.d <= d).length;
  const late = Math.max(0, part * list.filter(p => p.d < today).length - paid), now = Math.max(0, want(today) - paid) - late;
  return { id: o.id, d: o.d, s: o.s, a: o.a, paid: instR2_(paid), left: instR2_(left), late: instR2_(late), today: instR2_(now), parts: list };
}
function instCalc_(R, L, debtors, M, today) {
  const own = {}, ctOf = {}, alias = R.alias || {}, agentOf = {};
  Object.keys(R.clients || {}).forEach(k => { own[instNorm_(k)] = R.clients[k]; });
  Object.keys(R.agentOf || {}).forEach(k => { agentOf[instNorm_(k)] = R.agentOf[k]; });
  (R.contracts || []).forEach(c => (c.accounts || []).forEach(a => { ctOf[instNorm_(a)] = c; }));
  const byC = {}; L.forEach(o => { if (instUsd_(o.cur)) (byC[instNorm_(o.c)] = byC[instNorm_(o.c)] || []).push(o); });
  const clients = [];
  debtors.forEach(d => {
    const name = String(d['client.name'] || ''), k = instNorm_(name), x = own[k] || {}, ct = ctOf[k];
    const cs = Array.isArray(d.currencies) ? d.currencies : [], c = cs.filter(v => /usd|\$|долл/i.test(v.name || ''))[0] || cs[0] || {};
    const D = Math.abs(n_(c.debt_total)) || [c.debt_first, c.debt_second, c.debt_third, c.debt_fourth].reduce((a, v) => a + Math.abs(n_(v)), 0);
    if (!(D > 0.5) || x.ex) return;
    const days = Number(x.days || (ct && ct.days) || R.days || 30), parts = Math.max(1, Number(x.parts || (ct && ct.parts) || R.parts || 4));
    const os = (byC[k] || []).slice().reverse(), orders = []; let left = D; // newest first: the debt sits on the newest orders
    os.forEach(o => { const l = Math.min(o.s, Math.max(0, left)); left -= l; if (l > 0.005) orders.push(instPlan_(o, l, days, parts, today)); });
    orders.reverse();
    const old = instR2_(Math.max(0, left)), sum = key => instR2_(orders.reduce((a, o) => a + o[key], 0));
    const next = orders.map(o => o.parts.filter(p => p.d > today && p.st !== 'paid')[0]).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1))[0] || null;
    const lastA = (byC[k] || []).length ? byC[k][byC[k].length - 1].a : '';
    const resp = [d['client.responsible_agent.first_name'], d['client.responsible_agent.second_name']].filter(String).join(' ');
    clients.push({ name: name, agent: agentOf[k] || alias[lastA] || alias[resp] || lastA || resp || 'Без агента',
      phone: d['client.phone'] || d['market.phone'] || '', debt: instR2_(D), old: old, late: instR2_(old + sum('late')), today: sum('today'), next: next,
      type: ct ? 'contract' : /\bspe?t?s\b|спец/i.test(name) ? 'spec' : '', contract: ct ? ct.id : null, days: days, parts: parts, orders: orders });
  });
  clients.sort((a, b) => b.late - a.late || b.today - a.today || b.debt - a.debt);
  const contracts = instContracts_(R, M, today);
  return { at: new Date().toISOString(), day: today, days: R.days || 30, parts: R.parts || 4, clients: clients, contracts: contracts, texts: instTexts_(R, clients, contracts, today) };
}
// contracts: the purchase plan of each month (c.plan[i]; a contract without it — the same c.monthly every month)
// against what the contract's accounts bought that month
function instPlanOf_(c, i) { return Array.isArray(c.plan) && c.plan[i] != null ? Number(c.plan[i]) || 0 : Number(c.monthly) || 0; }
// fact — what the accounts bought in that contract month, paid — what they paid in it (null: LINKO not asked yet)
function instContracts_(R, M, today) {
  const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  return (R.contracts || []).filter(c => c.start && c.months > 0).map(c => {
    const list = [], acc = (c.accounts || []).map(instNorm_), end = instPeriod_(c.start, Number(c.months) - 1).to;
    for (let i = 0; i < Number(c.months); i++) {
      const p = instPeriod_(c.start, i); if (p.from > today) break;
      const got = M[p.from + '|' + p.to] || null; let fact = null, paid = null;
      if (got) { fact = 0; paid = 0; Object.keys(got).forEach(n => { if (acc.indexOf(instNorm_(n)) >= 0) { fact += got[n].s || 0; paid += got[n].p || 0; } }); fact = instR2_(fact); paid = instR2_(paid); }
      list.push({ m: p.from.slice(0, 7), from: p.from, to: p.to, plan: instPlanOf_(c, i), fact: fact, paid: paid });
    }
    let total = 0; for (let i = 0; i < Number(c.months); i++) total += instPlanOf_(c, i);
    const sum = k => instR2_(list.reduce((a, x) => a + (x[k] || 0), 0));
    const cur = list.filter(x => x.from <= today && today <= x.to)[0] || null;
    return { id: c.id, title: c.title || (c.accounts || []).join(' + '), accounts: c.accounts || [], monthly: Number(c.monthly) || 0, total: instR2_(total), months: Number(c.months), start: c.start, end: end,
      active: today >= c.start && today <= end, daysLeft: days(today, end), curLeft: cur ? days(today, cur.to) + 1 : null, cur: cur, list: list,
      bought: sum('fact'), paid: sum('paid'), agent: c.agent || '' };
  });
}
function instTexts_(R, clients, contracts, today) {
  const f = v => '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '), dm = d => d.slice(8, 10) + '.' + d.slice(5, 7);
  // a contract worth a reminder: its month is ending (10 days or less) and the month's sum is not bought or not paid
  // (the client both buys and pays the contract sum every month), or the contract ends within 30 days
  const ctAlert = c => c.active && ((c.cur && c.cur.fact != null && (c.cur.fact < c.cur.plan || (c.cur.paid || 0) < c.cur.plan) && c.curLeft <= 10) || c.daysLeft <= 30);
  const ctLine = c => '📄 Договор «' + c.title + '»: ' + (c.cur && c.cur.fact != null ? 'с ' + dm(c.cur.from) + ' по ' + dm(c.cur.to) + ' взял ' + f(c.cur.fact) + ' из ' + f(c.cur.plan) + ', оплатил ' + f(c.cur.paid || 0) + ' из ' + f(c.cur.plan) +
    ((c.cur.paid || 0) < c.cur.plan ? ' — осталось оплатить ' + f(c.cur.plan - (c.cur.paid || 0)) + ' за ' + c.curLeft + ' дн.' : ' ✓') : 'план в этом месяце ' + f(c.cur ? c.cur.plan : c.monthly)) + (c.daysLeft <= 30 ? ' · договор заканчивается ' + dm(c.end) + ' (через ' + c.daysLeft + ' дн.)' : '');
  const due = clients.filter(c => c.late > 0.5 || c.today > 0.5);
  const one = (c, i) => {
    const L = [(i + 1) + ') ' + c.name + (c.type === 'contract' ? ' [договор]' : c.type === 'spec' ? ' [спец]' : '') + ' · долг ' + f(c.debt)];
    L.push('   ' + [c.late > 0.5 ? '⚠ просрочено ' + f(c.late) : '', c.today > 0.5 ? '📅 сегодня ' + f(c.today) : ''].filter(String).join(' · ') + (c.phone ? ' · ☎ ' + c.phone : ''));
    c.orders.forEach(o => {
      const lateN = o.parts.filter(p => p.st === 'late').length, nowP = o.parts.filter(p => p.st === 'today')[0], n = o.parts.length;
      L.push('   • №' + o.id + ' от ' + dm(o.d) + ' на ' + f(o.s) + ': оплачено ' + f(o.paid) + ', осталось ' + f(o.left) + (lateN ? ' — просрочено частей: ' + lateN + ' из ' + n : '') + (nowP ? (lateN ? ', ' : ' — ') + 'сегодня ' + (o.parts.indexOf(nowP) + 1) + '-я часть' : ''));
    });
    if (c.old > 0.5) L.push('   • старый долг (заказы старше ' + INST_KEEP + ' дней): ' + f(c.old));
    if (c.next) L.push('   Следующая часть: ' + dm(c.next.d) + ' — ' + f(c.next.s));
    const ct = c.contract != null && contracts.filter(x => x.id === c.contract)[0]; if (ct && ctAlert(ct)) L.push('   ' + ctLine(ct));
    return L.join('\n');
  };
  const head = (list, who) => '📅 Оплаты по рассрочке — ' + dm(today) + (who ? ' · ' + who : '') + '\n' +
    'Сегодня срок: ' + list.filter(c => c.today > 0.5).length + ' кл. — ' + f(list.reduce((a, c) => a + c.today, 0)) + ' · Просрочено: ' + list.filter(c => c.late > 0.5).length + ' кл. — ' + f(list.reduce((a, c) => a + c.late, 0));
  const agents = {}, names = {};
  due.forEach(c => { names[c.agent] = 1; }); contracts.filter(ctAlert).forEach(c => { if (c.agent) names[c.agent] = 1; });
  Object.keys(names).forEach(a => {
    const mine = due.filter(c => c.agent === a), cts = contracts.filter(c => ctAlert(c) && c.agent === a && !mine.some(x => x.contract === c.id));
    agents[a] = head(mine, a) + (mine.length ? '\n\n' + mine.map(one).join('\n\n') : '') + (cts.length ? '\n\n' + cts.map(ctLine).join('\n') : '');
  });
  // to you: per agent, every client in one line, then the contracts that need attention
  const byA = {}; due.forEach(c => { (byA[c.agent] = byA[c.agent] || []).push(c); });
  const me = [head(due, ''), ''].concat(Object.keys(byA).sort().map(a => {
    const l = byA[a];
    return '👤 ' + a + ': сегодня ' + f(l.reduce((s, c) => s + c.today, 0)) + ', просрочено ' + f(l.reduce((s, c) => s + c.late, 0)) + '\n' +
      l.map(c => '  • ' + c.name + ' — ' + [c.late > 0.5 ? 'просрочено ' + f(c.late) : '', c.today > 0.5 ? 'сегодня ' + f(c.today) : ''].filter(String).join(', ') + ' (долг ' + f(c.debt) + ')').join('\n');
  })).join('\n');
  const cts = contracts.filter(ctAlert);
  return { me: me + (cts.length ? '\n\n' + cts.map(ctLine).join('\n') : '') + (R.crm ? '\n\nПодробно: ' + R.crm + '#/inst' : ''), agents: agents, due: due.length + cts.length };
}
// a long text in several Telegram messages (limit 4096)
function instTg_(chat, text) {
  const parts = []; let cur = '';
  String(text).split('\n').forEach(l => { if ((cur + '\n' + l).length > 3800) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; });
  if (cur) parts.push(cur);
  parts.forEach(p => UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: String(chat), text: p, disable_web_page_preview: true }), muteHttpExceptions: true }));
}
// once a day after the hour set in the CRM (not on Sunday unless allowed): to every agent with a linked chat and to you
function instSend_(R, S, today) {
  if (!CFG.TG_BOT || R.send === false) return;
  const t = new Date(), hour = Number(Utilities.formatDate(t, CFG.TZ, 'H')), dow = Number(Utilities.formatDate(t, CFG.TZ, 'u'));
  if (hour < Number(R.hour == null ? 9 : R.hour) || (dow === 7 && !R.sunday)) return;
  const P = PropertiesService.getScriptProperties(); if (P.getProperty('instSent') === today) return;
  P.setProperty('instSent', today); // first: a failure below must not send the same list again every 5 minutes
  let n = 0;
  if (R.agents !== false) Object.keys(S.texts.agents).forEach(a => { const ch = (R.chats || {})[a]; if (ch) { try { instTg_(ch, S.texts.agents[a]); n++; } catch (e) { Logger.log('Рассрочка, агенту ' + a + ': ' + mask_(e.message || e)); } } });
  const me = R.me || CFG.TG_CHAT; if (me && S.texts.due) { try { instTg_(me, S.texts.me); n++; } catch (e) { Logger.log('Рассрочка, вам: ' + mask_(e.message || e)); } }
  Logger.log('Рассрочка: напоминаний отправлено ' + n);
}

// ---------- дисциплина: заявки агентов и сообщения в Telegram (правила — disc-rules.json из CRM «Агенты → Дисциплина») ----------
// Заявка: агент в кабинете выбирает «больничный / командировка / отпросился…», дни и причину → inbox/ (CRM показывает её руководителю,
// тот подтверждает или отклоняет — агенту приходит ответ) + сообщение руководителю сразу.
// Опоздание: как только пришёл первый фотоотчёт позже начала дня — агенту «опоздание N мин, штраф …» (один раз в день).
// Авто-невыход: в час из CRM (обычно 12:00) нет первого отчёта, а визиты в плане есть — агенту «отмечен невыход», вам — сводка явки.
// Если отчёт потом всё же пришёл — агенту «невыход снят, считается опоздание». Не пишем: в воскресенье, при отметке дня
// (больничный, командировка…), свободном графике и «без учёта». CRM считает то же самое по тем же правилам (disc.js).
const ABS_TYPES = { leave: 'Отпросился на день', half: 'Полдня — отпросился', sick: 'Больничный', trip: 'Командировка', family: 'Семейные обстоятельства', other: 'Другая причина' };
function absReq_(p, snap) {
  if (!snap.disc || !snap.agent) return { error: 'Дисциплина для этого кабинета не включена' };
  const type = String(p.type || ''), from = String(p.from || ''), to = String(p.to || from), note = String(p.note || '').trim().slice(0, 300);
  if (!ABS_TYPES[type]) return { error: 'Выберите, что за отсутствие' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return { error: 'Проверьте даты' };
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 60) return { error: 'Не больше 60 дней за раз' };
  if (!note) return { error: 'Напишите причину' };
  const stamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'), uid = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const rec = { at: new Date().toISOString(), agent: snap.agent, act: 'absreq', uid: uid, type: type, from: from, to: to, note: note };
  saveB64ToGithub_('inbox/' + stamp + '/' + uid + '.json', Utilities.base64Encode(JSON.stringify(rec), Utilities.Charset.UTF_8), 'Кабинет: заявка на отсутствие');
  const dm = d => d.slice(8, 10) + '.' + d.slice(5, 7);
  try { notify_('📝 Заявка от ' + snap.agent + ': ' + ABS_TYPES[type] + ', ' + (from === to ? dm(from) : dm(from) + '–' + dm(to)) + '\nПричина: ' + note + '\nПодтвердить: CRM → Агенты → Дисциплина'); } catch (e) { Logger.log('Заявка: сообщение не ушло ' + mask_(e.message || e)); }
  return { ok: true };
}
function discNotify_() {
  if (!CFG.TG_BOT) return;
  const t = new Date(), dow = Number(Utilities.formatDate(t, CFG.TZ, 'u')); if (dow === 7) return;
  const mm = s => (s && /^\d{2}:\d{2}/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null);
  const now = Number(Utilities.formatDate(t, CFG.TZ, 'H')) * 60 + Number(Utilities.formatDate(t, CFG.TZ, 'm'));
  const r = ghRaw_('disc-rules.json'); if (r.code !== 200) return;
  const R = JSON.parse(r.text); if (!R || R.notify === false) return;
  const start = mm(R.start || '09:00'), auto = mm(R.autoAbs);
  if (start === null || now < start || now > 16 * 60) return; // LINKO is asked from the start of the day until 16:00
  const today = Utilities.formatDate(t, CFG.TZ, 'yyyy-MM-dd'), P = PropertiesService.getScriptProperties(), key = 'discsent_' + today;
  P.deleteProperty('discsent_' + Utilities.formatDate(new Date(t.getTime() - 864e5), CFG.TZ, 'yyyy-MM-dd'));
  let sent = {}; try { sent = JSON.parse(P.getProperty(key) || '{}'); } catch (e) { sent = {}; }
  const words = s => String(s || '').toLowerCase().split(/\s+/).filter(String).sort().join(' '), alias = {};
  Object.keys(R.alias || {}).forEach(k => { alias[words(k)] = R.alias[k]; });
  const marks = (R.marks || {})[today] || {}, f0 = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), late = [], miss = [];
  let changed = false;
  const tell = (k, agent, text) => { if (sent[k]) return; sent[k] = 1; changed = true; const ch = (R.chats || {})[agent]; if (ch) try { instTg_(ch, text); } catch (e) { Logger.log('Дисциплина, агенту ' + agent + ': ' + mask_(e.message || e)); } };
  all_('staff/working_day/?begin_date=' + today + '&end_date=' + today + '&page=1&page_size=200').forEach(w => {
    const name = [w.first_name, w.second_name].filter(String).join(' '), agent = alias[words(name)] || name;
    if (!agent || (R.skip || {})[agent] || (R.free || {})[agent] || marks[agent]) return;
    const fr = String(get2_(w, 'first_done_task_time.date') || ''), first = fr.slice(0, 10) === today ? fr.slice(11, 16) : '', plan = n_(w.total_tasks_by_market);
    if (first) {
      const lm = Math.max(0, mm(first) - start);
      if (lm > 0) {
        late.push(agent + ' — ' + first + ' (' + lm + ' мин)');
        tell('l_' + agent, agent, '⏰ ' + agent + ', первый фотоотчёт сегодня в ' + first + ', начало рабочего дня — ' + R.start + '.\nОпоздание ' + lm + ' мин' + (R.fine ? ', штраф ' + f0(lm * R.fine) + ' сум' : '') + '.\nЕсли была причина — отправьте заявку в кабинете: «Дисциплина» → «📝 Отсутствие».');
      }
      if (sent['a_' + agent]) tell('b_' + agent, agent, '✅ Первый фотоотчёт получен в ' + first + ' — невыход снят, считается опоздание.');
    } else if (auto !== null && now >= auto && plan > 0) {
      miss.push(agent);
      tell('a_' + agent, agent, '❗ ' + agent + ', сегодня до ' + R.autoAbs + ' нет первого фотоотчёта — день отмечен как невыход.\nЕсли есть причина — отправьте заявку в кабинете: «Дисциплина» → «📝 Отсутствие».');
    }
  });
  // to you: the attendance at the auto-невыход time, once a day
  if (auto !== null && now >= auto && !sent.sum) {
    sent.sum = 1; changed = true;
    const me = R.me || CFG.TG_CHAT;
    if (me && (late.length || miss.length)) try { instTg_(me, '📋 Явка на ' + R.autoAbs + ', ' + today.slice(8, 10) + '.' + today.slice(5, 7) + '\n' + (miss.length ? '❗ Нет отчёта — невыход: ' + miss.join(', ') : '✓ Невыходов нет') + (late.length ? '\n⏰ Опоздали: ' + late.join('; ') : '\n✓ Опозданий нет') + '\nПодробно: CRM → Агенты → Дисциплина'); } catch (e) { Logger.log('Дисциплина, вам: ' + mask_(e.message || e)); }
  }
  if (changed) P.setProperty(key, JSON.stringify(sent));
}
