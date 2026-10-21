// Архив данных (Данные → Архив данных): every day the Google auto-loader keeps a compressed copy of everything it took from LINKO
// in the private data repository — archive/YYYY/MM/YYYY-MM-DD/{latest,fast,extra}.json.gz (balance and stock files; orders,
// payments, debts; agents' working day, refusals, frequency, profit…). Nothing there is ever deleted: it is the base for analysis.
// This page lists the archive and downloads any day; ARC.fillDisc() fills the discipline log (disc.js) from archived days
// the CRM was not opened on.
window.EXT_PAGES = window.EXT_PAGES || {};

const ARC = {
  RE: /^archive\/\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})\/([a-z]+)\.json\.gz$/,
  NAMES: { latest: 'баланс и остатки', fast: 'заказы, оплаты, долги', extra: 'работа агентов, отказы и др.' },
  cfg() { const c = typeof CLOUD !== 'undefined' && CLOUD.cfg ? CLOUD.cfg() : null; return c && c.token && c.owner && c.repo ? c : null; },
  api(c, path) { return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${path}`; },
  head(c, accept = 'application/vnd.github+json') { return { Authorization: 'Bearer ' + c.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }; },

  // every archived file: [{ day, name, path, size }], newest day first (one request for the whole repository tree)
  async list() {
    const c = ARC.cfg(); if (!c) return null;
    const r = await fetch(ARC.api(c, 'git/trees/HEAD?recursive=1') + '&t=' + Date.now(), { headers: ARC.head(c), cache: 'no-store' });
    if (r.status === 409 || r.status === 404) return [];
    if (!r.ok) throw new Error('GitHub ответил ' + r.status);
    const j = await r.json();
    return (j.tree || []).map(t => { const m = t.type === 'blob' && t.path.match(ARC.RE); return m ? { day: m[1], name: m[2], path: t.path, size: t.size || 0 } : null; }).filter(Boolean).sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
  },
  async read(path) {
    const c = ARC.cfg(); if (!c) throw new Error('Синхронизация не настроена');
    const r = await fetch(ARC.api(c, 'contents/' + path.split('/').map(encodeURIComponent).join('/')) + '?t=' + Date.now(), { headers: ARC.head(c, 'application/vnd.github.raw'), cache: 'no-store' });
    if (!r.ok) throw new Error('Файл архива не получен: ' + r.status);
    const text = await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  },
  size: n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'),

  // discipline log: days of the current period that are in the archive but not in the log (the CRM was not opened that day)
  async fillDisc() {
    if (ARC._filled || typeof DS === 'undefined' || !ARC.cfg()) return 0;
    ARC._filled = true;
    const s = LX.st(); if (!s?.from) return 0;
    const t0 = UI.localDate(Date.now()), have = DS.cfg().days;
    const files = (await ARC.list()) || [], miss = files.filter(f => f.name === 'extra' && f.day >= s.from && f.day < t0 && !have[f.day]);
    let n = 0;
    for (const f of miss.slice(0, 31)) {
      try { const j = await ARC.read(f.path); const rows = j?.data?.workday || []; if (rows.length && DS.capture(rows, f.day)) n++; } catch (e) { console.warn('archive', f.day, e); }
    }
    return n;
  },
};

EXT_PAGES.archive = async el => {
  await CRMLocal.ready;
  el.innerHTML = `<div class="page-head"><div><h2>Архив данных</h2><div class="sub">Каждый день автозагрузка сохраняет всё, что взяла из LINKO, в ваш приватный репозиторий. Из архива ничего не удаляется — это база для подробного анализа.</div></div></div><div id="arBody"><p class="mut">Загружаю список…</p></div>`;
  const body = $('#arBody', el);
  if (!ARC.cfg()) { body.innerHTML = UI.empty('Синхронизация не настроена', 'Архив хранится в том же приватном репозитории, что и данные CRM. Включите <a href="#/cloud">Данные → Синхронизация и настройки</a>.'); return; }
  let files;
  try { files = await ARC.list(); } catch (e) { body.innerHTML = `<p class="neg">Не удалось получить архив: ${esc(e.message)}</p>`; return; }
  const days = [...new Set(files.map(f => f.day))], total = files.reduce((s, f) => s + f.size, 0), f0 = UI.fmt0;
  if (!days.length) { body.innerHTML = UI.empty('Архив пока пуст', 'Он начнёт заполняться, как только вы заново вставите скрипт автозагрузки в Google: <a href="#/cloud">Синхронизация и настройки</a> → «📋 Скопировать готовый скрипт». Дальше каждый день сохраняется сам.'); return; }
  const by = new Map(); for (const f of files) (by.get(f.day) || by.set(f.day, {}).get(f.day))[f.name] = f;
  const kinds = Object.keys(ARC.NAMES);
  body.innerHTML = `<div class="kpis">${UI.tile('Дней в архиве', f0(days.length), { sub: `с ${UI.dateRu(days.at(-1))} по ${UI.dateRu(days[0])}`, tone: 'good' })}
    ${UI.tile('Объём', ARC.size(total), { sub: 'в сжатом виде' })}
    ${UI.tile('Последний день', UI.dateRu(days[0]), { sub: kinds.filter(k => by.get(days[0])[k]).map(k => ARC.NAMES[k]).join(', ') })}</div>
    ${UI.panel('Дни', LX.table(['День', ...kinds.map(k => ARC.NAMES[k])], days.map(d => `<tr><td>${UI.dateRu(d)}</td>${kinds.map(k => { const f = by.get(d)[k]; return `<td>${f ? `<a href="#" data-p="${esc(f.path)}" data-n="${esc(d + '-' + k)}">⬇ ${ARC.size(f.size)}</a>` : '<span class="mut">—</span>'}</td>`; }).join('')}</tr>`), { max: '560px' }), { cls: 'w12', sub: 'Нажмите на размер — файл дня скачается (JSON). По этим данным строятся отчёты и анализ в CRM.' })}`;
  body.querySelectorAll('[data-p]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    try {
      const j = await ARC.read(a.dataset.p), url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' }));
      const x = document.createElement('a'); x.href = url; x.download = `mital-${a.dataset.n}.json`; x.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) { toast(err.message); }
  });
};
