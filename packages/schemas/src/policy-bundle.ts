import { z } from "zod";
import { ProvenanceTag } from "./provenance.js";

export const PolicyEffect = z.enum(["allow", "deny", "require_approval"]);
export type PolicyEffect = z.infer<typeof PolicyEffect>;

export const PolicyRuleList = z
  .object({
    /**
     * Optional allowlist. When empty, does not restrict by allowlist.
     * When non-empty, a value must match at least one entry to be considered.
     */
    allow: z.array(z.string().trim().min(1)).default([]),
    /** Denylist patterns; if any entry matches, the decision is `deny`. */
    deny: z.array(z.string().trim().min(1)).default([]),
    /** Require-approval patterns; if any entry matches, the decision is `require_approval`. */
    require_approval: z.array(z.string().trim().min(1)).default([]),
    /** Default effect when no explicit rule matches. */
    default: PolicyEffect.default("allow"),
  })
  .strict();
export type PolicyRuleList = z.infer<typeof PolicyRuleList>;

export const PolicyNetworkEgress = z
  .object({
    /** Explicit allowlist for outbound network destinations (hostname patterns). */
    allow_hosts: z.array(z.string().trim().min(1)).default([]),
    /** Explicit denylist for outbound network destinations (hostname patterns). */
    deny_hosts: z.array(z.string().trim().min(1)).default([]),
    /** Destinations requiring approval when contacted (hostname patterns). */
    require_approval_hosts: z.array(z.string().trim().min(1)).default([]),
    /** Default effect for non-matching hosts. */
    default: PolicyEffect.default("require_approval"),
  })
  .strict();
export type PolicyNetworkEgress = z.infer<typeof PolicyNetworkEgress>;

export const PolicySecretResolution = z
  .object({
    /** Explicit allowlist for secret handle ids (glob patterns). */
    allow: z.array(z.string().trim().min(1)).default([]),
    /** Explicit denylist for secret handle ids (glob patterns). */
    deny: z.array(z.string().trim().min(1)).default([]),
    /** Secret handle ids requiring approval to resolve (glob patterns). */
    require_approval: z.array(z.string().trim().min(1)).default([]),
    /** Default effect for non-matching handles. */
    default: PolicyEffect.default("require_approval"),
  })
  .strict();
export type PolicySecretResolution = z.infer<typeof PolicySecretResolution>;

export const PolicyProvenanceRule = z
  .object({
    /** Provenance sources that trigger this rule. */
    sources: z.array(ProvenanceTag).min(1),
    /** Tool policy overrides applied when sources match. */
    tools: PolicyRuleList.optional(),
    /** Action policy overrides applied when sources match. */
    actions: PolicyRuleList.optional(),
  })
  .strict();
export type PolicyProvenanceRule = z.infer<typeof PolicyProvenanceRule>;

export const PolicyProvenanceConfig = z
  .object({
    rules: z.array(PolicyProvenanceRule).default([]),
  })
  .strict();
export type PolicyProvenanceConfig = z.infer<typeof PolicyProvenanceConfig>;

/**
 * Policy bundle (v1).
 *
 * Declarative, versioned configuration stored as data (YAML/JSON) and validated
 * at trust boundaries.
 */
export const PolicyBundle = z
  .object({
    version: z.literal(1),

    /** Tool policy (gateway tool ids like `tool.exec`, `tool.http.fetch`, `mcp.*`). */
    tools: PolicyRuleList.default({
      allow: [],
      deny: [],
      require_approval: [],
      default: "allow",
    }),

    /** Action policy (execution primitives like `Http`, `CLI`, `Desktop`, ...). */
    actions: PolicyRuleList.default({
      allow: [],
      deny: [],
      require_approval: [],
      default: "allow",
    }),

    network: z
      .object({
        egress: PolicyNetworkEgress.default({
          allow_hosts: [],
          deny_hosts: [],
          require_approval_hosts: [],
          default: "require_approval",
        }),
      })
      .strict()
      .default({
        egress: {
          allow_hosts: [],
          deny_hosts: [],
          require_approval_hosts: [],
          default: "require_approval",
        },
      }),

    secrets: z
      .object({
        resolve: PolicySecretResolution.default({
          allow: [],
          deny: [],
          require_approval: [],
          default: "require_approval",
        }),
      })
      .strict()
      .default({
        resolve: {
          allow: [],
          deny: [],
          require_approval: [],
          default: "require_approval",
        },
      }),

    provenance: PolicyProvenanceConfig.default({ rules: [] }),
  })
  .strict();
export type PolicyBundle = z.infer<typeof PolicyBundle>;
