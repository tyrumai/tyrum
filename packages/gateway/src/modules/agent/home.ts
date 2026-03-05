import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, access, writeFile } from "node:fs/promises";
import { constants, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Logger } from "../observability/logger.js";

const logger = new Logger({ base: { module: "agent.home" } });

function fileExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

export function resolveTyrumHome(): string {
  const fromEnv = process.env["TYRUM_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".tyrum");
}

export function resolveUserTyrumHome(): string {
  return resolveTyrumHome();
}

export function resolveAgentConfigPath(home = resolveTyrumHome()): string {
  return join(home, "agent.yml");
}

export function resolveIdentityPath(home = resolveTyrumHome()): string {
  return join(home, "IDENTITY.md");
}

export function resolveSkillsDir(home = resolveTyrumHome()): string {
  return join(home, "skills");
}

export function resolveUserSkillsDir(userHome = resolveUserTyrumHome()): string {
  return join(userHome, "skills");
}

export function resolveBundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolveBundledSkillsDirFrom(here);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code?: unknown }).code === "ENOENT" ||
        (err as { code?: unknown }).code === "ENOTDIR")
    ) {
      return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("agent.home.directory_check_failed", { candidate_path: path, error: message });
    return false;
  }
}

export function resolveBundledSkillsDirFrom(startDir: string): string {
  // We cannot rely on the source tree depth because tsdown bundles the gateway
  // into `dist/index.mjs`, making `import.meta.url` point at `dist/`.
  //
  // Instead, walk up until we find a `skills/` directory.
  let current = startDir;
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(current, "skills");
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fallback to the historical source layout.
  return join(startDir, "../../../skills");
}

export function resolveMcpDir(home = resolveTyrumHome()): string {
  return join(home, "mcp");
}

export function resolveMemoryDir(home = resolveTyrumHome()): string {
  return join(home, "memory");
}

const DEFAULT_IDENTITY_MD = `---
name: Tyrum
description: Local single-user assistant identity.
style:
  tone: direct
  verbosity: concise
---
You are Tyrum.

Respond directly, be explicit about assumptions, and preserve safety guardrails.
`;

const DEFAULT_CORE_MEMORY_MD = `# MEMORY

## Learned Preferences

`;

export async function ensureWorkspaceInitialized(home = resolveTyrumHome()): Promise<void> {
  const skillsDir = resolveSkillsDir(home);
  const mcpDir = resolveMcpDir(home);
  const memoryDir = resolveMemoryDir(home);

  await mkdir(home, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(mcpDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  const identityPath = resolveIdentityPath(home);
  if (!(await fileExists(identityPath))) {
    await writeFile(identityPath, DEFAULT_IDENTITY_MD, "utf-8");
  }

  const coreMemoryPath = join(memoryDir, "MEMORY.md");
  if (!(await fileExists(coreMemoryPath))) {
    await writeFile(coreMemoryPath, DEFAULT_CORE_MEMORY_MD, "utf-8");
  }
}
