import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { DesktopActionArgs } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import type { DesktopBackend } from "./backends/desktop-backend.js";
import type {
  DesktopActArgs,
  DesktopBackendPermissions,
  DesktopQueryArgs,
  DesktopSnapshotArgs,
  DesktopUiRect,
  DesktopWaitForArgs,
} from "@tyrum/schemas";
import type { OcrEngine, OcrMatch } from "./ocr/types.js";

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

  constructor(
    private backend: DesktopBackend,
    private permissions: DesktopProviderPermissions,
    private requestConfirmation: ConfirmationFn,
    private ocr?: OcrEngine,
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

    const selector = _args.selector;
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

      if (matches.length >= _args.limit) break;
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
      await this.backend.doubleClickMouse(point.x, point.y);
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
    if (!this.permissions.desktopScreenshot) {
      return {
        success: false,
        error: "Desktop screenshot is disabled by permission profile",
      };
    }

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
}
