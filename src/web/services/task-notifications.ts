export interface NoticeParams {
  threadId?: string;
  thread?: {id?: string; [key: string]: unknown};
  params?: {threadId?: string; [key: string]: unknown};
  request?: {params?: {threadId?: string; [key: string]: unknown}; [key: string]: unknown};
  [key: string]: unknown;
}
interface Notice {key: string; label: string}
interface NotificationDependencies<T> {
  enabled: () => boolean;
  permitted: () => boolean;
  host: () => string;
  thread: (id: string | undefined) => T | null | undefined;
  known: (id: string | undefined) => boolean | undefined;
  alias: () => string | undefined;
  threadName: (thread: T) => string;
  notice: (method: string, params: NoticeParams, context: {host: string; known: boolean | undefined}) => Notice | null;
  lock: (key: string, work: () => Promise<boolean>) => Promise<boolean>;
  preference: (key: string) => string | null;
  deliver: (key: string, send: () => boolean | Promise<boolean>) => Promise<boolean>;
  send: (title: string, body: string, tag: string, threadId: string | undefined, host: string) => Promise<boolean>;
  acknowledge: (key: string) => Promise<unknown>;
  diagnostic: (message: string) => void;
  recordError: (error: unknown, stage: string) => void;
}

/** Original notification claim protocol; failed attempts are not repeated in this page. */
export function createTaskNotifications<T>(deps: NotificationDependencies<T>) {
  const attempted = new Set<string>();
  return async function notify(method: string, params: NoticeParams): Promise<boolean | undefined> {
    if (!deps.enabled() || !deps.permitted()) return;
    const host = deps.host();
    const threadId = params.threadId || params.thread?.id || (params.request || params).params?.threadId;
    const thread = deps.thread(threadId);
    const notice = deps.notice(method, params, {host, known: !!thread || deps.known(threadId)});
    if (!notice) return;
    const body = (deps.alias() || host) + ' · ' + (thread ? deps.threadName(thread) : '会话 ' + threadId!.slice(0, 8));
    try {
      const delivered = await deps.lock('rcm.task-notifications', async () => {
        if (host !== deps.host() || deps.preference('rcm.taskNotifications.' + host) !== 'true') return false;
        return deps.deliver(notice.key, () => {
          if (attempted.has(notice.key)) return false;
          attempted.add(notice.key);
          if (attempted.size > 1000) attempted.delete(attempted.values().next().value!);
          return deps.send('Codex · ' + notice.label, body, notice.key, threadId, host);
        });
      });
      if (delivered && host === deps.host()) await deps.acknowledge(notice.key);
      return delivered;
    } catch (error) {
      deps.diagnostic('通知处理失败：' + (error as Error).message);
      deps.recordError(error, 'notifications');
      return false;
    }
  };
}
