// Small conveniences: dark theme (🌙 in the top bar) and remembered filters (agent, status, sorting…)
// — both kept in this browser, so each device keeps its own.
(() => {
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

  // ---------- theme ----------
  const apply = t => { document.documentElement.dataset.theme = t; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#081521' : '#0e2433'; };
  apply(get('crm_theme') || 'light');
  const button = () => {
    const nav = document.querySelector('nav.top'); if (!nav || nav.querySelector('#themeBtn')) return;
    const b = document.createElement('button'); b.id = 'themeBtn'; b.type = 'button';
    const label = () => { const dark = document.documentElement.dataset.theme === 'dark'; b.textContent = dark ? '☀' : '🌙'; b.title = dark ? 'Светлая тема' : 'Тёмная тема'; b.setAttribute('aria-label', b.title); };
    b.onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; apply(t); set('crm_theme', t); label(); };
    label(); nav.insertBefore(b, nav.querySelector('#me'));
  };
  // ---------- collapsible left menu (computer): ☰ in the top bar, remembered in this browser ----------
  const sideCss = document.createElement('style');
  sideCss.textContent = `@media (min-width: 901px) { .side { transition: transform .2s ease; } .shell { transition: margin-left .2s ease; } body.sideoff .side { transform: translateX(-102%); box-shadow: none; } body.sideoff .shell { margin-left: 0; } body.sideoff main { max-width: none; } }
#sideBtn { background: none; border: 0; color: var(--text); font-size: 20px; line-height: 1; padding: 6px 10px 6px 0; cursor: pointer; } #sideBtn:hover { color: var(--oil, #e0a000); } @media (max-width: 900px) { #sideBtn { display: none; } }`;
  document.head.appendChild(sideCss);
  const sideButton = () => {
    const nav = document.querySelector('nav.top'); if (!nav || nav.querySelector('#sideBtn')) return;
    const b = document.createElement('button'); b.id = 'sideBtn'; b.type = 'button'; b.textContent = '☰';
    const label = () => { const off = document.body.classList.contains('sideoff'); b.title = off ? 'Показать меню' : 'Свернуть меню (больше места для таблиц)'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(off)); };
    b.onclick = () => { document.body.classList.toggle('sideoff'); set('crm_side', document.body.classList.contains('sideoff') ? 'off' : 'on'); label(); };
    label(); nav.insertBefore(b, nav.firstChild);
  };
  addEventListener('DOMContentLoaded', () => { if (get('crm_side') === 'off') document.body.classList.add('sideoff'); button(); sideButton(); new MutationObserver(() => { button(); sideButton(); }).observe(document.getElementById('app'), { childList: true }); });

  // ---------- remembered filters ----------
  const STATES = () => ({ clState, repDebt, repSleep, repDyn, repDays, sigState, whoState, AGP });
  try {
    const saved = JSON.parse(get('crm_filters') || '{}'), st = STATES();
    for (const [k, v] of Object.entries(saved)) if (st[k] && v && typeof v === 'object') { if ('q' in v) v.q = ''; Object.assign(st[k], v); }
  } catch { /* broken saved filters: ignore */ }
  const save = () => { try { set('crm_filters', JSON.stringify(STATES())); } catch { /* ignore */ } };
  addEventListener('hashchange', save); addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  document.addEventListener('change', () => setTimeout(save, 0), true);
})();
