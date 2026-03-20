import type { TaskResult } from "@tyrum/node-sdk";
import {
  DesktopActionArgs,
  type DesktopClipboardWriteArgs,
  descriptorIdsForClientCapability,
} from "@tyrum/contracts";
import type { DesktopBackend } from "./backends/desktop-backend.js";
import { toErrorMessage } from "./desktop-provider-helpers.js";

const DESKTOP_CLIPBOARD_WRITE_CAPABILITY_ID = "tyrum.desktop.clipboard-write";
const DESKTOP_CAPABILITY_IDS = descriptorIdsForClientCapability("desktop");
const DESKTOP_CAPABILITY_IDS_WITH_CLIPBOARD = Object.freeze([
  ...DESKTOP_CAPABILITY_IDS,
  DESKTOP_CLIPBOARD_WRITE_CAPABILITY_ID,
]);

type InputExecutionDeps = {
  backend: DesktopBackend;
  requireInput: () => TaskResult | undefined;
  confirm: (prompt: string, deniedMessage: string) => Promise<TaskResult | undefined>;
  fail: (error: string) => TaskResult;
  evidence: (value: Record<string, unknown>) => Record<string, unknown>;
};

export function resolveDesktopCapabilityIds(input: {
  supportsClipboardWrite?: boolean;
}): readonly string[] {
  return input.supportsClipboardWrite
    ? DESKTOP_CAPABILITY_IDS_WITH_CLIPBOARD
    : DESKTOP_CAPABILITY_IDS;
}

export function describeDesktopExecutionError(op: DesktopActionArgs["op"], err: unknown): string {
  if (op === "clipboard_write") {
    return "Clipboard write failed";
  }
  return `Desktop backend error: ${toErrorMessage(err)}`;
}

export async function executeMouseAction(
  args: {
    action: string;
    x: number;
    y: number;
    button?: string;
    duration_ms?: number;
  },
  deps: InputExecutionDeps,
): Promise<TaskResult> {
  const denied = deps.requireInput();
  if (denied) return denied;
  const confirmation = await deps.confirm(
    `Allow mouse ${args.action} at (${args.x}, ${args.y})?`,
    "User denied mouse action",
  );
  if (confirmation) return confirmation;
  switch (args.action) {
    case "move":
      await deps.backend.moveMouse(args.x, args.y);
      break;
    case "click":
      await deps.backend.clickMouse(
        args.x,
        args.y,
        args.button as "left" | "right" | "middle" | undefined,
      );
      break;
    case "drag":
      await deps.backend.dragMouse(args.x, args.y, args.duration_ms);
      break;
    default:
      return deps.fail(`Unsupported mouse action: ${args.action}`);
  }
  return {
    success: true,
    evidence: deps.evidence({ type: "mouse", action: args.action, x: args.x, y: args.y }),
  };
}

export async function executeKeyboardAction(
  args: {
    action: string;
    text?: string;
    key?: string;
  },
  deps: InputExecutionDeps,
): Promise<TaskResult> {
  const denied = deps.requireInput();
  if (denied) return denied;
  const detail =
    args.action === "type" ? args.text : args.action === "press" ? args.key : undefined;
  const confirmation = await deps.confirm(
    `Allow keyboard ${args.action}: "${detail ?? "<missing>"}"?`,
    "User denied keyboard action",
  );
  if (confirmation) return confirmation;
  switch (args.action) {
    case "type":
      if (!args.text) return deps.fail("Missing text for keyboard type action");
      await deps.backend.typeText(args.text);
      break;
    case "press":
      if (!args.key) return deps.fail("Missing key for keyboard press action");
      await deps.backend.pressKey(args.key);
      break;
    default:
      return deps.fail(`Unsupported keyboard action: ${args.action}`);
  }
  return {
    success: true,
    evidence: deps.evidence({
      type: "keyboard",
      action: args.action,
      text: args.text,
      key: args.key,
    }),
  };
}

export async function executeClipboardWrite(
  args: DesktopClipboardWriteArgs,
  deps: InputExecutionDeps,
): Promise<TaskResult> {
  const denied = deps.requireInput();
  if (denied) return denied;
  if (!deps.backend.supportsClipboardWrite) {
    return deps.fail("Clipboard write is unavailable on this desktop runtime");
  }
  const confirmation = await deps.confirm("Allow clipboard write?", "User denied clipboard write");
  if (confirmation) return confirmation;
  await deps.backend.writeClipboardText(args.text);
  return {
    success: true,
    result: {
      op: "clipboard_write",
      status: "ok",
    },
    evidence: deps.evidence({ type: "clipboard_write" }),
  };
}
