interface EventConnectionDependencies {
  state: {eventSource?: EventSource | null; transport: boolean};
  url: () => string;
  createSource: (url: string) => EventSource;
  resetThreadView: () => void;
  reconnectSideChat: () => void;
  renderStatus: () => void;
  reportThreadView: () => Promise<unknown>;
  resumeWorkspace: () => Promise<unknown>;
  recordError: (error: unknown, stage: string) => void;
  receiveWebUpdate: (data: unknown) => void;
  handleEvent: (event: MessageEvent<string>) => void;
}

// Keep transport recovery separate from native manager/status recovery.
export function createEventConnection(deps: EventConnectionDependencies) {
  return function setupEvents() {
    const {state} = deps;
    const es = deps.createSource(deps.url());
    state.eventSource = es;
    es.onopen = () => {
      deps.resetThreadView();
      deps.reconnectSideChat();
      const restored = !state.transport;
      state.transport = true;
      deps.renderStatus();
      void deps.reportThreadView().catch(e => deps.recordError(e, 'thread'));
      if (restored) deps.resumeWorkspace().catch(e => {
        deps.recordError(e, 'sync');
        deps.renderStatus();
      });
    };
    es.addEventListener('system/update', event => {
      if (state.eventSource === es) deps.receiveWebUpdate(JSON.parse((event as MessageEvent<string>).data));
    });
    es.onmessage = deps.handleEvent;
    for (const name of ['manager/status', 'manager/error', 'manager/request', 'manager/requestResolved']) {
      es.addEventListener(name, deps.handleEvent as EventListener);
    }
    es.onerror = () => { state.transport = false; deps.renderStatus(); };
  };
}
