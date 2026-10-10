// App on the phone: registers the service worker and offers «Установить приложение»
// (Android / computer Chrome — one tap; iPhone — a short instruction, Safari has no install button for sites).
(() => {
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    addEventListener('load', () => navigator.serviceWorker?.register('sw.js', { scope: './' }).catch(() => {}));
  }
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { deferred = null; document.getElementById('installBtn')?.remove(); try { localStorage.setItem('crm_installed', '1'); } catch { /* ignore */ } });

  const iosHelp = () => {
    const m = modal(`<h3>Установить на iPhone</h3><ol class="steps"><li>Откройте CRM в <b>Safari</b> (в других браузерах на iPhone установить нельзя).</li><li>Нажмите кнопку <b>«Поделиться»</b> — квадрат со стрелкой вверх внизу экрана.</li><li>Прокрутите и выберите <b>«На экран „Домой“»</b>, затем «Добавить».</li></ol><p class="mut">Значок MITAL CRM появится на экране телефона и будет открываться как приложение, без адресной строки.</p><div class="bar"><span class="spacer"></span><button class="btn" id="iosOk">Понятно</button></div>`);
    m.el.querySelector('#iosOk').onclick = m.close;
  };
  const install = async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; if (r?.outcome === 'accepted') document.getElementById('installBtn')?.remove(); }
    else if (ios) iosHelp();
    else if (typeof toast === 'function') toast('Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран»');
  };
  function show() {
    if (standalone()) return;
    const nav = document.querySelector('nav.top'); if (!nav || nav.querySelector('#installBtn')) return;
    if (!deferred && !ios) return;
    const b = document.createElement('button'); b.id = 'installBtn'; b.type = 'button'; b.textContent = '📲 Установить'; b.title = 'Установить CRM как приложение';
    b.onclick = install; nav.insertBefore(b, nav.querySelector('#themeBtn') || nav.querySelector('#me'));
  }
  addEventListener('DOMContentLoaded', () => { show(); new MutationObserver(show).observe(document.getElementById('app'), { childList: true }); });
  window.PWA = { install, standalone, ios, canPrompt: () => !!deferred };
  if (standalone()) document.documentElement.classList.add('standalone');
})();
