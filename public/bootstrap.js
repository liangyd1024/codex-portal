// Keep startup recovery independent of the module graph and its first request.
(() => {
  const banner = document.getElementById('startup-status');
  const message = document.getElementById('startup-message');
  const retry = document.getElementById('startup-retry');
  let ready = false, failed = false;
  retry.onclick = event => { event.preventDefault(); location.reload(); };
  function fail() {
    if (ready) return;
    failed = true;
    banner.hidden = false;
    message.textContent = '工作台加载失败或连接超时。请检查网络后重新加载。';
  }
  const timer = setTimeout(fail,15000);
  window.addEventListener('rcm-ready',() => {
    ready = true; clearTimeout(timer); banner.hidden = true;
  },{once:true});
  // Reload only before the app has become interactive: never discard live drafts.
  function resume() { if (failed && !ready && !document.hidden && navigator.onLine !== false) location.reload(); }
  window.addEventListener('online',resume);
  window.addEventListener('pageshow',resume);
  document.addEventListener('visibilitychange',resume);
  import('./app.js').catch(async () => {
    clearTimeout(timer); fail();
    if (ready) return;
    const controller = new AbortController(), authTimer = setTimeout(() => controller.abort(),5000);
    try {
      const response = await fetch('/api/access/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (response.status === 401) {
        const data = await response.json();
        if (data.error?.code === 'PAIRING_REQUIRED') location.reload();
      }
    } catch {} finally { clearTimeout(authTimer); }
  });
})();
