import { z } from "zod";
import {
  CapabilityDescriptor,
  CapabilityKind,
  descriptorIdForClientCapability,
} from "../capability.js";
import { NodeId } from "../keys.js";
import { NodeCapabilityState } from "../node-capability.js";
import { ActionPrimitiveKind, type ActionPrimitive } from "../planner.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyPayload = z
  .object({
    capabilities: z.array(CapabilityDescriptor).default([]),
    capability_states: z.array(NodeCapabilityState).default([]),
  })
  .strict();
export type WsCapabilityReadyPayload = z.infer<typeof WsCapabilityReadyPayload>;

export const WsCapabilityReadyRequest = WsRequestEnvelope.extend({
  type: z.literal("capability.ready"),
  payload: WsCapabilityReadyPayload,
});
export type WsCapabilityReadyRequest = z.infer<typeof WsCapabilityReadyRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("capability.ready"),
});
export type WsCapabilityReadyResponseOkEnvelope = z.infer<
  typeof WsCapabilityReadyResponseOkEnvelope
>;

export const WsCapabilityReadyResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("capability.ready"),
});
export type WsCapabilityReadyResponseErrEnvelope = z.infer<
  typeof WsCapabilityReadyResponseErrEnvelope
>;

export const WsCapabilityReadyResponseEnvelope = z.union([
  WsCapabilityReadyResponseOkEnvelope,
  WsCapabilityReadyResponseErrEnvelope,
]);
export type WsCapabilityReadyResponseEnvelope = z.infer<typeof WsCapabilityReadyResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — capability.ready
// ---------------------------------------------------------------------------

export const WsCapabilityReadyEventPayload = z
  .object({
    node_id: NodeId,
    capabilities: z.array(CapabilityDescriptor).default([]),
    capability_states: z.array(NodeCapabilityState).default([]),
  })
  .strict();
export type WsCapabilityReadyEventPayload = z.infer<typeof WsCapabilityReadyEventPayload>;

export const WsCapabilityReadyEvent = WsEventEnvelope.extend({
  type: z.literal("capability.ready"),
  payload: WsCapabilityReadyEventPayload,
});
export type WsCapabilityReadyEvent = z.infer<typeof WsCapabilityReadyEvent>;

/**
 * @deprecated Use `requiredCapabilityDescriptor()` with canonical capability IDs instead.
 *
 * Maps ActionPrimitiveKind to the legacy capability kind used for node routing.
 */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, CapabilityKind>> = {
  Web: "playwright",
  Browser: "browser",
  IOS: "ios",
  Android: "android",
  Desktop: "desktop",
};

/**
 * @deprecated Use `requiredCapabilityDescriptor()` with canonical capability IDs instead.
 */
export function requiredCapability(kind: ActionPrimitiveKind): CapabilityKind | undefined {
  return CAPABILITY_MAP[kind];
}

function readActionOp(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const op = (args as Record<string, unknown>)["op"];
  return typeof op === "string" ? op.trim() : undefined;
}

/** Maps Web (Playwright) transport op names to canonical browser automation IDs. */
const WEB_OP_TO_CANONICAL: Record<string, string> = {
  navigate: "tyrum.browser.navigate",
  navigate_back: "tyrum.browser.navigate-back",
  snapshot: "tyrum.browser.snapshot",
  click: "tyrum.browser.click",
  type: "tyrum.browser.type",
  fill: "tyrum.browser.fill-form",
  fill_form: "tyrum.browser.fill-form",
  select_option: "tyrum.browser.select-option",
  hover: "tyrum.browser.hover",
  drag: "tyrum.browser.drag",
  press_key: "tyrum.browser.press-key",
  screenshot: "tyrum.browser.screenshot",
  evaluate: "tyrum.browser.evaluate",
  wait_for: "tyrum.browser.wait-for",
  tabs: "tyrum.browser.tabs",
  upload_file: "tyrum.browser.upload-file",
  console_messages: "tyrum.browser.console-messages",
  network_requests: "tyrum.browser.network-requests",
  resize: "tyrum.browser.resize",
  close: "tyrum.browser.close",
  handle_dialog: "tyrum.browser.handle-dialog",
  run_code: "tyrum.browser.run-code",
  launch: "tyrum.browser.launch",
};

/** Maps Filesystem transport op names to canonical filesystem IDs. */
const FS_OP_TO_CANONICAL: Record<string, string> = {
  read: "tyrum.fs.read",
  write: "tyrum.fs.write",
  edit: "tyrum.fs.edit",
  apply_patch: "tyrum.fs.apply-patch",
  bash: "tyrum.fs.bash",
  glob: "tyrum.fs.glob",
  grep: "tyrum.fs.grep",
};

export function requiredCapabilityDescriptor(
  kind: ActionPrimitiveKind,
  args?: unknown,
): string | undefined {
  const op = readActionOp(args);

  switch (kind) {
    case "Desktop":
      switch (op) {
        case "screenshot":
          return "tyrum.desktop.screenshot";
        case "snapshot":
          return "tyrum.desktop.snapshot";
        case "query":
          return "tyrum.desktop.query";
        case "act":
          return "tyrum.desktop.act";
        case "mouse":
          return "tyrum.desktop.mouse";
        case "keyboard":
          return "tyrum.desktop.keyboard";
        case "wait_for":
          return "tyrum.desktop.wait-for";
        case "clipboard_write":
          return "tyrum.desktop.clipboard-write";
        default:
          return undefined;
      }

    case "IOS":
    case "Android":
    case "Browser":
      switch (op) {
        case "get":
          return "tyrum.location.get";
        case "capture_photo":
          return "tyrum.camera.capture-photo";
        case "capture_video":
          return "tyrum.camera.capture-video";
        case "record":
          return "tyrum.audio.record";
        default:
          return undefined;
      }

    case "Web":
      return op ? WEB_OP_TO_CANONICAL[op] : undefined;

    case "Filesystem":
      return op ? FS_OP_TO_CANONICAL[op] : undefined;

    default: {
      // Fallback for any other kinds (e.g. Research, Decide, Llm, CLI, Http, etc.)
      const capability = requiredCapability(kind);
      return capability ? descriptorIdForClientCapability(capability) : undefined;
    }
  }
}

export function requiredCapabilityDescriptorForAction(
  action: Pick<ActionPrimitive, "type" | "args">,
): string | undefined {
  return requiredCapabilityDescriptor(action.type, action.args);
}
