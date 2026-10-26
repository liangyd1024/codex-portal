import type {CapturedAttachments} from './attachments';
interface State {
  selectedId: string | null;
  selectionVersion: number;
  busy: Set<string>;
  detail: {desktop?: {canSend?: boolean}} | null;
}
interface Dependencies<Annotation, Draft extends {text: string}> {
  state: State;
  input: () => Pick<HTMLTextAreaElement, 'value'>;
  captureAnnotation: () => Annotation;
  annotatedText: (text: string, annotation: Annotation) => string;
  acknowledgeAnnotation: (annotation: Annotation) => void;
  hasAttachments: () => boolean | undefined;
  attachmentsPending: () => boolean | undefined;
  captureAttachments: () => CapturedAttachments;
  acknowledgeAttachments: (pictures: CapturedAttachments) => void;
  options: () => {skills: unknown[]; plugins: unknown[]; threads: unknown[]};
  captureDraft: (id: string, text: string) => Draft;
  acknowledgeDraft: (draft: Draft) => boolean;
  sends: Record<string, {messageId: string; text: string; pictures?:{id:string|null;items:{id:string}[]}} | undefined>;
  saveSends: () => void;
  uuid: () => string;
  action: (key: string, run: () => Promise<void>) => Promise<unknown>;
  post: (path: string, body: {messageId: string; text: string; threads: unknown[]; images:{url:string}[];skills:unknown[];plugins:unknown[]}) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  resize: () => void;
  toast: (message: string, error: boolean) => void;
}

export function createDesktopSend<Annotation, Draft extends {text: string}>(d: Dependencies<Annotation, Draft>) {
  const {state, sends} = d;
  return async function sendDesktopMessage() {
    const annotation = d.captureAnnotation();
    // Availability is established by the selected detail, as in the original controller.
    const id = state.selectedId!, selection = state.selectionVersion;
    const text = d.annotatedText(d.input().value.trim(), annotation);
    if ((!text&&!d.hasAttachments()) || d.attachmentsPending() || state.busy.has('message') || !state.detail?.desktop?.canSend) return;
    if (sends[id]) return;
    const options = d.options();
    const sent = d.captureDraft(id, d.input().value), pictures=d.captureAttachments(), messageId = d.uuid();
    sends[id] = {messageId, text: sent.text, ...(pictures.items.length?{pictures:{id:pictures.id,items:pictures.items.map(({id})=>({id}))}}:{})}; d.saveSends();
    await d.action('message', async () => {
      try {
        await d.post('/api/desktop/threads/' + encodeURIComponent(id) + '/message', {messageId, text, threads: options.threads,images:pictures.items.map(({url})=>({url})),skills:options.skills,plugins:options.plugins});
        d.acknowledgeAnnotation(annotation);
        d.acknowledgeAttachments(pictures);
        delete sends[id]; d.saveSends();
        const cleared = d.acknowledgeDraft(sent);
        if (id === state.selectedId && selection === state.selectionVersion && cleared && d.input().value === sent.text) { d.input().value = ''; d.resize(); }
      } catch (caught) {
        const error = caught as {status?: number; code?: string};
        if (error.status! >= 400 && error.status! < 500 && error.code !== 'OUTCOME_UNKNOWN' && error.code !== 'SEND_PENDING') { delete sends[id]; d.saveSends(); }
        throw caught;
      } finally {
        if (id === state.selectedId && selection === state.selectionVersion) await d.refresh();
      }
    });
  };
}
