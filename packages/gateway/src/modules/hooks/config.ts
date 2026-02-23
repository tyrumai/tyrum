import type { LifecycleHookDefinition as LifecycleHookDefinitionT } from "@tyrum/schemas";
import { LifecycleHooksConfig } from "@tyrum/schemas";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseJsonOrYaml(contents: string, hintPath: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};
  if (hintPath.toLowerCase().endsWith(".json") || trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as unknown;
  }
  return parseYaml(trimmed) as unknown;
}

export async function loadLifecycleHooksFromHome(home: string): Promise<LifecycleHookDefinitionT[]> {
  const candidates = ["hooks.yml", "hooks.yaml", "hooks.json"].map((name) => join(home, name));
  let path: string | undefined;
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      path = candidate;
      break;
    }
  }
  if (!path) return [];

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = parseJsonOrYaml(raw, path);
  } catch {
    return [];
  }

  const cfg = LifecycleHooksConfig.safeParse(parsed);
  if (!cfg.success) return [];
  return cfg.data.hooks;
}

