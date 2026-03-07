import type { ClientInterface } from "dbus-next";
import type {
  DesktopQueryArgs,
  DesktopUiNodeSummary,
  DesktopUiRect,
  DesktopUiTree,
  DesktopWindow,
} from "@tyrum/schemas";
import {
  MAX_ACTION_CHARS,
  MAX_NAME_CHARS,
  MAX_ROLE_CHARS,
  clampTrimmed,
} from "../a11y/schema-clamps.js";

export type AtSpiAccessibleRef = { busName: string; objectPath: string };

export const ATSPI_REF_PREFIX = "atspi:";
export const ATSPI_REF_SEPARATOR = "|";
export const ATSPI_REGISTRY_BUS_NAME = "org.a11y.atspi.Registry";
export const ATSPI_ROOT_ACCESSIBLE_PATH = "/org/a11y/atspi/accessible/root";
export const ATSPI_ROOT_ACCESSIBLE_REF: AtSpiAccessibleRef = {
  busName: ATSPI_REGISTRY_BUS_NAME,
  objectPath: ATSPI_ROOT_ACCESSIBLE_PATH,
};

export const QUERY_MAX_NODES = 8_192;
export const QUERY_MAX_CHILDREN = 512;

const MAX_WINDOWS = 32;

const ATSPI_STATE_TYPE_NAMES: Array<string | undefined> = [
  "invalid",
  "active",
  "armed",
  "busy",
  "checked",
  "collapsed",
  "defunct",
  "editable",
  "enabled",
  "expandable",
  "expanded",
  "focusable",
  "focused",
  "has_tooltip",
  "horizontal",
  "iconified",
  "modal",
  "multi_line",
  "multiselectable",
  "opaque",
  "pressed",
  "resizable",
  "selectable",
  "selected",
  "sensitive",
  "showing",
  "single_line",
  "stale",
  "transient",
  "vertical",
  "visible",
  "manages_descendants",
  "indeterminate",
  "required",
  "truncated",
  "animated",
  "invalid_entry",
  "supports_autocompletion",
  "selectable_text",
  "is_default",
  "visited",
  "checkable",
  "has_popup",
  "read_only",
];

export function unwrapDbusValue(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return unwrapDbusValue(value[0]);
  if (!value || typeof value !== "object") return value;
  const nested = (value as { value?: unknown }).value;
  return nested === undefined ? value : unwrapDbusValue(nested);
}

function toUint32(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  if (typeof value === "bigint") return Number(value & 0xffff_ffffn);
  if (value && typeof value === "object") {
    const toNumber = (value as { toNumber?: unknown }).toNumber;
    if (typeof toNumber === "function") {
      const num = toNumber.call(value) as unknown;
      if (typeof num === "number" && Number.isFinite(num)) return num >>> 0;
    }
  }
  return 0;
}

export function toNonNegativeInt(value: unknown): number {
  const unwrapped = unwrapDbusValue(value);
  if (unwrapped && typeof unwrapped === "object") {
    const toNumber = (unwrapped as { toNumber?: unknown }).toNumber;
    if (typeof toNumber === "function") {
      const num = toNumber.call(unwrapped) as unknown;
      if (typeof num === "number" && Number.isFinite(num)) return Math.max(0, Math.floor(num));
    }
  }
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped))
    return Math.max(0, Math.floor(unwrapped));
  if (typeof unwrapped === "bigint") {
    if (unwrapped <= 0n) return 0;
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(unwrapped > max ? max : unwrapped);
  }
  return 0;
}

export function normalizeDbusBoolean(value: unknown): boolean | undefined {
  const unwrapped = unwrapDbusValue(value);
  if (typeof unwrapped === "boolean") return unwrapped;
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    if (unwrapped === 0) return false;
    if (unwrapped === 1) return true;
  }
  if (typeof unwrapped === "bigint") {
    if (unwrapped === 0n) return false;
    if (unwrapped === 1n) return true;
  }
  return undefined;
}

function extractAtSpiStateWords(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === "number" || typeof raw === "bigint") return [raw];
  if (raw && typeof raw === "object") {
    const value = (raw as { value?: unknown }).value;
    if (value !== undefined) return extractAtSpiStateWords(value);
  }
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];
  if (raw.every((v) => typeof v === "number" || typeof v === "bigint")) return raw;
  const first = raw[0];
  if (Array.isArray(first)) return extractAtSpiStateWords(first);
  const out: unknown[] = [];
  for (const item of raw) {
    out.push(...extractAtSpiStateWords(item));
    if (out.length >= 2) break;
  }
  return out;
}

