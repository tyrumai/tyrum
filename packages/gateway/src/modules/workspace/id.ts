import { DEFAULT_WORKSPACE_ID, WorkspaceId } from "@tyrum/schemas";

export type { WorkspaceId };
export { DEFAULT_WORKSPACE_ID };

/**
 * Resolve the workspace id for the current process.
 *
 * - Desktop / single-host: defaults to "default".
 * - Split/HA: typically provided by the ToolRunner launcher (job/pod env/args).
 */
export function resolveWorkspaceId(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceId {
  const raw = env["TYRUM_WORKSPACE_ID"]?.trim();
  if (!raw) return WorkspaceId.parse(DEFAULT_WORKSPACE_ID);
  return WorkspaceId.parse(raw);
}

