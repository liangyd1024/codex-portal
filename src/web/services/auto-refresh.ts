interface AutoRefreshDependencies {
  hidden: () => boolean;
  usable: () => boolean;
  refreshing: () => boolean;
  pendingModels: () => unknown;
  pendingProjects: () => unknown;
  showRefresh: (scope: string, work: () => Promise<void>) => Promise<void>;
  loadProjects: () => Promise<unknown>;
  loadModels: (force: boolean) => Promise<unknown>;
  checked: (enabled: boolean) => void;
  host: () => string;
  save: (key: string, value: string) => void;
  recordError: (error: unknown, stage: string) => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Preserve catalog polling guards and the per-connection browser preference. */
export function createAutoRefresh(deps: AutoRefreshDependencies) {
  const schedule = deps.schedule ?? ((callback, delay) => setInterval(callback, delay));
  const cancel = deps.cancel ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
  let timer: unknown = null;

  async function refresh() {
    if (deps.hidden() || !deps.usable() || deps.refreshing() || deps.pendingModels() || deps.pendingProjects()) return;
    await deps.showRefresh('项目和模型列表', async () => {
      const results = await Promise.allSettled([deps.loadProjects(), deps.loadModels(true)]);
      const labels = ['项目列表', '模型列表'];
      const failures = results.flatMap((result, index) => result.status === 'rejected'
        ? [labels[index] + '：' + (result.reason?.message || String(result.reason))] : []);
      if (failures.length) throw new Error(failures.join('；'));
    });
  }
  function stop() {
    cancel(timer);
    timer = null;
  }
  function setEnabled(enabled: boolean) {
    stop();
    deps.checked(enabled);
    try { deps.save('rcm.autoRefresh.' + deps.host(), String(enabled)); } catch {}
    if (enabled) timer = schedule(() => {
      refresh().catch(error => deps.recordError(error, 'refresh'));
    }, 30000);
  }
  return {refresh, setEnabled, stop};
}
