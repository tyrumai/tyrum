import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId, WorkspaceId } from "./keys.js";
import { Decision } from "./policy.js";
import { Sha256Hex } from "./artifact.js";

// ---------------------------------------------------------------------------
// PolicyBundle (versioned, declarative)
// ---------------------------------------------------------------------------

export const ArtifactSensitivity = z.enum(["normal", "sensitive"]);
export type ArtifactSensitivity = z.infer<typeof ArtifactSensitivity>;

const ArtifactSensitivityNumberMap = z
  .object({
    normal: z.number().int().positive().optional(),
    sensitive: z.number().int().positive().optional(),
  })
  .strict();

const ArtifactRetentionPolicy = z
  .object({
    /**
     * Default retention applied when no more-specific rule matches.
     */
    default_days: z.number().int().positive().optional(),
    /**
     * Retention by label (examples: `log`, `screenshot`, `http_trace`).
     */
    by_label: z.record(z.string(), z.number().int().positive()).optional(),
    /**
     * Retention by sensitivity class.
     */
    by_sensitivity: ArtifactSensitivityNumberMap.optional(),
    /**
     * Retention by label + sensitivity class.
     */
    by_label_sensitivity: z.record(z.string(), ArtifactSensitivityNumberMap).optional(),
  })
  .strict();

const ArtifactQuotaPolicy = z
  .object({
    /**
     * Default quota applied when no more-specific rule matches.
     * Units are bytes.
     */
    default_max_bytes: z.number().int().positive().optional(),
    /**
     * Quota by label (examples: `log`, `screenshot`, `http_trace`).
     * Units are bytes.
     */
    by_label: z.record(z.string(), z.number().int().positive()).optional(),
    /**
     * Quota by sensitivity class.
     * Units are bytes.
     */
    by_sensitivity: ArtifactSensitivityNumberMap.optional(),
    /**
     * Quota by label + sensitivity class.
     * Units are bytes.
     */
    by_label_sensitivity: z.record(z.string(), ArtifactSensitivityNumberMap).optional(),
  })
  .strict();

export const PolicyBundleV1 = z
  .object({
    v: z.literal(1),

    tools: z
      .object({
        default: Decision.default("deny"),
        allow: z.array(z.string().trim().min(1)).default([]),
        require_approval: z.array(z.string().trim().min(1)).default([]),
        deny: z.array(z.string().trim().min(1)).default([]),
      })
      .strict()
      .optional(),

    network_egress: z
      .object({
        default: Decision.default("deny"),
        allow: z.array(z.string().trim().min(1)).default([]),
        require_approval: z.array(z.string().trim().min(1)).default([]),
        deny: z.array(z.string().trim().min(1)).default([]),
      })
      .strict()
      .optional(),

    secrets: z
      .object({
        default: Decision.default("deny"),
        allow: z.array(z.string().trim().min(1)).default([]),
        require_approval: z.array(z.string().trim().min(1)).default([]),
        deny: z.array(z.string().trim().min(1)).default([]),
      })
      .strict()
      .optional(),

    connectors: z
      .object({
        default: Decision.default("deny"),
        allow: z.array(z.string().trim().min(1)).default([]),
        require_approval: z.array(z.string().trim().min(1)).default([]),
        deny: z.array(z.string().trim().min(1)).default([]),
      })
      .strict()
      .optional(),

    artifacts: z
      .object({
        default: Decision.default("allow"),
        retention: ArtifactRetentionPolicy.optional(),
        quota: ArtifactQuotaPolicy.optional(),
      })
      .strict()
      .optional(),

    provenance: z
      .object({
        /**
         * Minimal initial provenance rule: treat untrusted sources as data,
         * and (optionally) require approvals for shell-like tools when the
         * origin is untrusted.
         */
        untrusted_shell_requires_approval: z.boolean().default(true),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PolicyBundleV1 = z.infer<typeof PolicyBundleV1>;

export const PolicyBundle = PolicyBundleV1;
export type PolicyBundle = z.infer<typeof PolicyBundle>;

// ---------------------------------------------------------------------------
// Policy snapshots (durable references)
// ---------------------------------------------------------------------------

export const PolicySnapshotId = UuidSchema;
export type PolicySnapshotId = z.infer<typeof PolicySnapshotId>;

export const PolicySnapshot = z
  .object({
    policy_snapshot_id: PolicySnapshotId,
    sha256: Sha256Hex,
    created_at: DateTimeSchema,
    bundle: PolicyBundle,
  })
  .strict();
export type PolicySnapshot = z.infer<typeof PolicySnapshot>;

// ---------------------------------------------------------------------------
// Policy overrides (“approve always”)
// ---------------------------------------------------------------------------

export const PolicyOverrideStatus = z.enum(["active", "revoked", "expired"]);
export type PolicyOverrideStatus = z.infer<typeof PolicyOverrideStatus>;

export const PolicyOverrideId = UuidSchema;
export type PolicyOverrideId = z.infer<typeof PolicyOverrideId>;

export const PolicyOverride = z
  .object({
    policy_override_id: PolicyOverrideId,
    status: PolicyOverrideStatus,
    created_at: DateTimeSchema,
    created_by: z.unknown().optional(),

    agent_id: AgentId,
    workspace_id: WorkspaceId.optional(),

    tool_id: z.string().trim().min(1),
    pattern: z.string().trim().min(1),

    created_from_approval_id: UuidSchema.optional(),
    created_from_policy_snapshot_id: PolicySnapshotId.optional(),

    expires_at: DateTimeSchema.nullable().optional(),

    revoked_at: DateTimeSchema.nullable().optional(),
    revoked_by: z.unknown().optional(),
    revoked_reason: z.string().optional(),
  })
  .strict();
export type PolicyOverride = z.infer<typeof PolicyOverride>;

export const PolicyOverrideListRequest = z
  .object({
    agent_id: AgentId.optional(),
    tool_id: z.string().trim().min(1).optional(),
    status: PolicyOverrideStatus.optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type PolicyOverrideListRequest = z.infer<typeof PolicyOverrideListRequest>;

export const PolicyOverrideListResponse = z
  .object({
    overrides: z.array(PolicyOverride),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type PolicyOverrideListResponse = z.infer<typeof PolicyOverrideListResponse>;

export const PolicyOverrideRevokeRequest = z
  .object({
    policy_override_id: PolicyOverrideId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type PolicyOverrideRevokeRequest = z.infer<typeof PolicyOverrideRevokeRequest>;

export const PolicyOverrideRevokeResponse = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type PolicyOverrideRevokeResponse = z.infer<typeof PolicyOverrideRevokeResponse>;

export const PolicyOverrideCreateRequest = z
  .object({
    agent_id: AgentId,
    workspace_id: WorkspaceId.optional(),
    tool_id: z.string().trim().min(1),
    pattern: z.string().trim().min(1),
    created_by: z.unknown().optional(),
    created_from_approval_id: UuidSchema.optional(),
    created_from_policy_snapshot_id: PolicySnapshotId.optional(),
    expires_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type PolicyOverrideCreateRequest = z.infer<typeof PolicyOverrideCreateRequest>;

export const PolicyOverrideCreateResponse = z
  .object({
    override: PolicyOverride,
  })
  .strict();
export type PolicyOverrideCreateResponse = z.infer<typeof PolicyOverrideCreateResponse>;
