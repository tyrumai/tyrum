import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";

export interface PlaywrightProviderConfig {
  allowedDomains: string[];
  headless: boolean;
  domainRestricted: boolean;
}

export class PlaywrightProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "playwright";
  private config: PlaywrightProviderConfig;

  constructor(config: PlaywrightProviderConfig) {
    this.config = config;
  }

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const args = action.args as Record<string, unknown>;
    const op = args["op"] as string | undefined;

    if (!op) {
      return { success: false, error: "Missing 'op' field in Web action args" };
    }

    switch (op) {
      case "navigate":
        return this.navigate(args);
      case "click":
        return this.click(args);
      case "fill":
        return this.fill(args);
      case "snapshot":
        return this.snapshot();
      default:
        return { success: false, error: `Unknown Web operation: ${op}` };
    }
  }

  private checkDomain(url: string): TaskResult | null {
    if (!this.config.domainRestricted) return null;
    try {
      const hostname = new URL(url).hostname;
      const allowed = this.config.allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
      if (!allowed) {
        return {
          success: false,
          error: `Domain "${hostname}" is not in the allowlist. Allowed: ${this.config.allowedDomains.join(", ")}`,
        };
      }
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }
    return null;
  }

  private async navigate(args: Record<string, unknown>): Promise<TaskResult> {
    const url = args["url"] as string | undefined;
    if (!url) return { success: false, error: "Missing 'url' in navigate args" };

    const domainCheck = this.checkDomain(url);
    if (domainCheck) return domainCheck;

    // V1 stub: In real impl, launch browser and navigate
    return {
      success: true,
      evidence: {
        type: "navigate",
        url,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async click(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    if (!selector) return { success: false, error: "Missing 'selector' in click args" };

    return {
      success: true,
      evidence: {
        type: "click",
        selector,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async fill(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const value = args["value"] as string | undefined;
    if (!selector || value === undefined) {
      return { success: false, error: "Missing 'selector' or 'value' in fill args" };
    }

    return {
      success: true,
      evidence: {
        type: "fill",
        selector,
        value,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async snapshot(): Promise<TaskResult> {
    return {
      success: true,
      evidence: {
        type: "snapshot",
        timestamp: new Date().toISOString(),
        // In real impl: DOM snapshot / accessibility tree
      },
    };
  }
}
