import { z } from "zod";
import { CapabilityDescriptor } from "./capability.js";
import { NodeId } from "./keys.js";
import { ActionPrimitiveKind } from "./planner.js";

const JsonSchemaObject = z.record(z.string(), z.unknown());

export const CapabilityAvailabilityStatus = z.enum(["unknown", "available", "unavailable"]);
export type CapabilityAvailabilityStatus = z.infer<typeof CapabilityAvailabilityStatus>;

export const SensitiveDataCategory = z.enum(["none", "location", "image", "audio", "screen", "ui"]);
export type SensitiveDataCategory = z.infer<typeof SensitiveDataCategory>;

export const NodeActionConsentMetadata = z
  .object({
    requires_operator_enable: z.boolean(),
    requires_runtime_consent: z.boolean(),
    may_prompt_user: z.boolean(),
    sensitive_data_category: SensitiveDataCategory,
  })
  .strict();
export type NodeActionConsentMetadata = z.infer<typeof NodeActionConsentMetadata>;

export const NodeActionPermissionMetadata = z
  .object({
    secure_context_required: z.boolean().optional(),
    browser_apis: z.array(z.string().trim().min(1)).default([]),
    hardware_may_be_required: z.boolean().optional(),
  })
  .strict();
export type NodeActionPermissionMetadata = z.infer<typeof NodeActionPermissionMetadata>;

export const NodeActionTransportMetadata = z
  .object({
    primitive_kind: ActionPrimitiveKind,
    op_field: z.string().trim().min(1),
    op_value: z.string().trim().min(1),
    result_channel: z.enum(["result", "evidence", "result_or_evidence"]),
    artifactize_binary_fields: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();
export type NodeActionTransportMetadata = z.infer<typeof NodeActionTransportMetadata>;

export const NodeCapabilityActionDefinition = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    supported: z.boolean(),
    enabled: z.boolean(),
    availability_status: CapabilityAvailabilityStatus,
    unavailable_reason: z.string().trim().min(1).optional(),
    input_schema: JsonSchemaObject,
    output_schema: JsonSchemaObject,
    consent: NodeActionConsentMetadata,
    permissions: NodeActionPermissionMetadata,
    transport: NodeActionTransportMetadata,
  })
  .strict();
export type NodeCapabilityActionDefinition = z.infer<typeof NodeCapabilityActionDefinition>;

export const NodeCapabilitySourceOfTruth = z
  .object({
    schema: z.literal("gateway_catalog"),
    state: z.literal("node_capability_state"),
  })
  .strict();
export type NodeCapabilitySourceOfTruth = z.infer<typeof NodeCapabilitySourceOfTruth>;

export const NodeCapabilityInspectionResponse = z
  .object({
    status: z.literal("ok"),
    generated_at: z.string().datetime(),
    node_id: NodeId,
    capability: CapabilityDescriptor.shape.id,
    capability_version: CapabilityDescriptor.shape.version,
    connected: z.boolean(),
    paired: z.boolean(),
    dispatchable: z.boolean(),
    source_of_truth: NodeCapabilitySourceOfTruth,
    actions: z.array(NodeCapabilityActionDefinition),
  })
  .strict();
export type NodeCapabilityInspectionResponse = z.infer<typeof NodeCapabilityInspectionResponse>;

export const NodeCapabilitySummary = z
  .object({
    capability: CapabilityDescriptor.shape.id,
    capability_version: CapabilityDescriptor.shape.version,
    description: z.string().trim().min(1).optional(),
    connected: z.boolean(),
    paired: z.boolean(),
    dispatchable: z.boolean(),
    supported_action_count: z.number().int().nonnegative(),
    enabled_action_count: z.number().int().nonnegative(),
    available_action_count: z.number().int().nonnegative(),
    unknown_action_count: z.number().int().nonnegative(),
  })
  .strict();
export type NodeCapabilitySummary = z.infer<typeof NodeCapabilitySummary>;

export const DispatchErrorCode = z.enum([
  "disabled_by_operator",
  "capability_not_paired",
  "action_not_supported",
  "invalid_input",
  "consent_denied",
  "permission_denied",
  "runtime_unavailable",
  "dispatch_timeout",
  "execution_failed",
]);
export type DispatchErrorCode = z.infer<typeof DispatchErrorCode>;

export const NodeActionDispatchRequest = z
  .object({
    node_id: NodeId,
    capability: CapabilityDescriptor.shape.id,
    action_name: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()).default({}),
    timeout_ms: z.number().int().positive().max(600_000).optional(),
  })
  .strict();
export type NodeActionDispatchRequest = z.infer<typeof NodeActionDispatchRequest>;

export const NodeActionDispatchError = z
  .object({
    code: DispatchErrorCode,
    message: z.string().trim().min(1),
    retryable: z.boolean(),
    details: z
      .object({
        issues: z.array(
          z
            .object({
              path: z.string().trim().min(1),
              message: z.string().trim().min(1),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NodeActionDispatchError = z.infer<typeof NodeActionDispatchError>;

export const NodeActionDispatchResponse = z
  .object({
    status: z.literal("ok"),
    task_id: z.string().trim().min(1),
    run_id: z.string().trim().min(1).optional(),
    node_id: NodeId,
    capability: CapabilityDescriptor.shape.id,
    action_name: z.string().trim().min(1),
    ok: z.boolean(),
    payload_source: z.enum(["result", "evidence", "none"]),
    payload: z.unknown().nullable(),
    error: NodeActionDispatchError.nullable(),
  })
  .strict();
export type NodeActionDispatchResponse = z.infer<typeof NodeActionDispatchResponse>;

export const NodeCapabilityActionState = z
  .object({
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    availability_status: CapabilityAvailabilityStatus,
    unavailable_reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type NodeCapabilityActionState = z.infer<typeof NodeCapabilityActionState>;

export const NodeCapabilityState = z
  .object({
    capability: CapabilityDescriptor,
    actions: z.array(NodeCapabilityActionState).default([]),
  })
  .strict();
export type NodeCapabilityState = z.infer<typeof NodeCapabilityState>;
