import type { CapabilityProvider, TaskResult } from "@tyrum/node-sdk";
import {
  DesktopActionArgs,
  type ActionPrimitive,
  type ClientCapability,
  type DesktopActArgs,
  type DesktopBackendPermissions,
  type DesktopQueryArgs,
  type DesktopQueryMatch,
  type DesktopSnapshotArgs,
  type DesktopUiRect,
  type DesktopUiTree,
  type DesktopWaitForArgs,
  type DesktopWindow,
} from "@tyrum/contracts";
import { DEFAULT_A11Y_MAX_DEPTH, pruneUiTree } from "./a11y/prune-ui-tree.js";
import type { DesktopA11yBackend } from "./backends/desktop-a11y-backend.js";
import type { DesktopBackend } from "./backends/desktop-backend.js";
import {
  describeDesktopExecutionError,
  executeClipboardWrite,
  executeKeyboardAction,
  executeMouseAction,
  resolveDesktopCapabilityIds,
} from "./desktop-provider-input.js";
import type { OcrEngine, OcrMatch } from "./ocr/types.js";

import {
  type PixelPoint,
  type Capture,
  SCREENSHOT_DISABLED,
  INPUT_DISABLED,
  COORDINATE_SPACE,
  parsePixelRef,
  OcrTimeoutError,
  resolveOcrTimeoutMs,
  withTimeout,
  isAtspiRef,
  toErrorMessage,
  collectOcrMatches,
} from "./desktop-provider-helpers.js";

export interface DesktopProviderPermissions {
  desktopScreenshot: boolean;
  desktopInput: boolean;
  desktopInputRequiresConfirmation: boolean;
}

export type ConfirmationFn = (prompt: string) => Promise<boolean>;

type SnapshotState = {
  mode: "pixel" | "hybrid";
  accessibility: boolean;
  windows: DesktopWindow[];
  tree?: DesktopUiTree;
};

