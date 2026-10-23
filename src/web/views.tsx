import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { SelectOption } from '../contracts/view';
import { Diagnostics } from './components/Diagnostics';
import { publishDiagnostics, workspaceStore } from './state';
export { publishWorkspace, createWorkspaceState } from './state';
const roots = new WeakMap<Element, Root>();
function rootFor(node: Element): Root {
  let root = roots.get(node);
  if (!root) { root = createRoot(node); roots.set(node, root); }
  return root;
}
export function renderSelectOptions(select: HTMLSelectElement, options: SelectOption[], value: string): void {
  flushSync(() => rootFor(select).render(<>{options.map(option => <option key={option.value} value={option.value} title={option.title || undefined}>{option.label}</option>)}</>));
  select.value = value;
}
export function renderDiagnosticsView(view: Parameters<typeof publishDiagnostics>[0]): void {
  const host = document.getElementById('diagnostic-content');
  if (!host) return;
  flushSync(() => { publishDiagnostics(view); rootFor(host).render(<Diagnostics/>); });
}
export function frameworkSnapshot() { return workspaceStore.getState(); }
