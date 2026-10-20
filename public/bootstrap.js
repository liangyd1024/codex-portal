// Recovery must work even when the app's module graph cannot load.
(() => {
  const panel = document.getElementById('startup-status');
  const title = document.getElementById('startup-title');
  const message = document.getElementById('startup-message');
  const retry = document.getElementById('startup-retry');
  let ready = false, failed = false, reloading = false, attempt = null, navigationTimer = null;
  function fail(text = '工作台加载失败或连接超时。请检查网络后重试。') {
    if (ready) return;
    failed = true; reloading = false;
    clearTimeout(navigationTimer);
    panel.hidden = false; panel.setAttribute('aria-busy','false');
    title.textContent = '暂时无法加载工作台';
    message.textContent = text;
    retry.disabled = false; retry.textContent = '重新加载';
  }
  const timer = setTimeout(fail,15000);
  async function reload() {
    if (ready || reloading) return;
    reloading = true; failed = false; clearTimeout(timer);
    panel.setAttribute('aria-busy','true');
    title.textContent = '正在重新加载工作台';
    message.textContent = '正在检查连接，请稍候…';
    retry.disabled = true; retry.textContent = '正在重新加载…';
    const controller = new AbortController(); attempt = controller;
    const timeout = setTimeout(() => controller.abort(),12000);
    try {
      // Check reachability first, keeping useful feedback on screen while offline.
      const response = await fetch('/api/connections',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (ready || attempt !== controller) return;
      const data = await response.json();
      if (ready || attempt !== controller) return;
      if (!response.ok && !(response.status === 401 && data.error?.code === 'PAIRING_REQUIRED')) throw Error('unavailable');
      message.textContent = '连接已恢复，正在打开工作台…';
      navigationTimer = setTimeout(() => fail('页面重新加载超时，请再次重试。'),15000);
      location.reload();
    } catch {
      if (!ready && attempt === controller) fail(controller.signal.aborted ? '连接超时。请检查网络后再次重试。' : '仍无法连接工作台。请检查网络和工作台服务后重试。');
    } finally { clearTimeout(timeout); if (attempt === controller) attempt = null; }
  }
  retry.onclick = reload;
  window.addEventListener('rcm-ready',() => {
    ready = true; clearTimeout(timer); clearTimeout(navigationTimer); attempt?.abort(); attempt = null;
    panel.hidden = true; document.body.classList.remove('startup-pending');
    if (document.activeElement === retry) document.getElementById('welcome-connect')?.focus({preventScroll:true});
  },{once:true});
  // Never reload after the UI becomes interactive, preserving live drafts.
  function resume() { if (failed && !ready && !document.hidden && navigator.onLine !== false) void reload(); }
  window.addEventListener('online',resume);
  window.addEventListener('pageshow',event => { if (event?.persisted) resume(); });
  document.addEventListener('visibilitychange',resume);
  import('./app.js').catch(async () => {
    clearTimeout(timer);
    if (ready || reloading) return;
    fail();
    const controller = new AbortController(), authTimer = setTimeout(() => controller.abort(),5000);
    try {
      const response = await fetch('/api/access/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (response.status === 401) {
        const data = await response.json();
        if (!ready && !reloading && data.error?.code === 'PAIRING_REQUIRED') void reload();
      }
    } catch {} finally { clearTimeout(authTimer); }
  });
})();
