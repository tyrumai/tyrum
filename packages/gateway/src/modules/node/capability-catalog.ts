import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  // Desktop schemas (unchanged)
  DesktopActArgs,
  DesktopActResult,
  DesktopKeyboardArgs,
  DesktopMouseArgs,
  DesktopQueryArgs,
  DesktopQueryResult,
  DesktopScreenshotArgs,
  DesktopScreenshotResult,
  DesktopSnapshotArgs,
  DesktopSnapshotResult,
  DesktopWaitForArgs,
  DesktopWaitForResult,
  // Cross-platform schemas
  LocationGetArgs,
  LocationGetResult,
  CameraCapturePhotoArgs,
  CameraCapturePhotoResult,
  CameraCaptureVideoArgs,
  CameraCaptureVideoResult,
  AudioRecordArgs,
  AudioRecordResult,
  // Browser automation schemas
  BrowserNavigateArgs,
  BrowserNavigateResult,
  BrowserNavigateBackArgs,
  BrowserNavigateBackResult,
  BrowserSnapshotArgs,
  BrowserSnapshotResult,
  BrowserClickArgs,
  BrowserClickResult,
  BrowserTypeArgs,
  BrowserTypeResult,
  BrowserFillFormArgs,
  BrowserFillFormResult,
  BrowserSelectOptionArgs,
  BrowserSelectOptionResult,
  BrowserHoverArgs,
  BrowserHoverResult,
  BrowserDragArgs,
  BrowserDragResult,
  BrowserPressKeyArgs,
  BrowserPressKeyResult,
  BrowserScreenshotArgs,
  BrowserScreenshotResult,
  BrowserEvaluateArgs,
  BrowserEvaluateResult,
  BrowserWaitForArgs,
  BrowserWaitForResult,
  BrowserTabsArgs,
  BrowserTabsResult,
  BrowserUploadFileArgs,
  BrowserUploadFileResult,
  BrowserConsoleMessagesArgs,
  BrowserConsoleMessagesResult,
  BrowserNetworkRequestsArgs,
  BrowserNetworkRequestsResult,
  BrowserResizeArgs,
  BrowserResizeResult,
  BrowserCloseArgs,
  BrowserCloseResult,
  BrowserHandleDialogArgs,
  BrowserHandleDialogResult,
  BrowserRunCodeArgs,
  BrowserRunCodeResult,
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

function crossPlatformSensorAction(
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
    inputParser: inputSchema as ZodType,
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
      primitive_kind: null, // Resolved at dispatch time from node's device_platform
      op_field: "op",
      op_value: name,
      result_channel: "evidence",
      artifactize_binary_fields: sensitiveDataCategory === "location" ? [] : ["bytesBase64"],
    },
  };
}

