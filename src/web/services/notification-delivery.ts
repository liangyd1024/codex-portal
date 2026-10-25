type NativeNotice = Pick<Notification, 'onclose' | 'onclick' | 'close' | 'onshow' | 'onerror'>;
interface Dependencies<W, N extends NativeNotice> {
  host: () => string;
  worker: () => boolean | undefined;
  prepareWorker: () => Promise<W>;
  submitWorker: (registration: W, title: string, options: {body: string; tag: string; data: {host: string; threadId: string | undefined}}, callbacks: {submitted: () => void; failed: (message: string) => void}) => Promise<boolean>;
  createNative: (title: string, options: {body: string; tag: string}) => N;
  submitNative: (create: () => N, callbacks: {shown: () => void; failed: (message: string) => void}) => Promise<boolean>;
  diagnostic: (message: string) => void;
  publish: (view: {status: string}) => void;
  focus: () => void;
  open: (target: {host: string; threadId: string}) => void;
}

export function createNotificationDelivery<W, N extends NativeNotice>(deps: Dependencies<W, N>) {
  let registration: W | undefined;
  const live = new Set<N | undefined>();
  async function prepare() { registration = await deps.prepareWorker(); }
  async function send(title: string, body: string, tag: string, threadId?: string, host = deps.host()): Promise<boolean> {
    if (deps.worker()) {
      try {
        registration ||= await deps.prepareWorker();
        return await deps.submitWorker(registration, title, {body, tag, data: {host, threadId}}, {
          submitted: () => deps.diagnostic(title + '：已提交给系统；是否弹出取决于系统通知设置'),
          failed: message => deps.diagnostic(title + '：' + message),
        });
      } catch (error) { deps.diagnostic(title + '：' + (error as Error).message); return false; }
    }
    deps.diagnostic(title + '：正在提交给浏览器');
    let notification: N | undefined;
    return deps.submitNative(() => {
      const created = deps.createNative(title, {body, tag});
      notification = created;
      live.add(created);
      created.onclose = () => { live.delete(created); deps.diagnostic(title + '：通知已关闭'); };
      created.onclick = () => { deps.focus(); created.close(); if (threadId) deps.open({host, threadId}); };
      return created;
    }, {
      shown: () => deps.diagnostic(title + '：浏览器报告已显示；若系统未弹出，请检查系统的浏览器通知开关'),
      failed: message => { live.delete(notification); deps.diagnostic(title + '：' + message); deps.publish({status: message + '。请检查浏览器和系统的通知设置。'}); },
    });
  }
  return {prepare, send};
}
