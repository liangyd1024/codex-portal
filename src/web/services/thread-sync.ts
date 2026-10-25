interface Options {
 window:Pick<Window,'addEventListener'|'removeEventListener'|'navigator'>;
 document:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;
 canSync:()=>boolean;refresh:()=>unknown;resume:()=>unknown;onError:(error:unknown)=>unknown;interval?:number;
}
// Reading a desktop-owned thread needs a fallback even when SSE stays connected.
// Keep this independent of the optional project/model catalog refresh.
export function installThreadSync({window, document, canSync, refresh, resume, onError, interval = 5000}:Options) {
  let timer:ReturnType<typeof setTimeout>|undefined, pending:Promise<unknown>|null, rerun = false, stopped = false;
  const visible = () => !stopped && !document.hidden && window.navigator.onLine !== false;
  const schedule = () => {
    clearTimeout(timer);
    if (visible()) timer = setTimeout(() => run(false), interval);
  };
  function run(foreground:boolean):Promise<unknown>|undefined {
    if (!visible()) return;
    clearTimeout(timer);
    if (pending) {
      // A read started before returning to the page may contain an old snapshot.
      if (foreground) rerun = true;
      return pending;
    }
    pending = Promise.resolve().then(() => {
      if (!visible()) return;
      if (foreground) return resume();
      if (canSync()) return refresh();
    }).catch(onError).finally(() => {
      pending = null;
      if (rerun) { rerun = false; run(true); }
      else schedule();
    });
    return pending;
  }
  const foreground = () => run(true);
  const visibility = () => { if (visible()) foreground(); else clearTimeout(timer); };
  const hide = () => { stopped = true; clearTimeout(timer); };
  const show = (event: PageTransitionEvent) => {
    // Initial loading already reads the workspace. Bundled startup can install
    // this listener before the first pageshow; that is not a page restoration.
    if (!stopped && !event.persisted) return;
    stopped = false;
    foreground();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('focus', foreground);
  window.addEventListener('online', foreground);
  window.addEventListener('offline', visibility);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  schedule();
  return () => {
    hide();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('focus', foreground);
    window.removeEventListener('online', foreground);
    window.removeEventListener('offline', visibility);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
  };
}
