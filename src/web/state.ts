import { createStore } from 'zustand/vanilla';
import type { DiagnosticsView, WorkspaceIdentity, WorkspaceProjection } from '../contracts/view';

export const workspaceStore = createStore<WorkspaceProjection>(() => ({
  selectedId: null, desktopMode: false, transport: false, revision: 0,
  diagnostics: { selectedId: null, entries: [] }, diagnosticsReady:false,
}));

/** Existing command/draft logic retains its object identity. React subscribes to
 * explicit immutable projections, never to a second authoritative transcript. */
export function publishWorkspace(state: WorkspaceIdentity): void {
  const previous = workspaceStore.getState();
  if (previous.selectedId === state.selectedId && previous.desktopMode === state.desktopMode && previous.transport === state.transport) return;
  workspaceStore.setState({selectedId: state.selectedId, desktopMode: state.desktopMode,
    transport: state.transport, revision: previous.revision + 1});
}
export function publishDiagnostics(diagnostics: DiagnosticsView): void {
  const previous = workspaceStore.getState().diagnostics;
  if (!workspaceStore.getState().diagnosticsReady || JSON.stringify(previous) !== JSON.stringify(diagnostics)) workspaceStore.setState({diagnostics,diagnosticsReady:true});
}

/** One state authority. Native payloads, draft stores, Maps and Sets retain identity.
 * Top-level controller writes notify only subscribers whose selected value changed. */
export function createWorkspaceState<T extends object>(initial: T): T {
  const store = createStore<T>(() => initial);
  return new Proxy(initial, {
    get(_target, key) { return Reflect.get(store.getState(), key); },
    set(_target, key, value) {
      if (!Object.is(Reflect.get(store.getState(), key), value)) {
        store.setState({[key]: value} as Partial<T>);
      }
      return true;
    },
    ownKeys() { return Reflect.ownKeys(store.getState()); },
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(store.getState(), key);
      return descriptor && {...descriptor, configurable: true};
    },
  });
}
