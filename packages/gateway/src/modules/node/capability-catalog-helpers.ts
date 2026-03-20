import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  type CapabilityDescriptor,
  type NodeActionConsentMetadata,
  type NodeActionPermissionMetadata,
  type NodeActionTransportMetadata,
} from "@tyrum/contracts";
import type { ZodType } from "zod";

export type CatalogAction = {
  name: string;
  description: string;
  inputParser: ZodType;
  outputParser: ZodType;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  consent: NodeActionConsentMetadata;
  permissions: NodeActionPermissionMetadata;
  transport: NodeActionTransportMetadata;
};

export type CapabilityCatalogEntry = {
  descriptor: CapabilityDescriptor;
  actions: readonly CatalogAction[];
};

type JsonSchemaConvertible = {
  toJSONSchema?: (opts?: { io?: "input" | "output" }) => unknown;
};

type PassthroughSchema = {
  passthrough?: () => ZodType;
};

export function jsonSchemaOf(schema: unknown, io: "input" | "output"): Record<string, unknown> {
  const candidate = schema as JsonSchemaConvertible;
  const json = candidate.toJSONSchema?.({ io });
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { type: "object", additionalProperties: false };
  }
  return json as Record<string, unknown>;
}

/**
 * Wraps a .strict() Zod object schema with .passthrough() so the transport
 * `op` field injected by the gateway dispatch is not rejected during parsing.
 * The JSON Schema output still uses the original strict shape (no `op` field).
 */
export function passthroughParser(schema: unknown): ZodType {
  const candidate = schema as PassthroughSchema;
  return typeof candidate.passthrough === "function"
    ? candidate.passthrough()
    : (schema as ZodType);
}

export function desktopAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  resultChannel: NodeActionTransportMetadata["result_channel"] = "result_or_evidence",
): CatalogAction {
  return {
    name,
    description,
    inputParser: inputSchema as ZodType,
    outputParser: outputSchema as ZodType,
    inputSchema: jsonSchemaOf(inputSchema, "input"),
    outputSchema: jsonSchemaOf(outputSchema, "output"),
    consent: {
      requires_operator_enable: false,
      requires_runtime_consent: false,
      may_prompt_user: false,
      sensitive_data_category: name === "screenshot" || name === "snapshot" ? "screen" : "ui",
    },
    permissions: {
      secure_context_required: false,
      browser_apis: [],
      hardware_may_be_required: false,
    },
    transport: {
      primitive_kind: "Desktop",
      op_field: "op",
      op_value: name,
      result_channel: resultChannel,
      artifactize_binary_fields: ["bytesBase64"],
    },
  };
}

export function crossPlatformSensorAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  sensitiveDataCategory: "location" | "image" | "audio",
  permissions: NodeActionPermissionMetadata,
): CatalogAction {
  return {
    name,
    description,
    inputParser: passthroughParser(inputSchema),
    outputParser: outputSchema as ZodType,
    inputSchema: jsonSchemaOf(inputSchema, "input"),
    outputSchema: jsonSchemaOf(outputSchema, "output"),
    consent: {
      requires_operator_enable: true,
      requires_runtime_consent: true,
      may_prompt_user: true,
      sensitive_data_category: sensitiveDataCategory,
    },
    permissions,
    transport: {
      primitive_kind: null,
      op_field: "op",
      op_value: name,
      result_channel: "evidence",
      artifactize_binary_fields: sensitiveDataCategory === "location" ? [] : ["bytesBase64"],
    },
  };
}

export function browserAutomationAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  resultChannel: NodeActionTransportMetadata["result_channel"] = "result_or_evidence",
): CatalogAction {
  return {
    name,
    description,
    inputParser: passthroughParser(inputSchema),
    outputParser: outputSchema as ZodType,
    inputSchema: jsonSchemaOf(inputSchema, "input"),
    outputSchema: jsonSchemaOf(outputSchema, "output"),
    consent: {
      requires_operator_enable: true,
      requires_runtime_consent: false,
      may_prompt_user: false,
      sensitive_data_category: "none",
    },
    permissions: {
      secure_context_required: false,
      browser_apis: [],
      hardware_may_be_required: false,
    },
    transport: {
      primitive_kind: "Web",
      op_field: "op",
      op_value: name,
      result_channel: resultChannel,
      artifactize_binary_fields: resultChannel === "result" ? [] : ["bytesBase64"],
    },
  };
}

export function filesystemAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  isStateChanging: boolean,
): CatalogAction {
  return {
    name,
    description,
    inputParser: passthroughParser(inputSchema),
    outputParser: outputSchema as ZodType,
    inputSchema: jsonSchemaOf(inputSchema, "input"),
    outputSchema: jsonSchemaOf(outputSchema, "output"),
    consent: {
      requires_operator_enable: false,
      requires_runtime_consent: false,
      may_prompt_user: false,
      sensitive_data_category: isStateChanging ? "filesystem" : "none",
    },
    permissions: {
      secure_context_required: false,
      browser_apis: [],
      hardware_may_be_required: false,
    },
    transport: {
      primitive_kind: "Filesystem",
      op_field: "op",
      op_value: name,
      result_channel: "result",
      artifactize_binary_fields: [],
    },
  };
}

export function createEntry(descriptorId: string, action: CatalogAction): CapabilityCatalogEntry {
  return {
    descriptor: {
      id: descriptorId,
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    },
    actions: [action],
  };
}

export function ba(
  id: string,
  name: string,
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
): CapabilityCatalogEntry {
  return createEntry(id, browserAutomationAction(name, description, inputSchema, outputSchema));
}

export function fa(
  id: string,
  name: string,
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  isStateChanging: boolean,
): CapabilityCatalogEntry {
  return createEntry(
    id,
    filesystemAction(name, description, inputSchema, outputSchema, isStateChanging),
  );
}
