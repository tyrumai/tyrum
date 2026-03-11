import {
  CapabilityDescriptor,
  DateTimeSchema,
  NodeActionDispatchRequest as NodeActionDispatchRequestSchema,
  NodeActionDispatchResponse as NodeActionDispatchResponseSchema,
  NodeCapabilityInspectionResponse as NodeCapabilityInspectionResponseSchema,
  NodeInventoryResponse as NodeInventoryResponseSchema,
  NodePairingRequest,
  NodePairingStatus,
  NodePairingTrustLevel,
  PresenceEntry,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const ActiveModelStatus = z
  .object({
    model_id: z.string().trim().min(1).nullable(),
    provider: z.string().trim().min(1).nullable(),
    model: z.string().trim().min(1).nullable(),
    fallback_models: z.array(z.string().trim().min(1)),
  })
  .strict();

const AuthProfilesStatus = z
  .object({
    enabled: z.boolean(),
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    cooldown_active: z.number().int().nonnegative(),
    oauth_expired: z.number().int().nonnegative(),
    oauth_expiring_within_24h: z.number().int().nonnegative(),
    providers: z.array(z.string().trim().min(1)),
    disabled_reasons: z.array(
      z
        .object({
          reason: z.string().trim().min(1),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    selected: z
      .object({
        agent_id: z.string().trim().min(1),
        session_id: z.string().trim().min(1),
        provider: z.string().trim().min(1),
        profile_id: z.string().trim().min(1),
        updated_at: DateTimeSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

const ConfigHealthIssue = z
  .object({
    code: z.string().trim().min(1),
    severity: z.enum(["warning", "error"]),
    message: z.string().trim().min(1),
    target: z
      .object({
        kind: z.enum(["deployment", "execution_profile", "agent"]),
        id: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

const ConfigHealthStatus = z
  .object({
    status: z.enum(["ok", "issues"]),
    issues: z.array(ConfigHealthIssue),
  })
  .strict();

const StatusResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string().trim().min(1),
    instance_id: z.string().trim().min(1),
    role: z.string().trim().min(1),
    db_kind: z.string().trim().min(1),
    is_exposed: z.boolean(),
    otel_enabled: z.boolean(),
    ws: z.unknown().nullable(),
    policy: z.unknown().nullable(),
    model_auth: z
      .object({
        active_model: ActiveModelStatus.nullable(),
        auth_profiles: AuthProfilesStatus.nullable(),
      })
      .strict()
      .nullable(),
    catalog_freshness: z.unknown().nullable(),
    session_lanes: z.unknown().nullable(),
    queue_depth: z.unknown().nullable(),
    sandbox: z.unknown().nullable(),
    config_health: ConfigHealthStatus,
  })
  .passthrough();

const UsageQuery = z
  .object({
    run_id: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1).optional(),
    agent_key: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const filled = [value.run_id, value.key, value.agent_key].filter(
      (entry): entry is string => entry !== undefined,
    );
    if (filled.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "usage scoping params are mutually exclusive",
        path: ["run_id"],
      });
    }
  });

const UsageResponse = z
  .object({
    status: z.literal("ok"),
    generated_at: DateTimeSchema,
    scope: z
      .object({
        kind: z.enum(["run", "session", "agent", "deployment"]),
        run_id: z.string().trim().min(1).nullable(),
        key: z.string().trim().min(1).nullable(),
        agent_key: z.string().trim().min(1).nullable(),
      })
      .strict(),
    local: z
      .object({
        attempts: z
          .object({
            total_with_cost: z.number().int().nonnegative(),
            parsed: z.number().int().nonnegative(),
            invalid: z.number().int().nonnegative(),
          })
          .strict(),
        totals: z
          .object({
            duration_ms: z.number().nonnegative(),
            input_tokens: z.number().nonnegative(),
            output_tokens: z.number().nonnegative(),
            total_tokens: z.number().nonnegative(),
            usd_micros: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    provider: z.unknown().nullable(),
  })
  .strict();

const PresenceEntryHttp = PresenceEntry.extend({
  connected_at: DateTimeSchema.optional(),
  expires_at: DateTimeSchema.optional(),
});

const PresenceResponse = z
  .object({
    status: z.literal("ok"),
    generated_at: DateTimeSchema,
    entries: z.array(PresenceEntryHttp),
  })
  .strict();

const PairingsListQuery = z
  .object({
    status: NodePairingStatus.optional(),
  })
  .strict();

const PairingIdParam = z.number().int().positive();

const PairingListResponse = z
  .object({
    status: z.literal("ok"),
    pairings: z.array(NodePairingRequest),
  })
  .strict();

const PairingMutateResponse = z
  .object({
    status: z.literal("ok"),
    pairing: NodePairingRequest,
  })
  .strict();

const PairingApproveRequest = z
  .object({
    trust_level: NodePairingTrustLevel,
    capability_allowlist: z.array(CapabilityDescriptor),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const PairingDenyOrRevokeRequest = z
  .object({
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export type StatusResponse = z.infer<typeof StatusResponse>;
export type UsageResponse = z.infer<typeof UsageResponse>;
export type PresenceResponse = z.infer<typeof PresenceResponse>;
export type NodeInventoryResponse = z.infer<typeof NodeInventoryResponseSchema>;
export type NodeCapabilityInspectionResponse = z.infer<
  typeof NodeCapabilityInspectionResponseSchema
>;
export type NodeActionDispatchResponse = z.infer<typeof NodeActionDispatchResponseSchema>;
export type PairingListResponse = z.infer<typeof PairingListResponse>;
export type PairingMutateResponse = z.infer<typeof PairingMutateResponse>;

export interface StatusApi {
  get(options?: TyrumRequestOptions): Promise<StatusResponse>;
}

export interface UsageApi {
  get(query?: z.input<typeof UsageQuery>, options?: TyrumRequestOptions): Promise<UsageResponse>;
}

export interface PresenceApi {
  list(options?: TyrumRequestOptions): Promise<PresenceResponse>;
}

const NodesListQuery = z
  .object({
    capability: z.string().trim().min(1).optional(),
    dispatchable_only: z.boolean().optional(),
    key: z.string().trim().min(1).optional(),
    lane: z.string().trim().min(1).optional(),
  })
  .strict();

const NodesInspectQuery = z
  .object({
    include_disabled: z.boolean().optional(),
  })
  .strict();

export interface NodesApi {
  list(
    query?: z.input<typeof NodesListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<NodeInventoryResponse>;
  inspect(
    nodeId: string,
    capabilityId: string,
    query?: z.input<typeof NodesInspectQuery>,
    options?: TyrumRequestOptions,
  ): Promise<NodeCapabilityInspectionResponse>;
  dispatch(
    nodeId: string,
    capabilityId: string,
    actionName: string,
    input?: Omit<
      z.input<typeof NodeActionDispatchRequestSchema>,
      "node_id" | "capability" | "action_name"
    >,
    options?: TyrumRequestOptions,
  ): Promise<NodeActionDispatchResponse>;
}

export interface PairingsApi {
  list(
    query?: z.input<typeof PairingsListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<PairingListResponse>;
  approve(
    pairingId: number,
    input: z.input<typeof PairingApproveRequest>,
    options?: TyrumRequestOptions,
  ): Promise<PairingMutateResponse>;
  deny(
    pairingId: number,
    input?: z.input<typeof PairingDenyOrRevokeRequest>,
    options?: TyrumRequestOptions,
  ): Promise<PairingMutateResponse>;
  revoke(
    pairingId: number,
    input?: z.input<typeof PairingDenyOrRevokeRequest>,
    options?: TyrumRequestOptions,
  ): Promise<PairingMutateResponse>;
}

export function createStatusApi(transport: HttpTransport): StatusApi {
  return {
    async get(options) {
      return await transport.request({
        method: "GET",
        path: "/status",
        response: StatusResponse,
        signal: options?.signal,
      });
    },
  };
}

export function createUsageApi(transport: HttpTransport): UsageApi {
  return {
    async get(query, options) {
      const parsedQuery = validateOrThrow(UsageQuery, query ?? {}, "usage query");
      return await transport.request({
        method: "GET",
        path: "/usage",
        query: parsedQuery,
        response: UsageResponse,
        signal: options?.signal,
      });
    },
  };
}

export function createPresenceApi(transport: HttpTransport): PresenceApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/presence",
        response: PresenceResponse,
        signal: options?.signal,
      });
    },
  };
}

export function createNodesApi(transport: HttpTransport): NodesApi {
  return {
    async list(query, options) {
      const parsedQuery = validateOrThrow(NodesListQuery, query ?? {}, "nodes list query");
      return await transport.request({
        method: "GET",
        path: "/nodes",
        query: parsedQuery,
        response: NodeInventoryResponseSchema,
        signal: options?.signal,
      });
    },
    async inspect(nodeId, capabilityId, query, options) {
      const parsedQuery = validateOrThrow(NodesInspectQuery, query ?? {}, "nodes inspect query");
      return await transport.request({
        method: "GET",
        path: `/nodes/${encodeURIComponent(nodeId)}/capabilities/${encodeURIComponent(capabilityId)}`,
        query: parsedQuery,
        response: NodeCapabilityInspectionResponseSchema,
        signal: options?.signal,
      });
    },
    async dispatch(nodeId, capabilityId, actionName, input, options) {
      const parsedInput = validateOrThrow(
        NodeActionDispatchRequestSchema,
        input
          ? {
              ...input,
              node_id: nodeId,
              capability: capabilityId,
              action_name: actionName,
            }
          : {
              node_id: nodeId,
              capability: capabilityId,
              action_name: actionName,
            },
        "nodes dispatch input",
      );
      return await transport.request({
        method: "POST",
        path: `/nodes/${encodeURIComponent(nodeId)}/capabilities/${encodeURIComponent(capabilityId)}/actions/${encodeURIComponent(actionName)}/dispatch`,
        body: {
          input: parsedInput.input,
          ...(parsedInput.timeout_ms !== undefined ? { timeout_ms: parsedInput.timeout_ms } : {}),
        },
        response: NodeActionDispatchResponseSchema,
        signal: options?.signal,
      });
    },
  };
}

function pairingPath(action: "approve" | "deny" | "revoke", pairingId: number): string {
  const parsedPairingId = validateOrThrow(PairingIdParam, pairingId, "pairing id");
  return `/pairings/${String(parsedPairingId)}/${action}`;
}

export function createPairingsApi(transport: HttpTransport): PairingsApi {
  return {
    async list(query, options) {
      const parsedQuery = validateOrThrow(PairingsListQuery, query ?? {}, "pairings list query");
      return await transport.request({
        method: "GET",
        path: "/pairings",
        query: parsedQuery,
        response: PairingListResponse,
        signal: options?.signal,
      });
    },

    async approve(pairingId, input, options) {
      const body = validateOrThrow(PairingApproveRequest, input, "pairing approve request");
      return await transport.request({
        method: "POST",
        path: pairingPath("approve", pairingId),
        body,
        response: PairingMutateResponse,
        signal: options?.signal,
      });
    },

    async deny(pairingId, input, options) {
      const body = validateOrThrow(PairingDenyOrRevokeRequest, input ?? {}, "pairing deny request");
      return await transport.request({
        method: "POST",
        path: pairingPath("deny", pairingId),
        body,
        response: PairingMutateResponse,
        signal: options?.signal,
      });
    },

    async revoke(pairingId, input, options) {
      const body = validateOrThrow(
        PairingDenyOrRevokeRequest,
        input ?? {},
        "pairing revoke request",
      );
      return await transport.request({
        method: "POST",
        path: pairingPath("revoke", pairingId),
        body,
        response: PairingMutateResponse,
        signal: options?.signal,
      });
    },
  };
}
