import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { DesktopActionArgs } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { ResolvedPermissions } from "../config/permissions.js";
import type { DesktopBackend } from "./backends/desktop-backend.js";

export type ConfirmationFn = (prompt: string) => Promise<boolean>;

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
      evidence: {
        type: "screenshot",
        mime: "image/png",
        width: capture.width,
        height: capture.height,
        timestamp: new Date().toISOString(),
        bytesBase64: capture.buffer.toString("base64"),
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
        args.action === "type"
          ? args.text
          : args.action === "press"
            ? args.key
            : undefined;
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
