interface NotificationView {disabled: boolean; checked: boolean; testDisabled: boolean; status: string}
interface Dependencies {
  host: () => string;
  support: () => {supported: boolean; message?: string; worker?: boolean};
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  prepareWorker: () => Promise<unknown>;
  read: (key: string) => string | null;
  save: (key: string, value: string) => void;
  publish: (view: Partial<NotificationView>) => void;
  recordError: (error: unknown, stage: string) => void;
}

export function createNotificationPreference(deps: Dependencies) {
  let enabled = false, pending = false;
  function render() {
    const {supported, message} = deps.support();
    const checked = enabled && supported && deps.permission() === 'granted';
    deps.publish({disabled: !supported || pending, checked, testDisabled: !checked,
      status: (!supported ? message : deps.permission() === 'denied'
        ? '通知已被阻止。请在浏览器网站设置中允许通知。'
        : checked ? '已开启。页面保持打开时提醒新发生的任务完成和待处理事项；不补发历史通知。' : '通知未开启') || '—'});
  }
  function sync() {
    try { enabled = deps.read('rcm.taskNotifications.' + deps.host()) === 'true'; } catch {}
    render();
  }
  async function setEnabled(value: boolean) {
    if (pending) return;
    const host = deps.host();
    pending = true;
    deps.publish({disabled: true, status: value ? '正在申请通知权限…' : '正在关闭通知…'});
    let failure: string | undefined;
    try {
      if (value && !deps.support().supported) throw Error(deps.support().message);
      // Keep the permission call in the synchronous user-gesture portion.
      if (value && deps.permission() === 'default') await deps.requestPermission();
      const allowed = value && deps.permission() === 'granted';
      if (allowed && deps.support().worker) await deps.prepareWorker();
      if (host !== deps.host()) return;
      enabled = allowed;
      deps.save('rcm.taskNotifications.' + host, String(allowed));
    } catch (error) {
      failure = (error as Error).message;
      deps.recordError(error, 'notifications');
    } finally {
      pending = false;
      if (host === deps.host()) {
        render();
        if (failure) deps.publish({status: '通知未开启：' + failure + '。请重试。'});
      }
    }
  }
  return {enabled: () => enabled, render, sync, setEnabled};
}
