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
  const fromEnv = process.env["TYRUM_USER_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".tyrum");
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

const DEFAULT_AGENT_YAML = `model:
  model: openai/gpt-4.1
skills:
  enabled: []
  workspace_trusted: false
mcp:
  enabled: []
tools:
  allow:
    - tool.fs.read
sessions:
  ttl_days: 30
  max_turns: 20
  loop_detection:
    within_turn:
      enabled: true
      consecutive_repeat_limit: 3
      cycle_repeat_limit: 3
    cross_turn:
      enabled: true
      window_assistant_messages: 3
      similarity_threshold: 0.97
      min_chars: 120
      cooldown_assistant_messages: 6
memory:
  markdown_enabled: true
  v1:
    enabled: true
    allow_sensitivities:
      - public
      - private
    structured:
      fact_keys: []
      tags: []
    keyword:
      enabled: true
      limit: 60
    semantic:
      enabled: false
      limit: 20
    budgets:
      max_total_items: 12
      max_total_chars: 2400
      per_kind:
        fact:
          max_items: 6
          max_chars: 800
        note:
          max_items: 4
          max_chars: 1200
        procedure:
          max_items: 3
          max_chars: 1200
        episode:
          max_items: 2
          max_chars: 800
`;

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

  const agentConfigPath = resolveAgentConfigPath(home);
  if (!(await fileExists(agentConfigPath))) {
    await writeFile(agentConfigPath, DEFAULT_AGENT_YAML, "utf-8");
  }

  const identityPath = resolveIdentityPath(home);
  if (!(await fileExists(identityPath))) {
    await writeFile(identityPath, DEFAULT_IDENTITY_MD, "utf-8");
  }

  const coreMemoryPath = join(memoryDir, "MEMORY.md");
  if (!(await fileExists(coreMemoryPath))) {
    await writeFile(coreMemoryPath, DEFAULT_CORE_MEMORY_MD, "utf-8");
  }
}
