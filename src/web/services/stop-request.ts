interface Dependencies<Request> {
  state: {busy: Set<string>; desktopMode: boolean; selectedId: string | null; selectionVersion: number};
  newChatOpen: () => boolean;
  context: () => string;
  turns: () => {id: string; status: unknown}[];
  kind: (status: unknown) => string;
  controlled: () => boolean;
  running: () => boolean;
  feedback: {
    has: (key: string) => boolean;
    begin: (key: string, turnId: string | undefined, background: boolean) => Request;
    settle: (key: string, request: Request, error?: unknown) => void;
  };
  action: (key: string, work: () => Promise<void>) => Promise<unknown>;
  api: (path: string, options: {method: 'POST'; body?: {turnId: string | undefined}}) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  recordError: (error: unknown, stage: string) => void;
}

export function createStopRequest<Request>(d: Dependencies<Request>) {
  const {state, feedback} = d;
  return async function interruptThread() {
    if (state.busy.has('interrupt') || feedback.has(d.context()) || !state.selectedId || d.newChatOpen()) return;
    const desktop = state.desktopMode, id = state.selectedId, selection = state.selectionVersion, key = d.context();
    const turnId = [...d.turns()].reverse().find(turn => ['inProgress', 'in_progress', 'running'].includes(d.kind(turn.status)))?.id;
    if (desktop ? !turnId : !d.controlled()) return;
    const current = () => key === d.context() && selection === state.selectionVersion && !d.newChatOpen();
    const request = feedback.begin(key, turnId, !desktop && !d.running());
    await d.action('interrupt', async () => {
      try {
        await d.api((desktop ? '/api/desktop/threads/' : '/api/threads/') + encodeURIComponent(id) + '/interrupt', {method: 'POST', ...(desktop ? {body: {turnId}} : {})});
      } catch (error) {
        feedback.settle(key, request, error);
        if (current()) throw error;
        d.recordError(error, 'interrupt'); return;
      }
      feedback.settle(key, request);
      if (current()) await d.refresh();
    });
  };
}
