// Telegram chats inside the CRM: list of chats and groups on the left, conversation on the right.
// Talks to the Cloudflare Worker (worker.js) that receives the bot's messages. Worker address and API key
// are stored only in this browser (localStorage), never in the synced state.
window.EXT_PAGES = window.EXT_PAGES || {};

const CHAT = {
  DEFAULT_URL: 'https://quiet-mud-c41e-mital-chat-api.muhammadbonur-ebd.workers.dev',
  url: () => (localStorage.getItem('crm_chat_url') || CHAT.DEFAULT_URL).replace(/\/+$/, ''),
  key: () => localStorage.getItem('crm_chat_key') || '',
  async api(path, opts = {}) {
    let r;
    try {
      r = await fetch(CHAT.url() + path, { ...opts, headers: { Authorization: 'Bearer ' + CHAT.key(), ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}) } });
    } catch { throw new Error('Нет связи с сервером чатов (интернет или неверный адрес)'); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Неверный API-ключ. Проверьте его в настройках чатов.');
    if (d && d.ok === false) throw new Error(d.description || 'Ошибка Telegram');
    if (!r.ok) throw new Error(d.error || 'Ошибка сервера чатов ' + r.status);
    return d;
  },
  fileUrl: id => `${CHAT.url()}/api/file?file_id=${encodeURIComponent(id)}&key=${encodeURIComponent(CHAT.key())}`,
  timer: null,
  hm: ts => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  day: ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
  linkify: t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>'),
  // chat id -> agent name (from Telegram settings: «Telegram агентам»)
  agentOf(chatId) {
    try { const m = (CRMLocal.ext().tg?.chats) || {}; return Object.keys(m).find(n => String(m[n].id) === String(chatId)) || ''; } catch { return ''; }
  },
};

