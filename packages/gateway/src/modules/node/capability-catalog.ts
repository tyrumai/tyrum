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
  BrowserLaunchArgs,
  BrowserLaunchResult,
  // Filesystem schemas
  FsReadArgs,
  FsReadResult,
  FsWriteArgs,
  FsWriteResult,
  FsEditArgs,
  FsEditResult,
  FsApplyPatchArgs,
  FsApplyPatchResult,
  FsBashArgs,
  FsBashResult,
  FsGlobArgs,
  FsGlobResult,
  FsGrepArgs,
  FsGrepResult,
  type CapabilityDescriptor,
  type NodeActionConsentMetadata,
  type NodeActionPermissionMetadata,
  type NodeActionTransportMetadata,
} from "@tyrum/contracts";
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

/**
 * Wraps a .strict() Zod object schema with .passthrough() so the transport
 * `op` field injected by the gateway dispatch is not rejected during parsing.
 * The JSON Schema output still uses the original strict shape (no `op` field).
 */
function passthroughParser(schema: unknown): ZodType {
  const candidate = schema as { passthrough?: () => ZodType };
  return typeof candidate.passthrough === "function"
    ? candidate.passthrough()
    : (schema as ZodType);
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
      primitive_kind: null, // Resolved at dispatch time from node's device_platform
      op_field: "op",
      op_value: name,
      result_channel: "evidence",
      artifactize_binary_fields: sensitiveDataCategory === "location" ? [] : ["bytesBase64"],
    },
  };
}

/** Shorthand: create a browser automation catalog entry. */
function ba(
  id: string,
  name: string,
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
): CapabilityCatalogEntry {
  return createEntry(id, browserAutomationAction(name, description, inputSchema, outputSchema));
}

/** Shorthand: create a filesystem catalog entry. */
function fa(
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

function browserAutomationAction(
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

function filesystemAction(
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
  // Browser automation (22 entries including launch)
  // ---------------------------------------------------------------------------
  ba(
    "tyrum.browser.launch",
    "launch",
    "Launch a browser session.",
    BrowserLaunchArgs,
    BrowserLaunchResult,
  ),
  ba(
    "tyrum.browser.navigate",
    "navigate",
    "Navigate to a URL.",
    BrowserNavigateArgs,
    BrowserNavigateResult,
  ),
  ba(
    "tyrum.browser.navigate-back",
    "navigate_back",
    "Navigate back in history.",
    BrowserNavigateBackArgs,
    BrowserNavigateBackResult,
  ),
  ba(
    "tyrum.browser.snapshot",
    "snapshot",
    "Collect a page accessibility snapshot.",
    BrowserSnapshotArgs,
    BrowserSnapshotResult,
  ),
  ba("tyrum.browser.click", "click", "Click a page element.", BrowserClickArgs, BrowserClickResult),
  ba(
    "tyrum.browser.type",
    "type",
    "Type text into an element.",
    BrowserTypeArgs,
    BrowserTypeResult,
  ),
  ba(
    "tyrum.browser.fill-form",
    "fill_form",
    "Fill a form field.",
    BrowserFillFormArgs,
    BrowserFillFormResult,
  ),
  ba(
    "tyrum.browser.select-option",
    "select_option",
    "Select from a dropdown.",
    BrowserSelectOptionArgs,
    BrowserSelectOptionResult,
  ),
  ba(
    "tyrum.browser.hover",
    "hover",
    "Hover over an element.",
    BrowserHoverArgs,
    BrowserHoverResult,
  ),
  ba("tyrum.browser.drag", "drag", "Drag an element.", BrowserDragArgs, BrowserDragResult),
  ba(
    "tyrum.browser.press-key",
    "press_key",
    "Press a keyboard key.",
    BrowserPressKeyArgs,
    BrowserPressKeyResult,
  ),
  ba(
    "tyrum.browser.screenshot",
    "screenshot",
    "Capture a page screenshot.",
    BrowserScreenshotArgs,
    BrowserScreenshotResult,
  ),
  ba(
    "tyrum.browser.evaluate",
    "evaluate",
    "Run JavaScript in page context.",
    BrowserEvaluateArgs,
    BrowserEvaluateResult,
  ),
  ba(
    "tyrum.browser.wait-for",
    "wait_for",
    "Wait for a page condition.",
    BrowserWaitForArgs,
    BrowserWaitForResult,
  ),
  ba(
    "tyrum.browser.tabs",
    "tabs",
    "List or switch browser tabs.",
    BrowserTabsArgs,
    BrowserTabsResult,
  ),
  ba(
    "tyrum.browser.upload-file",
    "upload_file",
    "Upload a file to a file input.",
    BrowserUploadFileArgs,
    BrowserUploadFileResult,
  ),
  ba(
    "tyrum.browser.console-messages",
    "console_messages",
    "Read browser console output.",
    BrowserConsoleMessagesArgs,
    BrowserConsoleMessagesResult,
  ),
  ba(
    "tyrum.browser.network-requests",
    "network_requests",
    "Inspect network requests.",
    BrowserNetworkRequestsArgs,
    BrowserNetworkRequestsResult,
  ),
  ba(
    "tyrum.browser.resize",
    "resize",
    "Resize the browser viewport.",
    BrowserResizeArgs,
    BrowserResizeResult,
  ),
  ba("tyrum.browser.close", "close", "Close the browser.", BrowserCloseArgs, BrowserCloseResult),
  ba(
    "tyrum.browser.handle-dialog",
    "handle_dialog",
    "Accept or dismiss a dialog.",
    BrowserHandleDialogArgs,
    BrowserHandleDialogResult,
  ),
  ba(
    "tyrum.browser.run-code",
    "run_code",
    "Run arbitrary code in the browser.",
    BrowserRunCodeArgs,
    BrowserRunCodeResult,
  ),

  // ---------------------------------------------------------------------------
  // Filesystem (7 entries)
  // ---------------------------------------------------------------------------
  fa("tyrum.fs.read", "read", "Read a file from the filesystem.", FsReadArgs, FsReadResult, false),
  fa("tyrum.fs.write", "write", "Write content to a file.", FsWriteArgs, FsWriteResult, true),
  fa("tyrum.fs.edit", "edit", "Edit a file by replacing text.", FsEditArgs, FsEditResult, true),
  fa(
    "tyrum.fs.apply-patch",
    "apply_patch",
    "Apply a structured patch.",
    FsApplyPatchArgs,
    FsApplyPatchResult,
    true,
  ),
  fa("tyrum.fs.bash", "bash", "Execute a shell command.", FsBashArgs, FsBashResult, true),
  fa("tyrum.fs.glob", "glob", "Find files by glob pattern.", FsGlobArgs, FsGlobResult, false),
  fa("tyrum.fs.grep", "grep", "Search files for text or regex.", FsGrepArgs, FsGrepResult, false),
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
