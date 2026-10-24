interface CatalogState<M, P> {
  models: M[];
  projects: P[];
  projectId: string | null;
  loadingModels: boolean;
  loadingProjects: boolean;
}
interface CatalogDependencies<M, P> {
  state: CatalogState<M, P>;
  version: () => number;
  modelId: (model: M) => string | undefined;
  readModels: (path: string) => Promise<{data?: M[]; nextCursor?: string | null}>;
  readProjects: () => Promise<{data?: P[]}>;
  renderModels: () => void;
  renderProjects: () => void;
}

/** One request per catalog. Account events drain the exposed pending snapshots
 * before starting a new generation; native records are retained without mapping. */
export function createCatalogReaders<M extends {hidden?: unknown}, P extends {id?: string}>(
  {state, version, modelId, readModels, readProjects, renderModels, renderProjects}: CatalogDependencies<M, P>,
) {
  let modelsPending: Promise<void> | null = null;
  let projectsPending: Promise<void> | null = null;
  async function loadModels(force = false): Promise<void> {
    if (modelsPending) return modelsPending;
    const generation = version();
    state.loadingModels = true; renderModels();
    modelsPending = (async () => {
      const all: M[] = []; let cursor: string | null | undefined = null;
      do {
        const data = await readModels('/api/models' + (force ? '?refresh=1' : '') +
          (cursor ? (force ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor) : ''));
        all.push(...(data.data || [])); cursor = data.nextCursor;
      } while (cursor);
      if (generation !== version()) return;
      const seen = new Set<string>();
      state.models = all.filter(model => {
        const id = modelId(model);
        if (!id || model.hidden || seen.has(id)) return false;
        seen.add(id); return true;
      });
    })();
    try { await modelsPending; }
    finally { modelsPending = null; state.loadingModels = false; renderModels(); }
  }
  async function loadProjects(): Promise<void> {
    if (projectsPending) return projectsPending;
    const generation = version();
    state.loadingProjects = true; renderProjects();
    projectsPending = (async () => {
      const data = await readProjects();
      if (generation !== version()) return;
      state.projects = data.data || [];
      if (state.projectId && !state.projects.some(project => project.id === state.projectId)) state.projectId = null;
    })();
    try { await projectsPending; }
    finally { projectsPending = null; state.loadingProjects = false; renderProjects(); }
  }
  return {loadModels, loadProjects, pendingModels: () => modelsPending, pendingProjects: () => projectsPending};
}
