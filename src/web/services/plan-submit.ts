interface Plan {turnId: string; text: string}
interface Dependencies<Turn> {
  state: {selectedId: string | null; selectionVersion: number; desktopMode: boolean; busy: Set<string>; model: string; effort: string};
  newChatOpen: () => boolean;
  usable: () => boolean;
  controlled: () => boolean;
  desktopReady?: () => boolean;
  desktopSend?: (id:string,plan:Plan)=>Promise<{turn?:Turn}>;
  running: () => boolean;
  completed: () => Plan | null;
  text: (plan: Plan) => string;
  access: string;
  post: (path: string, body: {text: string; mode: 'default'; access: string; model: string; effort: string}) => Promise<{turn?: Turn}>;
  upsert: (turn: Turn) => void;
  renderControls: () => void;
  renderThread: () => void;
  refresh: () => Promise<unknown>;
  recordError: (error: unknown, stage: string) => void;
}
export function createPlanSubmit<Turn>(d: Dependencies<Turn>) {
  const {state} = d;
  return async function implementPlan(id: string, plan: Plan) {
    if (id !== state.selectedId || d.newChatOpen() || (state.desktopMode ? !d.desktopReady?.() || !d.desktopSend : !d.usable() || !d.controlled()) || d.running() || state.busy.size || d.completed()?.turnId !== plan.turnId) {
      throw Object.assign(new Error('会话状态已变化，请重新核对计划。'), {status: 409});
    }
    const selection = state.selectionVersion;
    state.busy.add('message'); d.renderControls();
    try {
      const result = state.desktopMode ? await d.desktopSend!(id,plan) : await d.post('/api/threads/' + encodeURIComponent(id) + '/message', {text: d.text(plan), mode: 'default', access: d.access, model: state.model, effort: state.effort});
      if (id === state.selectedId && selection === state.selectionVersion) {
        if (result.turn) d.upsert(result.turn);
        d.renderThread();
        try { await d.refresh(); } catch (error) { d.recordError(error, 'thread'); }
      }
    } finally { state.busy.delete('message'); d.renderControls(); }
  };
}
