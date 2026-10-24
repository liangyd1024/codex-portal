import {publishModelSelect} from './components/ModelSelect';
import {publishRefreshStatus, type RefreshStatusView} from './components/RefreshStatus';
import { flushSync } from 'react-dom';
import type { SelectOption } from '../contracts/view';
import { publishSelectOptions } from './components/SelectOptions';
import { publishDiagnostics, workspaceStore } from './state';
export { publishWorkspace, createWorkspaceState } from './state';
export function renderSelectOptions(select: HTMLSelectElement, options: SelectOption[], value: string): void {
  if (select.id === "model-select" || select.id === "effort-select") {
    publishModelSelect(select.id, {options, value});
    return;
  }
  flushSync(() => publishSelectOptions(select.id,options));
  select.value = value;
}
export function renderDiagnosticsView(view: Parameters<typeof publishDiagnostics>[0]): void {
  const host = document.getElementById('diagnostic-content');
  if (!host) return;
  flushSync(() => publishDiagnostics(view));
}
export function frameworkSnapshot() { return workspaceStore.getState(); }

export function renderRefreshStatusView(view: RefreshStatusView): void {
  flushSync(() => publishRefreshStatus(view));
}
