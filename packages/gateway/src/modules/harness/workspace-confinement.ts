import { isAbsolute, relative, resolve } from "node:path";

/**
 * Workspace confinement for harness tool calls.
 *
 * The native tool path confines every filesystem argument to the agent home in
 * `ToolExecutor.assertSandboxed`, which throws `path escapes workspace: <path>`
 * before the tool runs. A harness executes its own tools, so nothing on that
 * path can throw for us: the ask channel is the only place Tyrum still sees the
 * arguments, and it must apply the same invariant or a flagged conversation
 * would be able to read and write outside the workspace when an unflagged one
 * cannot.
 *
 * Confinement is not expressible as a policy pattern — `canonicalizeToolMatchTarget`
 * collapses an escaping path to the empty string, so `read:` alone cannot tell
 * "no path" from "a path outside the workspace". It is therefore checked here,
 * against the raw argument, rather than in policy.
 */
export function pathEscapesWorkspace(input: { path: string; workspaceRoot?: string }): boolean {
  const raw = input.path.trim();
  if (raw.length === 0) return false;

  const root = input.workspaceRoot?.trim();
  // Fails closed: with no root there is nothing to prove confinement against.
  if (!root) return true;

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, raw);
  const rel = relative(resolvedRoot, resolvedPath);
  // Identical to `ToolExecutor.assertSandboxed`, deliberately: the two paths
  // must accept and reject exactly the same arguments.
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}
