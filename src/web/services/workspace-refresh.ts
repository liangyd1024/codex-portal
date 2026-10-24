interface WorkspaceRefreshDependencies {
  showRefresh: (scope: string, work: () => Promise<void>) => Promise<void>;
  loadStatus: () => Promise<unknown>;
  connected: () => boolean;
  loadModels: (force: boolean) => Promise<unknown>;
  loadProjects: () => Promise<unknown>;
  loadThreads: (archived: boolean, force: boolean) => Promise<unknown>;
  refreshSelected: () => Promise<unknown>;
  refreshAccountUsage: () => Promise<unknown> | undefined;
}

/** Keep one workspace refresh in flight while its independent reads settle. */
export function createWorkspaceRefresh(deps: WorkspaceRefreshDependencies) {
  let pending: Promise<void> | null = null;
  return async function refreshWorkspace(forceModels = false, statusReady = false): Promise<void> {
    if (pending) return pending;
    pending = deps.showRefresh('工作区', async () => {
      if (!statusReady) await deps.loadStatus();
      if (!deps.connected()) throw new Error('目标机器未连接。请先连接，再刷新。');
      const results = await Promise.allSettled([
        deps.loadModels(forceModels), deps.loadProjects(), deps.loadThreads(false, true),
        deps.refreshSelected(), deps.refreshAccountUsage(),
      ]);
      const labels = ['模型列表', '项目列表', '会话列表', '当前会话', '账号与用量'];
      const failures = results.flatMap((result, index) => result.status === 'rejected'
        ? [labels[index] + '：' + (result.reason.message || String(result.reason))] : []);
      if (failures.length) throw new Error(failures.join('；'));
    });
    try { await pending; }
    finally { pending = null; }
  };
}
