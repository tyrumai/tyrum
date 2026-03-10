import {
  BrowserCameraCapturePhotoArgs,
  BrowserCameraCapturePhotoResult,
  BrowserGeolocationGetArgs,
  BrowserGeolocationGetResult,
  BrowserMicrophoneRecordArgs,
  BrowserMicrophoneRecordResult,
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  DesktopActArgs,
  DesktopActResult,
  DesktopKeyboardArgs,
  DesktopMouseArgs,
  DesktopQueryArgs,
  DesktopQueryResult,
  DesktopScreenshotArgs,
  DesktopSnapshotArgs,
  DesktopSnapshotResult,
  DesktopWaitForArgs,
  DesktopWaitForResult,
  type CapabilityDescriptor,
  type NodeActionConsentMetadata,
  type NodeActionPermissionMetadata,
  type NodeActionTransportMetadata,
} from "@tyrum/schemas";
import type { ZodType } from "zod";
import { z } from "zod";

type CatalogAction = {
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

function jsonSchemaOf(schema: unknown, io: "input" | "output"): Record<string, unknown> {
  const candidate = schema as {
    toJSONSchema?: (opts?: { io?: "input" | "output" }) => unknown;
  };
  const json = candidate.toJSONSchema?.({ io });
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { type: "object", additionalProperties: false };
  }
  return json as Record<string, unknown>;
}

function browserAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  consent: NodeActionConsentMetadata,
  permissions: NodeActionPermissionMetadata,
): CatalogAction {
  return {
    name,
    description,
    inputParser: inputSchema as ZodType,
    outputParser: outputSchema as ZodType,
    inputSchema: jsonSchemaOf(inputSchema, "input"),
    outputSchema: jsonSchemaOf(outputSchema, "output"),
    consent,
    permissions,
    transport: {
      primitive_kind: "Browser",
      op_field: "op",
      op_value: name,
      result_channel: "evidence",
      artifactize_binary_fields: ["bytesBase64"],
    },
  };
}

function desktopAction(
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

const BROWSER_CATALOG: CapabilityCatalogEntry = {
  descriptor: {
    id: "tyrum.browser",
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  },
  actions: [
    browserAction(
      "geolocation.get",
      "Read the browser geolocation position.",
      BrowserGeolocationGetArgs,
      BrowserGeolocationGetResult,
      {
        requires_operator_enable: true,
        requires_runtime_consent: true,
        may_prompt_user: true,
        sensitive_data_category: "location",
      },
      {
        secure_context_required: true,
        browser_apis: ["navigator.geolocation"],
        hardware_may_be_required: false,
      },
    ),
    browserAction(
      "camera.capture_photo",
      "Capture a still photo from the browser camera.",
      BrowserCameraCapturePhotoArgs,
      BrowserCameraCapturePhotoResult,
      {
        requires_operator_enable: true,
        requires_runtime_consent: true,
        may_prompt_user: true,
        sensitive_data_category: "image",
      },
      {
        secure_context_required: true,
        browser_apis: ["mediaDevices.getUserMedia"],
        hardware_may_be_required: true,
      },
    ),
    browserAction(
      "microphone.record",
      "Record audio from the browser microphone.",
      BrowserMicrophoneRecordArgs,
      BrowserMicrophoneRecordResult,
      {
        requires_operator_enable: true,
        requires_runtime_consent: true,
        may_prompt_user: true,
        sensitive_data_category: "audio",
      },
      {
        secure_context_required: true,
        browser_apis: ["mediaDevices.getUserMedia", "MediaRecorder"],
        hardware_may_be_required: true,
      },
    ),
  ],
};

const DESKTOP_CATALOG: CapabilityCatalogEntry = {
  descriptor: {
    id: "tyrum.desktop",
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  },
  actions: [
    desktopAction(
      "screenshot",
      "Capture a desktop screenshot.",
      DesktopScreenshotArgs,
      DesktopSnapshotResult,
    ),
    desktopAction(
      "snapshot",
      "Collect a desktop accessibility snapshot.",
      DesktopSnapshotArgs,
      DesktopSnapshotResult,
    ),
    desktopAction(
      "query",
      "Query desktop UI elements.",
      DesktopQueryArgs,
      DesktopQueryResult,
      "result",
    ),
    desktopAction(
      "act",
      "Perform a desktop UI action.",
      DesktopActArgs,
      DesktopActResult,
      "result",
    ),
    desktopAction(
      "mouse",
      "Perform a low-level desktop mouse action.",
      DesktopMouseArgs,
      z.object({}).passthrough(),
      "result",
    ),
    desktopAction(
      "keyboard",
      "Perform a low-level desktop keyboard action.",
      DesktopKeyboardArgs,
      z.object({}).passthrough(),
      "result",
    ),
    desktopAction(
      "wait_for",
      "Wait for a desktop UI condition.",
      DesktopWaitForArgs,
      DesktopWaitForResult,
      "result",
    ),
  ],
};

const CATALOG = new Map<string, CapabilityCatalogEntry>([
  [BROWSER_CATALOG.descriptor.id, BROWSER_CATALOG],
  [DESKTOP_CATALOG.descriptor.id, DESKTOP_CATALOG],
]);

export function getCapabilityCatalogEntry(
  capabilityId: string,
): CapabilityCatalogEntry | undefined {
  return CATALOG.get(capabilityId);
}

export function getCapabilityCatalogAction(
  capabilityId: string,
  actionName: string,
): CatalogAction | undefined {
  return CATALOG.get(capabilityId)?.actions.find((action) => action.name === actionName);
}
