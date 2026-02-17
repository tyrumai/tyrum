import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { DesktopActionArgs } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { ResolvedPermissions } from "../config/permissions.js";

export type ConfirmationFn = (prompt: string) => Promise<boolean>;

export class DesktopProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "desktop";

  constructor(
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
    max_width?: number;
  }): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    // V1 stub: In the real implementation, use Electron desktopCapturer
    // or @nut-tree/nut-js screen.capture()
    return {
      success: true,
      evidence: {
        type: "screenshot",
        mime: "image/png",
        width: 1920,
        height: 1080,
        timestamp: new Date().toISOString(),
        bytesBase64: "", // placeholder
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

    // V1 stub: In real implementation, use @nut-tree/nut-js
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

    // V1 stub
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
