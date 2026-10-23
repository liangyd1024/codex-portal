/** Presentation projections only. Native data remains authoritative and lossless. */
export type NativeRecord = Record<string, unknown>;
export interface DiagnosticEntry { title: string; messages: string[]; error?: boolean }
export interface DiagnosticsView { selectedId: string | null; entries: DiagnosticEntry[] }
export interface SelectOption { value: string; label: string; title?: string }
export interface WorkspaceIdentity { selectedId: string | null; desktopMode: boolean; transport: boolean }
export interface WorkspaceProjection extends WorkspaceIdentity {
  revision: number;
  diagnostics: DiagnosticsView;
}
