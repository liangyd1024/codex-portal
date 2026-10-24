interface SidebarLoaderDependencies {
  key: (append: boolean) => string;
  read: (append: boolean) => Promise<void>;
}

interface PendingRead {
  key: string;
  promise: Promise<void>;
}

/** Preserve the controller's single active slot, not a cache of all requests.
 * Applying results and rejecting stale snapshots remain the reader's job. */
export function createSidebarLoader({key, read}: SidebarLoaderDependencies) {
  let active: PendingRead | null = null;
  function load(append = false, reportFailure = false, fresh = false): Promise<void> {
    const currentKey = key(append);
    if (active?.key === currentKey) {
      // Evaluate the key again after waiting: selection or search may change.
      if (fresh) return active.promise.catch(() => {}).then(() => load(append, reportFailure));
      return reportFailure ? active.promise : active.promise.catch(() => {});
    }
    const record: PendingRead = {
      key: currentKey,
      promise: read(append).finally(() => {
        if (active === record) active = null;
      }),
    };
    active = record;
    return reportFailure ? record.promise : record.promise.catch(() => {});
  }
  // Account changes drain the currently active read before rebuilding catalogs.
  // Return its snapshot, not a promise that starts another request.
  return Object.assign(load, {pending: (): Promise<void> | undefined => active?.promise});
}
