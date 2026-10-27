// Recovery must work even when the app's module graph cannot load.
(() => {
  // React may replace the prerendered shell during hydration recovery.
  const node = id => document.getElementById(id);
  let ready = false, failed = false, reloading = false, attempt = null, navigationTimer = null, recoveryTimer = null;
  const recoveryKey = 'rcm.startup-recovery';
  let recovery = {count:0, started:Date.now()}, persistentRecovery = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
    if (saved && Number.isInteger(saved.count) && saved.count >= 0 && Date.now() - saved.started < 60000) recovery = saved;
    sessionStorage.setItem(recoveryKey,JSON.stringify(recovery));
  } catch { persistentRecovery = false; }
  function automaticReload() {
    clearTimeout(recoveryTimer); recoveryTimer = null;
    if (ready || reloading || !failed || document.hidden || navigator.onLine === false || recovery.count >= 3) return;
    recovery.count++; recovery.started = Date.now();
    try { sessionStorage.setItem(recoveryKey,JSON.stringify(recovery)); } catch { persistentRecovery = false; }
    void reload(true);
  }
  function scheduleRecovery() {
    clearTimeout(recoveryTimer);
    if (!ready && failed && !document.hidden && navigator.onLine !== false && recovery.count < 3) {
      recoveryTimer = setTimeout(automaticReload,[1000,3000,8000][recovery.count]);
    }
  }
  function fail(text = '工作台加载失败或连接超时。请检查网络后重试。') {
    if (ready) return;
    failed = true; reloading = false;
    clearTimeout(navigationTimer);
    node('startup-status').hidden = false; node('startup-status').setAttribute('aria-busy','false');
    node('startup-title').textContent = '暂时无法加载工作台';
    node('startup-message').textContent = text;
    node('startup-retry').disabled = false; node('startup-retry').textContent = '重新加载';
    scheduleRecovery();
  }
  const timer = setTimeout(fail,15000);
  async function reload(automatic = false) {
    if (ready || reloading) return;
    reloading = true; failed = false; clearTimeout(timer); clearTimeout(recoveryTimer);
    node('startup-status').setAttribute('aria-busy','true');
    node('startup-title').textContent = '正在重新加载工作台';
    node('startup-message').textContent = '正在检查连接，请稍候…';
    node('startup-retry').disabled = true; node('startup-retry').textContent = '正在重新加载…';
    const controller = new AbortController(); attempt = controller;
    const timeout = setTimeout(() => controller.abort(),12000);
    try {
      // Check reachability first, keeping useful feedback on screen while offline.
      const response = await fetch('/api/connections',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (ready || attempt !== controller) return;
      const data = await response.json();
      if (ready || attempt !== controller) return;
      if (!response.ok && !(response.status === 401 && data.error?.code === 'PAIRING_REQUIRED')) throw Error('unavailable');
      if (automatic && !persistentRecovery) {
        reloading = false; failed = true; recovery.count = 3;
        node('startup-status').setAttribute('aria-busy','false'); node('startup-retry').disabled = false; node('startup-retry').textContent = '重新加载';
        node('startup-message').textContent = '连接已恢复。请点击重新加载。'; return;
      }
      node('startup-message').textContent = '连接已恢复，正在打开工作台…';
      navigationTimer = setTimeout(() => fail('页面重新加载超时，请再次重试。'),15000);
      location.reload();
    } catch {
      if (!ready && attempt === controller) fail(controller.signal.aborted ? '连接超时。请检查网络后再次重试。' : '仍无法连接工作台。请检查网络和工作台服务后重试。');
    } finally { clearTimeout(timeout); if (attempt === controller) attempt = null; }
  }
  function retryStartup() {
    recovery = {count:0,started:Date.now()};
    try {sessionStorage.setItem(recoveryKey,JSON.stringify(recovery));} catch {}
    return reload();
  }
  document.addEventListener('click',event => {
    if (event.target?.closest?.('#startup-retry')) return retryStartup();
  });
  window.addEventListener('rcm-ready',() => {
    ready = true; clearTimeout(recoveryTimer);
    try {sessionStorage.removeItem(recoveryKey);} catch {}
    clearTimeout(timer); clearTimeout(navigationTimer); attempt?.abort(); attempt = null;
    node('startup-status').hidden = true; document.body.classList.remove('startup-pending');
    if (document.activeElement === node('startup-retry')) document.getElementById('welcome-connect')?.focus({preventScroll:true});
  },{once:true});
  // Never reload after the UI becomes interactive, preserving live drafts.
  function resume() {
    if (Date.now() - recovery.started >= 60000) recovery = {count:0,started:Date.now()};
    automaticReload();
  }
  window.addEventListener('online',resume);
  window.addEventListener('pageshow',event => { if (event?.persisted) resume(); });
  document.addEventListener('visibilitychange',resume);
  window.addEventListener('focus',resume);
  import('./app.js').catch(async () => {
    clearTimeout(timer);
    if (ready || reloading) return;
    fail();
    const controller = new AbortController(), authTimer = setTimeout(() => controller.abort(),5000);
    try {
      const response = await fetch('/api/access/status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if (response.status === 401) {
        const data = await response.json();
        if (!ready && !reloading && data.error?.code === 'PAIRING_REQUIRED') automaticReload();
      }
    } catch {} finally { clearTimeout(authTimer); }
  });
})();
