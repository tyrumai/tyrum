import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { DesktopActionArgs } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { DesktopBackend } from "./backends/desktop-backend.js";
import type { DesktopA11yBackend } from "./backends/desktop-a11y-backend.js";
import type {
  DesktopActArgs,
  DesktopBackendPermissions,
  DesktopQueryMatch,
  DesktopQueryArgs,
  DesktopSnapshotArgs,
  DesktopUiRect,
  DesktopUiTree,
  DesktopWindow,
  DesktopWaitForArgs,
} from "@tyrum/schemas";
import type { OcrEngine, OcrMatch } from "./ocr/types.js";
import { DEFAULT_A11Y_MAX_DEPTH, pruneUiTree } from "./a11y/prune-ui-tree.js";

export interface DesktopProviderPermissions {
  desktopScreenshot: boolean;
  desktopInput: boolean;
  desktopInputRequiresConfirmation: boolean;
}

export type ConfirmationFn = (prompt: string) => Promise<boolean>;

type PixelPoint = { x: number; y: number };

const DEFAULT_OCR_TIMEOUT_MS = 30_000;
const MAX_OCR_TIMEOUT_MS = 60_000;
const MAX_OCR_MATCH_TEXT_BYTES = 8_192;
const MAX_OCR_MATCH_TEXT_CHARS = 512;

function parsePixelRef(ref: string): PixelPoint | null {
  const match = /^pixel:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref.trim());
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

class OcrTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`OCR timeout after ${String(timeoutMs)}ms`);
    this.name = "OcrTimeoutError";
  }
}

