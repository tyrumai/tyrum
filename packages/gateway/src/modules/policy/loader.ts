/**
 * Policy bundle file loader — reads YAML or JSON policy bundles
 * from disk and validates them against the PolicyBundle schema.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { PolicyBundle as PolicyBundleSchema } from "@tyrum/schemas";
import type { PolicyBundleConfig } from "./bundle.js";

export function loadPolicyBundle(filePath: string): PolicyBundleConfig {
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;

  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    parsed = parseYaml(raw) as unknown;
  } else {
    parsed = JSON.parse(raw) as unknown;
  }

  const result = PolicyBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid policy bundle at ${filePath}: ${result.error.message}`,
    );
  }

  return result.data;
}