function browserAutomationAction(
  name: CatalogAction["name"],
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  resultChannel: NodeActionTransportMetadata["result_channel"] = "result",
): CatalogAction {
  return {
    name,
    description,
    inputParser: inputSchema as ZodType,
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

function createEntry(descriptorId: string, action: CatalogAction): CapabilityCatalogEntry {
  return {
    descriptor: {
      id: descriptorId,
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    },
    actions: [action],
  };
}

const CATALOG_ENTRIES: CapabilityCatalogEntry[] = [
  // ---------------------------------------------------------------------------
  // Desktop (7 entries)
  // ---------------------------------------------------------------------------
  createEntry(
    "tyrum.desktop.screenshot",
    desktopAction(
      "screenshot",
      "Capture a desktop screenshot.",
      DesktopScreenshotArgs,
      DesktopScreenshotResult,
    ),
  ),
  createEntry(
    "tyrum.desktop.snapshot",
    desktopAction(
      "snapshot",
      "Collect a desktop accessibility snapshot.",
      DesktopSnapshotArgs,
      DesktopSnapshotResult,
    ),
  ),
  createEntry(
    "tyrum.desktop.query",
    desktopAction(
      "query",
      "Query desktop UI elements.",
      DesktopQueryArgs,
      DesktopQueryResult,
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.act",
    desktopAction(
      "act",
      "Perform a desktop UI action.",
      DesktopActArgs,
      DesktopActResult,
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.mouse",
    desktopAction(
      "mouse",
      "Perform a low-level desktop mouse action.",
      DesktopMouseArgs,
      z.object({}).passthrough(),
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.keyboard",
    desktopAction(
      "keyboard",
      "Perform a low-level desktop keyboard action.",
      DesktopKeyboardArgs,
      z.object({}).passthrough(),
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.wait-for",
    desktopAction(
      "wait_for",
      "Wait for a desktop UI condition.",
      DesktopWaitForArgs,
      DesktopWaitForResult,
      "result",
    ),
  ),

  // ---------------------------------------------------------------------------
  // Cross-platform sensor (4 entries)
  // ---------------------------------------------------------------------------
  createEntry(
    "tyrum.location.get",
    crossPlatformSensorAction(
      "get",
      "Read the device's current geographic position.",
      LocationGetArgs,
      LocationGetResult,
      "location",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.camera.capture-photo",
    crossPlatformSensorAction(
      "capture_photo",
      "Capture a still image from a camera.",
      CameraCapturePhotoArgs,
      CameraCapturePhotoResult,
      "image",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.camera.capture-video",
    crossPlatformSensorAction(
      "capture_video",
      "Record a video clip from a camera.",
      CameraCaptureVideoArgs,
      CameraCaptureVideoResult,
      "image",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.audio.record",
    crossPlatformSensorAction(
      "record",
      "Record an audio clip from a microphone.",
      AudioRecordArgs,
      AudioRecordResult,
      "audio",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),

  // ---------------------------------------------------------------------------
  // Browser automation (21 entries)
  // ---------------------------------------------------------------------------
  createEntry(
    "tyrum.browser.navigate",
    browserAutomationAction(
      "navigate",
      "Navigate to a URL.",
      BrowserNavigateArgs,
      BrowserNavigateResult,
    ),
  ),
  createEntry(
    "tyrum.browser.navigate-back",
    browserAutomationAction(
      "navigate_back",
      "Navigate back in history.",
      BrowserNavigateBackArgs,
      BrowserNavigateBackResult,
    ),
  ),
  createEntry(
    "tyrum.browser.snapshot",
    browserAutomationAction(
      "snapshot",
      "Collect a page accessibility snapshot.",
      BrowserSnapshotArgs,
      BrowserSnapshotResult,
    ),
  ),
  createEntry(
    "tyrum.browser.click",
    browserAutomationAction("click", "Click a page element.", BrowserClickArgs, BrowserClickResult),
  ),
  createEntry(
    "tyrum.browser.type",
    browserAutomationAction(
      "type",
      "Type text into an element.",
      BrowserTypeArgs,
      BrowserTypeResult,
    ),
  ),
  createEntry(
    "tyrum.browser.fill-form",
    browserAutomationAction(
      "fill_form",
      "Fill a form field.",
      BrowserFillFormArgs,
      BrowserFillFormResult,
    ),
  ),
  createEntry(
    "tyrum.browser.select-option",
    browserAutomationAction(
      "select_option",
      "Select from a dropdown.",
      BrowserSelectOptionArgs,
      BrowserSelectOptionResult,
    ),
  ),
  createEntry(
    "tyrum.browser.hover",
    browserAutomationAction(
      "hover",
      "Hover over an element.",
      BrowserHoverArgs,
      BrowserHoverResult,
    ),
  ),
  createEntry(
    "tyrum.browser.drag",
    browserAutomationAction("drag", "Drag an element.", BrowserDragArgs, BrowserDragResult),
  ),
  createEntry(
    "tyrum.browser.press-key",
    browserAutomationAction(
      "press_key",
      "Press a keyboard key.",
      BrowserPressKeyArgs,
      BrowserPressKeyResult,
    ),
  ),
  createEntry(
    "tyrum.browser.screenshot",
    browserAutomationAction(
      "screenshot",
      "Capture a page screenshot.",
      BrowserScreenshotArgs,
      BrowserScreenshotResult,
      "result_or_evidence",
    ),
  ),
  createEntry(
    "tyrum.browser.evaluate",
    browserAutomationAction(
      "evaluate",
      "Run JavaScript in page context.",
      BrowserEvaluateArgs,
      BrowserEvaluateResult,
    ),
  ),
  createEntry(
    "tyrum.browser.wait-for",
    browserAutomationAction(
      "wait_for",
      "Wait for a page condition.",
      BrowserWaitForArgs,
      BrowserWaitForResult,
    ),
  ),
  createEntry(
    "tyrum.browser.tabs",
    browserAutomationAction(
      "tabs",
      "List or switch browser tabs.",
      BrowserTabsArgs,
      BrowserTabsResult,
    ),
  ),
  createEntry(
    "tyrum.browser.upload-file",
    browserAutomationAction(
      "upload_file",
      "Upload a file to a file input.",
      BrowserUploadFileArgs,
      BrowserUploadFileResult,
    ),
  ),
  createEntry(
    "tyrum.browser.console-messages",
    browserAutomationAction(
      "console_messages",
      "Read browser console output.",
      BrowserConsoleMessagesArgs,
      BrowserConsoleMessagesResult,
    ),
  ),
  createEntry(
    "tyrum.browser.network-requests",
    browserAutomationAction(
      "network_requests",
      "Inspect network requests.",
      BrowserNetworkRequestsArgs,
      BrowserNetworkRequestsResult,
    ),
  ),
  createEntry(
    "tyrum.browser.resize",
    browserAutomationAction(
      "resize",
      "Resize the browser viewport.",
      BrowserResizeArgs,
      BrowserResizeResult,
    ),
  ),
  createEntry(
    "tyrum.browser.close",
    browserAutomationAction("close", "Close the browser.", BrowserCloseArgs, BrowserCloseResult),
  ),
  createEntry(
    "tyrum.browser.handle-dialog",
    browserAutomationAction(
      "handle_dialog",
      "Accept or dismiss a dialog.",
      BrowserHandleDialogArgs,
      BrowserHandleDialogResult,
    ),
  ),
  createEntry(
    "tyrum.browser.run-code",
    browserAutomationAction(
      "run_code",
      "Run arbitrary code in the browser.",
      BrowserRunCodeArgs,
      BrowserRunCodeResult,
    ),
  ),

  // ---------------------------------------------------------------------------
  // CLI / HTTP (2 entries)
  // ---------------------------------------------------------------------------
  createEntry("tyrum.cli.execute", {
    name: "execute",
    description: "Execute a CLI command on the node.",
    inputParser: z.object({}).passthrough() as ZodType,
    outputParser: z.object({}).passthrough() as ZodType,
    inputSchema: { type: "object", additionalProperties: true },
    outputSchema: { type: "object", additionalProperties: true },
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
      primitive_kind: "CLI",
      op_field: "op",
      op_value: "execute",
      result_channel: "result",
      artifactize_binary_fields: [],
    },
  }),
  createEntry("tyrum.http.request", {
    name: "request",
    description: "Send an HTTP request from the node.",
    inputParser: z.object({}).passthrough() as ZodType,
    outputParser: z.object({}).passthrough() as ZodType,
    inputSchema: { type: "object", additionalProperties: true },
    outputSchema: { type: "object", additionalProperties: true },
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
      primitive_kind: "Http",
      op_field: "op",
      op_value: "request",
      result_channel: "result",
      artifactize_binary_fields: [],
    },
  }),
];

const CATALOG = new Map<string, CapabilityCatalogEntry>(
  CATALOG_ENTRIES.map((entry) => [entry.descriptor.id, entry] as const),
);

export function listCapabilityCatalogEntries(): readonly CapabilityCatalogEntry[] {
  return CATALOG_ENTRIES;
}

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
