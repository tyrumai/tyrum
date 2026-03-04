import { DEFAULT_WORKSPACE_KEY, WorkspaceKey } from "@tyrum/schemas";

export type { WorkspaceKey };
export { DEFAULT_WORKSPACE_KEY };

/**
 * Resolve the workspace id for the current process.
 *
 * - Desktop / single-host: defaults to "default".
 * - Split/HA: typically provided by the ToolRunner launcher (job/pod env/args).
 */
export function resolveWorkspaceKey(env: NodeJS.ProcessEnv = process.env): WorkspaceKey {
  const raw = env["TYRUM_WORKSPACE_ID"]?.trim();
  if (!raw) return WorkspaceKey.parse(DEFAULT_WORKSPACE_KEY);
  return WorkspaceKey.parse(raw);
}
