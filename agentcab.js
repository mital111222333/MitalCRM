// Доступ агентов (Настройки → Доступ агентов): every agent gets a personal link to his own cabinet (me.html). The supervisor's CRM
// computes each agent's part — his clients and debts, plan / fact, discipline and fines, his place in the leaderboard, the stock of
// his warehouse — and saves it to the PRIVATE data repository as agents/<sha256(code)>.json. The agent's page asks the Google
// auto-loader (doGet ?agent=code), which reads only that one file: the agent never gets the GitHub key or anybody else's data.
// Stored in the synced state: ext.agentAccess = { agents: { [agent]: { on, code, wh, sentAt } }, publishedAt }.
// «Режим офиса» (this device only): the CRM refreshes itself and the cabinets every 15 minutes while it is open.
window.EXT_PAGES = window.EXT_PAGES || {};

const AC = {
  DIR: 'agents/',
  cfg() { const x = CRMLocal.ext(); const c = (x.agentAccess ||= { agents: {} }); c.agents ||= {}; return c; },
  cloud() { const c = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null; return c && c.token && c.owner && c.repo ? c : null; },
  web() { const w = CRMLocal.ext().linkoWeb || {}; return w.url || ''; },
  newCode() { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); },
  link(code) { const base = location.origin + location.pathname.replace(/[^/]*$/, ''); return `${base}me.html#k=${encodeURIComponent(code)}&u=${encodeURIComponent(AC.web())}`; },
  office() { try { return localStorage.getItem('crm_office') === '1'; } catch { return false; } },

  // the agent's part of the data: only what he is allowed to see
  async snapshot(agent, d, stock, disc) {
    const a = d.agents.find(x => x.agent === agent) || { sold: 0, plan: 0, paid: 0, pool: 0, debt: 0, akb: 0, okb: 0, debtors: 0 };
    const pct = (x, y) => (y > 0 ? Math.round(x / y * 100) : null);
    const board = d.agents.filter(x => x.agent !== 'Без агента').map(x => ({ agent: x.agent, sold: pct(x.sold, x.plan), paid: pct(x.paid, x.pool), amt: x.sold + x.paid }))
      .map(x => ({ ...x, score: (x.sold ?? 0) + (x.paid ?? 0) })).sort((p, q) => q.score - p.score || q.amt - p.amt) // no plans yet: by sales and collection (amounts are not sent).map((x, i) => ({ place: i + 1, agent: x.agent, sold: x.sold, paid: x.paid, me: x.agent === agent }));
    const prom = typeof NOTES !== 'undefined' ? NOTES.promises(d).filter(p => p.agent === agent && p.status !== 'kept') : [];
    const promBy = new Map(prom.map(p => [p.client, p]));
    const clients = d.clients.filter(c => c.agent === agent).map(c => ({ name: c.name, debt: Math.round(c.debt || 0), sold: Math.round(c.sold || 0), paid: Math.round(c.paid || 0), plan: Math.round(c.plan || 0), pool: Math.round(c.pool || 0), lastPay: c.lastPay || null, lastBuy: c.lastBuy || null, buyDays: c.buyDays ?? null, phone: c.phone || '', landmark: c.landmark || '', promise: promBy.get(c.name) ? { date: promBy.get(c.name).date, sum: promBy.get(c.name).sum } : null }))
      .sort((x, y) => y.debt - x.debt || x.name.localeCompare(y.name));
    const r = disc?.rows.find(x => x.agent === agent), t0 = UI.localDate(Date.now()), today = disc ? DS.cfg().days[t0]?.[agent] || null : null;
    const days = disc ? disc.days.map(dd => ({ day: dd, ...(DS.cfg().days[dd]?.[agent] || {}) })).filter(x => x.first || x.plan).map(x => ({ day: x.day, first: x.first || '', late: x.first ? DS.lateOf(x.first, disc.start) : 0, plan: x.plan || 0, done: x.done || 0 })) : [];
    const wh = AC.cfg().agents[agent]?.wh || '';
    const items = wh && stock ? stock.items.filter(i => i.cells[wh]).map(i => ({ name: i.name, art: i.art, brand: i.brand || '', available: i.cells[wh].available, total: i.cells[wh].total })).sort((x, y) => (x.brand || '').localeCompare(y.brand || '') || x.name.localeCompare(y.name)) : [];
    const whUp = wh && stock ? stock.warehouses.find(w => w.name === wh)?.upload?.taken_at || null : null;
    return {
      v: 1, agent, at: new Date().toISOString(), data_at: d.upload.taken_at, period: { from: d.upload.period_from, to: d.forecast?.period_end || d.upload.period_to, days_left: d.forecast?.days_left ?? null },
      kpi: { sold: Math.round(a.sold), plan: Math.round(a.plan || 0), paid: Math.round(a.paid), pool: Math.round(a.pool || 0), debt: Math.round(a.debt), debtors: a.debtors || 0, akb: a.akb, okb: a.okb },
      board, clients,
      disc: disc ? { start: disc.startTxt, rate: disc.rate, today: today ? { first: today.first || '', late: today.first ? DS.lateOf(today.first, disc.start) : 0 } : null, late: r?.late || 0, minutes: r?.lateMin || 0, fine: r?.fine || 0, route: r?.route ?? null, days } : null,
      // branch: the LINKO warehouse number of this warehouse, so the auto-loader can put fresh stock in (autolinko.gs live_)
      stock: wh ? { warehouse: wh, at: whUp, branch: Object.keys(CRMLocal.ext().linkoBranch || {}).find(b => CRMLocal.ext().linkoBranch[b] === wh) || null, items } : null,
    };
  },

  async gh(c, method, path, body) {
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
    const h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const cur = await fetch(url + '?t=' + Date.now(), { headers: h, cache: 'no-store' }), sha = cur.ok ? (await cur.json()).sha : undefined;
    if (method === 'DELETE' && !sha) return;
    const r = await fetch(url, { method: method === 'DELETE' ? 'DELETE' : 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: body.message, ...(body.content ? { content: body.content } : {}), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub: ' + r.status);
  },
  b64: text => { const bytes = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },

  // write every enabled agent's file (only when it changed); returns how many were written
  async publish({ force = false } = {}) {
    const c = AC.cloud(), A = AC.cfg(), on = Object.entries(A.agents).filter(([, v]) => v.on && v.code);
    if (!c || !on.length || AC._busy) return 0;
    AC._busy = true;
    try {
      const d = await REP.load(); if (d.empty) return 0;
      let stock = null; try { stock = await CRMLocal.request('GET', '/api/wh/stock'); } catch { /* no stock */ }
      let disc = null; try { if (typeof DS !== 'undefined' && LX.has()) disc = DS.model(); } catch { /* no LINKO data */ }
      AC._last ||= {}; let n = 0;
      for (const [agent, v] of on) {
        const snap = await AC.snapshot(agent, d, stock, disc), key = JSON.stringify({ ...snap, at: '' });
        if (!force && AC._last[agent] === key) continue;
        await AC.gh(c, 'PUT', AC.DIR + (await AC.sha(v.code)) + '.json', { message: 'CRM: кабинет агента', content: AC.b64(JSON.stringify(snap)) });
        AC._last[agent] = key; n++;
      }
      A.publishedAt = new Date().toISOString(); // not a reason to sync the whole state: saved with the next real change
      return n;
    } finally { AC._busy = false; }
  },
  async revoke(code) { const c = AC.cloud(); if (c && code) await AC.gh(c, 'DELETE', AC.DIR + (await AC.sha(code)) + '.json', { message: 'CRM: доступ агента закрыт' }); },
};

// publish after the data changes (LINKO import, a balance upload) and on start; «режим офиса» refreshes every 15 minutes
(() => {
  const later = () => { clearTimeout(AC._t); AC._t = setTimeout(() => AC.publish().catch(e => console.warn('agent cabinets', e)), 20000); };
  for (const k of ['importSnap', 'importFast', 'put']) { const orig = LX[k]; if (typeof orig === 'function') LX[k] = function (...a) { const r = orig.apply(this, a); later(); return r; }; }
  Promise.resolve(CRMLocal.ready).then(later);
  setInterval(async () => { if (!AC.office()) return; try { if (window.REFRESH?.run) await REFRESH.run(); } catch { /* refresh failed: publish what we have */ } later(); }, 15 * 60000);
})();

EXT_PAGES.access = async el => {
  await CRMLocal.ready;
  const A = AC.cfg(), d = await REP.load();
  const names = d.empty ? [] : d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  let whs = []; try { whs = (await CRMLocal.request('GET', '/api/wh/warehouses')).map(w => w.name); } catch { /* none */ }
  const tg = CRMLocal.ext().tg || {}, cloud = AC.cloud(), web = AC.web();
  const missing = [!cloud && 'включите синхронизацию (<a href="#/cloud">Синхронизация и настройки</a>)', !web && 'опубликуйте скрипт автозагрузки как веб-приложение (там же, «Кнопка Обновить»)'].filter(Boolean);
  el.innerHTML = `<div class="page-head"><div><h2>Доступ агентов</h2><div class="sub">Личная ссылка для каждого агента: он видит только своих клиентов и долги, план и факт, свою дисциплину и штрафы, своё место в рейтинге и остатки своего склада. Изменить ничего не может.</div></div></div>
    ${missing.length ? `<p class="neg">Чтобы кабинеты заработали: ${missing.join('; ')}.</p>` : ''}
    <div class="bar"><label><input type="checkbox" id="acOffice" ${AC.office() ? 'checked' : ''}> Режим офиса на этом устройстве</label><span class="mut">— пока CRM открыта здесь, она сама обновляет данные и кабинеты агентов каждые 15 минут. Включите на компьютере, который весь день работает.</span>
    <span class="spacer"></span><button class="btn gray" id="acPub"${cloud ? '' : ' disabled'}>Обновить кабинеты сейчас</button></div>
    <p class="mut">${A.publishedAt ? `Кабинеты обновлены ${new Date(A.publishedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : 'Кабинеты ещё не отправлялись.'} Данные в кабинете обновляются, когда открыта ваша CRM (телефон или компьютер) — или постоянно, если включён режим офиса.</p>
    ${names.length ? UI.panel('Агенты', LX.table(['Агент', 'Склад агента', 'Доступ', 'Ссылка', 'Telegram'], names.map(n => { const v = A.agents[n] || {}, chat = tg.token && tg.chats?.[n]; return `<tr><td>${LX.ag(n)}</td>
      <td><select data-wh="${esc(n)}" aria-label="Склад"><option value="">— без склада —</option>${whs.map(w => `<option ${v.wh === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></td>
      <td><label><input type="checkbox" data-on="${esc(n)}" ${v.on ? 'checked' : ''}> ${v.on ? 'открыт' : 'закрыт'}</label></td>
      <td>${v.on && v.code ? `<button class="btn gray sm" data-copy="${esc(n)}">Скопировать</button> <a class="btn gray sm" href="${esc(AC.link(v.code))}" target="_blank" rel="noopener">Открыть как агент</a> <button class="btn gray sm" data-new="${esc(n)}" title="Старая ссылка перестанет работать">Новая ссылка</button>` : '<span class="mut">—</span>'}</td>
      <td>${v.on && v.code ? (chat ? `<button class="btn sm" data-send="${esc(n)}">📤 Отправить ссылку</button>${v.sentAt ? `<br><small class="mut">отправлено ${UI.dateRu(v.sentAt.slice(0, 10))}</small>` : ''}` : '<small class="mut">агент не привязан в «Telegram агентам»</small>') : ''}</td></tr>`; })), { cls: 'w12', sub: 'Откройте доступ, выберите склад, отправьте ссылку. «Новая ссылка» — если ссылка попала к чужому: старая сразу перестаёт работать.' }) : UI.empty('Нет агентов', 'Агенты появятся после загрузки «Баланс клиентов».')}`;
  const re = () => EXT_PAGES.access(el), save = () => { CRMLocal.touch(); setTimeout(() => AC.publish({ force: true }).catch(e => toast(e.message)), 500); };
  $('#acOffice', el).onchange = e => { try { localStorage.setItem('crm_office', e.target.checked ? '1' : '0'); } catch { /* storage blocked */ } toast(e.target.checked ? 'Режим офиса включён на этом устройстве' : 'Режим офиса выключен'); };
  $('#acPub', el).onclick = async () => { try { const n = await AC.publish({ force: true }); toast(`Кабинеты обновлены: ${n}`); re(); } catch (e) { toast(e.message); } };
  el.querySelectorAll('[data-wh]').forEach(s => s.onchange = () => { (A.agents[s.dataset.wh] ||= {}).wh = s.value; save(); });
  el.querySelectorAll('[data-on]').forEach(cb => cb.onchange = async () => {
    const v = (A.agents[cb.dataset.on] ||= {});
    if (cb.checked) { v.on = true; v.code ||= AC.newCode(); } else { v.on = false; try { await AC.revoke(v.code); } catch (e) { toast(e.message); } v.code = ''; }
    save(); re();
  });
  el.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => {
    const v = A.agents[b.dataset.new]; if (!confirm(`Сделать новую ссылку для ${b.dataset.new}? Старая сразу перестанет работать — новую надо будет отправить агенту.`)) return;
    try { await AC.revoke(v.code); } catch (e) { toast(e.message); }
    v.code = AC.newCode(); v.sentAt = ''; save(); re();
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const l = AC.link(A.agents[b.dataset.copy].code); try { await navigator.clipboard.writeText(l); toast('Ссылка скопирована'); } catch { prompt('Скопируйте ссылку', l); } });
  el.querySelectorAll('[data-send]').forEach(b => b.onclick = async () => {
    const n = b.dataset.send, v = A.agents[n], chat = tg.chats[n];
    if (!confirm(`Отправить ${n} его личную ссылку в Telegram?`)) return;
    try {
      await AC.publish({ force: true });
      await TG.send(chat.id, `<b>Ваш кабинет MITAL CRM</b>\nЗдесь ваши клиенты и долги, план и факт, дисциплина и место в рейтинге.\n\n${esc(AC.link(v.code))}\n\nСсылка личная — никому её не пересылайте. Откройте и добавьте на экран телефона.`);
      v.sentAt = new Date().toISOString(); CRMLocal.touch(); toast('Ссылка отправлена'); re();
    } catch (e) { toast(e.message); }
  });
};