export function parseAtSpiStates(raw: unknown): string[] {
  const wordsRaw = extractAtSpiStateWords(raw);
  const word0 = toUint32(wordsRaw[0]);
  const word1 = toUint32(wordsRaw[1]);
  if (word0 === 0 && word1 === 0) return [];
  const states: string[] = [];
  for (let i = 0; i < ATSPI_STATE_TYPE_NAMES.length; i++) {
    const name = ATSPI_STATE_TYPE_NAMES[i];
    if (!name) continue;
    const bit = i % 32;
    const word = i < 32 ? word0 : word1;
    if (((word >>> bit) & 1) === 1) states.push(name);
  }
  return states;
}

export function toAtSpiElementRef(ref: AtSpiAccessibleRef): string {
  return `${ATSPI_REF_PREFIX}${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
}

export function parseAtSpiElementRef(input: string): AtSpiAccessibleRef | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith(ATSPI_REF_PREFIX)) return null;
  const rest = trimmed.slice(ATSPI_REF_PREFIX.length);
  const sep = rest.indexOf(ATSPI_REF_SEPARATOR);
  if (sep <= 0) return null;
  const busName = rest.slice(0, sep);
  const objectPath = rest.slice(sep + 1);
  if (!busName || !objectPath.startsWith("/")) return null;
  return { busName, objectPath };
}

export function parseAccessibleRef(value: unknown): AtSpiAccessibleRef | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [busName, objectPath] = value;
  if (typeof busName !== "string" || typeof objectPath !== "string") return null;
  if (!busName.trim()) return null;
  if (!objectPath.startsWith("/")) return null;
  return { busName, objectPath };
}

export function normalizeMaybe(value: unknown): string | undefined {
  const unwrapped = unwrapDbusValue(value);
  if (typeof unwrapped !== "string") return undefined;
  const trimmed = unwrapped.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeRole(value: string | undefined): string {
  return clampTrimmed(value?.toLowerCase() ?? "", MAX_ROLE_CHARS) || "unknown";
}

export function normalizeName(value: string | undefined): string {
  return value ? clampTrimmed(value, MAX_NAME_CHARS) : "";
}

export function toRect(value: unknown): DesktopUiRect {
  if (!Array.isArray(value) || value.length < 4) return { x: 0, y: 0, width: 0, height: 0 };
  const [x, y, width, height] = value;
  const xn = typeof x === "number" && Number.isFinite(x) ? x : 0;
  const yn = typeof y === "number" && Number.isFinite(y) ? y : 0;
  const wn = typeof width === "number" && Number.isFinite(width) ? Math.max(0, width) : 0;
  const hn = typeof height === "number" && Number.isFinite(height) ? Math.max(0, height) : 0;
  return { x: xn, y: yn, width: wn, height: hn };
}

export function matchesSelector(input: {
  selector: DesktopQueryArgs["selector"];
  node: Pick<DesktopUiNodeSummary, "role" | "name" | "states">;
}): boolean {
  const selector = input.selector;
  if (selector.kind !== "a11y") return false;
  if (selector.role) {
    const want = selector.role.trim().toLowerCase();
    if (want && input.node.role.trim().toLowerCase() !== want) return false;
  }
  if (selector.name) {
    const needle = selector.name.trim().toLowerCase();
    if (needle && !input.node.name.trim().toLowerCase().includes(needle)) return false;
  }
  if (selector.states.length > 0) {
    const haystack = new Set(input.node.states.map((s) => s.toLowerCase()));
    for (const state of selector.states) {
      const want = state.trim().toLowerCase();
      if (!want) continue;
      if (!haystack.has(want)) return false;
    }
  }
  return true;
}

export function extractWindowsFromTree(root: DesktopUiTree["root"]): DesktopWindow[] {
  const windows: DesktopWindow[] = [];
  const seen = new Set<string>();
  const visit = (node: DesktopUiTree["root"]): void => {
    if (windows.length >= MAX_WINDOWS) return;
    const role = node.role.trim().toLowerCase();
    const isWindowRole = role === "frame" || role === "dialog" || role === "window";
    if (
      isWindowRole &&
      typeof node.ref === "string" &&
      node.ref.length > 0 &&
      node.ref.length <= 256
    ) {
      const ref = node.ref;
      if (!seen.has(ref)) {
        seen.add(ref);
        const title = node.name.trim();
        windows.push({
          ref,
          title: title.length > 0 ? title : undefined,
          bounds: node.bounds,
          focused: node.states.some((state) => state.trim().toLowerCase() === "active"),
        });
      }
    }
    for (const child of node.children) {
      if (windows.length >= MAX_WINDOWS) break;
      visit(child);
    }
  };
  visit(root);
  return windows;
}

export async function loadDbus(): Promise<typeof import("dbus-next")> {
  return await import("dbus-next");
}

export type AtSpiDynamicMethod = (...args: unknown[]) => unknown;

export function getAtSpiDynamicMethod(
  iface: ClientInterface,
  methodName: string,
): AtSpiDynamicMethod | null {
  const candidate = (iface as unknown as Record<string, unknown>)[methodName];
  return typeof candidate === "function" ? (candidate as AtSpiDynamicMethod) : null;
}
