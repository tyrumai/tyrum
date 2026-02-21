import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { PolicyBundle } from "@tyrum/schemas";
import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonOrYaml(contents: string, hintPath?: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};

  const isJson = hintPath?.toLowerCase().endsWith(".json") ?? trimmed.startsWith("{");
  if (isJson) {
    return JSON.parse(trimmed) as unknown;
  }

  return parseYaml(trimmed) as unknown;
}

export async function loadPolicyBundleFromFile(path: string): Promise<PolicyBundleT> {
  const raw = await readFile(path, "utf-8");
  const parsed = parseJsonOrYaml(raw, path);
  if (!isRecord(parsed)) {
    return PolicyBundle.parse({ v: 1 });
  }
  return PolicyBundle.parse(parsed);
}

/**
 * Conservative local-first default bundle that preserves existing runtime
 * behavior (tool allowlist still applies separately).
 */
export function defaultPolicyBundle(): PolicyBundleT {
  return PolicyBundle.parse({
    v: 1,
    tools: {
      default: "require_approval",
      allow: ["tool.fs.read"],
      require_approval: [],
      deny: [],
    },
    network_egress: {
      default: "require_approval",
      allow: [],
      require_approval: [],
      deny: [],
    },
    secrets: {
      default: "require_approval",
      allow: [],
      require_approval: [],
      deny: [],
    },
    connectors: {
      default: "require_approval",
      // Default: allow Telegram sends to preserve existing single-user behavior.
      // Operators can tighten this by supplying `TYRUM_POLICY_BUNDLE_PATH`.
      allow: ["telegram:*"],
      require_approval: [],
      deny: [],
    },
    artifacts: {
      default: "allow",
    },
    provenance: {
      untrusted_shell_requires_approval: true,
    },
  });
}
