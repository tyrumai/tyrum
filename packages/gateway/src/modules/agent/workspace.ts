import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillManifest, McpServerSpec } from "@tyrum/schemas";
import type {
  AgentConfig as AgentConfigT,
  SkillProvenanceSource as SkillProvenanceSourceT,
  SkillManifest as SkillManifestT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import {
  resolveSkillsDir,
  resolveUserSkillsDir,
  resolveBundledSkillsDir,
  resolveMcpDir,
} from "./home.js";
import { parseFrontmatterDocument } from "./frontmatter.js";
import type { Logger } from "../observability/logger.js";

export type SkillProvenanceSource = SkillProvenanceSourceT | "shared";
export type SkillProvenance = { source: SkillProvenanceSource; path: string };
export type LoadedSkillManifest = SkillManifestT & { provenance: SkillProvenance };

function readYamlObject(contents: string): Record<string, unknown> {
  const parsed = parseYaml(contents);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export async function loadSkillFromDir(
  skillsDir: string,
  skillId: string,
  source: SkillProvenanceSource,
  logger?: Logger,
): Promise<LoadedSkillManifest | undefined> {
  const skillPath = join(skillsDir, skillId, "SKILL.md");
  try {
    const contents = await readFile(skillPath, "utf-8");
    const parsed = parseFrontmatterDocument(contents);
    const manifest = SkillManifest.parse({
      meta: parsed.frontmatter,
      body: parsed.body.trim(),
    });
    return {
      ...manifest,
      provenance: {
        source,
        path: skillPath,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn("agent.skill_load_failed", { skill_id: skillId, path: skillPath, error: message });
    return undefined;
  }
}

export async function loadEnabledSkills(
  home: string,
  config: AgentConfigT,
  opts?: { logger?: Logger; userSkillsDir?: string; bundledSkillsDir?: string },
): Promise<LoadedSkillManifest[]> {
  const loaded: LoadedSkillManifest[] = [];

  const userSkillsDir = opts?.userSkillsDir ?? resolveUserSkillsDir();
  const bundledSkillsDir = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
  const workspaceSkillsDir = resolveSkillsDir(home);
  const workspaceTrusted = config.skills.workspace_trusted === true;

  for (const skillId of config.skills.enabled) {
    const manifest =
      (workspaceTrusted
        ? await loadSkillFromDir(workspaceSkillsDir, skillId, "workspace", opts?.logger)
        : undefined) ??
      (await loadSkillFromDir(userSkillsDir, skillId, "user", opts?.logger)) ??
      (await loadSkillFromDir(bundledSkillsDir, skillId, "bundled", opts?.logger));
    if (manifest) {
      loaded.push(manifest);
    }
  }

  return loaded;
}

async function loadMcpServerFromDir(
  mcpDir: string,
  serverId: string,
  logger?: Logger,
): Promise<McpServerSpecT | undefined> {
  const serverDir = join(mcpDir, serverId);
  const serverPath = join(serverDir, "server.yml");
  try {
    const contents = await readFile(serverPath, "utf-8");
    const parsed = readYamlObject(contents);
    let spec = McpServerSpec.parse(parsed);

    // Keep IDs consistent with the directory/config key.
    if (spec.id !== serverId) {
      spec = { ...spec, id: serverId };
    }

    // Make relative commands/args behave predictably by defaulting cwd to the install dir.
    if (spec.transport === "stdio") {
      if (!spec.cwd) {
        spec = { ...spec, cwd: serverDir };
      } else if (!isAbsolute(spec.cwd)) {
        spec = { ...spec, cwd: join(serverDir, spec.cwd) };
      }
    }

    return spec;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn("mcp.server_spec_load_failed", {
      server_id: serverId,
      path: serverPath,
      error: message,
    });
    return undefined;
  }
}

export async function loadEnabledMcpServers(
  home: string,
  config: AgentConfigT,
  opts?: { logger?: Logger },
): Promise<McpServerSpecT[]> {
  const mcpDir = resolveMcpDir(home);
  const loaded: McpServerSpecT[] = [];

  for (const serverId of config.mcp.enabled) {
    const spec = await loadMcpServerFromDir(mcpDir, serverId, opts?.logger);
    if (spec) {
      loaded.push(spec);
    }
  }

  return loaded;
}
