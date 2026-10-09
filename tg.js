// Telegram: personal reports to every agent and a team summary to the supervisor, sent straight from the browser
// through the Telegram Bot API. Settings (bot token, which chat belongs to which agent) live in the synced state (ext.tg).
window.EXT_PAGES = window.EXT_PAGES || {};

const TG = {
  conf: () => (CRMLocal.ext().tg ||= { token: '', chats: {}, me: null, seen: {}, log: {} }),
  async call(method, params = {}, token = TG.conf().token) {
    let r;
    try { r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }); }
    catch { throw new Error('Нет связи с Telegram (интернет или блокировка)'); }
    const d = await r.json().catch(() => ({}));
    if (!d.ok) {
      if (r.status === 401) throw new Error('Неверный токен бота');
      if (r.status === 409) throw new Error('У бота включён webhook (его использует другая программа). Создайте для CRM отдельного бота.');
      if (r.status === 403) throw new Error('Пользователь не запускал бота или заблокировал его — пусть откроет бота и нажмёт «Старт»');
      throw new Error(d.description || 'Ошибка Telegram ' + r.status);
    }
    return d.result;
  },
  // Telegram limit is 4096 characters: long reports go in several messages, split on line breaks
  async send(chat, html) {
    const parts = [], lines = html.split('\n'); let cur = '';
    for (const l of lines) { if ((cur + '\n' + l).length > 3900) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }
    if (cur) parts.push(cur);
    for (const p of parts) await TG.call('sendMessage', { chat_id: chat, text: p, parse_mode: 'HTML', disable_web_page_preview: true });
  },
  chatName: c => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.title || 'Без имени',
  async discover() {
    const ups = await TG.call('getUpdates', { timeout: 0, allowed_updates: ['message', 'my_chat_member'] }), conf = TG.conf();
    for (const u of ups) {
      const c = u.message?.chat || u.my_chat_member?.chat; if (!c) continue;
      if (c.type === 'private') conf.seen[c.id] = { id: c.id, name: TG.chatName(c) + (c.username ? ` (@${c.username})` : '') };
      else if (c.type === 'group' || c.type === 'supergroup') (conf.groups ||= {})[c.id] = { id: c.id, name: c.title || 'Группа' };
    }
    if (ups.length) await TG.call('getUpdates', { offset: ups.at(-1).update_id + 1, timeout: 0 }).catch(() => {});
    CRMLocal.touch();
    return Object.keys(conf.seen).length;
  },
};