EXT_PAGES.chat = async el => {
  clearInterval(CHAT.timer);
  const st = { chats: [], cur: null, msgs: [], reply: null, last: 0 };
  const settingsPanel = (msg = '') => `<div class="grid">${UI.panel('Подключение чатов', `${msg ? `<p class="neg" style="margin-top:0">${esc(msg)}</p>` : ''}
    <p class="mut" style="margin-top:0">Адрес сервера чатов и ключ хранятся только в этом браузере.</p>
    <div class="form"><label>Адрес сервера<input id="cUrl" value="${esc(CHAT.url())}" autocomplete="off"></label>
    <label>API-ключ (тот, что вы задали как API_KEY в Cloudflare)<input id="cKey" type="password" value="${esc(CHAT.key())}" autocomplete="off"></label></div>
    <div class="bar" style="margin-top:12px"><button class="btn" id="cSave">Сохранить и открыть чаты</button></div>`, { cls: 'w6' })}</div>`;
  const showSettings = msg => {
    el.innerHTML = `<div class="page-head"><div><h2>Чаты Telegram</h2><div class="sub">Переписка с агентами через бота</div></div></div>${settingsPanel(msg)}`;
    $('#cSave', el).onclick = () => {
      localStorage.setItem('crm_chat_url', $('#cUrl', el).value.trim()); localStorage.setItem('crm_chat_key', $('#cKey', el).value.trim());
      EXT_PAGES.chat(el);
    };
  };
  if (!CHAT.key()) return showSettings();

  el.innerHTML = `<div class="page-head"><div><h2>Чаты Telegram</h2><div class="sub">Переписка с агентами через бота</div></div><div class="tools"><button class="btn gray" id="cSet">⚙ Настройки</button></div></div>
    <div class="chatbox" id="cBox"><aside class="clist" id="cList" aria-label="Чаты"></aside>
    <section class="cmain" id="cMain"><div class="cempty">Выберите чат слева</div></section></div>`;
  $('#cSet', el).onclick = () => showSettings();

  const renderList = () => {
    const l = $('#cList', el); if (!l) return;
    l.innerHTML = st.chats.length ? st.chats.map(c => {
      const ag = CHAT.agentOf(c.id), on = st.cur && String(st.cur.id) === String(c.id);
      return `<button class="citem${on ? ' on' : ''}" data-id="${c.id}"><span class="cav">${esc((c.title || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="cinfo"><b>${esc(c.title)}</b>${ag ? `<small class="cag">агент: ${esc(ag)}</small>` : ''}<small>${esc((c.last_text || '').slice(0, 60))}</small></span>
        <span class="cmeta"><small>${c.last_ts ? CHAT.hm(c.last_ts) : ''}</small>${c.unread ? `<i class="cbadge">${c.unread}</i>` : ''}</span></button>`;
    }).join('') : '<div class="cempty" style="padding:20px">Чатов пока нет. Напишите боту в Telegram или добавьте его в группу — чат появится здесь.</div>';
    l.querySelectorAll('.citem').forEach(b => b.onclick = () => openChat(st.chats.find(c => String(c.id) === b.dataset.id)));
  };

  const bubble = m => {
    let media = '';
    if (m.file_id) {
      const u = CHAT.fileUrl(m.file_id);
      if (m.type === 'photo') media = `<a href="${u}" target="_blank" rel="noopener"><img class="cimg" src="${u}" alt="Фото" loading="lazy"></a>`;
      else if (m.type === 'voice' || m.type === 'audio') media = `<audio controls preload="none" src="${u}"></audio>`;
      else if (m.type === 'video' || m.type === 'video_note') media = `<video controls preload="none" class="cimg" src="${u}"></video>`;
      else if (m.type === 'sticker') media = '';
      else media = `<a class="cfile" href="${u}" target="_blank" rel="noopener">📎 ${esc(m.file_name || 'Файл')}</a>`;
    }
    if (m.type === 'location') media = `<a href="https://maps.google.com/?q=${esc(m.text)}" target="_blank" rel="noopener">📍 Геолокация</a>`;
    const text = m.type === 'location' ? '' : m.text;
    return `<div class="cmsg ${m.out ? 'out' : 'in'}" data-id="${m.id}">${!m.out && st.cur.type !== 'private' ? `<div class="cfrom">${esc(m.from)}</div>` : ''}
      ${m.reply ? `<div class="cquote">${esc(m.reply.text)}</div>` : ''}${media}${text ? `<div class="ctext">${CHAT.linkify(text)}</div>` : ''}
      <span class="ctime">${CHAT.hm(m.date)}</span></div>`;
  };

  const renderMsgs = (stick = true) => {
    const box = $('#cMsgs', el); if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    let prev = '', html = '';
    for (const m of st.msgs) { const d = CHAT.day(m.date); if (d !== prev) { html += `<div class="cday">${d}</div>`; prev = d; } html += bubble(m); }
    box.innerHTML = html || '<div class="cempty">Сообщений пока нет</div>';
    box.querySelectorAll('.cmsg').forEach(b => b.ondblclick = () => setReply(st.msgs.find(m => String(m.id) === b.dataset.id)));
    if (stick || near) box.scrollTop = box.scrollHeight;
  };

  const setReply = m => {
    st.reply = m || null;
    const r = $('#cReply', el); if (!r) return;
    r.hidden = !m; r.innerHTML = m ? `<span>↩ ${esc((m.text || '[медиа]').slice(0, 80))}</span><button class="btn gray sm" id="cNoRep">✕</button>` : '';
    if (m) { $('#cNoRep', el).onclick = () => setReply(null); $('#cText', el).focus(); }
  };

  const send = async () => {
    const t = $('#cText', el), text = t.value.trim(); if (!text || !st.cur) return;
    t.disabled = true;
    try { await CHAT.api('/api/send', { method: 'POST', body: JSON.stringify({ chat_id: st.cur.id, text: esc(text), reply_to: st.reply?.id }) }); t.value = ''; setReply(null); await refresh(true); }
    catch (e) { toast(e.message); }
    t.disabled = false; t.focus();
  };
  const sendFile = async f => {
    if (!f || !st.cur) return;
    const fd = new FormData(); fd.append('chat_id', st.cur.id); fd.append('file', f, f.name);
    const cap = $('#cText', el).value.trim(); if (cap) fd.append('caption', cap);
    if (st.reply) fd.append('reply_to', st.reply.id);
    toast('Отправляю файл…');
    try { await CHAT.api('/api/send-file', { method: 'POST', body: fd }); $('#cText', el).value = ''; setReply(null); await refresh(true); }
    catch (e) { toast(e.message); }
  };

  async function openChat(c) {
    if (!c) return;
    st.cur = c; st.msgs = []; st.reply = null;
    $('#cBox', el).classList.add('open');
    const ag = CHAT.agentOf(c.id);
    $('#cMain', el).innerHTML = `<header class="chead"><button class="btn gray sm" id="cBack" aria-label="Назад к списку">←</button><div><b>${esc(c.title)}</b><small>${ag ? 'агент: ' + esc(ag) : c.type === 'private' ? 'личный чат' : 'группа'}</small></div><span class="spacer"></span>
      ${ag ? '<button class="btn gray sm" id="cRep">📊 Отчёт агента</button>' : ''}</header>
      <div class="cmsgs" id="cMsgs"></div><div class="creply" id="cReply" hidden></div>
      <footer class="cform"><label class="btn gray attach" title="Прикрепить фото или файл">📎<input type="file" id="cFile" hidden></label>
      <textarea id="cText" rows="1" placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка; двойной клик по сообщению — ответить)"></textarea><button class="btn" id="cSend">Отправить</button></footer>`;
    $('#cBack', el).onclick = () => { $('#cBox', el).classList.remove('open'); st.cur = null; renderList(); };
    $('#cSend', el).onclick = send;
    $('#cText', el).onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('#cFile', el).onchange = e => { sendFile(e.target.files[0]); e.target.value = ''; };
    const rep = $('#cRep', el);
    if (rep) rep.onclick = async () => {
      if (!confirm(`Отправить отчёт дня агенту ${ag}?`)) return;
      try {
        const d = await REP.load(); if (d.empty) return toast('Нет данных для отчёта — сначала загрузите данные');
        const html = REP.agentText(d, ag), parts = []; let cur = '';
        for (const l of html.split('\n')) { if ((cur + '\n' + l).length > 3900) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }
        if (cur) parts.push(cur);
        for (const p of parts) await CHAT.api('/api/send', { method: 'POST', body: JSON.stringify({ chat_id: c.id, text: p }) });
        toast('Отчёт отправлен'); await refresh(true);
      } catch (e) { toast(e.message); }
    };
    renderList();
    await refresh(true);
    CHAT.api('/api/read', { method: 'POST', body: JSON.stringify({ chat_id: c.id }) }).catch(() => {});
    c.unread = 0; renderList();
  }

  async function refresh(stick) {
    try {
      st.chats = await CHAT.api('/api/chats');
      if (st.cur) {
        const fresh = st.chats.find(c => String(c.id) === String(st.cur.id));
        const msgs = await CHAT.api('/api/messages?chat_id=' + encodeURIComponent(st.cur.id));
        if (fresh && fresh.unread) { fresh.unread = 0; CHAT.api('/api/read', { method: 'POST', body: JSON.stringify({ chat_id: st.cur.id }) }).catch(() => {}); }
        if (JSON.stringify(msgs.map(m => m.id + m.text)) !== JSON.stringify(st.msgs.map(m => m.id + m.text))) { st.msgs = msgs; renderMsgs(stick); }
      }
      renderList();
    } catch (e) {
      if (/API-ключ/.test(e.message)) { clearInterval(CHAT.timer); showSettings(e.message); } else if (stick) toast(e.message);
    }
  }

  await refresh(true);
  CHAT.timer = setInterval(() => {
    if (!document.body.contains(el) || location.hash !== '#/chat' || document.hidden) { if (!document.body.contains(el) || location.hash !== '#/chat') clearInterval(CHAT.timer); return; }
    refresh(false);
  }, 5000);
};
