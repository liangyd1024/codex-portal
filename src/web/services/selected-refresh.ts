interface Detail<T> {
  turns?: T[];
  thread?: {turns?: T[]};
  nextCursor?: string | null;
}
interface SelectionState<D> {
  selectedId: string | null;
  selectionVersion: number;
  detailVersion: number;
  detail?: D | null;
  loadingDetail: boolean;
  loadedOlderHistory: boolean;
  historyCursor: string | null;
}
interface SelectionDependencies<T, D extends Detail<T>> {
  state: SelectionState<D>;
  blocked: () => boolean;
  newChatOpen: () => boolean;
  restore: (id: string, selection: number) => unknown;
  read: (id: string, isCurrent: () => boolean) => Promise<D>;
  turns: () => T[];
  merge: (current: T[], incoming: T[]) => T[];
  apply: (data: D, resetModels: boolean) => void;
  updated: () => void;
}

/** Selection and connection generations are part of request identity. Keep
 * each pending read until it settles, even after another selection is shown. */
export function createSelectedRefresh<T, D extends Detail<T>>({
  state, blocked, newChatOpen, restore, read, turns, merge, apply, updated,
}: SelectionDependencies<T, D>) {
  const reads = new Map<string, Promise<void>>();
  const currentKey = () => JSON.stringify([state.selectedId, state.selectionVersion, state.detailVersion]);
  async function refresh(): Promise<void> {
    if (blocked() || !state.selectedId) return;
    const id = state.selectedId, selection = state.selectionVersion, version = state.detailVersion;
    const key = JSON.stringify([id, selection, version]);
    const isCurrent = () => !newChatOpen() && id === state.selectedId &&
      selection === state.selectionVersion && version === state.detailVersion;
    if (reads.has(key)) return reads.get(key);
    let applied = false;
    const pending = (async () => {
      // IndexedDB recovery is optional and must not delay the network reader.
      if (!state.detail) void restore(id, selection);
      if (!isCurrent()) return;
      const resetModels = !state.detail || state.loadingDetail;
      const data = await read(id, isCurrent);
      if (!isCurrent()) return;
      data.turns = merge(turns(), data.turns || data.thread?.turns || []);
      if (state.loadedOlderHistory) data.nextCursor = state.historyCursor;
      state.loadingDetail = false;
      apply(data, resetModels); applied = true;
    })().catch(error => { if (isCurrent()) throw error; });
    reads.set(key, pending);
    try { await pending; }
    finally {
      if (reads.get(key) === pending) reads.delete(key);
      if (applied && isCurrent()) updated();
    }
  }
  return {refresh, pending: () => reads.has(currentKey())};
}
