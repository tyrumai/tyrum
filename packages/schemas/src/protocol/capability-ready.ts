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

/** Maps ActionPrimitiveKind to the legacy capability kind used for node routing. */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, CapabilityKind>> = {
  Web: "playwright",
  Browser: "browser",
  IOS: "ios",
  Android: "android",
  Desktop: "desktop",
  CLI: "cli",
  Http: "http",
};

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

export function requiredCapabilityDescriptor(
  kind: ActionPrimitiveKind,
  args?: unknown,
): string | undefined {
  const op = readActionOp(args);

  if (kind === "Desktop") {
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
      default:
        return undefined;
    }
  }

  if (kind === "Browser") {
    switch (op) {
      case "geolocation.get":
        return "tyrum.browser.geolocation.get";
      case "camera.capture_photo":
        return "tyrum.browser.camera.capture-photo";
      case "microphone.record":
        return "tyrum.browser.microphone.record";
      default:
        return undefined;
    }
  }

  if (kind === "IOS") {
    switch (op) {
      case "location.get_current":
        return "tyrum.ios.location.get-current";
      case "camera.capture_photo":
        return "tyrum.ios.camera.capture-photo";
      case "audio.record_clip":
        return "tyrum.ios.audio.record-clip";
      default:
        return undefined;
    }
  }

  if (kind === "Android") {
    switch (op) {
      case "location.get_current":
        return "tyrum.android.location.get-current";
      case "camera.capture_photo":
        return "tyrum.android.camera.capture-photo";
      case "audio.record_clip":
        return "tyrum.android.audio.record-clip";
      default:
        return undefined;
    }
  }

  const capability = requiredCapability(kind);
  return capability ? descriptorIdForClientCapability(capability) : undefined;
}

export function requiredCapabilityDescriptorForAction(
  action: Pick<ActionPrimitive, "type" | "args">,
): string | undefined {
  return requiredCapabilityDescriptor(action.type, action.args);
}
