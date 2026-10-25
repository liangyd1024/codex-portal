interface Turn {id?: string}
interface Detail<T> {turns?: T[]; historySource?: string}
interface State<T> {
  historyCursor: string | null;
  selectedId: string | null;
  detail: Detail<T> | null;
  selectionVersion: number;
  desktopMode: boolean;
  loadingDetail: boolean;
  loadedOlderHistory: boolean;
  busy: Set<string>;
}
interface Dependencies<T> {
  state: State<T>;
  busy: (value: boolean) => void;
  action: (key: string, work: () => Promise<boolean | undefined>) => Promise<boolean | undefined>;
  read: (path: string) => Promise<{data?: T[]; nextCursor?: string | null; historySource?: string}>;
  turns: () => T[];
  render: () => void;
}
export function createHistoryPagination<T extends Turn>({state, busy, action, read, turns, render}: Dependencies<T>) {
  return async function moreHistory({deferRender = false} = {}) {
    if (!state.historyCursor || !state.selectedId || !state.detail || state.loadingDetail || state.busy.has('history')) return;
    const id = state.selectedId, version = state.selectionVersion;
    busy(true);
    try { return await action('history', async () => {
      let data;
      try {
        data = await read((state.desktopMode ? '/api/desktop/threads/' + encodeURIComponent(id) + '/history' : '/api/threads/' + encodeURIComponent(id) + '/history') + '?cursor=' + encodeURIComponent(state.historyCursor!) + '&lazyTools=1' + (state.desktopMode ? '&threadId=' + encodeURIComponent(id) : ''));
      } catch (error) {
        if ((error as {code?: string}).code === 'HISTORY_CURSOR_CHANGED') throw new Error('历史记录已更新。请刷新会话后再向上滚动。');
        throw error;
      }
      if (id !== state.selectedId || version !== state.selectionVersion) return;
      const old = new Map(turns().map(turn => [turn.id, turn]));
      const all = [...[...(data.data || [])].reverse(), ...turns()], seen = new Set<string|undefined>();
      state.detail!.turns = all.filter(turn => !seen.has(turn.id) && seen.add(turn.id)).map(turn => old.get(turn.id) || turn);
      state.historyCursor = data.nextCursor || null;
      state.loadedOlderHistory = true;
      if (data.historySource === 'snapshot') state.detail!.historySource = 'snapshot';
      if (!deferRender) render();
      return true;
    }); } finally { busy(false); }
  };
}
