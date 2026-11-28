// Interface layer (2026-11-20). Nothing here changes a number — it only reads what the CRM already computes.
//   • icons in the left menu;
//   • quick search (Ctrl+K, «/», «Поиск» in the top bar): any screen or hub tab, any client (opens the card), any agent (opens the page);
//   • «Пульс» (#/pulse): the debt picture as infographics — 3D ring of today's calls, debt structure, agents, promises, who to call first;
//   • light 3D motion: tiles lean toward the mouse, numbers count up. Off when the device asks for less motion.
// Loaded before app.js (app.js copies EXT_PAGES into PAGES once); the rest waits for the page.
(() => {
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
  const ex = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = (d, cls = 'nv-ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const initial = s => ex((String(s).match(/\p{L}/u) || ['•'])[0].toUpperCase());

  // ---------- menu icons ----------
  const IC = {
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
    field: 'M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0M7.8 7.8a6 6 0 0 0 0 8.4m8.4 0a6 6 0 0 0 0-8.4M5 5a10 10 0 0 0 0 14m14 0a10 10 0 0 0 0-14',
    my: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    signals: 'M12 4 2.5 20h19zM12 10v4m0 3v.01',
    collect: 'M12 3v18M16.5 7.5C16.5 5.6 14.5 5 12 5S7.5 5.8 7.5 8s2 3 4.5 3.5 4.5 1.3 4.5 3.5-2 3-4.5 3-4.5-.6-4.5-2.5',
    lxpay: 'M3 7h18v10H3zM3 11h18M7 15h3',
    contracts: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6m-6 4h4',
    lxday: 'M6 6h15l-2 8H7zM6 6 5 3H2M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1',
    aclients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0m1-10a3 3 0 1 0 0-6m2 16h3a6 6 0 0 0-4-5.6',
    abc: 'M3 17l6-6 4 4 8-8m0 0h-6m6 0v6',
    leaders: 'M8 21h8m-4-4v4M6 4h12v5a6 6 0 0 1-12 0zM6 6H3a3 3 0 0 0 3 4m12-4h3a3 3 0 0 1-3 4',
    disc: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    atk: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
    pay: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
    whstock: 'M3 8l9-5 9 5v10l-9 5-9-5zM3 8l9 5 9-5M12 13v10',
    ranalytics: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
    cloud: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4M6.3 17.7l1.4-1.4m8.6-8.6 1.4-1.4',
  };
  const SEARCH = 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 3-5-5';

  // the frame is redrawn as a whole (app.js render): decorate it each time
  function decorate() {
    document.querySelectorAll('.sidenav a[data-r]:not([data-nv])').forEach(a => {
      a.dataset.nv = '1';
      a.insertAdjacentHTML('afterbegin', svg(IC[a.dataset.r] || 'M12 12h.01'));
    });
    const top = document.querySelector('nav.top');
    if (top && !top.querySelector('.nv-sbtn')) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nv-sbtn'; b.title = 'Быстрый поиск: экраны, клиенты, агенты (Ctrl+K)'; b.setAttribute('aria-label', 'Быстрый поиск');
      b.innerHTML = `${svg(SEARCH)}<span>Поиск</span><kbd>Ctrl K</kbd>`;
      b.onclick = () => PAL.open();
      const sp = top.querySelector('.spacer'); sp ? sp.after(b) : top.appendChild(b);
    }
  }

  // ---------- recent screens ----------
  const RKEY = 'nv_recent';
  const recent = () => { try { const v = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  addEventListener('hashchange', () => {
    const r = location.hash.replace('#/', ''); if (!r || !/^[\w-]+$/.test(r)) return;
    try { localStorage.setItem(RKEY, JSON.stringify([r, ...recent().filter(x => x !== r)].slice(0, 6))); } catch { /* storage blocked */ }
  });

  // ---------- quick search ----------
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const clean = t => String(t).replace(/^[^\p{L}]+/u, '');
  const PAL = {
    el: null, items: [], shown: [], at: 0, people: null, peopleAt: 0,
    // every screen the person may open: menu lines and the tabs of their hubs
    screens() {
      const out = [], seen = new Set(), ok = r => (typeof canOpen !== 'function' || canOpen(r)) && !(window.MENU_HIDDEN && MENU_HIDDEN(r));
      const menu = typeof MENU !== 'undefined' ? MENU : (window.EXT_MENU || {});
      for (const [top, groups] of Object.entries(menu)) for (const [t, r] of Object.values(groups).flat()) {
        const hub = (window.HUBS || []).find(h => h.some(x => x[0] === r));
        for (const [hr, ht] of hub || [[r, t]]) {
          if (seen.has(hr) || !ok(hr)) continue; seen.add(hr);
          out.push({ kind: 'screen', r: hr, t: clean(hr === r ? t : ht), sub: clean(top) + (hr === r ? '' : ' · ' + clean(t)), ic: IC[r] || IC.pulse });
        }
      }
      return out;
    },
    // clients and agents from the last data (only when this device's CRM data may be shown)
    async loadPeople() {
      if (this.people && Date.now() - this.peopleAt < 60000) return this.people;
      if (window.CLOUD?.gate?.() || typeof REP === 'undefined') return [];
      try {
        const d = await REP.load(); if (d.empty) return (this.people = []);
        const agents = new Map();
        const cl = d.clients.map(c => {
          if (c.agent) agents.set(c.agent, (agents.get(c.agent) || 0) + 1);
          return { kind: 'client', name: c.name, t: c.name, sub: (c.agent || 'Без агента') + (c.debt > 0.5 ? ` · долг $${UI.fmt0(Math.round(c.debt))}` : ''), debt: c.debt || 0 };
        });
        const ag = [...agents].map(([n, k]) => ({ kind: 'agent', name: n, t: n, sub: `агент · ${k} ${UI.plural(k, 'клиент', 'клиента', 'клиентов')}` }));
        this.people = [...ag, ...cl]; this.peopleAt = Date.now(); return this.people;
      } catch { return []; }
    },
    open() {
      if (this.el) { this.el.querySelector('input').focus(); return; }
      if (!document.querySelector('.sidenav')) return; // signed out or the CRM is closed on this device
      const bg = document.createElement('div'); bg.className = 'nv-pal-bg';
      bg.innerHTML = `<div class="nv-pal" role="dialog" aria-modal="true" aria-label="Быстрый поиск">
        <label class="nv-pal-in">${svg(SEARCH)}<input type="search" placeholder="Экран, клиент или агент…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="nvList" aria-autocomplete="list"><kbd>Esc</kbd></label>
        <div class="nv-pal-list" id="nvList" role="listbox" aria-label="Результаты"></div>
        <div class="nv-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span class="nv-pal-n" aria-live="polite"></span></div></div>`;
      document.body.appendChild(bg); this.el = bg;
      const input = bg.querySelector('input');
      bg.onclick = e => { if (e.target === bg) this.close(); };
      input.oninput = () => { this.at = 0; this.draw(input.value); };
      input.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = this.shown.length; if (n) { this.at = (this.at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; this.mark(); } }
        else if (e.key === 'Enter') { e.preventDefault(); this.go(this.shown[this.at]); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      };
      input.focus(); // at once: letters typed right after Ctrl+K must land in the field
      this.items = this.screens(); this.draw('');
      this.loadPeople().then(p => { if (this.el && p.length) { this.items = [...this.screens(), ...p]; this.draw(input.value); } });
    },
    close() { if (this.el) { this.el.remove(); this.el = null; } },
    draw(q) {
      const list = this.el.querySelector('.nv-pal-list'), nq = norm(q), words = nq.split(' ').filter(Boolean);
      let res;
      if (!words.length) {
        const rec = recent(), scr = this.items.filter(x => x.kind === 'screen');
        res = [...rec.map(r => scr.find(x => x.r === r)).filter(Boolean).map(x => ({ ...x, rec: true })), ...scr.filter(x => !rec.includes(x.r))].slice(0, 14);
      } else {
        const scored = [];
        for (const x of this.items) {
          const h = norm(x.t + ' ' + (x.kind === 'screen' ? x.sub : ''));
          if (!words.every(w => h.includes(w))) continue;
          // best: the whole name or a whole word sequence matches; then every word starts a word of the name; then anywhere
          const t = norm(x.t), padded = ` ${t} `, tw = t.split(' ');
          const rank = t === nq ? 0 : padded.includes(` ${nq} `) ? 0.4 : t.startsWith(nq) ? 0.6 : padded.includes(` ${nq}`) ? 0.9 : words.every(w => tw.some(p => p.startsWith(w))) ? 1.3 : 2;
          scored.push([x, rank + (x.kind === 'agent' ? 0.2 : x.kind === 'client' ? 0.3 : 0) - Math.min(x.debt || 0, 1e6) / 1e7]);
        }
        scored.sort((a, b) => a[1] - b[1]);
        res = [...scored.filter(s => s[0].kind === 'screen').slice(0, 6), ...scored.filter(s => s[0].kind === 'agent').slice(0, 4), ...scored.filter(s => s[0].kind === 'client').slice(0, 10)].map(s => s[0]);
      }
      this.shown = res;
      const secName = x => (x.rec ? 'Недавние' : x.kind === 'screen' ? 'Экраны' : x.kind === 'agent' ? 'Агенты' : 'Клиенты');
      list.innerHTML = res.length ? res.map((x, i) => {
        const sec = i === 0 || secName(res[i - 1]) !== secName(x) ? `<div class="nv-pal-sec" role="presentation">${secName(x)}</div>` : '';
        const icon = x.kind === 'screen' ? svg(x.ic) : `<span class="nv-av${x.kind === 'agent' ? ' ag' : ''}" aria-hidden="true">${initial(x.t)}</span>`;
        return `${sec}<div class="nv-pal-it" role="option" aria-selected="false" id="nvo${i}" data-i="${i}">${icon}<span class="nv-pal-t"><b>${ex(x.t)}</b><small>${ex(x.sub)}</small></span><span class="nv-go" aria-hidden="true">↵</span></div>`;
      }).join('') : `<div class="nv-pal-none">Ничего не найдено${this.people === null && window.REP ? ' — клиенты ещё загружаются' : ''}</div>`;
      list.querySelectorAll('[data-i]').forEach(it => {
        it.onmousemove = () => { if (this.at !== +it.dataset.i) { this.at = +it.dataset.i; this.mark(false); } };
        it.onclick = () => this.go(this.shown[+it.dataset.i]);
      });
      this.el.querySelector('.nv-pal-n').textContent = words.length ? `${res.length} ${UI.plural(res.length, 'результат', 'результата', 'результатов')}` : '';
      this.mark();
    },
    mark(scroll = true) {
      const list = this.el.querySelector('.nv-pal-list');
      list.querySelectorAll('.on').forEach(x => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
      const it = list.querySelector(`[data-i="${this.at}"]`); if (!it) return;
      it.classList.add('on'); it.setAttribute('aria-selected', 'true'); this.el.querySelector('input').setAttribute('aria-activedescendant', it.id);
      if (scroll) it.scrollIntoView({ block: 'nearest' });
    },
    go(x) {
      if (!x) return; this.close();
      if (x.kind === 'screen') { location.hash = '#/' + x.r; return; }
      if (x.kind === 'client' && typeof CARD !== 'undefined') { CARD.open(x.name); return; }
      if (x.kind === 'agent' && typeof AGP !== 'undefined') { AGP.agent = x.name; if (location.hash === '#/agent') route(); else location.hash = '#/agent'; }
    },
  };
  window.NOVA_SEARCH = PAL;
  document.addEventListener('keydown', e => {
    const typing = e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') { e.preventDefault(); PAL.el ? PAL.close() : PAL.open(); return; }
    if (e.key === '/' && !typing && !document.querySelector('.modal-bg') && !PAL.el) { e.preventDefault(); PAL.open(); }
  });
  addEventListener('hashchange', () => PAL.close());

  // ---------- 3D tilt: tiles and cards lean toward the mouse (computer only) ----------
  const TILT = '.kpis .tile, .nv-tilt';
  let tEl = null, tXY = null, tRaf = 0;
  const tiltReset = el => { el.style.transform = ''; el.classList.remove('nv-tilting'); };
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || RM() || !FINE()) return;
    const el = e.target.closest?.(TILT) || null;
    if (el !== tEl) { if (tEl) tiltReset(tEl); tEl = el; }
    if (!el) return;
    tXY = [e.clientX, e.clientY];
    if (tRaf) return;
    tRaf = requestAnimationFrame(() => {
      tRaf = 0; if (!tEl || !tXY) return;
      const b = tEl.getBoundingClientRect(); if (!b.width) return;
      const x = (tXY[0] - b.left) / b.width - 0.5, y = (tXY[1] - b.top) / b.height - 0.5, k = b.width > 420 ? 2.5 : 7;
      tEl.classList.add('nv-tilting');
      tEl.style.transform = `perspective(900px) rotateX(${(-y * k).toFixed(2)}deg) rotateY(${(x * k).toFixed(2)}deg) translateY(-2px)`;
      tEl.style.setProperty('--nv-gx', ((x + 0.5) * 100).toFixed(1) + '%'); tEl.style.setProperty('--nv-gy', ((y + 0.5) * 100).toFixed(1) + '%');
    });
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { if (tEl) tiltReset(tEl); tEl = null; });

  // ---------- numbers count up ----------
  function countUp(root) {
    root.querySelectorAll('[data-nv-num]').forEach(el => {
      const to = +el.dataset.nvNum || 0, pre = el.dataset.nvPre || '', suf = el.dataset.nvSuf || '';
      const show = v => { el.textContent = pre + UI.fmt0(Math.round(v)) + suf; };
      if (RM() || !to) { show(to); return; }
      const t0 = performance.now(), dur = 900;
      const step = t => { const p = Math.min(1, (t - t0) / dur); show(to * (1 - Math.pow(1 - p, 3))); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
      show(0); requestAnimationFrame(step);
    });
  }

  // ---------- «Пульс» ----------
  const money = v => '$' + UI.fmt0(Math.round(v || 0));
  const num = (v, pre = '$', suf = '') => `<span data-nv-num="${Math.round(v || 0)}" data-nv-pre="${pre}" data-nv-suf="${suf}">${pre}${UI.fmt0(Math.round(v || 0))}${suf}</span>`;
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);

  // ring of segments: [{v, c, t}], c — a CSS color
  function donut(parts, { size = 176, w = 20, center = '', label = '' } = {}) {
    const h = size / 2, r = (size - w) / 2, C = 2 * Math.PI * r, tot = parts.reduce((s, p) => s + Math.max(0, p.v), 0) || 1, gap = parts.filter(p => p.v > 0).length > 1 ? 4 : 0;
    let off = 0;
    const arcs = parts.map((p, i) => {
      const len = Math.max(0, p.v) / tot * C, d = Math.max(0.01, len - gap - w * 0.9);
      const s = len > 0 ? `<circle class="nv-arc" style="--d:${d.toFixed(1)};--c:${C.toFixed(1)};animation-delay:${i * 140}ms" cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-(off + w * 0.45)).toFixed(1)}"><title>${ex(p.t)}: ${money(p.v)} (${pct(p.v, tot)}%)</title></circle>` : '';
      off += len; return s;
    }).join('');
    return `<div class="nv-donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${ex(label)}"><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${w}"/><g transform="rotate(-90 ${h} ${h})">${arcs}</g></svg><div class="nv-donut-c">${center}</div></div>`;
  }

  // today's call progress inside a 3D gyroscope
  function orb(p, done, total) {
    const r = 84, C = 2 * Math.PI * r, d = Math.max(0.01, Math.min(1, total ? done / total : 0) * C);
    return `<div class="nv-orb" role="img" aria-label="Обзвон сегодня: ${done} из ${total}">
      <div class="nv-gyro" aria-hidden="true"><i></i><i></i><i></i></div>
      <svg viewBox="0 0 210 210" aria-hidden="true"><defs><linearGradient id="nvG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset=".55" stop-color="#0a84ff"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs>
        <circle cx="105" cy="105" r="${r}" fill="none" stroke="var(--fill)" stroke-width="14"/>
        ${done ? `<circle class="nv-arc" style="--d:${d.toFixed(1)};--c:${C.toFixed(1)}" cx="105" cy="105" r="${r}" fill="none" stroke="url(#nvG)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${d.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 105 105)"/>` : ''}</svg>
      <div class="nv-orb-c"><b>${num(p, '', '%')}</b><small>${done} из ${total}<br>приоритетных</small></div></div>`;
  }

  async function pulse(el) {
    el.innerHTML = `<div class="page-head"><div><h2>Пульс</h2><div class="sub" id="nvSub">Собираю картину…</div></div>
      <div class="actions no-print"><button class="btn gray" id="nvFind" type="button">Найти клиента</button><a class="btn" href="#/my">Мой день →</a></div></div>
      <div class="nv-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
    el.querySelector('#nvFind').onclick = () => PAL.open();
    let D;
    try { if (typeof MY === 'undefined') throw new Error('Модуль «Мой день» не загружен'); D = await MY.fresh(); }
    catch (e) { if (el.isConnected) el.querySelector('.nv-skel').outerHTML = UI.empty('Не удалось собрать картину', ex(e.message || e)); return; }
    if (!el.isConnected || !el.querySelector('.nv-skel')) return; // the person went to another page meanwhile
    if (D.empty) {
      el.querySelector('#nvSub').textContent = 'Нет загруженных данных';
      el.querySelector('.nv-skel').outerHTML = UI.empty('Данных пока нет', 'Как только придёт выгрузка LINKO «Баланс клиентов», здесь появится вся картина: долг, просрочка, агенты, обещания.', '<a class="btn" href="#/up">Загрузить данные</a>');
      return;
    }

    const { d, rows, L, hasB } = D;
    const total = rows.reduce((s, c) => s + c.debt, 0);
    // debt structure: by baskets when the auto-loader counts them, else by days without payment
    const parts = hasB
      ? [{ t: 'В сроке', v: rows.reduce((s, c) => s + (c.hasB ? Math.max(0, c.debt - c.r - c.o) : c.debt), 0), c: 'var(--st-good)' },
        { t: 'Просрочка 31–60 дн.', v: rows.reduce((s, c) => s + c.o, 0), c: 'var(--st-warn)' },
        { t: 'Просрочка 61+ дн.', v: rows.reduce((s, c) => s + c.r, 0), c: 'var(--st-crit)' }]
      : [{ t: 'Платили за 30 дн.', v: rows.filter(c => (c.days || 0) <= 30).reduce((s, c) => s + c.debt, 0), c: 'var(--st-good)' },
        { t: '31–60 дн. без оплаты', v: rows.filter(c => c.days > 30 && c.days <= 60).reduce((s, c) => s + c.debt, 0), c: 'var(--st-warn)' },
        { t: '61+ дн. без оплаты', v: rows.filter(c => c.days > 60).reduce((s, c) => s + c.debt, 0), c: 'var(--st-crit)' }];
    const risky = parts[1].v + parts[2].v;

    // agents: debt, its risky part, today's calls among the first 10 of their queue (rows are already in queue order)
    const A = new Map();
    for (const c of rows) {
      const a = A.get(c.agent) || { name: c.agent, debt: 0, risk: 0, top: 0, done: 0 };
      a.debt += c.debt; a.risk += hasB ? (c.over || 0) : (c.days > 30 ? c.debt : 0);
      if (a.top < 10) { a.top++; if (c.doneToday) a.done++; }
      A.set(c.agent, a);
    }
    const agents = [...A.values()].sort((a, b) => b.debt - a.debt), maxDebt = agents[0]?.debt || 1;
    const qTotal = agents.reduce((s, a) => s + a.top, 0), qDone = agents.reduce((s, a) => s + a.done, 0), qP = pct(qDone, qTotal);

    // today's call results
    const RES = [['paid', 'Оплатил', 'var(--st-good)'], ['promise', 'Обещал', 'var(--tint)'], ['refuse', 'Отказ', 'var(--st-crit)'], ['noanswer', 'Недозвон', 'var(--muted)']];
    const res = Object.fromEntries(RES.map(([k]) => [k, 0]));
    rows.forEach(c => { if (c.doneToday && c.last && c.last.r in res) res[c.last.r]++; });
    const resN = Object.values(res).reduce((s, v) => s + v, 0);
    const sumS = a => (a || []).reduce((s, x) => s + (+x.s || 0), 0), cnt = a => (a || []).length;
    const risks = rows.filter(c => c.broke || c.due || c.r > 0.5 || (!hasB && c.days > 60)).slice(0, 7);
    const active = d.clients.filter(c => c.active).length;

    el.querySelector('#nvSub').innerHTML = `Данные на <b>${UI.dateRu(String(d.upload?.taken_at || D.t0).slice(0, 10))}</b> · ${UI.fmt0(d.clients.length)} ${UI.plural(d.clients.length, 'клиент', 'клиента', 'клиентов')}, ${UI.fmt0(active)} ${UI.plural(active, 'активный', 'активных', 'активных')}`;
    el.querySelector('.nv-skel').outerHTML = `
      <section class="nv-hero nv-tilt"><div class="nv-hero-l">
        <div class="nv-eyebrow">Обзвон должников сегодня</div>
        <h3>${qTotal && qDone >= qTotal ? 'Все приоритетные отработаны 🎉' : qDone ? `Отработано ${qDone} из ${qTotal}` : 'Обзвон ещё не начат'}</h3>
        <p>По 10 первых клиентов из очереди каждого агента. Отметки ставятся в «Мой день» и в кабинетах агентов.</p>
        <div class="nv-res" role="img" aria-label="Результаты звонков сегодня: ${RES.map(([k, t]) => `${t} ${res[k]}`).join(', ')}">${resN ? RES.filter(([k]) => res[k]).map(([k, t, c]) => `<i style="flex:${res[k]};background:${c}" title="${t}: ${res[k]}"></i>`).join('') : '<i style="flex:1"></i>'}</div>
        <div class="nv-legend">${RES.map(([k, t, c]) => `<span><i style="background:${c}"></i>${t} <b>${res[k]}</b></span>`).join('')}</div>
      </div>${orb(qP, qDone, qTotal)}</section>

      <div class="kpis nv-kpis">
        ${UI.tile('Общий долг', num(total), { sub: `${UI.fmt0(rows.length)} ${UI.plural(rows.length, 'должник', 'должника', 'должников')}` })}
        ${UI.tile(hasB ? 'Просрочено' : 'Без оплаты 30+ дней', num(risky), { sub: `${pct(risky, total)}% всего долга`, tone: pct(risky, total) >= 30 ? 'bad' : risky > 0.5 ? 'warn' : 'good' })}
        ${UI.tile('Обещали сегодня', num(sumS(L.today)), { sub: `${cnt(L.today)} ${UI.plural(cnt(L.today), 'обещание', 'обещания', 'обещаний')} · завтра ${money(sumS(L.tomorrow))}` })}
        ${UI.tile('Сорванные обещания', num(sumS(L.late)), { sub: `${cnt(L.late)} ${UI.plural(cnt(L.late), 'клиент', 'клиента', 'клиентов')}`, tone: cnt(L.late) ? 'bad' : 'good' })}
      </div>

      <div class="grid">
      ${UI.panel('Структура долга', `<div class="nv-split">${donut(parts, { center: `<b>${num(pct(risky, total), '', '%')}</b><small>в зоне риска</small>`, label: `Структура долга: ${parts.map(p => `${p.t} ${pct(p.v, total)}%`).join(', ')}` })}
          <div class="nv-bars">${parts.map((p, i) => `<div class="nv-bar"><div class="nv-bar-h"><span><i style="background:${p.c}"></i>${p.t}</span><b>${money(p.v)}</b></div><div class="nv-track"><i style="width:${pct(p.v, total)}%;background:${p.c};animation-delay:${i * 120}ms"></i></div><small>${pct(p.v, total)}% долга</small></div>`).join('')}</div></div>`,
        { sub: hasB ? 'по корзинам LINKO' : 'по дням без оплаты', cls: 'w6 nv-card' })}
      ${UI.panel('Кому звонить первым', risks.length
        ? `<div class="nv-risks">${risks.map(c => `<a href="#" data-client="${ex(c.name)}" class="nv-risk"><span class="nv-av${c.broke ? ' bad' : c.due ? ' warn' : ''}" aria-hidden="true">${initial(c.name)}</span><span class="nv-pal-t"><b>${ex(c.name)}</b><small>${ex(c.agent)} · ${ex(MY.whyText(c))}</small></span><b class="nv-risk-v">${money(c.debt)}</b></a>`).join('')}</div>`
        : '<p class="mut" style="margin:0">Сорванных обещаний и долгой просрочки нет 👍</p>',
        { sub: 'сорванные и сегодняшние обещания, долгая просрочка', tools: '<a class="btn gray sm" href="#/collect">Вся очередь</a>', cls: 'w6 nv-card' })}
      ${UI.panel('Долг по агентам', `<div class="nv-agents">${agents.slice(0, 14).map((a, i) => `<div class="nv-ag"><a href="#" data-agent="${ex(a.name)}" class="nv-ag-n">${ex(a.name)}</a>
          <div class="nv-stack-w"><div class="nv-stack" style="width:${Math.max(2, a.debt / maxDebt * 100).toFixed(1)}%;animation-delay:${i * 50}ms" title="${ex(a.name)}: ${money(a.debt)}, в зоне риска ${money(a.risk)}"><i style="flex:${Math.max(0, a.debt - a.risk).toFixed(0)};background:var(--tint)"></i><i style="flex:${a.risk.toFixed(0)};background:var(--st-crit)"></i></div></div>
          <b class="nv-ag-v">${money(a.debt)}</b><span class="nv-ag-q${a.top && a.done >= a.top ? ' ok' : ''}" title="Отработано сегодня из первых в очереди">${a.done}/${a.top}</span></div>`).join('')}
          ${agents.length > 14 ? `<p class="mut" style="margin:8px 0 0">И ещё ${agents.length - 14} — все в «Дебиторка → Должники по агентам».</p>` : ''}</div>`,
        { sub: `<span class="nv-key"><i style="background:var(--tint)"></i>${hasB ? 'в сроке' : 'платили за 30 дн.'}</span><span class="nv-key"><i style="background:var(--st-crit)"></i>${hasB ? 'просрочено' : 'без оплаты 30+ дн.'}</span><span class="nv-key">✓ отработано сегодня</span>`, cls: 'w12 nv-card' })}
      </div>`;
    countUp(el);
  }
  window.EXT_PAGES = window.EXT_PAGES || {};
  window.EXT_PAGES.pulse = pulse;

  // ---------- start ----------
  addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app'); if (!app) return;
    decorate();
    new MutationObserver(decorate).observe(app, { childList: true });
  });
})();
