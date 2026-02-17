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

    switch (args.op) {
      case "screenshot":
        return this.screenshot(args);
      case "mouse":
        return this.mouseAction(args);
      case "keyboard":
        return this.keyboardAction(args);
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
      const approved = await this.requestConfirmation(
        `Allow keyboard ${args.action}: "${args.text ?? args.key}"?`,
      );
      if (!approved) {
        return { success: false, error: "User denied keyboard action" };
      }
    }

    if (args.action === "type" && args.text != null) {
      await this.backend.typeText(args.text);
    } else if (args.action === "press" && args.key != null) {
      await this.backend.pressKey(args.key);
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