export class DesktopProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "desktop";
  readonly capabilityIds: readonly string[];
  private a11yBackendState: "unknown" | "available" | "unavailable" = "unknown";

  constructor(
    private backend: DesktopBackend,
    private permissions: DesktopProviderPermissions,
    private requestConfirmation: ConfirmationFn,
    private ocr?: OcrEngine,
    private a11yBackend?: DesktopA11yBackend,
  ) {
    this.capabilityIds = resolveDesktopCapabilityIds({
      supportsClipboardWrite: this.backend.supportsClipboardWrite,
    });
  }

  private fail(error: string): TaskResult {
    return { success: false, error };
  }

  private requireScreenshot(): TaskResult | undefined {
    return this.permissions.desktopScreenshot ? undefined : this.fail(SCREENSHOT_DISABLED);
  }

  private requireInput(): TaskResult | undefined {
    return this.permissions.desktopInput ? undefined : this.fail(INPUT_DISABLED);
  }

  private evidence<T extends Record<string, unknown>>(value: T): T & { timestamp: string } {
    return { ...value, timestamp: new Date().toISOString() };
  }

  private async resolveA11yBackend(): Promise<DesktopA11yBackend | null> {
    if (this.a11yBackendState === "available") return this.a11yBackend ?? null;
    if (this.a11yBackendState === "unavailable") return null;
    if (process.platform !== "linux" || !this.a11yBackend) {
      this.a11yBackendState = "unavailable";
      return null;
    }
    try {
      const available = await this.a11yBackend.isAvailable();
      this.a11yBackendState = available ? "available" : "unavailable";
      return available ? this.a11yBackend : null;
    } catch {
      this.a11yBackendState = "unavailable";
      return null;
    }
  }

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const parseResult = DesktopActionArgs.safeParse(action.args);
    if (!parseResult.success)
      return this.fail(`Invalid desktop args: ${parseResult.error.message}`);
    const args = parseResult.data;
    try {
      switch (args.op) {
        case "screenshot":
          return await this.screenshot(args);
        case "mouse":
          return await executeMouseAction(args, {
            backend: this.backend,
            requireInput: () => this.requireInput(),
            confirm: (prompt, deniedMessage) => this.confirm(prompt, deniedMessage),
            fail: (error) => this.fail(error),
            evidence: (value) => this.evidence(value),
          });
        case "keyboard":
          return await executeKeyboardAction(args, {
            backend: this.backend,
            requireInput: () => this.requireInput(),
            confirm: (prompt, deniedMessage) => this.confirm(prompt, deniedMessage),
            fail: (error) => this.fail(error),
            evidence: (value) => this.evidence(value),
          });
        case "clipboard_write":
          return await executeClipboardWrite(args, {
            backend: this.backend,
            requireInput: () => this.requireInput(),
            confirm: (prompt, deniedMessage) => this.confirm(prompt, deniedMessage),
            fail: (error) => this.fail(error),
            evidence: (value) => this.evidence(value),
          });
        case "snapshot":
          return await this.snapshot(args);
        case "query":
          return await this.query(args);
        case "act":
          return await this.act(args);
        case "wait_for":
          return await this.waitFor(args);
        default:
          return this.fail(`Unsupported desktop operation: ${(args as { op: string }).op}`);
      }
    } catch (err) {
      return this.fail(describeDesktopExecutionError(args.op, err));
    }
  }

  private backendPermissions(accessibility: boolean): DesktopBackendPermissions {
    return {
      accessibility,
      screen_capture: this.permissions.desktopScreenshot,
      input_control: this.permissions.desktopInput,
    };
  }

  private toImageEvidence(
    type: string,
    capture: Capture,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return this.evidence({
      type,
      mime: "image/png",
      width: capture.width,
      height: capture.height,
      bytesBase64: capture.buffer.toString("base64"),
      ...extra,
    });
  }

  private async confirm(prompt: string, deniedMessage: string): Promise<TaskResult | undefined> {
    if (!this.permissions.desktopInputRequiresConfirmation) return undefined;
    return (await this.requestConfirmation(prompt)) ? undefined : this.fail(deniedMessage);
  }

  private extractMatches(result: TaskResult["result"]): DesktopQueryMatch[] {
    const matches = (result as { matches?: DesktopQueryMatch[] } | undefined)?.matches;
    return Array.isArray(matches) ? matches : [];
  }

  private queryText(selector: DesktopQueryArgs["selector"]): string | undefined {
    return selector.kind === "ocr"
      ? selector.text
      : selector.kind === "a11y"
        ? selector.name
        : undefined;
  }

  private async snapshotState(args: DesktopSnapshotArgs): Promise<SnapshotState> {
    const empty: SnapshotState = { mode: "pixel", accessibility: false, windows: [] };
    if (!args.include_tree) return empty;
    const a11yBackend = await this.resolveA11yBackend();
    if (!a11yBackend) return empty;
    try {
      const snapshot = await a11yBackend.snapshot(args);
      return {
        mode: "hybrid",
        accessibility: true,
        windows: snapshot.windows,
        tree: pruneUiTree(snapshot.tree, {
          maxNodes: args.max_nodes,
          maxTextChars: args.max_text_chars,
          maxDepth: DEFAULT_A11Y_MAX_DEPTH,
        }),
      };
    } catch {
      this.a11yBackendState = "unknown";
      return empty;
    }
  }

  private async queryViaA11y(args: DesktopQueryArgs): Promise<TaskResult | undefined> {
    const { selector } = args;
    const wantsA11y =
      selector.kind === "a11y" || (selector.kind === "ref" && isAtspiRef(selector.ref));
    if (!wantsA11y) return undefined;
    const a11yBackend = await this.resolveA11yBackend();
    if (!a11yBackend) return undefined;
    try {
      const matches = await a11yBackend.query(args);
      return {
        success: true,
        result: { op: "query", matches },
        evidence: this.evidence({ type: "query", mode: "a11y" }),
      };
    } catch (err) {
      return this.fail(toErrorMessage(err));
    }
  }

  private actResult(
    args: DesktopActArgs,
    mode: "a11y" | "pixel",
    resolvedElementRef?: string,
    point?: PixelPoint,
  ): TaskResult {
    return {
      success: true,
      result: {
        op: "act",
        target: args.target,
        action: args.action,
        ...(resolvedElementRef === undefined ? {} : { resolved_element_ref: resolvedElementRef }),
      },
      evidence: this.evidence({
        type: "act",
        mode,
        action: args.action.kind,
        ...(point ? { x: point.x, y: point.y } : {}),
      }),
    };
  }

  private async resolvePointFromA11yName(
    name: string,
  ): Promise<{ point: PixelPoint } | TaskResult> {
    const ocrResult = await this.query({
      op: "query",
      selector: { kind: "ocr", text: name, case_insensitive: true },
      limit: 1,
    });
    if (!ocrResult.success) return ocrResult;
    const match = ((
      ocrResult.result as { matches?: Array<{ kind: string; bounds?: DesktopUiRect }> } | undefined
    )?.matches ?? [])[0];
    if (!match || match.kind !== "ocr" || !match.bounds)
      return this.fail(`OCR target not found: "${name}"`);
    return {
      point: {
        x: match.bounds.x + match.bounds.width / 2,
        y: match.bounds.y + match.bounds.height / 2,
      },
    };
  }

  private async actViaA11y(args: DesktopActArgs): Promise<TaskResult | undefined> {
    const targetRef = args.target.kind === "ref" ? args.target.ref : undefined;
    const isA11yTarget =
      args.target.kind === "a11y" || (targetRef !== undefined && isAtspiRef(targetRef));
    if (!isA11yTarget) return undefined;
    const a11yBackend = await this.resolveA11yBackend();
    if (a11yBackend) {
      const denied = await this.confirm(
        `Allow desktop act ${args.action.kind} via accessibility?`,
        "User denied desktop act",
      );
      if (denied) return denied;
      try {
        const result = await a11yBackend.act(args);
        return this.actResult(args, "a11y", result.resolved_element_ref);
      } catch (err) {
        return this.fail(toErrorMessage(err));
      }
    }
    if (args.target.kind === "ref") {
      return this.fail(
        "AT-SPI backend unavailable for atspi: refs (pixel fallback requires an OCR selector or pixel ref)",
      );
    }
    if (args.target.kind !== "a11y")
      return this.fail(`Unsupported act target kind for a11y fallback: ${args.target.kind}`);
    const name = args.target.name?.trim();
    if (!name) return this.fail("Pixel act requires an a11y selector name for OCR text search");
    const pointResult = await this.resolvePointFromA11yName(name);
    if ("success" in pointResult) return pointResult;
    const { point } = pointResult;
    const denied = await this.confirm(
      `Allow desktop act ${args.action.kind} at (${point.x}, ${point.y})?`,
      "User denied desktop act",
    );
    if (denied) return denied;
    await this.performPixelAct(point, args.action);
    return this.actResult(args, "pixel", `pixel:${point.x},${point.y}`, point);
  }

  private async screenshot(args: {
    display: "primary" | "all" | { id: string };
    max_width?: number;
  }): Promise<TaskResult> {
    const denied = this.requireScreenshot();
    if (denied) return denied;
    const capture = await this.backend.captureScreen(args.display);
    return { success: true, evidence: this.toImageEvidence("screenshot", capture) };
  }

  private async snapshot(args: DesktopSnapshotArgs): Promise<TaskResult> {
    const denied = this.requireScreenshot();
    if (denied) return denied;
    const capture = await this.backend.captureScreen("primary");
    const { mode, accessibility, windows, tree } = await this.snapshotState(args);
    return {
      success: true,
      result: {
        op: "snapshot",
        backend: { mode, permissions: this.backendPermissions(accessibility) },
        windows,
        tree,
      },
      evidence: this.toImageEvidence("snapshot", capture, { mode }),
    };
  }

  private async query(args: DesktopQueryArgs): Promise<TaskResult> {
    const denied = this.requireScreenshot();
    if (denied) return denied;
    const a11yResult = await this.queryViaA11y(args);
    if (a11yResult) return a11yResult;
    const queryText = this.queryText(args.selector);
    if (!queryText?.trim()) {
      return this.fail(
        args.selector.kind === "a11y"
          ? "Pixel query requires an a11y selector name for OCR text search"
          : `Unsupported query selector kind for pixel mode: ${args.selector.kind}`,
      );
    }
    const ocr = this.ocr;
    if (!ocr) return this.fail("OCR unavailable: no OCR engine configured");
    const timeoutMs = resolveOcrTimeoutMs();
    const capture = await this.backend.captureScreen("primary");
    const caseInsensitive = args.selector.kind === "ocr" ? args.selector.case_insensitive : true;
    let candidates: OcrMatch[];
    try {
      candidates = await withTimeout(
        ocr.recognize({ buffer: capture.buffer, width: capture.width, height: capture.height }),
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof OcrTimeoutError) {
        await ocr.reset?.().catch(() => undefined);
        return this.fail(err.message);
      }
      return this.fail(`OCR failed: ${toErrorMessage(err)}`);
    }
    const boundsFilter = args.selector.kind === "ocr" ? args.selector.bounds : undefined;
    const matches = collectOcrMatches(
      candidates,
      queryText,
      caseInsensitive,
      boundsFilter,
      args.limit,
    );
    return {
      success: true,
      result: { op: "query", matches },
      evidence: this.evidence({
        type: "query",
        width: capture.width,
        height: capture.height,
        mode: "pixel",
        coordinate_space: COORDINATE_SPACE,
        ocr: { contains_text: queryText, case_insensitive: caseInsensitive, timeout_ms: timeoutMs },
      }),
    };
  }

  private async act(args: DesktopActArgs): Promise<TaskResult> {
    const denied = this.requireInput();
    if (denied) return denied;
    const a11yResult = await this.actViaA11y(args);
    if (a11yResult) return a11yResult;
    if (args.target.kind !== "ref")
      return this.fail(`Unsupported act target kind for pixel mode: ${args.target.kind}`);
    const point = parsePixelRef(args.target.ref);
    if (!point)
      return this.fail(`Unsupported pixel ref format: "${args.target.ref}" (expected "pixel:x,y")`);
    const confirmation = await this.confirm(
      `Allow desktop act ${args.action.kind} at (${point.x}, ${point.y})?`,
      "User denied desktop act",
    );
    if (confirmation) return confirmation;
    await this.performPixelAct(point, args.action);
    return this.actResult(args, "pixel", args.target.ref, point);
  }

  private async waitFor(args: DesktopWaitForArgs): Promise<TaskResult> {
    const denied = this.requireScreenshot();
    if (denied) return denied;
    const start = Date.now();
    const deadline = start + args.timeout_ms;
    let lastMatch: DesktopQueryMatch | undefined;
    while (true) {
      const queryResult = await this.query({ op: "query", selector: args.selector, limit: 1 });
      const matches = queryResult.success ? this.extractMatches(queryResult.result) : [];
      lastMatch = matches[0] ?? lastMatch;
      const satisfied =
        queryResult.success &&
        (args.state === "hidden" ? matches.length === 0 : matches.length > 0);
      if (satisfied) {
        const elapsed = Date.now() - start;
        return {
          success: true,
          result: {
            op: "wait_for",
            selector: args.selector,
            state: args.state,
            status: "satisfied",
            elapsed_ms: elapsed,
            match: args.state === "hidden" ? undefined : matches[0],
          },
        };
      }
      const sleepMs = Math.min(args.poll_ms, Math.max(0, deadline - Date.now()));
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
        match: args.state === "hidden" ? lastMatch : undefined,
      },
    };
  }

  private async performPixelAct(
    point: PixelPoint,
    action: DesktopActArgs["action"],
  ): Promise<void> {
    if (action.kind === "right_click") {
      await this.backend.clickMouse(point.x, point.y, "right");
      return;
    }
    if (action.kind === "double_click") {
      await this.backend.doubleClickMouse(point.x, point.y);
      return;
    }
    await this.backend.clickMouse(point.x, point.y);
  }
}
