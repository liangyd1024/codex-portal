interface Dependencies {
  state: {streamRender: boolean; selectedId: string | null};
  defer: (run: () => void, delay: number) => number;
  cancel: (timer: number | undefined) => void;
  usable: () => boolean;
  renderMessages: () => void;
  renderRequests: () => void;
  renderControls: () => void;
  refreshSelected: () => Promise<unknown>;
  refreshList: () => void;
  report: (error: unknown) => void;
}
export function createUpdateScheduler(d: Dependencies) {
  let fullRender = false;
  let detailTimer: number | undefined, listTimer: number | undefined;
  return {
    stream(kind = 'all') {
      if (kind !== 'text') fullRender = true;
      if (d.state.streamRender) return;
      d.state.streamRender = true;
      d.defer(() => {
        d.state.streamRender = false;
        const full = fullRender;
        fullRender = false;
        d.renderMessages();
        if (full) { d.renderRequests(); d.renderControls(); }
      }, 80);
    },
    detail() {
      if (detailTimer) return;
      detailTimer = d.defer(() => {
        detailTimer = undefined;
        if (d.usable() && d.state.selectedId) d.refreshSelected().catch(d.report);
      }, 650);
    },
    list() {
      d.cancel(listTimer);
      listTimer = d.defer(() => { if (d.usable()) d.refreshList(); }, 1000);
    },
  };
}
