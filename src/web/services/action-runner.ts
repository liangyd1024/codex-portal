interface Dependencies {
  state: {busy: Set<string>; status?: {controlledThreads?: string[]} | null};
  renderControls: () => void;
  renderStatus: () => void;
  usable: () => boolean;
  syncRequestCards: (view: {ready: boolean; pending: (id: string) => boolean; controlledThreads?: string[]}) => void;
  recordError: (error: unknown, stage: string) => void;
  messageOf: (error: unknown) => string;
  toast: (message: string, error: boolean, duration: number) => void;
}
export function createActionRunner(d: Dependencies) {
  const {state,renderControls,renderStatus,usable,syncRequestCards,recordError,messageOf,toast}=d;
async function action<T>(key: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  if (state.busy.has(key)) return;
  state.busy.add(key); renderControls();
  try { return await fn(); }
  catch (e) {
    if(key.startsWith('request:')){state.busy.delete(key);syncRequestCards({ready:usable(),pending:id=>state.busy.has('request:'+id),controlledThreads:state.status?.controlledThreads});}
    recordError(e,key); toast(messageOf(e),true,11000);
  }
  finally { state.busy.delete(key); if(['connect','disconnect','release'].includes(key))renderStatus();else renderControls(); }
}

return action;
}
