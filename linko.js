// Bookmark «⚡ В MITAL CRM» — runs on app.linko.uz with the supervisor's own LINKO session.
// It opens the CRM, asks it for the plan period, takes the client balance and the stock of every warehouse
// from the LINKO API (the same requests the LINKO pages make), turns them into the usual tables and hands them to the CRM.
// The LINKO key never leaves this browser tab: only the tables are sent to the CRM window.
// This file is the readable source; the CRM page builds the bookmark (javascript: link) from it.
(() => {
  const CRM = '__CRM_URL__';
  if (!/linko\.uz$/.test(location.hostname)) { alert('Откройте LINKO (app.linko.uz), войдите и нажмите эту закладку там.'); return; }
  const w = window.open(CRM + '#/up', 'mitalcrm');
  if (!w) { alert('Браузер заблокировал окно. Разрешите всплывающие окна для app.linko.uz и нажмите ещё раз.'); return; }
  let t = localStorage.getItem('token') || ''; try { t = JSON.parse(t); } catch (e) { /* plain string */ }
  if (t && typeof t === 'object') t = t.token || t.access || '';
  let srv = localStorage.getItem('server') || ''; try { srv = JSON.parse(srv); } catch (e) { /* plain string */ }
  if (!/^https?:/.test(srv)) srv = 'https://' + location.hostname.replace(/^app\./, 'mital.');
  const B = srv.replace(/\/+$/, '') + '/ru/api/v1/', H = { Authorization: 'Token ' + t };
  const say = (m, done) => { try { w.postMessage({ type: 'mital-progress', text: m, done: !!done }, CRM.replace(/^(https?:\/\/[^/]+).*$/, '$1')); } catch (e) { /* window closed */ } };
  const get = async u => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('LINKO ответил ' + r.status + (r.status === 401 ? ': войдите в LINKO заново' : '')); return r.json(); };
  const all = async u => { let out = [], next = u; while (next) { const j = await get(next); out = out.concat(j.results || []); next = j.next; } return out; };
  const csv = rows => '﻿' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\n');
  const num = v => Number(v) || 0;

  async function run(from, to) {
    const files = [];
    // 1) client balance: the Excel export of LINKO (it has agents), otherwise the same numbers from the API
    const q = 'only_out_stock=False&is_only_delivered=False&last_status=False&exclude_closed_clients=false&only_payment_with_invoice=false&begin_date=' + from + '&end_date=' + to;
    say('Беру баланс клиентов ' + from + ' — ' + to + '…');
    let got = false;
    for (const u of [B + 'stats/client_balances_expanded/export/?token=' + t + '&' + q, B + 'stats/client_balances_expanded/export/?' + q]) {
      try {
        const r = await fetch(u, { headers: H }); if (!r.ok) continue;
        const buf = await r.arrayBuffer(), b = new Uint8Array(buf);
        if (b[0] === 0x50 && b[1] === 0x4b) { files.push({ name: 'balance - ' + to + 'T000000.xlsx', data: buf }); got = true; break; }
      } catch (e) { /* try the next way */ }
    }
    if (!got) {
      const list = await all(B + 'stats/client_balances_expanded/?' + q + '&page=1&page_size=500');
      const rows = [['№', 'Клиент', 'Агент', 'Баланс на начало периода', 'Продано', 'Возврат', 'Оплачено', 'Прочие приходы', 'Прочие расходы', 'Баланс на конец']];
      for (const c of list) { const u = (c.currencies || []).find(x => x.name === 'USD') || {}; rows.push([c.client_id || c.id, c.name, '', num(u.begin_balance), num(u.order), num(u.order_return), num(u.payment), num(u.none_type_plus), num(u.none_type_minus), num(u.end_balance)]); }
      files.push({ name: 'balance - ' + to + 'T000000.csv', data: new TextEncoder().encode(csv(rows)).buffer });
    }
    // 2) stock of every warehouse the user can see (branch = warehouse in LINKO)
    say('Беру остатки складов…');
    for (let br = 1; br <= 20; br++) {
      let list; try { list = await all(B + 'stock/all_balances/?in_way=true&page=1&branch=' + br + '&page_size=500&show_in=amount'); } catch (e) { continue; }
      if (!list.length || !list.some(p => num(p.balance) || num(p.reserved))) continue;
      const rows = [['Продукт', 'Код', 'Aртикул', 'Тип продукта', 'Бренд', 'Ед. изм.', 'Всего товаров', 'В пути', 'Зарезервированный', 'Доступный']];
      for (const p of list) rows.push([p.title, p.product_code || '', p.vendor_code || '', p.type && p.type.name || '', p.brand && p.brand.brand || '', p.measurement && p.measurement.name || '', num(p.balance), num(p.in_way), num(p.reserved), num(p.available)]);
      files.push({ name: 'stock LINKO branch ' + br + '.csv', data: new TextEncoder().encode(csv(rows)).buffer });
    }
    say('Передаю в CRM…');
    w.postMessage({ type: 'mital-import', files, key: t }, CRM.replace(/^(https?:\/\/[^/]+).*$/, '$1'), files.map(f => f.data));
  }

  // extra data the CRM asks for: only plain LINKO API paths, the answer goes back as rows (so the bookmark never needs replacing)
  async function jobs(list) {
    for (const j of list.slice(0, 30)) {
      if (!j || typeof j.id !== 'string' || !/^[a-z0-9_\/]+\/(\?[\w=&%.:-]*)?$/i.test(j.path || '') || /\.\./.test(j.path)) continue;
      say('Беру из LINKO: ' + (j.title || j.id) + '…');
      let rows = [], err = '';
      try { let next = B + j.path, n = 0; while (next && n++ < 200 && rows.length < 50000) { const r = await get(next); rows = rows.concat(Array.isArray(r) ? r : (r.results || [r])); next = Array.isArray(r) ? null : r.next; } }
      catch (x) { err = String(x.message || x); }
      w.postMessage({ type: 'mital-data', id: j.id, rows, error: err }, origin);
    }
  }

  // looks for every data section LINKO has: the addresses the LINKO pages use, then one small request to each.
  // Only the section names, the number of records and the field names go to the CRM — no values.
  async function probe(from, to) {
    say('🔍 Ищу, какие ещё данные есть в LINKO…');
    const bad = /logout|login|auth|token|password|delete|remove|cancel|confirm|approve|reset|send|sms|notify|export|import|upload|print|pdf|excel|xlsx|create|update|bulk|sync/i;
    const skip = /^(assets|static|js|css|img|images|fonts|media|node_modules|src|http|https|www|ru|uz|en|api|v1|app|data|text|image|application|font|video|audio)\//i;
    const paths = new Set(), calls = new Set();
    for (const r of performance.getEntriesByType('resource')) {
      const m = r.name.match(/\/api\/v1\/([^?#]+)(\?[^#]*)?/); if (!m) continue;
      const p = m[1].replace(/\/\d+\//g, '/{id}/');
      calls.add(p + (m[2] ? '?' + [...new URLSearchParams(m[2]).keys()].filter(k => k !== 'token').join('&') : ''));
      if (!/\{id\}/.test(p)) paths.add(p);
    }
    const urls = [...document.querySelectorAll('script[src],link[href]')].map(x => x.src || x.href)
      .concat(performance.getEntriesByType('resource').map(r => r.name))
      .filter(u => u.startsWith(location.origin) && /\.js(\?|$)/.test(u));
    for (const u of [...new Set(urls)].slice(0, 80)) {
      let t = ''; try { t = await (await fetch(u)).text(); } catch (x) { continue; }
      for (const m of t.matchAll(/["'`]\/?((?:[a-z][a-z0-9_]*\/){1,4})(?=["'`$?])/g)) if (!skip.test(m[1])) paths.add(m[1]);
    }
    const list = [...paths].filter(p => !bad.test(p)).sort().slice(0, 400), out = [];
    const shape = (o, d) => { if (o === null || typeof o !== 'object') return ''; if (Array.isArray(o)) return o.length && typeof o[0] === 'object' ? '[' + shape(o[0], d) + ']' : '[]'; return Object.keys(o).slice(0, 40).map(k => k + (d < 2 && o[k] && typeof o[k] === 'object' ? (Array.isArray(o[k]) ? shape(o[k], d + 1) : '{' + shape(o[k], d + 1) + '}') : '')).join(','); };
    let i = 0, done = 0;
    const one = async () => { while (i < list.length) { const p = list[i++];
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
      try {
        const r = await fetch(B + p + '?page=1&page_size=2&begin_date=' + from + '&end_date=' + to, { headers: H, signal: ac.signal });
        let count = '', fields = '';
        if (r.ok && /json/.test(r.headers.get('content-type') || '')) { const j = await r.json(); count = j && j.count != null ? j.count : Array.isArray(j) ? j.length : ''; fields = shape(j && j.results ? j.results[0] || {} : Array.isArray(j) ? j[0] || {} : j, 0).slice(0, 900); }
        out.push({ path: p, status: r.status, count, fields });
      } catch (x) { out.push({ path: p, status: 0, count: '', fields: '' }); }
      clearTimeout(tm); if (++done % 20 === 0) say('🔍 Проверено разделов: ' + done + ' из ' + list.length + '…'); } };
    await Promise.all([one(), one(), one(), one(), one(), one()]);
    w.postMessage({ type: 'mital-probe', items: out, calls: [...calls].slice(0, 200) }, origin);
    say('✓ Проверка LINKO закончена', true);
  }

  // handshake: knock on the CRM window until it answers with the plan period (it may still be loading)
  const origin = CRM.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  let started = false, tries = 0;
  const knock = setInterval(() => { if (started || ++tries > 120) return clearInterval(knock); try { w.postMessage({ type: 'mital-hello', v: 3 }, origin); } catch (e) { /* loading */ } }, 500);
  addEventListener('message', function on(e) {
    if (e.source !== w || e.origin !== origin || !e.data || e.data.type !== 'mital-ready' || started) return;
    started = true; clearInterval(knock); removeEventListener('message', on);
    const d = e.data;
    run(d.from, d.to)
      .then(() => jobs(d.jobs || []))
      .then(() => d.probe ? probe(d.from, d.to) : null)
      .catch(err => say('✕ ' + err.message, true));
  });
})();
