// «🔄 Обновить» in the top bar: the platform no longer refreshes itself on a timer —
// one press sends unsaved changes, pulls the newest cloud data and the newest LINKO data, and redraws the page.
(() => {
  let running = false;
  const btn = () => document.getElementById('refreshBtn');
  const label = (state, text) => {
    const b = btn(); if (!b) return;
    b.classList.toggle('spin', state === 'busy'); b.disabled = state === 'busy';
    b.querySelector('.rt').textContent = text;
  };
  const clock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  let lastAt = '';

  async function run() {
    if (running) return; running = true;
    label('busy', 'Обновляю…');
    try {
      if (window.CLOUD?.on()) {
        const wasDirty = CLOUD.status().dirty;
        await CLOUD.sync();                       // sends local changes, or pulls a newer cloud version
        if (wasDirty) await CLOUD.sync();         // after sending, check once more for a newer version
        const st = CLOUD.status();
        if (st.status === 'error') throw new Error(st.message || 'ошибка синхронизации');
        if (st.status === 'conflict') { label('idle', 'Выберите версию'); return; }
      }
      if (window.LINKO_AUTO) { LINKO_AUTO.lastTry = 0; for (let i = 0; i < 20 && LINKO_AUTO.busy; i++) await new Promise(r => setTimeout(r, 300)); await LINKO_AUTO.check(); }
      const ae = document.activeElement, typing = ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable) || document.querySelector('.modal-bg, dialog[open]');
      if (!typing && typeof route === 'function') route();
      lastAt = clock(); label('idle', 'Обновлено ' + lastAt);
      if (typeof toast === 'function') toast('Данные обновлены · ' + lastAt);
    } catch (e) {
      label('idle', 'Обновить');
      if (typeof toast === 'function') toast('Не удалось обновить: ' + (e && e.message || e));
    } finally { running = false; const b = btn(); if (b) b.disabled = false; }
  }
  window.REFRESH = { run };

  const place = () => {
    const nav = document.querySelector('nav.top'); if (!nav || nav.querySelector('#refreshBtn')) return;
    const b = document.createElement('button'); b.id = 'refreshBtn'; b.type = 'button'; b.title = 'Обновить все данные платформы'; b.setAttribute('aria-label', 'Обновить');
    b.innerHTML = '<span class="ri" aria-hidden="true">🔄</span><span class="rt">' + (lastAt ? 'Обновлено ' + lastAt : 'Обновить') + '</span>';
    b.onclick = run;
    nav.insertBefore(b, nav.querySelector('#cloudBadge') || nav.querySelector('#themeBtn') || nav.querySelector('#me'));
  };
  addEventListener('DOMContentLoaded', () => { place(); new MutationObserver(place).observe(document.getElementById('app'), { childList: true }); });
})();
