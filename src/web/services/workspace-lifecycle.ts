interface WorkspaceLifecycleDependencies {
  window: Pick<Window, 'addEventListener'>;
  document: Pick<Document, 'addEventListener' | 'hidden'>;
  host: string;
  syncNotificationPreference: () => void;
  readPreference: (key: string) => string | null;
  autoRefreshInput: () => HTMLInputElement;
  setAutoRefresh: (enabled: boolean) => void;
  stopAutoRefresh: () => void;
  flushDrafts: () => void;
}

export function installWorkspaceLifecycle(deps: WorkspaceLifecycleDependencies) {
  const {window, document, host, syncNotificationPreference, setAutoRefresh, flushDrafts} = deps;
  window.addEventListener('focus', syncNotificationPreference);
  window.addEventListener('storage', event => {
    if (event.key === 'rcm.taskNotifications.' + host) syncNotificationPreference();
  });
  let autoRefresh = false;
  try { autoRefresh = deps.readPreference('rcm.autoRefresh.' + host) === 'true'; } catch {}
  setAutoRefresh(autoRefresh);
  deps.autoRefreshInput().onchange = event => setAutoRefresh((event.target as HTMLInputElement).checked);
  window.addEventListener('pagehide', () => { flushDrafts(); deps.stopAutoRefresh(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) setAutoRefresh(deps.autoRefreshInput().checked);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDrafts(); });
}

// Install after thread synchronization, preserving the offline listener order.
export function installOfflineDraftGuard(deps: {
  window: Pick<Window, 'addEventListener'>;
  state: {transport: boolean};
  flushDrafts: () => void;
  renderStatus: () => void;
  renderControls: () => void;
}) {
  deps.window.addEventListener('offline', () => {
    deps.flushDrafts();
    deps.state.transport = false;
    deps.renderStatus();
    deps.renderControls();
  });
}
