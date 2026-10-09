// Small conveniences: dark theme (🌙 in the top bar) and remembered filters (agent, status, sorting…)
// — both kept in this browser, so each device keeps its own.
(() => {
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

  // ---------- theme ----------
  const apply = t => { document.documentElement.dataset.theme = t; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#08262a' : '#0c3b3d'; };
  apply(get('crm_theme') || 'light');
  const button = () => {
    const nav = document.querySelector('nav.top'); if (!nav || nav.querySelector('#themeBtn')) return;
    const b = document.createElement('button'); b.id = 'themeBtn'; b.type = 'button';
    const label = () => { const dark = document.documentElement.dataset.theme === 'dark'; b.textContent = dark ? '☀' : '🌙'; b.title = dark ? 'Светлая тема' : 'Тёмная тема'; b.setAttribute('aria-label', b.title); };
    b.onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; apply(t); set('crm_theme', t); label(); };
    label(); nav.insertBefore(b, nav.querySelector('#me'));
  };
  addEventListener('DOMContentLoaded', () => { button(); new MutationObserver(button).observe(document.getElementById('app'), { childList: true }); });

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
