import type { DesktopQueryMatch, DesktopUiRect } from "@tyrum/schemas";
import type { OcrMatch } from "./ocr/types.js";

export type PixelPoint = { x: number; y: number };
export type Capture = { width: number; height: number; buffer: Buffer };

const DEFAULT_OCR_TIMEOUT_MS = 30_000;
const MAX_OCR_TIMEOUT_MS = 60_000;
export const MAX_OCR_MATCH_TEXT_BYTES = 8_192;
export const MAX_OCR_MATCH_TEXT_CHARS = 512;
export const SCREENSHOT_DISABLED = "Desktop screenshot is disabled by permission profile";
export const INPUT_DISABLED = "Desktop input is disabled by permission profile";
export const COORDINATE_SPACE = { origin: "top-left", units: "px" } as const;

export function parsePixelRef(ref: string): PixelPoint | null {
  const match = /^pixel:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref.trim());
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export class OcrTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`OCR timeout after ${String(timeoutMs)}ms`);
    this.name = "OcrTimeoutError";
  }
}

export function resolveOcrTimeoutMs(): number {
  const raw = process.env["TYRUM_DESKTOP_OCR_TIMEOUT_MS"]?.trim();
  if (!raw) return DEFAULT_OCR_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_OCR_TIMEOUT_MS;
  const value = Math.floor(parsed);
  if (value <= 0) return DEFAULT_OCR_TIMEOUT_MS;
  return Math.min(value, MAX_OCR_TIMEOUT_MS);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function normalizeForContainsText(value: string, caseInsensitive: boolean): string {
  const trimmed = value.trim();
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

export function rectsIntersect(a: DesktopUiRect, b: DesktopUiRect): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

export function boundTextAroundMatch(value: string, matchIndex: number): string {
  if (value.length <= MAX_OCR_MATCH_TEXT_CHARS) return value;
  const windowSize = MAX_OCR_MATCH_TEXT_CHARS;
  const safeIndex = matchIndex >= 0 ? matchIndex : 0;
  const preferredStart = safeIndex - Math.floor(windowSize / 4);
  const maxStart = Math.max(0, value.length - windowSize);
  const start = Math.max(0, Math.min(maxStart, preferredStart));
  const sliced = value.slice(start, start + windowSize).trim();
  return sliced.length > 0 ? sliced : value.slice(0, windowSize).trim();
}

export function isAtspiRef(ref: string): boolean {
  return ref.trim().toLowerCase().startsWith("atspi:");
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function collectOcrMatches(
  candidates: OcrMatch[],
  queryText: string,
  caseInsensitive: boolean,
  boundsFilter: DesktopUiRect | undefined,
  limit: number,
): DesktopQueryMatch[] {
  const matches: DesktopQueryMatch[] = [];
  const normalizedNeedle = normalizeForContainsText(queryText, caseInsensitive);
  let totalTextBytes = 0;
  for (const candidate of candidates) {
    const candidateText = candidate.text.trim();
    if (!candidateText) continue;
    const matchIndex = normalizeForContainsText(candidateText, caseInsensitive).indexOf(
      normalizedNeedle,
    );
    if (matchIndex === -1 || (boundsFilter && !rectsIntersect(candidate.bounds, boundsFilter)))
      continue;
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
    if (matches.length >= limit) break;
  }
  return matches;
}
