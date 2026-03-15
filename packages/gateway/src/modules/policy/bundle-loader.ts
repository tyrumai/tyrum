import { readFile } from "node:fs/promises";
import { PolicyBundle } from "@tyrum/schemas";
import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import { isRecord, parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";

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
      allow: [],
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
      // Operators can tighten this by setting deployment config `policy.bundlePath`.
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
