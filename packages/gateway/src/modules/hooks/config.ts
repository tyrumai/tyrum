import type { LifecycleHookDefinition as LifecycleHookDefinitionT } from "@tyrum/schemas";
import { LifecycleHooksConfig } from "@tyrum/schemas";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
