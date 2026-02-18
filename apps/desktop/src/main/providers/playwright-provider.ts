import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { checkPostcondition } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { PlaywrightBackend } from "./backends/playwright-backend.js";

export interface PlaywrightProviderConfig {
  allowedDomains: string[];
  headless: boolean;
  domainRestricted: boolean;
}

export class PlaywrightProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "playwright";
  private config: PlaywrightProviderConfig;

  constructor(
    config: PlaywrightProviderConfig,
    private backend: PlaywrightBackend,
  ) {
    this.config = config;
  }

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const args = action.args as Record<string, unknown>;
    const op = args["op"] as string | undefined;

    if (!op) {
      return { success: false, error: "Missing 'op' field in Web action args" };
    }

    try {
      switch (op) {
        case "navigate":
          return await this.navigate(action, args);
        case "click":
          return await this.click(action, args);
        case "fill":
          return await this.fill(action, args);
        case "snapshot":
          return await this.snapshot();
        default:
          return { success: false, error: `Unknown Web operation: ${op}` };
      }
    } catch (err) {
      return {
        success: false,
        error: `Playwright backend error: ${(err as Error).message}`,
      };
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

  private async navigate(
    action: ActionPrimitive,
    args: Record<string, unknown>,
  ): Promise<TaskResult> {
    const url = args["url"] as string | undefined;
    if (!url) return { success: false, error: "Missing 'url' in navigate args" };

    const domainCheck = this.checkDomain(url);
    if (domainCheck) return domainCheck;

    await this.backend.ensureBrowser();
    const result = await this.backend.navigate(url);

    const evidence: Record<string, unknown> = {
      type: "navigate",
      url: result.url,
      title: result.title,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(
      action,
      evidence,
    );
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async click(
    action: ActionPrimitive,
    args: Record<string, unknown>,
  ): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    if (!selector) return { success: false, error: "Missing 'selector' in click args" };

    await this.backend.ensureBrowser();
    await this.backend.click(selector);

    const evidence: Record<string, unknown> = {
      type: "click",
      selector,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(
      action,
      evidence,
    );
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async fill(
    action: ActionPrimitive,
    args: Record<string, unknown>,
  ): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const value = args["value"] as string | undefined;
    if (!selector || value === undefined) {
      return { success: false, error: "Missing 'selector' or 'value' in fill args" };
    }

    await this.backend.ensureBrowser();
    await this.backend.fill(selector, value);

    const evidence: Record<string, unknown> = {
      type: "fill",
      selector,
      value,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(
      action,
      evidence,
    );
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async snapshot(): Promise<TaskResult> {
    await this.backend.ensureBrowser();
    const snap = await this.backend.snapshot();

    return {
      success: true,
      evidence: {
        type: "snapshot",
        html: snap.html,
        title: snap.title,
        url: snap.url,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Evaluates a postcondition against the current page state.
   * Returns a failing TaskResult when the postcondition is not met,
   * or null when the postcondition passes (or is absent).
   */
  private async evaluatePostconditionIfPresent(
    action: ActionPrimitive,
    evidence: Record<string, unknown>,
  ): Promise<TaskResult | null> {
    if (action.postcondition == null) return null;

    const snap = await this.backend.snapshot();
    const evalContext: EvaluationContext = {
      dom: { html: snap.html },
    };

    const postcondResult = checkPostcondition(action.postcondition, evalContext);
    if (postcondResult.report) {
      evidence.postcondition = postcondResult.report;
    }

    if (!postcondResult.passed) {
      evidence.postcondition ??= { passed: false, error: postcondResult.error };
      return {
        success: false,
        evidence,
        error: postcondResult.error ?? "postcondition failed",
      };
    }

    return null;
  }
}