function resolveOcrTimeoutMs(): number {
  const raw = process.env["TYRUM_DESKTOP_OCR_TIMEOUT_MS"]?.trim();
  if (!raw) return DEFAULT_OCR_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_OCR_TIMEOUT_MS;
  const value = Math.floor(parsed);
  if (value <= 0) return DEFAULT_OCR_TIMEOUT_MS;
  return Math.min(value, MAX_OCR_TIMEOUT_MS);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeForContainsText(value: string, caseInsensitive: boolean): string {
  const trimmed = value.trim();
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

function rectsIntersect(a: DesktopUiRect, b: DesktopUiRect): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function boundTextAroundMatch(value: string, matchIndex: number): string {
  if (value.length <= MAX_OCR_MATCH_TEXT_CHARS) return value;

  const windowSize = MAX_OCR_MATCH_TEXT_CHARS;
  const safeIndex = matchIndex >= 0 ? matchIndex : 0;
  const preferredStart = safeIndex - Math.floor(windowSize / 4);
  const maxStart = Math.max(0, value.length - windowSize);
  const start = Math.max(0, Math.min(maxStart, preferredStart));
  const sliced = value.slice(start, start + windowSize).trim();

  return sliced.length > 0 ? sliced : value.slice(0, windowSize).trim();
}

export class DesktopProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "desktop";

  private a11yBackendState: "unknown" | "available" | "unavailable" = "unknown";

  constructor(
    private backend: DesktopBackend,
    private permissions: DesktopProviderPermissions,
    private requestConfirmation: ConfirmationFn,
    private ocr?: OcrEngine,
    private a11yBackend?: DesktopA11yBackend,
  ) {}

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

  private backendPermissions(accessibility: boolean): DesktopBackendPermissions {
    return {
      accessibility,
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

  private async snapshot(args: DesktopSnapshotArgs): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const capture = await this.backend.captureScreen("primary");

    let mode: "pixel" | "hybrid" = "pixel";
    let accessibility = false;
    let windows: DesktopWindow[] = [];
    let tree: DesktopUiTree | undefined;

    if (args.include_tree) {
      const a11yBackend = await this.resolveA11yBackend();
      if (a11yBackend) {
        try {
          const snapshot = await a11yBackend.snapshot(args);
          accessibility = true;
          mode = "hybrid";
          windows = snapshot.windows;
          tree = pruneUiTree(snapshot.tree, {
            maxNodes: args.max_nodes,
            maxTextChars: args.max_text_chars,
            maxDepth: DEFAULT_A11Y_MAX_DEPTH,
          });
        } catch {
          // Fall back to pixel mode, but allow future AT-SPI retries.
          this.a11yBackendState = "unknown";
        }
      }
    }

    return {
      success: true,
      result: {
        op: "snapshot",
        backend: {
          mode,
          permissions: this.backendPermissions(accessibility),
        },
        windows,
        tree,
      },
      evidence: this.toImageEvidence("snapshot", capture, { mode }),
    };
  }

  private async query(args: DesktopQueryArgs): Promise<TaskResult> {
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const selector = args.selector;
    const wantsA11y =
      selector.kind === "a11y" ||
      (selector.kind === "ref" && selector.ref.trim().toLowerCase().startsWith("atspi:"));

    if (wantsA11y) {
      const a11yBackend = await this.resolveA11yBackend();
      if (a11yBackend) {
        try {
          const matches = await a11yBackend.query(args);
          return {
            success: true,
            result: {
              op: "query",
              matches,
            },
            evidence: {
              type: "query",
              mode: "a11y",
              timestamp: new Date().toISOString(),
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: message };
        }
      }
    }

    const queryText =
      selector.kind === "ocr"
        ? selector.text
        : selector.kind === "a11y"
          ? selector.name
          : undefined;
    if (!queryText || !queryText.trim()) {
      return {
        success: false,
        error:
          selector.kind === "a11y"
            ? "Pixel query requires an a11y selector name for OCR text search"
            : `Unsupported query selector kind for pixel mode: ${selector.kind}`,
      };
    }

    const timeoutMs = resolveOcrTimeoutMs();
    const ocr = this.ocr;
    if (!ocr) {
      return {
        success: false,
        error: "OCR unavailable: no OCR engine configured",
      };
    }

    const capture = await this.backend.captureScreen("primary");

    const caseInsensitive = selector.kind === "ocr" ? selector.case_insensitive : true;
    const normalizedNeedle = normalizeForContainsText(queryText, caseInsensitive);

    let candidates: OcrMatch[];
    try {
      candidates = await withTimeout(
        ocr.recognize({ buffer: capture.buffer, width: capture.width, height: capture.height }),
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof OcrTimeoutError) {
        await ocr.reset?.().catch(() => undefined);
        return { success: false, error: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `OCR failed: ${message}` };
    }

    const boundsFilter = selector.kind === "ocr" ? selector.bounds : undefined;
    const matches: Array<{
      kind: "ocr";
      text: string;
      bounds: DesktopUiRect;
      confidence?: number;
    }> = [];
    let totalTextBytes = 0;

    for (const candidate of candidates) {
      const candidateText = candidate.text.trim();
      if (!candidateText) continue;

      const normalizedHaystack = normalizeForContainsText(candidateText, caseInsensitive);
      const matchIndex = normalizedHaystack.indexOf(normalizedNeedle);
      if (matchIndex === -1) continue;

      if (boundsFilter && !rectsIntersect(candidate.bounds, boundsFilter)) continue;

      const boundedText = boundTextAroundMatch(candidateText, matchIndex);
      if (!boundedText) continue;

      const nextBytes = Buffer.byteLength(boundedText, "utf8");
      if (totalTextBytes + nextBytes > MAX_OCR_MATCH_TEXT_BYTES) continue;
      totalTextBytes += nextBytes;

      matches.push({
        kind: "ocr",
        text: boundedText,
        bounds: candidate.bounds,
        confidence: candidate.confidence,
      });

      if (matches.length >= args.limit) break;
    }

    return {
      success: true,
      result: {
        op: "query",
        matches,
      },
      evidence: {
        type: "query",
        width: capture.width,
        height: capture.height,
        timestamp: new Date().toISOString(),
        mode: "pixel",
        coordinate_space: {
          origin: "top-left",
          units: "px",
        },
        ocr: {
          contains_text: queryText,
          case_insensitive: caseInsensitive,
          timeout_ms: timeoutMs,
        },
      },
    };
  }

  private async act(args: DesktopActArgs): Promise<TaskResult> {
    if (!this.permissions.desktopInput) {
      return {
        success: false,
        error: "Desktop input is disabled by permission profile",
      };
    }

    const targetRef = args.target.kind === "ref" ? args.target.ref : undefined;
    const isA11yTarget =
      args.target.kind === "a11y" ||
      (targetRef !== undefined && targetRef.trim().toLowerCase().startsWith("atspi:"));

    if (isA11yTarget) {
      const a11yBackend = await this.resolveA11yBackend();
      if (a11yBackend) {
        if (this.permissions.desktopInputRequiresConfirmation) {
          const approved = await this.requestConfirmation(
            `Allow desktop act ${args.action.kind} via accessibility?`,
          );
          if (!approved) {
            return { success: false, error: "User denied desktop act" };
          }
        }

        try {
          const result = await a11yBackend.act(args);
          return {
            success: true,
            result: {
              op: "act",
              target: args.target,
              action: args.action,
              resolved_element_ref: result.resolved_element_ref,
            },
            evidence: {
              type: "act",
              mode: "a11y",
              action: args.action.kind,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: message };
        }
      }

      if (args.target.kind === "ref") {
        return {
          success: false,
          error:
            "AT-SPI backend unavailable for atspi: refs (pixel fallback requires an OCR selector or pixel ref)",
        };
      }

      if (args.target.kind !== "a11y") {
        return {
          success: false,
          error: `Unsupported act target kind for a11y fallback: ${args.target.kind}`,
        };
      }

      const name = args.target.name;
      if (!name || !name.trim()) {
        return {
          success: false,
          error: "Pixel act requires an a11y selector name for OCR text search",
        };
      }

      const ocrResult = await this.query({
        op: "query",
        selector: { kind: "ocr", text: name, case_insensitive: true },
        limit: 1,
      });
      if (!ocrResult.success) return ocrResult;

      const matches = (
        ocrResult.result as { matches?: Array<{ kind: string; bounds?: DesktopUiRect }> }
      )?.matches;
      const match = matches?.[0];
      if (!match || match.kind !== "ocr" || !match.bounds) {
        return { success: false, error: `OCR target not found: "${name}"` };
      }

      const point: PixelPoint = {
        x: match.bounds.x + match.bounds.width / 2,
        y: match.bounds.y + match.bounds.height / 2,
      };

      if (this.permissions.desktopInputRequiresConfirmation) {
        const approved = await this.requestConfirmation(
          `Allow desktop act ${args.action.kind} at (${point.x}, ${point.y})?`,
        );
        if (!approved) {
          return { success: false, error: "User denied desktop act" };
        }
      }

      await this.performPixelAct(point, args.action);

      return {
        success: true,
        result: {
          op: "act",
          target: args.target,
          action: args.action,
          resolved_element_ref: `pixel:${point.x},${point.y}`,
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

    await this.performPixelAct(point, args.action);

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
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

    const start = Date.now();
    const deadline = start + args.timeout_ms;
    let lastMatch: DesktopQueryMatch | undefined;

    while (true) {
      const queryResult = await this.query({
        op: "query",
        selector: args.selector,
        limit: 1,
      });

      const matches = (() => {
        if (!queryResult.success) return [] as DesktopQueryMatch[];
        const result = queryResult.result as { matches?: DesktopQueryMatch[] } | undefined;
        return Array.isArray(result?.matches) ? result.matches : [];
      })();

      lastMatch = matches[0] ?? lastMatch;

      const satisfied = args.state === "hidden" ? matches.length === 0 : matches.length > 0;
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

      const now = Date.now();
      const remaining = deadline - now;
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
        match: args.state === "hidden" ? lastMatch : undefined,
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
        return { success: false, error: `Unsupported mouse action: ${args.action}` };
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
        return { success: false, error: `Unsupported keyboard action: ${args.action}` };
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

    // click | focus
    await this.backend.clickMouse(point.x, point.y);
  }
}
