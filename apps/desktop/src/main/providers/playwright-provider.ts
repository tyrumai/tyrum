import type { ActionPrimitive } from "@tyrum/operator-core";
import { checkPostcondition } from "@tyrum/operator-core";
import type { EvaluationContext } from "@tyrum/operator-core";
import type { CapabilityProvider, TaskResult } from "@tyrum/operator-core";
import type { PlaywrightBackend } from "./backends/playwright-backend.js";

export interface PlaywrightProviderConfig {
  allowedDomains: string[];
  headless: boolean;
  domainRestricted: boolean;
}

export class PlaywrightProvider implements CapabilityProvider {
  readonly capabilityIds = [
    "tyrum.browser.navigate",
    "tyrum.browser.navigate-back",
    "tyrum.browser.snapshot",
    "tyrum.browser.click",
    "tyrum.browser.type",
    "tyrum.browser.fill-form",
    "tyrum.browser.select-option",
    "tyrum.browser.hover",
    "tyrum.browser.drag",
    "tyrum.browser.press-key",
    "tyrum.browser.screenshot",
    "tyrum.browser.evaluate",
    "tyrum.browser.wait-for",
    "tyrum.browser.tabs",
    "tyrum.browser.upload-file",
    "tyrum.browser.console-messages",
    "tyrum.browser.network-requests",
    "tyrum.browser.resize",
    "tyrum.browser.close",
    "tyrum.browser.handle-dialog",
    "tyrum.browser.run-code",
  ] as const;

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
        case "navigate_back":
          return await this.navigateBack(action);
        case "click":
          return await this.click(action, args);
        case "fill":
        case "fill_form":
          return await this.fill(action, args);
        case "type":
          return await this.typeText(action, args);
        case "snapshot":
          return await this.snapshot();
        case "select_option":
          return await this.selectOption(args);
        case "hover":
          return await this.hover(args);
        case "drag":
          return await this.drag(args);
        case "press_key":
          return await this.pressKey(args);
        case "screenshot":
          return await this.screenshotOp(args);
        case "evaluate":
          return await this.evaluateOp(args);
        case "wait_for":
          return await this.waitFor(args);
        case "tabs":
          return await this.tabs(args);
        case "upload_file":
          return await this.uploadFile(args);
        case "console_messages":
          return await this.consoleMessages();
        case "network_requests":
          return await this.networkRequests();
        case "resize":
          return await this.resizeOp(args);
        case "close":
          return await this.closeOp();
        case "handle_dialog":
          return await this.handleDialogOp(args);
        case "run_code":
          return await this.runCodeOp(args);
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
      const hostname = new URL(url).hostname.toLowerCase();
      const allowedDomains = this.config.allowedDomains
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0);

      if (allowedDomains.includes("*")) return null;

      const allowed = allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
      if (!allowed) {
        const shownAllowlist =
          allowedDomains.length > 0 ? allowedDomains.join(", ") : "(empty: default deny)";
        return {
          success: false,
          error:
            `Domain allowlist is active (default deny). ` +
            `Domain "${hostname}" is not in the allowlist. Allowed: ${shownAllowlist}. ` +
            `Use "*" to allow all domains.`,
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
    const finalDomainCheck = this.checkDomain(result.url);
    if (finalDomainCheck) return finalDomainCheck;

    const evidence: Record<string, unknown> = {
      type: "navigate",
      url: result.url,
      title: result.title,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(action, evidence);
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async navigateBack(action: ActionPrimitive): Promise<TaskResult> {
    await this.backend.ensureBrowser();
    const result = await this.backend.goBack();
    const domainCheck = this.checkDomain(result.url);
    if (domainCheck) return domainCheck;

    const evidence: Record<string, unknown> = {
      type: "navigate_back",
      url: result.url,
      title: result.title,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(action, evidence);
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async click(action: ActionPrimitive, args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    if (!selector) return { success: false, error: "Missing 'selector' in click args" };

    await this.backend.ensureBrowser();
    await this.backend.click(selector);
    const snap = await this.backend.snapshot();
    const domainCheck = this.checkDomain(snap.url);
    if (domainCheck) return domainCheck;

    const evidence: Record<string, unknown> = {
      type: "click",
      selector,
      url: snap.url,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(action, evidence);
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async fill(action: ActionPrimitive, args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const value = args["value"] as string | undefined;
    if (!selector || value === undefined) {
      return { success: false, error: "Missing 'selector' or 'value' in fill args" };
    }

    await this.backend.ensureBrowser();
    await this.backend.fill(selector, value);
    const snap = await this.backend.snapshot();
    const domainCheck = this.checkDomain(snap.url);
    if (domainCheck) return domainCheck;

    const evidence: Record<string, unknown> = {
      type: "fill",
      selector,
      value,
      url: snap.url,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(action, evidence);
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async typeText(
    action: ActionPrimitive,
    args: Record<string, unknown>,
  ): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const text = args["text"] as string | undefined;
    if (!selector || !text) {
      return { success: false, error: "Missing 'selector' or 'text' in type args" };
    }
    const submit = args["submit"] === true;

    await this.backend.ensureBrowser();
    await this.backend.type(selector, text, submit);
    const snap = await this.backend.snapshot();
    const domainCheck = this.checkDomain(snap.url);
    if (domainCheck) return domainCheck;

    const evidence: Record<string, unknown> = {
      type: "type",
      selector,
      text,
      submit,
      url: snap.url,
      timestamp: new Date().toISOString(),
    };

    const postcondResult = await this.evaluatePostconditionIfPresent(action, evidence);
    if (postcondResult) return postcondResult;

    return { success: true, evidence };
  }

  private async snapshot(): Promise<TaskResult> {
    await this.backend.ensureBrowser();
    const snap = await this.backend.snapshot();
    const domainCheck = this.checkDomain(snap.url);
    if (domainCheck) return domainCheck;

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

  private async selectOption(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const values = args["values"] as string[] | undefined;
    if (!selector || !values) {
      return { success: false, error: "Missing 'selector' or 'values' in select_option args" };
    }

    await this.backend.ensureBrowser();
    const selected = await this.backend.selectOption(selector, values);

    return {
      success: true,
      evidence: { type: "select_option", selector, selected, timestamp: new Date().toISOString() },
    };
  }

  private async hover(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    if (!selector) return { success: false, error: "Missing 'selector' in hover args" };

    await this.backend.ensureBrowser();
    await this.backend.hover(selector);

    return {
      success: true,
      evidence: { type: "hover", selector, timestamp: new Date().toISOString() },
    };
  }

  private async drag(args: Record<string, unknown>): Promise<TaskResult> {
    const sourceSelector = args["source_selector"] as string | undefined;
    const targetSelector = args["target_selector"] as string | undefined;
    if (!sourceSelector || !targetSelector) {
      return {
        success: false,
        error: "Missing 'source_selector' or 'target_selector' in drag args",
      };
    }

    await this.backend.ensureBrowser();
    await this.backend.drag(sourceSelector, targetSelector);

    return {
      success: true,
      evidence: {
        type: "drag",
        sourceSelector,
        targetSelector,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async pressKey(args: Record<string, unknown>): Promise<TaskResult> {
    const key = args["key"] as string | undefined;
    if (!key) return { success: false, error: "Missing 'key' in press_key args" };
    const modifiers = args["modifiers"] as string[] | undefined;

    await this.backend.ensureBrowser();
    await this.backend.pressKey(key, modifiers);

    return {
      success: true,
      evidence: { type: "press_key", key, modifiers, timestamp: new Date().toISOString() },
    };
  }

  private async screenshotOp(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const fullPage = args["full_page"] === true;

    await this.backend.ensureBrowser();
    const result = await this.backend.screenshot(selector, fullPage);

    return {
      success: true,
      evidence: {
        type: "screenshot",
        mime: result.mime,
        bytesBase64: result.bytesBase64,
        width: result.width,
        height: result.height,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async evaluateOp(args: Record<string, unknown>): Promise<TaskResult> {
    const expression = args["expression"] as string | undefined;
    if (!expression) return { success: false, error: "Missing 'expression' in evaluate args" };

    await this.backend.ensureBrowser();
    const result = await this.backend.evaluate(expression);

    return {
      success: true,
      evidence: { type: "evaluate", result, timestamp: new Date().toISOString() },
    };
  }

  private async waitFor(args: Record<string, unknown>): Promise<TaskResult> {
    const options = {
      selector: args["selector"] as string | undefined,
      url: args["url"] as string | undefined,
      text: args["text"] as string | undefined,
      timeoutMs: args["timeout_ms"] as number | undefined,
    };

    await this.backend.ensureBrowser();
    const matched = await this.backend.waitFor(options);

    return {
      success: true,
      evidence: { type: "wait_for", matched, ...options, timestamp: new Date().toISOString() },
    };
  }

  private async tabs(args: Record<string, unknown>): Promise<TaskResult> {
    await this.backend.ensureBrowser();

    const switchTo = args["switch_to"] as number | undefined;
    if (switchTo !== undefined) {
      await this.backend.switchTab(switchTo);
    }

    const result = await this.backend.listTabs();

    return {
      success: true,
      evidence: { type: "tabs", ...result, timestamp: new Date().toISOString() },
    };
  }

  private async uploadFile(args: Record<string, unknown>): Promise<TaskResult> {
    const selector = args["selector"] as string | undefined;
    const paths = args["paths"] as string[] | undefined;
    if (!selector || !paths) {
      return { success: false, error: "Missing 'selector' or 'paths' in upload_file args" };
    }

    await this.backend.ensureBrowser();
    const count = await this.backend.uploadFile(selector, paths);

    return {
      success: true,
      evidence: {
        type: "upload_file",
        selector,
        filesUploaded: count,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async consoleMessages(): Promise<TaskResult> {
    await this.backend.ensureBrowser();
    const messages = await this.backend.getConsoleMessages();

    return {
      success: true,
      evidence: { type: "console_messages", messages, timestamp: new Date().toISOString() },
    };
  }

  private async networkRequests(): Promise<TaskResult> {
    await this.backend.ensureBrowser();
    const requests = await this.backend.getNetworkRequests();

    return {
      success: true,
      evidence: { type: "network_requests", requests, timestamp: new Date().toISOString() },
    };
  }

  private async resizeOp(args: Record<string, unknown>): Promise<TaskResult> {
    const width = args["width"] as number | undefined;
    const height = args["height"] as number | undefined;
    if (width === undefined || height === undefined) {
      return { success: false, error: "Missing 'width' or 'height' in resize args" };
    }

    await this.backend.ensureBrowser();
    await this.backend.resize(width, height);

    return {
      success: true,
      evidence: { type: "resize", width, height, timestamp: new Date().toISOString() },
    };
  }

  private async closeOp(): Promise<TaskResult> {
    await this.backend.close();

    return {
      success: true,
      evidence: { type: "close", timestamp: new Date().toISOString() },
    };
  }

  private async handleDialogOp(args: Record<string, unknown>): Promise<TaskResult> {
    const accept = args["accept"] as boolean | undefined;
    if (accept === undefined) {
      return { success: false, error: "Missing 'accept' in handle_dialog args" };
    }
    const promptText = args["prompt_text"] as string | undefined;

    await this.backend.ensureBrowser();
    const result = await this.backend.handleDialog(accept, promptText);

    return {
      success: true,
      evidence: { type: "handle_dialog", ...result, timestamp: new Date().toISOString() },
    };
  }

  private async runCodeOp(args: Record<string, unknown>): Promise<TaskResult> {
    const code = args["code"] as string | undefined;
    if (!code) return { success: false, error: "Missing 'code' in run_code args" };

    await this.backend.ensureBrowser();
    const result = await this.backend.runCode(code);

    return {
      success: true,
      evidence: { type: "run_code", result, timestamp: new Date().toISOString() },
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
