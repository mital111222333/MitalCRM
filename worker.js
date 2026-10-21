// MITAL CRM — Telegram chat backend (Cloudflare Worker, free plan)
// Bindings required: KV namespace CHAT_KV; secrets BOT_TOKEN, API_KEY, WEBHOOK_SECRET
// Optional var: ALLOWED_ORIGIN (e.g. https://mital111222333.github.io)
//
// /api/*   — the supervisor's CRM («Чаты Telegram»), API key.
// /agent/* — the agent's cabinet (Telegram Mini App): signed in by Telegram's initData, checked with BOT_TOKEN as Telegram requires.
//            The agent reaches only his own conversation with the bot (chat id = his Telegram user id). A message he writes in the
//            app is stored in that conversation as his (so the CRM shows it as an incoming message with an unread mark); a photo is
//            sent through the bot to his own chat to get a Telegram file and then stored the same way.

const MAX_MSGS = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      // 1) Telegram -> worker
      if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}` && request.method === 'POST') {
        await handleUpdate(env, await request.json());
        return new Response('ok');
      }

      // 2) CRM -> worker (requires API key)
      if (url.pathname.startsWith('/api/')) {
        const auth = request.headers.get('Authorization') || '';
        const keyParam = url.searchParams.get('key'); // for <img>/<audio> src
        if (auth !== `Bearer ${env.API_KEY}` && keyParam !== env.API_KEY) {
          return json({ error: 'unauthorized' }, 401, cors);
        }

        if (url.pathname === '/api/chats') {
          const chats = (await env.CHAT_KV.get('chats', 'json')) || {};
          const list = Object.values(chats).sort((a, b) => b.last_ts - a.last_ts);
          return json(list, 200, cors);
        }

        if (url.pathname === '/api/messages') {
          const id = url.searchParams.get('chat_id');
          const msgs = (await env.CHAT_KV.get(`msgs:${id}`, 'json')) || [];
          const since = Number(url.searchParams.get('since') || 0);
          return json(msgs.filter(m => m.id > since), 200, cors);
        }

        if (url.pathname === '/api/read' && request.method === 'POST') {
          const { chat_id } = await request.json();
          const chats = (await env.CHAT_KV.get('chats', 'json')) || {};
          if (chats[chat_id]) { chats[chat_id].unread = 0; await env.CHAT_KV.put('chats', JSON.stringify(chats)); }
          return json({ ok: true }, 200, cors);
        }

        if (url.pathname === '/api/send' && request.method === 'POST') {
          const { chat_id, text, reply_to } = await request.json();
          const body = { chat_id, text, parse_mode: 'HTML' };
          if (Number.isInteger(Number(reply_to)) && Number(reply_to) > 0) body.reply_parameters = { message_id: Number(reply_to), allow_sending_without_reply: true }; // a message written in the app has no Telegram id to reply to
          const r = await tg(env, 'sendMessage', body);
          if (r.ok) await storeMessage(env, normalize(r.result, true));
          return json(r, 200, cors);
        }

        if (url.pathname === '/api/send-file' && request.method === 'POST') {
          const form = await request.formData();
          const file = form.get('file');
          const mime = file.type || '';
          let method = 'sendDocument', field = 'document';
          if (mime.startsWith('image/')) { method = 'sendPhoto'; field = 'photo'; }
          else if (mime.startsWith('video/')) { method = 'sendVideo'; field = 'video'; }
          else if (mime === 'audio/ogg' || mime === 'audio/webm') { method = 'sendVoice'; field = 'voice'; }
          else if (mime.startsWith('audio/')) { method = 'sendAudio'; field = 'audio'; }
          const out = new FormData();
          out.append('chat_id', form.get('chat_id'));
          if (form.get('caption')) out.append('caption', form.get('caption'));
          if (Number.isInteger(Number(form.get('reply_to'))) && Number(form.get('reply_to')) > 0) out.append('reply_parameters', JSON.stringify({ message_id: Number(form.get('reply_to')) }));
          out.append(field, file, file.name);
          const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', body: out });
          const r = await res.json();
          if (r.ok) await storeMessage(env, normalize(r.result, true));
          return json(r, 200, cors);
        }

        if (url.pathname === '/api/file') {
          const info = await tg(env, 'getFile', { file_id: url.searchParams.get('file_id') });
          if (!info.ok) return json(info, 404, cors);
          const f = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.result.file_path}`);
          return new Response(f.body, { headers: { ...cors, 'Content-Type': f.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' } });
        }
      }

      // 3) agent's cabinet -> worker (Telegram Mini App, signed in by initData)
      if (url.pathname.startsWith('/agent/')) {
        const init = (request.headers.get('Authorization') || '').replace(/^tma /, '') || url.searchParams.get('init') || '';
        const user = await tgUser(env, init);
        if (!user) return json({ error: 'Откройте чат кнопкой в боте' }, 401, cors);
        const chatId = user.id, key = `msgs:${chatId}`;

        if (url.pathname === '/agent/messages') {
          const msgs = (await env.CHAT_KV.get(key, 'json')) || [];
          const since = Number(url.searchParams.get('since') || 0);
          return json(msgs.filter(m => m.id > since), 200, cors);
        }

        if (url.pathname === '/agent/send' && request.method === 'POST') {
          const { text } = await request.json();
          const t = String(text || '').trim().slice(0, 3000);
          if (!t) return json({ error: 'Пустое сообщение' }, 400, cors);
          const msg = await appMessage(env, user, { type: 'text', text: t });
          return json({ ok: true, message: msg }, 200, cors);
        }

        if (url.pathname === '/agent/send-photo' && request.method === 'POST') {
          const form = await request.formData();
          const file = form.get('file');
          if (!file || !(file.type || '').startsWith('image/') || file.size > 10 * 1024 * 1024) return json({ error: 'Нужна фотография до 10 МБ' }, 400, cors);
          const caption = String(form.get('caption') || '').slice(0, 900);
          // the bot sends the photo to the agent's own chat to get a Telegram file for it; that service message is not stored
          const out = new FormData();
          out.append('chat_id', String(chatId));
          out.append('caption', '📎 Отправлено руководителю' + (caption ? ': ' + caption : ''));
          out.append('disable_notification', 'true');
          out.append('photo', file, file.name || 'photo.jpg');
          const r = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: 'POST', body: out })).json();
          if (!r.ok) return json({ error: 'Telegram не принял фото' }, 502, cors);
          const p = r.result.photo, msg = await appMessage(env, user, { type: 'photo', text: caption, file_id: p[p.length - 1].file_id }, r.result.message_id);
          return json({ ok: true, message: msg }, 200, cors);
        }

        if (url.pathname === '/agent/file') {
          const id = url.searchParams.get('file_id') || '';
          const msgs = (await env.CHAT_KV.get(key, 'json')) || [];
          if (!msgs.some(m => m.file_id === id)) return json({ error: 'not found' }, 404, cors); // only files of his own conversation
          const info = await tg(env, 'getFile', { file_id: id });
          if (!info.ok) return json(info, 404, cors);
          const f = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.result.file_path}`);
          return new Response(f.body, { headers: { ...cors, 'Content-Type': f.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' } });
        }
      }
      return new Response('MITAL chat worker', { status: 200, headers: cors });
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

// Telegram Mini App sign-in: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}
async function tgUser(env, initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac('WebAppData', env.BOT_TOKEN);
  const sign = [...(await hmac(secret, check))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sign !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { const u = JSON.parse(p.get('user') || '{}'); return /^\d+$/.test(String(u.id || '')) ? u : null; } catch { return null; }
}

// a message the agent wrote in the app: stored in his conversation as his own (incoming for the CRM).
// Its id goes between the last Telegram message id and the next one, so the CRM's «since» polling keeps working.
async function appMessage(env, user, part, afterId) {
  const key = `msgs:${user.id}`;
  const msgs = (await env.CHAT_KV.get(key, 'json')) || [];
  const max = Math.max(afterId || 0, ...msgs.map(m => m.id), 0), id = max + (Math.floor(max) + 1 - max) / 2;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);
  const msg = { id, chat_id: user.id, chat_title: name, chat_type: 'private', from: name, date: Math.floor(Date.now() / 1000), out: false, type: part.type, text: part.text || '', file_id: part.file_id || null, file_name: null, reply: null, via: 'app' };
  await storeMessage(env, msg);
  return msg;
}

async function handleUpdate(env, upd) {
  const m = upd.message || upd.edited_message || upd.channel_post;
  if (!m) return;
  await storeMessage(env, normalize(m, false), !!upd.edited_message);
}

function normalize(m, out) {
  let type = 'text', file_id = null, file_name = null, text = m.text || m.caption || '';
  if (m.photo) { type = 'photo'; file_id = m.photo[m.photo.length - 1].file_id; }
  else if (m.voice) { type = 'voice'; file_id = m.voice.file_id; }
  else if (m.video_note) { type = 'video_note'; file_id = m.video_note.file_id; }
  else if (m.video) { type = 'video'; file_id = m.video.file_id; }
  else if (m.audio) { type = 'audio'; file_id = m.audio.file_id; file_name = m.audio.file_name; }
  else if (m.document) { type = 'document'; file_id = m.document.file_id; file_name = m.document.file_name; }
  else if (m.sticker) { type = 'sticker'; file_id = m.sticker.file_id; text = m.sticker.emoji || ''; }
  else if (m.location) { type = 'location'; text = `${m.location.latitude},${m.location.longitude}`; }
  else if (m.contact) { type = 'contact'; text = `${m.contact.first_name} ${m.contact.phone_number}`; }
  const chat = m.chat;
  return {
    id: m.message_id, chat_id: chat.id,
    chat_title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id),
    chat_type: chat.type,
    from: m.from ? [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') : (chat.title || ''),
    date: m.date, out, type, text, file_id, file_name,
    reply: m.reply_to_message ? { id: m.reply_to_message.message_id, text: (m.reply_to_message.text || m.reply_to_message.caption || '[медиа]').slice(0, 80) } : null,
  };
}

async function storeMessage(env, msg, edited) {
  const key = `msgs:${msg.chat_id}`;
  const msgs = (await env.CHAT_KV.get(key, 'json')) || [];
  const i = msgs.findIndex(x => x.id === msg.id);
  if (i >= 0) msgs[i] = msg; else msgs.push(msg);
  await env.CHAT_KV.put(key, JSON.stringify(msgs.slice(-MAX_MSGS)));

  const chats = (await env.CHAT_KV.get('chats', 'json')) || {};
  const c = chats[msg.chat_id] || { id: msg.chat_id, title: msg.chat_title, type: msg.chat_type, unread: 0 };
  c.title = msg.chat_title;
  c.last_text = msg.text || `[${msg.type}]`;
  c.last_ts = msg.date;
  if (!msg.out && !edited) c.unread = (c.unread || 0) + 1;
  chats[msg.chat_id] = c;
  await env.CHAT_KV.put('chats', JSON.stringify(chats));
}
