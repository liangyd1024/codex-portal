export interface Request {
  key?: string; id?: unknown; kind?: string; threadId?: string;
  params?: {threadId?: string; turnId?: unknown; itemId?: unknown; [key: string]: unknown};
  [key: string]: unknown;
}
interface Dependencies {
  state: {selectedId: string | null; localRequests: Request[]; status?: {instanceId?: unknown; pendingRequests?: Request[]} | null; detail?: {pendingRequests?: Request[]} | null};
  action: (key: string, run: () => Promise<void>) => Promise<unknown>;
  api: (path: string, options: {method: string; body: Record<string, unknown>}) => Promise<unknown>;
  questionDrafts: {clear: (request: Request) => void; set: (request: Request, value: {sent: boolean}) => void};
  document: Document;
  element: (id: 'message-input') => HTMLTextAreaElement;
  sideChat: () => {id?: string} | null | undefined;
  renderRequests: () => void;
  loadStatus: () => Promise<unknown>;
}
export function requestKey(r: Request) { return r.key ?? (typeof r.id + ':' + String(r.id)); }
export function requestPath(r: Request) { return String(r.key ?? r.id); }
export function createRequestResponder(d: Dependencies) {
  const {state,action,api,questionDrafts,document,sideChat,renderRequests,loadStatus,element:$}=d;
  const requestThread=(r: Request)=>r.threadId || r.params?.threadId;
async function respondRequest(r: Request, answer: Record<string, unknown>) {
  await action('request:' + requestPath(r), async () => {
    const instance=state.status?.instanceId,returnFocus=document.activeElement?.closest<HTMLElement>('.request-card')?.dataset.requestId===requestPath(r);
    if(r.kind==='asyncQuestion')await api('/api/threads/'+encodeURIComponent(r.threadId!)+'/question-answer',{method:'POST',body:{...answer,turnId:r.params!.turnId,itemId:r.params!.itemId}});
    else await api('/api/requests/' + encodeURIComponent(requestPath(r)) + '/respond',{method:'POST',body:answer});
    questionDrafts.clear(r);if(r.kind==='asyncQuestion')questionDrafts.set(r,{sent:true});
    if(instance!==state.status?.instanceId)return;
    const remove = (list: Request[] | undefined) => (list || []).filter(x => requestKey(x) !== requestKey(r));
    state.localRequests = remove(state.localRequests); if (state.status) state.status.pendingRequests = remove(state.status.pendingRequests); if (state.detail) state.detail.pendingRequests = remove(state.detail.pendingRequests);
    renderRequests();if(returnFocus){if(state.selectedId===requestThread(r))$('message-input').focus();else if(sideChat()?.id===requestThread(r))document.querySelector<HTMLTextAreaElement>('.side-chat-panel .composer textarea')?.focus();}await loadStatus();
  });
}
return respondRequest;
}
