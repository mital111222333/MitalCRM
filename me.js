// Кабинет агента (me.html): the agent's own page. The personal link carries a secret code (k) and the address of the Google
// auto-loader (u); the page asks u?agent=k and gets back only this agent's file, prepared by the supervisor's CRM (agentcab.js).
// Read-only. The link is remembered on this phone, and the last data is kept so the page opens without internet.
// Inside Telegram (Mini App from the bot's button) there is no link: the page sends Telegram's signed initData instead (u?tg=…),
// the auto-loader checks the signature with the bot token and returns the file of that Telegram user.
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
  const ACADEMY = 'https://mital111222333.github.io/academy/'; // MITAL Akademiya: courses for agents
  const hhmm = v => (v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };

  // the personal link: #k=…&u=… (taken once, then remembered and removed from the address bar)
  const TGA = window.Telegram?.WebApp, inTg = !!TGA?.initData, qs = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('k') && h.get('u')) { store.set('mital_me', { k: h.get('k'), u: h.get('u') }); history.replaceState(null, '', location.pathname + location.search); }
  const link = inTg && qs.get('u') ? { tg: TGA.initData, u: qs.get('u') } : store.get('mital_me');
  if (inTg) { try { TGA.ready(); TGA.expand(); if (TGA.colorScheme === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* old Telegram */ } }
  let tab = 'main', q = '', S = store.get('mital_me_data'), loading = false, doing = null;
  // chat tab: the agent's conversation with the bot through the chat worker (/agent/*), signed in by Telegram's initData
  const CH = { msgs: [], last: 0, timer: null, sending: false };
  const chatUrl = p => S?.chat ? S.chat.replace(/\/+$/, '') + p : '';
  async function chatLoad() {
    if (!inTg || !S?.chat) return;
    try {
      const r = await fetch(chatUrl('/agent/messages?since=' + CH.last), { headers: { Authorization: 'tma ' + TGA.initData }, cache: 'no-store' });
      const j = await r.json(); if (!Array.isArray(j)) return;
      for (const m of j) if (!CH.msgs.some(x => x.id === m.id)) CH.msgs.push(m);
      CH.msgs.sort((a, b) => a.id - b.id); if (CH.msgs.length) CH.last = CH.msgs.at(-1).id;
      if (j.length && tab === 'chat') chatDraw();
    } catch { /* offline: try again on the next tick */ }
  }
  function chatDraw() {
    const box = $('#chatList'); if (!box) return;
    const at = s => new Date(s * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const file = id => chatUrl('/agent/file?file_id=' + encodeURIComponent(id) + '&init=' + encodeURIComponent(TGA.initData));
    box.innerHTML = CH.msgs.length ? CH.msgs.map(m => { const me = !m.out; let media = '';
      if (m.type === 'photo' && m.file_id) media = `<img src="${file(m.file_id)}" alt="Фото" loading="lazy">`;
      else if ((m.type === 'voice' || m.type === 'audio') && m.file_id) media = `<audio controls preload="none" src="${file(m.file_id)}"></audio>`;
      else if ((m.type === 'video' || m.type === 'video_note') && m.file_id) media = `<video controls preload="none" src="${file(m.file_id)}" style="max-width:100%"></video>`;
      else if (m.type === 'document' && m.file_id) media = `<a href="${file(m.file_id)}" target="_blank" rel="noopener">📎 ${esc(m.file_name || 'файл')}</a>`;
      return `<div class="chat-msg ${me ? 'me' : ''}">${media}${m.text ? esc(m.text) : ''}<small>${me ? 'Вы' : 'Руководитель'} · ${at(m.date)}</small></div>`; }).join('') : '<p class="mut">Сообщений пока нет. Напишите руководителю — он ответит здесь.</p>';
    box.scrollTop = box.scrollHeight;
  }
  function chatStop() { clearInterval(CH.timer); CH.timer = null; }
  // tasks marked here but not yet seen by the supervisor's CRM: shown as «отправлено» until the next data comes
  const marks = () => store.get('mital_me_marks') || {}, markKey = t => t.src + ':' + t.id;
  const isOpen = t => (t.status === 'open' || t.status === 'returned') && !marks()[markKey(t)];

  async function load() {
    if (!link) return;
    loading = true; $('#meUpd').disabled = true; $('#meUpd').textContent = 'Обновляю…';
    try {
      const r = await fetch(link.u + (link.u.includes('?') ? '&' : '?') + (link.tg ? 'tg=' + encodeURIComponent(link.tg) : 'agent=' + encodeURIComponent(link.k)) + '&t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j.error) { msg(j.error, true); if (/закрыт|устарел|неверн/.test(j.error)) { S = null; store.set('mital_me_data', null); } }
      else { S = j; store.set('mital_me_data', j); msg(''); const m = marks(), keep = {}; for (const t of j.tasks || []) if (m[markKey(t)] && (t.status === 'open' || t.status === 'returned')) keep[markKey(t)] = m[markKey(t)]; store.set('mital_me_marks', keep); }
    } catch { msg(S ? 'Нет интернета — показаны последние сохранённые данные' : 'Нет интернета. Откройте страницу, когда появится связь.', !S); }
    loading = false; $('#meUpd').disabled = false; $('#meUpd').textContent = '🔄 Обновить';
    draw();
  }
  // a phone photo is large: shrink to 1280 px JPEG before sending
  async function shrink(file) {
    const img = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72)); const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function sendDone(t, comment, file) {
    const photo = file ? await shrink(file) : '';
    const body = JSON.stringify({ ...(link.tg ? { tg: link.tg } : { k: link.k }), act: 'done', src: t.src, id: t.id, comment, photo });
    const r = await fetch(link.u, { method: 'POST', body }); const j = await r.json();
    if (j.error) throw new Error(j.error);
    const m = marks(); m[markKey(t)] = new Date().toISOString(); store.set('mital_me_marks', m);
  }
  const msg = (t, bad) => { const m = $('#meMsg'); m.textContent = t; m.className = bad ? 'neg' : 'mut'; m.hidden = !t; };
  // chat with the supervisor = the chat with the bot: inside Telegram the button closes the cabinet and the agent is back in that chat
  // (voice, photos, files — everything Telegram has); the supervisor answers from CRM → «Чаты Telegram». Outside Telegram it opens the bot.
  const chatBtn = () => (inTg ? '<button class="btn gray" type="button" data-chat="1">💬 Чат с руководителем</button>' : S?.bot ? `<a class="btn gray" href="https://t.me/${esc(S.bot)}" target="_blank" rel="noopener">💬 Чат с руководителем</a>` : S?.boss ? `<a class="btn gray" href="https://t.me/${esc(S.boss)}" target="_blank" rel="noopener">💬 Написать руководителю</a>` : '');
  const search = () => { const i = $('#meQ'); if (i) i.oninput = () => { q = i.value; draw(); const j = $('#meQ'); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }; };


  // ---------- store keeper's cabinet (role 'store'): the daily blind stock count ----------
  // The list has product names only. «Начать сверку» asks the auto-loader to keep LINKO «Всего» of this minute; the counts are kept on
  // the phone while counting (the app may close), «Отправить» sends them. A recount asked by the supervisor shows only those items.
  const CNT = { get: () => store.get('mital_cnt'), set: v => store.set('mital_cnt', v) };
  async function storePost(body) {
    const r = await fetch(link.u, { method: 'POST', body: JSON.stringify({ ...(link.tg ? { tg: link.tg } : { k: link.k }), ...body }) });
    const j = await r.json(); if (j.error) throw new Error(j.error); return j;
  }
  function drawStore(body) {
    const nav = document.querySelector('nav.tabs'); if (nav) nav.hidden = true;
    const t0 = new Date().toLocaleDateString('sv-SE'), hm = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const rec = S.recount && S.recount.length ? S.recount : null, list = rec ? rec.map(r => ({ ...((S.items || []).find(i => i.art === r.art) || {}), ...r, brand: '' })) : (S.items || []);
    let st = CNT.get(); if (st && (st.day !== t0 || !!st.partial !== !!rec)) { st = null; CNT.set(null); }
    $('#meName').textContent = 'Склад ' + S.warehouse;
    $('#meSub').textContent = `${S.name} · сверка до ${S.deadline || '10:00'}${S.today ? ` · сегодня отправлено в ${hm(S.today.at)}` : ''}`;
    // the result of the day (from the auto-loader): ok / closed with a discrepancy — nothing more to send today
    const R = S.round && S.round.status !== 'recount' ? S.round : null;
    if (!st && R) {
      body.innerHTML = R.status === 'ok'
        ? panel('Сверка склада', `<p class="pos" style="font-size:18px"><b>✅ Сверка прошла успешно — склад в порядке</b></p><p class="mut">Отправлено в ${hm(R.at)}${R.round === 2 ? ' (после пересчёта)' : ''}. Спасибо!</p>`)
        : panel('Сверка склада закрыта', `<p class="neg"><b>⚠️ Пересчёт не сошёлся по ${R.items.length} поз.</b></p><ul>${R.items.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul><p class="mut">Расхождение зафиксировано, руководитель получил отчёт. Сегодня сверка больше не отправляется.</p>`);
      if (chatBtn()) body.insertAdjacentHTML('beforeend', `<div class="bar">${chatBtn()}</div>`);
      return;
    }
    if (!st) {
      body.innerHTML = panel(rec ? '↻ Есть расхождение — пересчитайте' : 'Сверка склада', `
        ${rec ? `<p>По этим товарам цифры не сошлись. Пересчитайте их внимательно ещё раз (${rec.length} поз.) — <b>это последняя попытка</b>:</p><ul>${rec.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul>` : S.today ? `<p class="pos"><b>✓ Сегодняшняя сверка отправлена в ${hm(S.today.at)}</b></p><p class="mut">Если нужно — можно пересчитать и отправить заново.</p>` : `<p>Пересчитайте все товары склада (${list.length} поз.) и отправьте до <b>${esc(S.deadline || '10:00')}</b>. Считайте то, что физически лежит на складе, включая отложенное под заказы.</p>`}
        <p class="mut">Нажмите «Начать», когда готовы считать — с этой минуты CRM сравнит с остатком LINKO.</p>
        <div class="bar"><button class="btn" id="scStart" style="padding:12px 20px;font-size:16px">▶ ${rec ? 'Начать пересчёт' : S.today ? 'Начать сверку заново' : 'Начать сверку'}</button></div><small id="scE" class="neg" role="alert"></small>`) + (chatBtn() ? `<div class="bar">${chatBtn()}</div>` : '');
      $('#scStart').onclick = async e => { e.target.disabled = true; try { const j = await storePost({ act: 'count_start' }); CNT.set({ day: t0, start: j.at, partial: !!rec, counts: {} }); drawStore(body); } catch (err) { e.target.disabled = false; $('#scE').textContent = err.message; } };
      return;
    }
    const filled = list.filter(i => st.counts[i.art] !== undefined && st.counts[i.art] !== '').length;
    const groups = new Map(); for (const i of list) { const k = i.brand || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    body.innerHTML = `<div class="bar" style="position:sticky;top:52px;z-index:4;background:var(--bg,#eef2f5);padding:8px 0"><input id="scQ" type="search" placeholder="Поиск товара" value="${esc(q)}" style="flex:1;min-width:0"><b id="scN">${filled} / ${list.length}</b></div>
      ${panel(rec ? 'Пересчёт' : 'Пересчитайте товары', [...groups].map(([g, L]) => `${g ? `<h4 style="margin:14px 0 6px">${esc(g)}</h4>` : ''}${L.map(i => `<label class="sc-row" data-n="${esc((i.name + ' ' + i.art).toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line,#dde3e8)"><span style="flex:1;min-width:0">${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></span><input type="number" inputmode="numeric" min="0" step="1" data-a="${esc(i.art)}" value="${st.counts[i.art] ?? ''}" style="width:90px;font-size:18px;text-align:right;padding:8px"></label>`).join('')}`).join(''), 'Пусто — ещё не посчитано. Если товара нет — поставьте 0.')}
      ${panel('Отправить', `<div class="form"><label style="grid-column:1/-1">Комментарий (необязательно)<textarea id="scC" rows="2" maxlength="500" placeholder="например: 2 коробки повреждены"></textarea></label><label style="grid-column:1/-1">Фото (необязательно)<input id="scP" type="file" accept="image/*" capture="environment"></label></div>
        <div class="bar"><button class="btn gray" id="scZero">Поставить 0 в пустые</button><button class="btn gray" id="scX">Отменить</button><span class="spacer"></span><button class="btn" id="scGo">Отправить сверку</button></div><small id="scE" class="neg" role="alert"></small>`)}`;
    const upd = () => { const n = list.filter(i => st.counts[i.art] !== undefined && st.counts[i.art] !== '').length; $('#scN').textContent = n + ' / ' + list.length; };
    body.querySelectorAll('input[data-a]').forEach(inp => inp.oninput = () => { const v = inp.value.trim(); if (v === '') delete st.counts[inp.dataset.a]; else st.counts[inp.dataset.a] = Math.max(0, Math.round(Number(v)) || 0); CNT.set(st); upd(); });
    $('#scQ').oninput = e => { q = e.target.value; const s = q.toLowerCase(); body.querySelectorAll('.sc-row').forEach(r => { r.style.display = !s || r.dataset.n.includes(s) ? 'flex' : 'none'; }); };
    $('#scQ').dispatchEvent(new Event('input'));
    $('#scZero').onclick = () => { const empty = list.filter(i => st.counts[i.art] === undefined); if (!empty.length) return; if (!confirm(`Поставить 0 для ${empty.length} непосчитанных позиций?`)) return; for (const i of empty) st.counts[i.art] = 0; CNT.set(st); drawStore(body); };
    $('#scX').onclick = () => { if (!confirm('Отменить сверку? Введённые цифры удалятся.')) return; CNT.set(null); drawStore(body); };
    $('#scGo').onclick = async e => {
      const empty = list.filter(i => st.counts[i.art] === undefined);
      if (empty.length) return ($('#scE').textContent = `Не посчитано ${empty.length} поз. — введите количество или нажмите «Поставить 0 в пустые»`);
      e.target.disabled = true; e.target.textContent = 'Отправляю…';
      try {
        const file = $('#scP').files[0], photo = file ? await shrink(file) : '';
        const counts = {}; for (const i of list) counts[i.art] = st.counts[i.art];
        const j = await storePost({ act: 'count', counts, partial: !!rec, comment: $('#scC').value.trim(), photo });
        CNT.set(null); q = '';
        const at = new Date().toISOString(), items = j.items || [];
        S.today = { at }; S.round = j.result ? { status: j.result, round: j.round, at, items } : null; S.recount = j.result === 'recount' ? items : [];
        msg(j.result === 'ok' ? '✅ Сверка прошла успешно — склад в порядке' : j.result === 'recount' ? `↻ Есть расхождение: пересчитайте ${items.length} поз.` : j.result === 'final' ? '⚠️ Пересчёт не сошёлся — расхождение зафиксировано' : 'Сверка отправлена руководителю ✓', j.result === 'final');
        try { TGA?.HapticFeedback?.notificationOccurred(j.result === 'ok' ? 'success' : 'warning'); } catch { /* not in Telegram */ }
        drawStore(body); load();
      } catch (err) { e.target.disabled = false; e.target.textContent = 'Отправить сверку'; $('#scE').textContent = err.message || 'Нет связи — попробуйте ещё раз, цифры сохранены'; }
    };
  }

  function draw() {
    const body = $('#meBody');
    if (!link) { body.innerHTML = '<div class="empty-state"><h3>Откройте кабинет из Telegram</h3><p>Нажмите кнопку «Мой кабинет» в боте MITAL — или откройте ссылку, которую прислал руководитель.</p></div>'; return; }
    if (S && S.role === 'store') return drawStore(body);
    if (!S) { body.innerHTML = loading ? '<p class="mut">Загружаю…</p>' : '<div class="empty-state"><h3>Нет данных</h3><p>Причина — в сообщении выше. Если доступ закрыт, попросите руководителя прислать новую ссылку.</p></div>'; return; }
    const k = S.kpi, sp = pct(k.sold, k.plan), cp = pct(k.paid, k.pool), me = S.board.find(b => b.me);
    $('#meName').textContent = S.agent;
    $('#meSub').textContent = `Период ${dRu(S.period.from)} — ${dRu(S.period.to)}${S.period.days_left != null ? ` · осталось ${S.period.days_left} дн.` : ''} · план и рейтинг на ${hhmm(S.at)}${S.live?.debt ? ` · долги на ${hhmm(S.live.debt)}` : ''}${S.live?.stock ? ` · остатки на ${hhmm(S.live.stock)}` : ''}`;
    document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    const openN = (S.tasks || []).filter(isOpen).length; $('#meTaskN').textContent = openN ? `(${openN})` : '';
    if (tab !== 'chat') chatStop();
    if (tab === 'chat') {
      if (!inTg || !S.chat) { body.innerHTML = panel('Чат с руководителем', `<p>Чат работает в кабинете внутри Telegram.</p>${chatBtn() ? `<div class="bar">${chatBtn()}</div>` : ''}`); return; }
      body.innerHTML = panel('Чат с руководителем', `<div class="chat-list" id="chatList"><p class="mut">Загружаю…</p></div>
        <div class="chat-send"><label class="btn gray" title="Отправить фото" aria-label="Отправить фото" style="cursor:pointer;font-size:20px;padding:8px 12px;line-height:1">📷<input id="chatPh" type="file" accept="image/*" hidden></label><textarea id="chatT" rows="2" maxlength="3000" placeholder="Сообщение"></textarea><button class="btn" id="chatGo" type="button">➤</button></div><small id="chatE" class="neg" role="alert"></small>`, 'Голосовые и файлы можно отправить в самом чате с ботом — кнопка ниже');
      body.insertAdjacentHTML('beforeend', `<div class="bar">${chatBtn()}</div>`);
      chatDraw(); chatLoad(); if (!CH.timer) CH.timer = setInterval(chatLoad, 5000);
      const send = async (text, file) => {
        if (CH.sending) return; CH.sending = true; $('#chatE').textContent = '';
        try {
          let r;
          if (file) { const fd = new FormData(), b64 = await shrink(file), bin = atob(b64), u8 = Uint8Array.from(bin, c => c.charCodeAt(0)); fd.append('file', new Blob([u8], { type: 'image/jpeg' }), 'photo.jpg'); if (text) fd.append('caption', text); r = await fetch(chatUrl('/agent/send-photo'), { method: 'POST', headers: { Authorization: 'tma ' + TGA.initData }, body: fd }); }
          else r = await fetch(chatUrl('/agent/send'), { method: 'POST', headers: { Authorization: 'tma ' + TGA.initData, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
          const j = await r.json(); if (j.error) throw new Error(j.error);
          $('#chatT').value = ''; await chatLoad(); chatDraw();
        } catch (e) { $('#chatE').textContent = e.message || 'Не отправилось — проверьте интернет'; }
        CH.sending = false;
      };
      $('#chatGo').onclick = () => { const t = $('#chatT').value.trim(); if (t) send(t); };
      $('#chatPh').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) send($('#chatT').value.trim(), f); };
      return;
    }
    if (tab === 'tasks') {
      const T = S.tasks || [], ST = { open: ['info', 'в работе'], returned: ['crit', 'возвращено — доделать'], done: ['warn', 'на проверке'], closed: ['good', '✓ принято'] };
      const item = t => { const sent = marks()[markKey(t)], st = sent ? ['warn', 'отправлено руководителю'] : ST[t.status] || ST.open;
        return `<li><div><span class="pill ${st[0]}">${st[1]}</span> <b>${esc(t.title)}</b>${t.due ? ` <span class="mut">· до ${dRu(t.due)}</span>` : ''}${t.overdue && !sent ? ' <b class="neg">просрочено</b>' : ''}</div>
          ${t.text ? `<div class="mut">${esc(t.text)}</div>` : ''}${t.progress ? `<div>Факт: <b>${esc(t.progress)}</b></div>` : ''}${t.back && t.status === 'returned' ? `<div class="neg">↩ ${esc(t.back)}</div>` : ''}
          <div class="bar" style="margin-top:6px">${t.link ? `<a class="btn gray sm" href="${esc(t.link)}" target="_blank" rel="noopener">${t.kind === 'academy' ? '🎓 Открыть урок' : 'Открыть ссылку'}</a>` : ''}${isOpen(t) ? `<button class="btn sm" data-do="${esc(markKey(t))}">✅ Выполнено</button>` : ''}</div>
          ${doing === markKey(t) ? `<div class="form" style="margin-top:8px"><label style="grid-column:1/-1">Комментарий<textarea id="dnC" rows="3" maxlength="1000" placeholder="Что сделано"></textarea></label><label style="grid-column:1/-1">Фото (необязательно)<input id="dnP" type="file" accept="image/*" capture="environment"></label></div><small id="dnE" class="neg" role="alert"></small><div class="bar"><button class="btn gray sm" id="dnX">Отмена</button><button class="btn sm" id="dnOk">Отправить руководителю</button></div>` : ''}</li>`; };
      const open = T.filter(t => isOpen(t)), rest = T.filter(t => !isOpen(t));
      body.innerHTML = (chatBtn() ? `<div class="bar" style="margin-bottom:12px"><span class="mut">Вопрос по заданию?</span>${chatBtn()}</div>` : '') + panel(`Задания (${open.length} открыто)`, T.length ? `<ul class="notes">${[...open, ...rest].map(item).join('')}</ul>` : '<p class="mut">Заданий нет.</p>', 'Нажмите «Выполнено», напишите, что сделано, и приложите фото, если нужно — руководитель получит это сразу.');
      body.querySelectorAll('[data-do]').forEach(b => b.onclick = () => { doing = b.dataset.do; draw(); });
      const ok = $('#dnOk');
      if (ok) {
        $('#dnX').onclick = () => { doing = null; draw(); };
        ok.onclick = async () => {
          const t = T.find(x => markKey(x) === doing), comment = $('#dnC').value.trim(), file = $('#dnP').files[0];
          if (!comment && !file) return ($('#dnE').textContent = 'Напишите комментарий или приложите фото');
          ok.disabled = true; ok.textContent = 'Отправляю…';
          try { await sendDone(t, comment, file); doing = null; msg('Отправлено руководителю ✓'); try { TGA?.HapticFeedback?.notificationOccurred('success'); } catch { /* not in Telegram */ } draw(); }
          catch (e) { ok.disabled = false; ok.textContent = 'Отправить руководителю'; $('#dnE').textContent = e.message || 'Нет связи — попробуйте ещё раз'; }
        };
      }
      return;
    }
    if (tab === 'main') {
      const t = S.disc?.today, top = S.clients.filter(c => c.debt > 0 && (c.promise || c.pool > c.paid)).slice(0, 10);
      body.innerHTML = `<section class="panel w12" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="font-size:32px" aria-hidden="true">🎓</div><div style="flex:1;min-width:200px"><h4 style="margin:0">MITAL Akademiya</h4><div class="sub">Курсы для агентов: продажи, работа с клиентами и долгами, товары</div></div><a class="btn" style="padding:10px 18px;white-space:nowrap;line-height:1.2" href="${ACADEMY}" target="_blank" rel="noopener">Перейти к курсам →</a></section>
        ${(S.tasks || []).filter(isOpen).length || chatBtn() ? `<div class="bar" style="margin-bottom:12px">${(S.tasks || []).filter(isOpen).length ? `<a class="btn" href="#" data-go="tasks">✅ Задания: ${(S.tasks || []).filter(isOpen).length} открыто</a>` : ''}${chatBtn()}</div>` : ''}
        <div class="kpis">
        ${tile('Продано', $$(k.sold), k.plan ? `план ${$$(k.plan)} · ${sp}%` : 'план не задан', sp === null ? '' : sp >= 100 ? 'good' : '')}
        ${tile('Собрано', $$(k.paid), k.pool ? `пул ${$$(k.pool)} · ${cp}% · осталось ${$$(Math.max(0, k.pool - k.paid))}` : 'пул не задан', cp === null ? '' : cp >= 100 ? 'good' : '')}
        ${tile('Долг ваших клиентов', $$(k.debt), `должников ${f0(k.debtors)}`, k.debt ? 'warn' : '')}
        ${tile('Место в рейтинге', me ? `${me.place} из ${S.board.length}` : '—', 'по % плана продаж и сбора')}
        ${S.disc ? tile('Сегодня', t?.first ? `отчёт в ${esc(t.first)}` : t?.st ? esc(t.st) : 'нет отчёта', t?.late ? `опоздание ${t.late} мин · штраф ${f0(t.late * S.disc.rate)} сум` : t?.st ? (t.st === 'Невыход' ? 'отмечен невыход на работу' : 'без штрафа за опоздание') : t?.first ? 'вовремя ✓' : `первый фотоотчёт до ${esc(S.disc.start)}`, t?.late || t?.st === 'Невыход' ? 'bad' : t?.first || t?.st ? 'good' : 'warn') : ''}
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
        ${panel(`Склад ${esc(S.stock.warehouse)} (${f0(L.length)})`, `<div class="tscroll"><table><thead><tr><th>Товар</th><th>Бренд</th><th class="n">Доступно</th><th class="n">Всего</th></tr></thead><tbody>${L.map(i => `<tr><td>${esc(i.name)}<br><small class="mut">${esc(i.art)}</small></td><td>${esc(i.brand)}</td><td class="n ${i.available <= 0 ? 'neg' : ''}"><b>${f0(i.available)}</b></td><td class="n">${f0(i.total)}</td></tr>`).join('')}</tbody></table></div>`, `Остатки на ${S.live?.stock ? hhmm(S.live.stock) + ' (обновляются каждые 5 минут)' : dRu(S.stock.at)}. «Доступно» — без резерва под заказы.`)}`;
      search();
    }
    if (tab === 'disc') {
      const D = S.disc;
      body.innerHTML = D ? `<div class="kpis">${tile('Штрафы за период', f0(D.fine) + ' сум', `${D.minutes} мин опозданий · ${f0(D.rate)} сум за минуту`, D.fine ? 'bad' : 'good')}${tile('Опозданий', f0(D.late), `первый фотоотчёт до ${esc(D.start)}`, D.late ? 'warn' : 'good')}${tile('Маршрут', D.route != null ? Math.round(D.route * 100) + '%' : '—', 'визитов из плана за период')}</div>
        ${panel('По дням', `<div class="tscroll"><table><thead><tr><th>День</th><th>Первый отчёт</th><th class="n">Опоздание</th><th class="n">Штраф</th><th class="n">Визиты</th></tr></thead><tbody>${D.days.slice().reverse().map(x => `<tr><td>${dRu(x.day)}</td><td class="${x.late || x.st === 'Невыход' ? 'neg' : ''}">${esc(x.first || '')}${x.st ? `${x.first ? ' · ' : ''}<b>${esc(x.st)}</b>` : x.first ? '' : x.plan ? 'нет отчёта' : '—'}</td><td class="n">${x.late ? x.late + ' мин' : x.first ? '✓' : ''}</td><td class="n ${x.late ? 'neg' : ''}">${x.late ? f0(x.late * D.rate) + ' сум' : ''}</td><td class="n">${x.plan ? `${x.done}/${x.plan}` : ''}</td></tr>`).join('')}</tbody></table></div>`)}` : '<p class="mut">Данных о дисциплине пока нет.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tab]').forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.tab; q = ''; doing = null; draw(); scrollTo(0, 0); });
    document.addEventListener('click', e => { if (e.target.closest('[data-chat]') && inTg) { try { TGA.close(); } catch { /* old Telegram */ } } });
    document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (!g) return; e.preventDefault(); tab = g.dataset.go; doing = null; draw(); scrollTo(0, 0); });
    $('#meUpd').onclick = load;
    // links inside Telegram: t.me opens in Telegram itself (the chat), other links in the browser — not inside the small app window
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="http"]'); if (!a || !inTg) return; e.preventDefault(); if (a.href.startsWith('https://t.me/')) TGA.openTelegramLink(a.href); else TGA.openLink(a.href); });
    draw(); load();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && Date.now() - Date.parse(S.at || 0) > 10 * 60000) load(); });
  });
})();