let tgPick = null; // agents chosen for sending (null = all linked)
EXT_PAGES.tg = async el => {
  const d = await REP.load(), body = REP.shell(el, 'tg', d), conf = TG.conf();
  let bot = null;
  if (conf.token) { try { bot = await TG.call('getMe'); } catch (e) { bot = { error: e.message }; } }
  const seen = Object.values(conf.seen || {}), opt = (cur, name) => `<select data-ag="${esc(name)}" aria-label="Чат агента"><option value="">— не привязан —</option>${seen.map(s => `<option value="${s.id}" ${String(cur?.id) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const agents = d.empty ? [] : d.agents.map(a => a.agent).filter(n => n !== 'Без агента');
  const linked = agents.filter(n => conf.chats[n]);
  if (tgPick === null) tgPick = new Set(linked);
  const last = n => conf.log?.[n] ? `<small class="mut">отправлено ${new Date(conf.log[n]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>` : '';

  body.innerHTML = `<div class="grid">
  ${UI.panel('1. Бот', bot && !bot.error ? `<p style="margin-top:0">✓ Подключён бот <b>@${esc(bot.username)}</b>. Агенты должны найти его в Telegram и нажать «Старт» — после этого их можно привязать ниже.</p>
      <div class="bar"><button class="btn gray" id="tCopy">Скопировать ссылку на бота для агентов</button><button class="btn gray" id="tOff">Сменить бота</button></div>` : `
      ${bot?.error ? `<p class="neg" style="margin-top:0">${esc(bot.error)}</p>` : ''}
      <ol class="steps"><li>Откройте в Telegram <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> → <b>/newbot</b>.</li><li>Имя, например: «MITAL Отчёты», логин: <b>mital_otchet_bot</b> (любой свободный, на _bot).</li><li>BotFather пришлёт токен — вставьте его сюда.</li></ol>
      <div class="bar"><input id="tTok" type="password" placeholder="123456789:AA…" style="flex:1;min-width:220px" autocomplete="off"><button class="btn" id="tSave">Подключить</button></div>`, { cls: 'w12' })}
  ${bot && !bot.error ? UI.panel('2. Кто есть кто', `<p class="mut" style="margin-top:0">Попросите каждого агента написать боту любое сообщение, затем нажмите «Обновить список». Вы тоже напишите боту — чтобы получать сводку себе.</p>
      <div class="bar"><button class="btn gray" id="tFind">🔄 Обновить список (написали боту: ${seen.length})</button></div>
      <div class="scroll" style="max-height:none"><table><thead><tr><th>Кто</th><th>Чат в Telegram</th></tr></thead><tbody>
      <tr><td><b>Я (руководитель)</b><br><small class="mut">сводка по всей команде</small></td><td>${opt(conf.me, '__me')}</td></tr>
      ${agents.map(n => `<tr><td>${esc(n)}</td><td>${opt(conf.chats[n], n)}</td></tr>`).join('')}</tbody></table></div>`, { cls: 'w6' }) : ''}
  ${bot && !bot.error && !d.empty ? UI.panel('3. Отправить отчёт', `<p class="mut" style="margin-top:0">Каждый агент получит только свои цифры: продажи и сбор к плану, сколько нужно в день, кому из должников звонить, кто давно не покупал, его задания.</p>
      <div class="scroll" style="max-height:none"><table><tbody>${agents.map(n => `<tr><td><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pick="${esc(n)}" ${conf.chats[n] ? '' : 'disabled'} ${tgPick.has(n) && conf.chats[n] ? 'checked' : ''}>${esc(n)}</label></td><td>${conf.chats[n] ? last(n) : '<small class="mut">не привязан</small>'}</td><td><button class="btn gray sm" data-prev="${esc(n)}">Просмотр</button></td></tr>`).join('')}</tbody></table></div>
      <div class="bar" style="margin-top:12px"><button class="btn" id="tSend" ${linked.length ? '' : 'disabled'}>📤 Отправить выбранным агентам</button><button class="btn gray" id="tMe" ${conf.me ? '' : 'disabled'}>Отправить сводку себе</button><span id="tMsg" role="status" class="mut"></span></div>`, { cls: 'w6' }) : ''}
  ${bot && !bot.error && !d.empty ? UI.panel('Как это выглядит у агента', `<div id="tPrev" class="tgprev">${REP.agentText(d, agents.find(n => conf.chats[n]) || agents[0]).replace(/\n/g, '<br>')}</div>`, { cls: 'w12' }) : ''}
  </div>`;

  const re = () => EXT_PAGES.tg(el);
  const save = $('#tSave', body);
  if (save) save.onclick = async () => {
    const tok = $('#tTok', body).value.trim(); if (!tok) return;
    try { const b = await TG.call('getMe', {}, tok); conf.token = tok; CRMLocal.touch(); toast(`Бот @${b.username} подключён`); re(); } catch (e) { toast(e.message); }
  };
  const off = $('#tOff', body); if (off) off.onclick = () => { if (!confirm('Отключить этого бота? Привязки агентов сохранятся.')) return; conf.token = ''; CRMLocal.touch(); re(); };
  const cp = $('#tCopy', body); if (cp) cp.onclick = async () => { const l = `https://t.me/${bot.username}`; try { await navigator.clipboard.writeText(l); toast('Ссылка скопирована: ' + l); } catch { prompt('Ссылка на бота:', l); } };
  const find = $('#tFind', body); if (find) find.onclick = async () => { try { const n = await TG.discover(); toast(`Найдено чатов: ${n}`); re(); } catch (e) { toast(e.message); } };
  body.querySelectorAll('select[data-ag]').forEach(s => s.onchange = () => {
    const pick = seen.find(x => String(x.id) === s.value) || null, who = s.dataset.ag;
    if (who === '__me') conf.me = pick; else if (pick) conf.chats[who] = pick; else delete conf.chats[who];
    CRMLocal.touch(); tgPick = null; re();
  });
  body.querySelectorAll('[data-pick]').forEach(b => b.onchange = () => { b.checked ? tgPick.add(b.dataset.pick) : tgPick.delete(b.dataset.pick); });
  body.querySelectorAll('[data-prev]').forEach(b => b.onclick = () => { $('#tPrev', body).innerHTML = REP.agentText(d, b.dataset.prev).replace(/\n/g, '<br>'); $('#tPrev', body).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  const send = $('#tSend', body);
  if (send) send.onclick = async () => {
    const list = agents.filter(n => tgPick.has(n) && conf.chats[n]), msg = $('#tMsg', body);
    if (!list.length) return toast('Выберите агентов');
    if (!confirm(`Отправить персональный отчёт ${list.length} агентам?`)) return;
    send.disabled = true; let ok = 0; const errs = [];
    for (const n of list) {
      msg.textContent = `Отправляю: ${n}…`;
      try { await TG.send(conf.chats[n].id, REP.agentText(d, n)); conf.log[n] = new Date().toISOString(); ok++; } catch (e) { errs.push(`${n}: ${e.message}`); }
    }
    CRMLocal.touch(); msg.textContent = '';
    toast(`Отправлено: ${ok} из ${list.length}`); if (errs.length) alert('Не отправлено:\n' + errs.join('\n'));
    re();
  };
  const me = $('#tMe', body);
  if (me) me.onclick = async () => { try { await TG.send(conf.me.id, REP.teamText(d)); toast('Сводка отправлена вам'); } catch (e) { toast(e.message); } };
};
