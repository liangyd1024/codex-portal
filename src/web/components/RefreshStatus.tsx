import {createStore, useStore} from 'zustand';

export interface RefreshStatusView {
  refreshing: boolean;
  message: string;
  time: string;
}
const refreshStore = createStore<RefreshStatusView & {ready: boolean}>(() => ({
  refreshing: false, message: '', time: '', ready: false,
}));
export function publishRefreshStatus(view: RefreshStatusView): void {
  const previous = refreshStore.getState();
  if (!previous.ready || previous.refreshing !== view.refreshing || previous.message !== view.message || previous.time !== view.time) {
    refreshStore.setState({...view, ready: true});
  }
}
export function RefreshStatus() {
  const view = useStore(refreshStore, state => state);
  const failed = view.message.includes('失败');
  const compact = view.refreshing ? '刷新中…' : failed ? '刷新失败' : view.message;
  return <div id="refresh-status" className={'refresh-status' + (!view.refreshing && failed ? ' error' : '')}
    role="status" aria-live="polite" aria-atomic="true" tabIndex={0} hidden={!view.message}
    aria-busy={view.ready ? String(view.refreshing) as 'true' | 'false' : undefined}>
    <span id="refresh-compact" aria-hidden="true">{view.ready ? compact || '—' : ''}</span>
    <span className="refresh-details"><span id="refresh-message">{view.ready ? view.message || '—' : ''}</span>
      <span id="refresh-time">{view.time}</span></span>
  </div>;
}
