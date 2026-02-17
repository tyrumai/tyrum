import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
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

    switch (op) {
      case "navigate":
        return this.navigate(action, args);
      case "click":
        return this.click(action, args);
      case "fill":
        return this.fill(action, args);
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

    try {
      const snap = await this.backend.snapshot();
      const evalContext: EvaluationContext = {
        dom: { html: snap.html },
      };

      const report = evaluatePostcondition(action.postcondition, evalContext);
      evidence.postcondition = report;

      if (!report.passed) {
        return {
          success: false,
          evidence,
          error: `Action succeeded but postcondition failed: ${report.assertions
            .filter((a) => a.status === "failed")
            .map((a) => a.message)
            .join("; ")}`,
        };
      }
    } catch (err) {
      if (err instanceof PostconditionError) {
        evidence.postcondition = { passed: false, error: err.message };
        return {
          success: false,
          evidence,
          error: `Postcondition evaluation error: ${err.message}`,
        };
      }
      throw err;
    }

    return null;
  }
}
