// Кабинет агента (me.html): the agent's own page. The personal link carries a secret code (k) and the address of the Google
// auto-loader (u); the page asks u?agent=k and gets back only this agent's file, prepared by the supervisor's CRM (agentcab.js).
// Read-only. The link is remembered on this phone, and the last data is kept so the page opens without internet.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');
  const $$ = n => '$' + f0(n);
  const dRu = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
  const dm = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);
  const tile = (label, value, sub = '', tone = '') => `<div class="tile ${tone ? 'tone-' + tone : ''}"><div class="tl">${label}</div><div class="tv">${value}</div><div class="ts">${sub}</div></div>`;
  const panel = (title, body, sub = '') => `<section class="panel w12"><div class="ph"><div><h4>${title}</h4>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>${body}</section>`;
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };

  // the personal link: #k=…&u=… (taken once, then remembered and removed from the address bar)
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('k') && h.get('u')) { store.set('mital_me', { k: h.get('k'), u: h.get('u') }); history.replaceState(null, '', location.pathname); }
  const link = store.get('mital_me');
  let tab = 'main', q = '', S = store.get('mital_me_data'), loading = false;

  async function load() {
    if (!link) return;
    loading = true; $('#meUpd').disabled = true; $('#meUpd').textContent = 'Обновляю…';
    try {
      const r = await fetch(link.u + (link.u.includes('?') ? '&' : '?') + 'agent=' + encodeURIComponent(link.k) + '&t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.error) { msg(j.error, true); if (/закрыт|устарел|неверн/.test(j.error)) { S = null; store.set('mital_me_data', null); } }
      else { S = j; store.set('mital_me_data', j); msg(''); }
    } catch { msg(S ? 'Нет интернета — показаны последние сохранённые данные' : 'Нет интернета. Откройте страницу, когда появится связь.', !S); }
    loading = false; $('#meUpd').disabled = false; $('#meUpd').textContent = '🔄 Обновить';
    draw();
  }
  const msg = (t, bad) => { const m = $('#meMsg'); m.textContent = t; m.className = bad ? 'neg' : 'mut'; m.hidden = !t; };
  const search = () => { const i = $('#meQ'); if (i) i.oninput = () => { q = i.value; draw(); const j = $('#meQ'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; };

  function draw() {
    const body = $('#meBody');
    if (!link) { body.innerHTML = '<div class="empty-state"><h3>Нужна личная ссылка</h3><p>Откройте ссылку на кабинет, которую прислал руководитель в Telegram.</p></div>'; return; }
    if (!S) { body.innerHTML = loading ? '<p class="mut">Загружаю…</p>' : '<div class="empty-state"><h3>Нет данных</h3><p>Причина — в сообщении выше. Если доступ закрыт, попросите руководителя прислать новую ссылку.</p></div>'; return; }
    const k = S.kpi, sp = pct(k.sold, k.plan), cp = pct(k.paid, k.pool), me = S.board.find(b => b.me);
    $('#meName').textContent = S.agent;
    $('#meSub').textContent = `Период ${dRu(S.period.from)} — ${dRu(S.period.to)}${S.period.days_left != null ? ` · осталось ${S.period.days_left} дн.` : ''} · данные на ${new Date(S.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    if (tab === 'main') {
      const t = S.disc?.today, top = S.clients.filter(c => c.debt > 0 && (c.promise || c.pool > c.paid)).slice(0, 10);
      body.innerHTML = `<div class="kpis">
        ${tile('Продано', $$(k.sold), k.plan ? `план ${$$(k.plan)} · ${sp}%` : 'план не задан', sp === null ? '' : sp >= 100 ? 'good' : '')}
        ${tile('Собрано', $$(k.paid), k.pool ? `пул ${$$(k.pool)} · ${cp}% · осталось ${$$(Math.max(0, k.pool - k.paid))}` : 'пул не задан', cp === null ? '' : cp >= 100 ? 'good' : '')}
        ${tile('Долг ваших клиентов', $$(k.debt), `должников ${f0(k.debtors)}`, k.debt ? 'warn' : '')}
        ${tile('Место в рейтинге', me ? `${me.place} из ${S.board.length}` : '—', 'по % плана продаж и сбора')}
        ${S.disc ? tile('Сегодня', t?.first ? `отчёт в ${esc(t.first)}` : 'нет отчёта', t?.late ? `опоздание ${t.late} мин · штраф ${f0(t.late * S.disc.rate)} сум` : t?.first ? 'вовремя ✓' : `первый фотоотчёт до ${esc(S.disc.start)}`, t?.late ? 'bad' : t?.first ? 'good' : 'warn') : ''}
        ${S.disc ? tile('Штрафы за период', f0(S.disc.fine) + ' сум', `опозданий ${S.disc.late} · ${S.disc.minutes} мин`, S.disc.fine ? 'bad' : 'good') : ''}
        ${tile('АКБ / ОКБ', `${k.akb} / ${k.okb}`, 'активные / все клиенты')}</div>
        ${panel('Рейтинг агентов', `<div class="tscroll"><table><thead><tr><th class="n">#</th><th>Агент</th><th class="n">План продаж</th><th class="n">Сбор пула</th></tr></thead><tbody>${S.board.map(b => `<tr${b.me ? ' style="font-weight:700"' : ''}><td class="n">${b.place}</td><td>${esc(b.agent)}${b.me ? ' — вы' : ''}</td><td class="n">${b.sold != null ? b.sold + '%' : '—'}</td><td class="n">${b.paid != null ? b.paid + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>`, 'Место — по сумме % плана продаж и % сбора пула')}
        ${top.length ? panel('Кому собрать в первую очередь', `<div class="tscroll"><table><thead><tr><th>Клиент</th><th class="n">Долг</th><th class="n">Осталось по пулу</th><th>Обещал</th></tr></thead><tbody>${top.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${$$(c.debt)}</td><td class="n">${c.pool ? $$(Math.max(0, c.pool - c.paid)) : '—'}</td><td>${c.promise ? `${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>`) : ''}`;
    }
    if (tab === 'clients') {
      const L = S.clients.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));
      body.innerHTML = `<div class="bar"><input id="meQ" type="search" placeholder="Поиск клиента" value="${esc(q)}" style="flex:1;min-width:0"></div>
        ${panel(`Мои клиенты (${f0(L.length)})`, `<div class="tscroll"><table><thead><tr><th>Клиент</th><th class="n">Долг</th><th class="n">Купил</th><th class="n">Оплатил</th><th class="n">Пул, осталось</th><th class="n">Посл. оплата</th><th class="n">Без покупок</th><th>Обещал</th></tr></thead><tbody>${L.map(c => `<tr><td>${esc(c.name)}${c.landmark ? `<br><small class="mut">${esc(c.landmark)}</small>` : ''}${c.phone ? `<br><a href="tel:${esc(c.phone)}"><small>${esc(c.phone)}</small></a>` : ''}</td><td class="n ${c.debt ? 'neg' : ''}">${c.debt ? $$(c.debt) : '—'}</td><td class="n">${$$(c.sold)}</td><td class="n">${$$(c.paid)}</td><td class="n">${c.pool ? $$(Math.max(0, c.pool - c.paid)) : '—'}</td><td class="n">${c.lastPay ? dm(c.lastPay) : '—'}</td><td class="n ${c.buyDays > 30 ? 'neg' : ''}">${c.buyDays != null ? c.buyDays + ' дн.' : '—'}</td><td>${c.promise ? `${dm(c.promise.date)}${c.promise.sum ? ' · ' + $$(c.promise.sum) : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>`, 'Сверху — самые большие долги')}`;
      search();
    }
    if (tab === 'stock') {
      if (!S.stock) { body.innerHTML = '<div class="empty-state"><h3>Склад не назначен</h3><p>Попросите руководителя указать ваш склад.</p></div>'; return; }
      const L = S.stock.items.filter(i => !q || (i.name + ' ' + i.brand + ' ' + i.art).toLowerCase().includes(q.toLowerCase()));
      body.innerHTML = `<div class="bar"><input id="meQ" type="search" placeholder="Поиск товара, бренда, артикула" value="${esc(q)}" style="flex:1;min-width:0"></div>
        ${panel(`Склад ${esc(S.stock.warehouse)} (${f0(L.length)})`, `<div class="tscroll"><table><thead><tr><th>Товар</th><th>Бренд</th><th class="n">Доступно</th><th class="n">Всего</th></tr></thead><tbody>${L.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td>${esc(i.brand)}</td><td class="n ${i.available <= 0 ? 'neg' : ''}"><b>${f0(i.available)}</b></td><td class="n">${f0(i.total)}</td></tr>`).join('')}</tbody></table></div>`, `Остатки на ${dRu(S.stock.at)}. «Доступно» — без резерва под заказы.`)}`;
      search();
    }
    if (tab === 'disc') {
      const D = S.disc;
      body.innerHTML = D ? `<div class="kpis">${tile('Штрафы за период', f0(D.fine) + ' сум', `${D.minutes} мин опозданий · ${f0(D.rate)} сум за минуту`, D.fine ? 'bad' : 'good')}${tile('Опозданий', f0(D.late), `первый фотоотчёт до ${esc(D.start)}`, D.late ? 'warn' : 'good')}${tile('Маршрут', D.route != null ? Math.round(D.route * 100) + '%' : '—', 'визитов из плана за период')}</div>
        ${panel('По дням', `<div class="tscroll"><table><thead><tr><th>День</th><th>Первый отчёт</th><th class="n">Опоздание</th><th class="n">Штраф</th><th class="n">Визиты</th></tr></thead><tbody>${D.days.slice().reverse().map(x => `<tr><td>${dRu(x.day)}</td><td class="${x.late ? 'neg' : ''}">${x.first || (x.plan ? 'нет отчёта' : '—')}</td><td class="n">${x.late ? x.late + ' мин' : x.first ? '✓' : ''}</td><td class="n ${x.late ? 'neg' : ''}">${x.late ? f0(x.late * D.rate) + ' сум' : ''}</td><td class="n">${x.plan ? `${x.done}/${x.plan}` : ''}</td></tr>`).join('')}</tbody></table></div>`)}` : '<p class="mut">Данных о дисциплине пока нет.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.tab; q = ''; draw(); scrollTo(0, 0); });
    $('#meUpd').onclick = load;
    draw(); load();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && Date.now() - Date.parse(S.at || 0) > 10 * 60000) load(); });
  });
})();
