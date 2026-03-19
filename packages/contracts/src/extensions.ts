import { z } from "zod";
import { McpServerSpec, SkillManifest } from "./agent.js";

export const ExtensionKind = z.enum(["skill", "mcp"]);
export type ExtensionKind = z.infer<typeof ExtensionKind>;

export const ExtensionSourceType = z.enum([
  "builtin",
  "bundled",
  "user",
  "local",
  "managed",
  "shared",
]);
export type ExtensionSourceType = z.infer<typeof ExtensionSourceType>;

export const ExtensionAccessDefault = z.enum(["inherit", "allow", "deny"]);
export type ExtensionAccessDefault = z.infer<typeof ExtensionAccessDefault>;

export const ManagedBundleFile = z
  .object({
    path: z.string().trim().min(1),
    content_base64: z.string().trim().min(1),
  })
  .strict();
export type ManagedBundleFile = z.infer<typeof ManagedBundleFile>;

export const ManagedSkillSource = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("direct-url"),
      url: z.string().trim().url(),
      filename: z.string().trim().min(1).optional(),
      content_type: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      filename: z.string().trim().min(1).optional(),
      content_type: z.string().trim().min(1).optional(),
    })
    .strict(),
]);
export type ManagedSkillSource = z.infer<typeof ManagedSkillSource>;

export const ManagedMcpSource = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("direct-url"),
      url: z.string().trim().url(),
      mode: z.enum(["remote", "archive"]),
      filename: z.string().trim().min(1).optional(),
      content_type: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("npm"),
      npm_spec: z.string().trim().min(1),
      command: z.string().trim().min(1).default("npx"),
      args: z.array(z.string()).default(["-y"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      filename: z.string().trim().min(1).optional(),
      content_type: z.string().trim().min(1).optional(),
    })
    .strict(),
]);
export type ManagedMcpSource = z.infer<typeof ManagedMcpSource>;

export const ManagedSkillPackage = z
  .object({
    format: z.literal("agent-skill-bundle"),
    key: z.string().trim().min(1),
    manifest: SkillManifest,
    files: z.array(ManagedBundleFile).min(1),
    source: ManagedSkillSource,
  })
  .strict();
export type ManagedSkillPackage = z.infer<typeof ManagedSkillPackage>;

export const ManagedMcpPackage = z
  .object({
    format: z.literal("mcp-package"),
    key: z.string().trim().min(1),
    spec: McpServerSpec,
    files: z.array(ManagedBundleFile).default([]),
    source: ManagedMcpSource,
  })
  .strict();
export type ManagedMcpPackage = z.infer<typeof ManagedMcpPackage>;

export const ManagedExtensionRevision = z
  .object({
    revision: z.number().int().positive(),
    enabled: z.boolean(),
    created_at: z.string().trim().min(1),
    reason: z.string().trim().min(1).nullable(),
    reverted_from_revision: z.number().int().positive().nullable(),
  })
  .strict();
export type ManagedExtensionRevision = z.infer<typeof ManagedExtensionRevision>;

export const ManagedExtensionSourceDescriptor = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("direct-url"),
      url: z.string().trim().url(),
      mode: z.enum(["remote", "archive"]).optional(),
      filename: z.string().trim().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("npm"),
      npm_spec: z.string().trim().min(1),
      command: z.string().trim().min(1),
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      filename: z.string().trim().min(1).nullable(),
    })
    .strict(),
]);
export type ManagedExtensionSourceDescriptor = z.infer<typeof ManagedExtensionSourceDescriptor>;

export const ExtensionDiscoveredSource = z
  .object({
    source_type: ExtensionSourceType,
    is_effective: z.boolean(),
    enabled: z.boolean(),
    revision: z.number().int().positive().nullable(),
    refreshable: z.boolean(),
    materialized_path: z.string().trim().min(1).nullable(),
    transport: z.enum(["stdio", "remote"]).nullable(),
    version: z.string().trim().min(1).nullable(),
    description: z.string().trim().min(1).nullable(),
    source: ManagedExtensionSourceDescriptor.nullable(),
  })
  .strict();
export type ExtensionDiscoveredSource = z.infer<typeof ExtensionDiscoveredSource>;

export const ManagedExtensionSummary = z
  .object({
    kind: ExtensionKind,
    key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
    version: z.string().trim().min(1).nullable(),
    enabled: z.boolean(),
    revision: z.number().int().positive().nullable(),
    source: ManagedExtensionSourceDescriptor.nullable(),
    source_type: ExtensionSourceType,
    refreshable: z.boolean(),
    materialized_path: z.string().trim().min(1).nullable(),
    assignment_count: z.number().int().min(0),
    transport: z.enum(["stdio", "remote"]).nullable(),
    default_access: ExtensionAccessDefault,
    can_edit_settings: z.boolean(),
    can_toggle_source_enabled: z.boolean(),
    can_refresh_source: z.boolean(),
    can_revert_source: z.boolean(),
  })
  .strict();
export type ManagedExtensionSummary = z.infer<typeof ManagedExtensionSummary>;

export const ManagedExtensionDetail = ManagedExtensionSummary.extend({
  manifest: SkillManifest.nullable(),
  spec: McpServerSpec.nullable(),
  files: z.array(z.string().trim().min(1)),
  revisions: z.array(ManagedExtensionRevision),
  default_mcp_server_settings_json: z.record(z.string(), z.unknown()).nullable(),
  default_mcp_server_settings_yaml: z.string().trim().min(1).nullable(),
  sources: z.array(ExtensionDiscoveredSource),
}).strict();
export type ManagedExtensionDetail = z.infer<typeof ManagedExtensionDetail>;

export const ExtensionsListResponse = z
  .object({
    items: z.array(ManagedExtensionSummary),
  })
  .strict();
export type ExtensionsListResponse = z.infer<typeof ExtensionsListResponse>;

export const ExtensionsDetailResponse = z
  .object({
    item: ManagedExtensionDetail,
  })
  .strict();
export type ExtensionsDetailResponse = z.infer<typeof ExtensionsDetailResponse>;

export const ExtensionsMutateResponse = z
  .object({
    item: ManagedExtensionDetail,
  })
  .strict();
export type ExtensionsMutateResponse = z.infer<typeof ExtensionsMutateResponse>;
