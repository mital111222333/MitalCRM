/**
 * MITAL CRM — автозагрузка из LINKO (Google Apps Script, бесплатно).
 * Каждые 5 минут (с 7 до 22) берёт из LINKO баланс клиентов (с начала периода плана по сегодня) и остатки всех складов
 * и кладёт их в ваш приватный репозиторий mitalcrm-data (файл linko-latest.json).
 * CRM на любом устройстве, включая телефон, при открытии сама забирает эти данные.
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
  TG_BOT: '',                              // необязательно: токен Telegram-бота — пришлёт сообщение, если что-то сломалось
  TG_CHAT: '',                             // необязательно: ваш chat id
};

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().deleteAllProperties();
  run();
  Logger.log('Готово: автозагрузка будет работать каждые 5 минут (с 7 до 22).');
}

function run() {
  const hour = Number(Utilities.formatDate(new Date(), CFG.TZ, 'H'));
  if (hour < 7 || hour > 22) return; // ночью данные не меняются
  let snap;
  try { snap = collect_(); }
  catch (e) {
    snap = { at: new Date().toISOString(), error: String(e.message || e), files: [] };
    const P0 = PropertiesService.getScriptProperties(); // tell about an error once, not every 5 minutes
    if (P0.getProperty('lastErr') !== snap.error) { notify_('⚠ MITAL CRM: автозагрузка из LINKO не сработала — ' + snap.error); P0.setProperty('lastErr', snap.error); }
  }
  if (!snap.error) PropertiesService.getScriptProperties().deleteProperty('lastErr');
  // write to GitHub only when something changed in LINKO (or once an hour as a heartbeat) — keeps quotas and history small
  const P = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([snap.error || '', snap.files]), Utilities.Charset.UTF_8));
  const last = Number(P.getProperty('savedAt') || 0);
  if (hash === P.getProperty('hash') && Date.now() - last < 3600 * 1000) { Logger.log('Без изменений — пропускаю'); return; }
  saveToGithub_('linko-latest.json', JSON.stringify(snap));
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
    const r = UrlFetchApp.fetch(u, { headers: auth_(), muteHttpExceptions: true, followRedirects: true });
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
    if (!list.length || !list.some(p => n_(p.balance) || n_(p.reserved))) continue;
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

function planFrom_(d) {
  let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (Number(d.slice(8, 10)) < CFG.PLAN_DAY) { m--; if (!m) { m = 12; y--; } }
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + CFG.PLAN_DAY).slice(-2);
}
function auth_() { return { Authorization: 'Token ' + CFG.LINKO_TOKEN }; }
function get_(u) {
  const r = UrlFetchApp.fetch(u.indexOf('http') === 0 ? u : CFG.LINKO_API + u, { headers: auth_(), muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 401 || code === 403) throw new Error('LINKO не принял ключ (' + code + '): возьмите новый ключ LINKO и вставьте в скрипт');
  if (code !== 200) throw new Error('LINKO ответил ' + code);
  return JSON.parse(r.getContentText());
}
function all_(u) { let out = [], next = u; while (next) { const j = get_(next); out = out.concat(j.results || []); next = j.next; } return out; }
function n_(v) { return Number(v) || 0; }
function csv_(rows) { return '﻿' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\n'); }

function saveToGithub_(path, text) {
  const url = 'https://api.github.com/repos/' + CFG.GH_OWNER + '/' + CFG.GH_REPO + '/contents/' + path;
  const h = { Authorization: 'Bearer ' + CFG.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const cur = UrlFetchApp.fetch(url, { headers: h, muteHttpExceptions: true });
  const sha = cur.getResponseCode() === 200 ? JSON.parse(cur.getContentText()).sha : undefined;
  const body = { message: 'LINKO: автозагрузка', content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (sha) body.sha = sha;
  const r = UrlFetchApp.fetch(url, { method: 'put', headers: h, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('GitHub не принял файл: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
}
function notify_(text) {
  if (!CFG.TG_BOT || !CFG.TG_CHAT) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TG_BOT + '/sendMessage', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: CFG.TG_CHAT, text: text }), muteHttpExceptions: true });
}
