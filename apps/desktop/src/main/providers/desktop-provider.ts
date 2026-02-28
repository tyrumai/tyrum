import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { DesktopActionArgs } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { ResolvedPermissions } from "../config/permissions.js";
import type { DesktopBackend } from "./backends/desktop-backend.js";
import type {
  DesktopActArgs,
  DesktopBackendPermissions,
  DesktopQueryArgs,
  DesktopSnapshotArgs,
  DesktopWaitForArgs,
} from "@tyrum/schemas";

export type ConfirmationFn = (prompt: string) => Promise<boolean>;

type PixelPoint = { x: number; y: number };

function parsePixelRef(ref: string): PixelPoint | null {
  const match = /^pixel:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref.trim());
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export class DesktopProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "desktop";

  constructor(
    private backend: DesktopBackend,
    private permissions: ResolvedPermissions,
    private requestConfirmation: ConfirmationFn,
  ) {}

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const parseResult = DesktopActionArgs.safeParse(action.args);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid desktop args: ${parseResult.error.message}`,
      };
    }
    const args = parseResult.data;

    try {
      switch (args.op) {
        case "screenshot":
          return await this.screenshot(args);
        case "mouse":
          return await this.mouseAction(args);
        case "keyboard":
          return await this.keyboardAction(args);
        case "snapshot":
          return await this.snapshot(args);
        case "query":
          return await this.query(args);
        case "act":
          return await this.act(args);
        case "wait_for":
          return await this.waitFor(args);
        default:
          return {
            success: false,
            error: `Unsupported desktop operation: ${(args as { op: string }).op}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: `Desktop backend error: ${(err as Error).message}`,
      };
    }
  }

  private backendPermissions(): DesktopBackendPermissions {
    return {
      accessibility: false,
      screen_capture: this.permissions.desktopScreenshot,
      input_control: this.permissions.desktopInput,
    };
  }

  private toImageEvidence(
    type: string,
    capture: { width: number; height: number; buffer: Buffer },
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type,
      mime: "image/png",
      width: capture.width,
      height: capture.height,
      timestamp: new Date().toISOString(),
      bytesBase64: capture.buffer.toString("base64"),
      ...extra,
    };
  }

  private async screenshot(args: {
    display: "primary" | "all" | { id: string };
    max_width?: number;
  }): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const capture = await this.backend.captureScreen(args.display);

    return {
      success: true,
      evidence: this.toImageEvidence("screenshot", capture),
    };
  }

  private async snapshot(_args: DesktopSnapshotArgs): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const capture = await this.backend.captureScreen("primary");

    return {
      success: true,
      result: {
        op: "snapshot",
        backend: {
          mode: "pixel",
          permissions: this.backendPermissions(),
        },
        windows: [],
      },
      evidence: this.toImageEvidence("snapshot", capture, { mode: "pixel" }),
    };
  }

  private async query(_args: DesktopQueryArgs): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const capture = await this.backend.captureScreen("primary");
    return {
      success: true,
      result: {
        op: "query",
        matches: [],
      },
      evidence: this.toImageEvidence("query", capture, {
        mode: "pixel",
        coordinate_space: {
          origin: "top-left",
          units: "px",
        },
      }),
    };
  }

  private async act(args: DesktopActArgs): Promise<TaskResult> {
    if (!this.permissions.desktopInput) {
      return {
        success: false,
        error: "Desktop input is disabled by permission profile",
      };
    }

    if (args.target.kind !== "ref") {
      return {
        success: false,
        error: `Unsupported act target kind for pixel mode: ${args.target.kind}`,
      };
    }

    const point = parsePixelRef(args.target.ref);
    if (!point) {
      return {
        success: false,
        error: `Unsupported pixel ref format: "${args.target.ref}" (expected "pixel:x,y")`,
      };
    }

    if (this.permissions.desktopInputRequiresConfirmation) {
      const approved = await this.requestConfirmation(
        `Allow desktop act ${args.action.kind} at (${point.x}, ${point.y})?`,
      );
      if (!approved) {
        return { success: false, error: "User denied desktop act" };
      }
    }

    if (args.action.kind === "right_click") {
      await this.backend.clickMouse(point.x, point.y, "right");
    } else if (args.action.kind === "double_click") {
      await this.backend.clickMouse(point.x, point.y);
      await this.backend.clickMouse(point.x, point.y);
    } else {
      // click | focus
      await this.backend.clickMouse(point.x, point.y);
    }

    return {
      success: true,
      result: {
        op: "act",
        target: args.target,
        action: args.action,
        resolved_element_ref: args.target.ref,
      },
      evidence: {
        type: "act",
        mode: "pixel",
        action: args.action.kind,
        x: point.x,
        y: point.y,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async waitFor(args: DesktopWaitForArgs): Promise<TaskResult> {
    const start = Date.now();
    while (Date.now() - start < args.timeout_ms) {
      const remaining = args.timeout_ms - (Date.now() - start);
      const sleepMs = Math.min(args.poll_ms, Math.max(0, remaining));
      if (sleepMs <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    const elapsed = Date.now() - start;
    return {
      success: true,
      result: {
        op: "wait_for",
        selector: args.selector,
        state: args.state,
        status: "timeout",
        elapsed_ms: elapsed,
      },
    };
  }

  private async mouseAction(args: {
    action: string;
    x: number;
    y: number;
    button?: string;
    duration_ms?: number;
  }): Promise<TaskResult> {
    if (!this.permissions.desktopInput) {
      return {
        success: false,
        error: "Desktop input is disabled by permission profile",
      };
    }
    if (this.permissions.desktopInputRequiresConfirmation) {
      const approved = await this.requestConfirmation(
        `Allow mouse ${args.action} at (${args.x}, ${args.y})?`,
      );
      if (!approved) {
        return { success: false, error: "User denied mouse action" };
      }
    }

    switch (args.action) {
      case "move":
        await this.backend.moveMouse(args.x, args.y);
        break;
      case "click":
        await this.backend.clickMouse(
          args.x,
          args.y,
          args.button as "left" | "right" | "middle" | undefined,
        );
        break;
      case "drag":
        await this.backend.dragMouse(args.x, args.y, args.duration_ms);
        break;
      default:
        return {
          success: false,
          error: `Unsupported mouse action: ${args.action}`,
        };
    }

    return {
      success: true,
      evidence: {
        type: "mouse",
        action: args.action,
        x: args.x,
        y: args.y,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async keyboardAction(args: {
    action: string;
    text?: string;
    key?: string;
  }): Promise<TaskResult> {
    if (!this.permissions.desktopInput) {
      return {
        success: false,
        error: "Desktop input is disabled by permission profile",
      };
    }
    if (this.permissions.desktopInputRequiresConfirmation) {
      const detail =
        args.action === "type" ? args.text : args.action === "press" ? args.key : undefined;
      const approved = await this.requestConfirmation(
        `Allow keyboard ${args.action}: "${detail ?? "<missing>"}"?`,
      );
      if (!approved) {
        return { success: false, error: "User denied keyboard action" };
      }
    }

    switch (args.action) {
      case "type":
        if (!args.text) {
          return { success: false, error: "Missing text for keyboard type action" };
        }
        await this.backend.typeText(args.text);
        break;
      case "press":
        if (!args.key) {
          return { success: false, error: "Missing key for keyboard press action" };
        }
        await this.backend.pressKey(args.key);
        break;
      default:
        return {
          success: false,
          error: `Unsupported keyboard action: ${args.action}`,
        };
    }

    return {
      success: true,
      evidence: {
        type: "keyboard",
        action: args.action,
        text: args.text,
        key: args.key,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
