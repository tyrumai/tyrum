import { DEFAULT_WORKSPACE_KEY, WorkspaceKey } from "@tyrum/schemas";

export type { WorkspaceKey };
export { DEFAULT_WORKSPACE_KEY };

/**
 * Resolve the workspace id for the current process.
 *
 * - Desktop / single-host: defaults to "default".
 * - Split/HA: typically provided by the caller (CLI args / payload).
 */
export function resolveWorkspaceKey(raw?: string): WorkspaceKey {
  const trimmed = raw?.trim();
  if (!trimmed) return WorkspaceKey.parse(DEFAULT_WORKSPACE_KEY);
  return WorkspaceKey.parse(trimmed);
}
