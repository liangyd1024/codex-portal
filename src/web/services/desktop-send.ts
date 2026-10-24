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
  options: () => {skills: unknown[]; plugins: unknown[]; threads: unknown[]};
  captureDraft: (id: string, text: string) => Draft;
  acknowledgeDraft: (draft: Draft) => boolean;
  sends: Record<string, {messageId: string; text: string} | undefined>;
  saveSends: () => void;
  uuid: () => string;
  action: (key: string, run: () => Promise<void>) => Promise<unknown>;
  post: (path: string, body: {messageId: string; text: string; threads: unknown[]}) => Promise<unknown>;
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
    if (!text || state.busy.has('message') || !state.detail?.desktop?.canSend) return;
    if (sends[id]) return;
    if (d.hasAttachments()) { d.toast('桌面入口暂不支持草稿中的图片，请返回网页入口处理图片后再发送。', true); return; }
    const options = d.options();
    if (options.skills.length || options.plugins.length) { d.toast('桌面入口暂不支持草稿中的技能或插件引用，请删除后再发送。', true); return; }
    const sent = d.captureDraft(id, d.input().value), messageId = d.uuid();
    sends[id] = {messageId, text: sent.text}; d.saveSends();
    await d.action('message', async () => {
      try {
        await d.post('/api/desktop/threads/' + encodeURIComponent(id) + '/message', {messageId, text, threads: options.threads});
        d.acknowledgeAnnotation(annotation);
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
