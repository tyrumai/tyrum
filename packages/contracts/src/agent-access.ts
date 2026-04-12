import { z } from "zod";
import { canonicalizeToolIdList } from "./tool-id.js";

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeLegacySkillConfig(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed) return value;

  if (
    "enabled" in parsed &&
    !("default_mode" in parsed) &&
    !("allow" in parsed) &&
    !("deny" in parsed)
  ) {
    return {
      ...parsed,
      default_mode: "deny",
      allow: parsed["enabled"],
      deny: [],
      workspace_trusted: parsed["workspace_trusted"] ?? false,
    };
  }

  return value;
}

function normalizeLegacyMcpConfig(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed) return value;

  if (
    "enabled" in parsed &&
    !("default_mode" in parsed) &&
    !("allow" in parsed) &&
    !("deny" in parsed)
  ) {
    return {
      ...parsed,
      default_mode: "deny",
      allow: parsed["enabled"],
      deny: [],
    };
  }

  return value;
}

function normalizeLegacyToolConfig(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed) return value;

  if ("allow" in parsed && !("default_mode" in parsed) && !("deny" in parsed)) {
    const rawAllow = Array.isArray(parsed["allow"]) ? parsed["allow"] : [];
    const allowAll = canonicalizeToolIdList(
      rawAllow.filter((entry): entry is string => typeof entry === "string"),
    ).includes("*");
    return {
      ...parsed,
      default_mode: allowAll ? "allow" : "deny",
      allow: allowAll ? [] : parsed["allow"],
      deny: [],
    };
  }

  return value;
}

export const AgentAccessDefaultMode = z.enum(["allow", "deny"]);
export type AgentAccessDefaultMode = z.infer<typeof AgentAccessDefaultMode>;

export const AgentToolExposureBundle = z.string().trim().min(1);
export type AgentToolExposureBundle = z.infer<typeof AgentToolExposureBundle>;

export const AgentToolExposureTier = z.enum(["default", "advanced"]);
export type AgentToolExposureTier = z.infer<typeof AgentToolExposureTier>;

function uniqueStringList(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function assertNoAccessOverlap(
  value: { allow: readonly string[]; deny: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  const denied = new Set(value.deny);

  for (const id of value.allow) {
    if (!denied.has(id)) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deny"],
      message: `id '${id}' cannot appear in both allow and deny`,
    });
  }
}

export const AgentSkillConfig = z.preprocess(
  normalizeLegacySkillConfig,
  z
    .object({
      default_mode: AgentAccessDefaultMode.default("allow"),
      allow: z.array(z.string().trim().min(1)).default([]).overwrite(uniqueStringList),
      deny: z.array(z.string().trim().min(1)).default([]).overwrite(uniqueStringList),
      workspace_trusted: z.boolean().default(true),
    })
    .superRefine(assertNoAccessOverlap),
);
export type AgentSkillConfig = z.infer<typeof AgentSkillConfig>;

export const AgentMcpConfig = z.preprocess(
  normalizeLegacyMcpConfig,
  z
    .object({
      bundle: AgentToolExposureBundle.optional(),
      tier: AgentToolExposureTier.optional(),
      default_mode: AgentAccessDefaultMode.default("allow"),
      allow: z.array(z.string().trim().min(1)).default([]).overwrite(uniqueStringList),
      deny: z.array(z.string().trim().min(1)).default([]).overwrite(uniqueStringList),
      pre_turn_tools: z
        .array(z.string().trim().min(1))
        .default([])
        .overwrite(canonicalizeToolIdList),
      server_settings: z
        .record(z.string().trim().min(1), z.record(z.string(), z.unknown()))
        .default({}),
    })
    .superRefine(assertNoAccessOverlap),
);
export type AgentMcpConfig = z.infer<typeof AgentMcpConfig>;

export const AgentToolConfig = z.preprocess(
  normalizeLegacyToolConfig,
  z
    .object({
      bundle: AgentToolExposureBundle.optional(),
      tier: AgentToolExposureTier.optional(),
      default_mode: AgentAccessDefaultMode.default("allow"),
      allow: z.array(z.string().trim().min(1)).default([]).overwrite(canonicalizeToolIdList),
      deny: z.array(z.string().trim().min(1)).default([]).overwrite(canonicalizeToolIdList),
    })
    .superRefine(assertNoAccessOverlap),
);
export type AgentToolConfig = z.infer<typeof AgentToolConfig>;
