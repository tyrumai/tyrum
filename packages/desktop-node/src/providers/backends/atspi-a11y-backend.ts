import type { ClientInterface, MessageBus } from "dbus-next";

import type {
  DesktopActArgs,
  DesktopQueryArgs,
  DesktopQueryMatch,
  DesktopSnapshotArgs,
  DesktopUiNodeSummary,
  DesktopUiRect,
  DesktopUiTree,
  DesktopWindow,
} from "@tyrum/schemas";

import { DEFAULT_A11Y_MAX_DEPTH } from "../a11y/prune-ui-tree.js";
import {
  MAX_ACTION_CHARS,
  MAX_NAME_CHARS,
  MAX_NODE_ACTIONS,
  MAX_NODE_CHILDREN,
  MAX_NODE_STATES,
  MAX_ROLE_CHARS,
  MAX_STATE_CHARS,
  clampTrimmed,
} from "../a11y/schema-clamps.js";
import type {
  DesktopA11yActResult,
  DesktopA11yBackend,
  DesktopA11ySnapshot,
} from "./desktop-a11y-backend.js";

type AtSpiAccessibleRef = { busName: string; objectPath: string };

const ATSPI_REF_PREFIX = "atspi:";
const ATSPI_REF_SEPARATOR = "|";
const ATSPI_REGISTRY_BUS_NAME = "org.a11y.atspi.Registry";
const ATSPI_ROOT_ACCESSIBLE_PATH = "/org/a11y/atspi/accessible/root";
const ATSPI_ROOT_ACCESSIBLE_REF: AtSpiAccessibleRef = {
  busName: ATSPI_REGISTRY_BUS_NAME,
  objectPath: ATSPI_ROOT_ACCESSIBLE_PATH,
};

const QUERY_MAX_NODES = 2_048;

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

function parseAtSpiStates(raw: unknown): string[] {
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
    if (((word >>> bit) & 1) === 1) {
      states.push(name);
    }
  }
  return states;
}

function toAtSpiElementRef(ref: AtSpiAccessibleRef): string {
  return `${ATSPI_REF_PREFIX}${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
}

function parseAtSpiElementRef(input: string): AtSpiAccessibleRef | null {
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

function parseAccessibleRef(value: unknown): AtSpiAccessibleRef | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [busName, objectPath] = value;
  if (typeof busName !== "string" || typeof objectPath !== "string") return null;
  if (!busName.trim()) return null;
  if (!objectPath.startsWith("/")) return null;
  return { busName, objectPath };
}

function normalizeMaybe(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRole(value: string | undefined): string {
  if (!value) return "unknown";
  const normalized = clampTrimmed(value.toLowerCase(), MAX_ROLE_CHARS);
  return normalized ? normalized : "unknown";
}

function normalizeName(value: string | undefined): string {
  if (!value) return "";
  return clampTrimmed(value, MAX_NAME_CHARS);
}

function toRect(value: unknown): DesktopUiRect {
  if (!Array.isArray(value) || value.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const [x, y, width, height] = value;
  const xn = typeof x === "number" && Number.isFinite(x) ? x : 0;
  const yn = typeof y === "number" && Number.isFinite(y) ? y : 0;
  const wn = typeof width === "number" && Number.isFinite(width) ? Math.max(0, width) : 0;
  const hn = typeof height === "number" && Number.isFinite(height) ? Math.max(0, height) : 0;
  return { x: xn, y: yn, width: wn, height: hn };
}

function matchesSelector(input: {
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

function extractWindowsFromTree(root: DesktopUiTree["root"]): DesktopWindow[] {
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
          focused: node.states.some((state) => state.trim().toLowerCase() === "focused"),
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

async function loadDbus(): Promise<typeof import("dbus-next")> {
  return await import("dbus-next");
}

export class AtSpiDesktopA11yBackend implements DesktopA11yBackend {
  private bus: MessageBus | null = null;
  private connectPromise: Promise<void> | null = null;

  private async connect(): Promise<void> {
    if (this.bus) return;
    if (this.connectPromise) return await this.connectPromise;

    this.connectPromise = (async () => {
      const dbus = await loadDbus();

      const session = dbus.sessionBus();
      let atspiBus: MessageBus | null = null;
      try {
        const busObj = await session.getProxyObject("org.a11y.Bus", "/org/a11y/bus");
        const busIface = busObj.getInterface("org.a11y.Bus") as ClientInterface;
        const address = await (busIface as any)["GetAddress"]?.();
        const busAddress = normalizeMaybe(address);
        if (!busAddress)
          throw new Error("AT-SPI bus address unavailable (org.a11y.Bus.GetAddress)");

        atspiBus = dbus.sessionBus({ busAddress });
        await atspiBus.getProxyObject(ATSPI_REGISTRY_BUS_NAME, ATSPI_ROOT_ACCESSIBLE_PATH);

        this.bus = atspiBus;
        atspiBus = null;
      } finally {
        atspiBus?.disconnect();
        session.disconnect();
      }
    })()
      .catch((err) => {
        this.bus?.disconnect();
        this.bus = null;
        throw err;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    await this.connectPromise;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.connect();
      const accessible = await this.getInterface(
        ATSPI_ROOT_ACCESSIBLE_REF,
        "org.a11y.atspi.Accessible",
      );
      if (!accessible) return false;
      const fn = (accessible as any)["GetRoleName"];
      if (typeof fn !== "function") return false;
      const role = normalizeMaybe(await fn.call(accessible));
      return role !== undefined;
    } catch {
      return false;
    }
  }

  private async getInterface(
    ref: AtSpiAccessibleRef,
    name: string,
  ): Promise<ClientInterface | null> {
    await this.connect();
    const bus = this.bus;
    if (!bus) return null;
    const obj = await bus.getProxyObject(ref.busName, ref.objectPath);
    try {
      return obj.getInterface(name) as ClientInterface;
    } catch {
      return null;
    }
  }

  private async getChildren(
    ref: AtSpiAccessibleRef,
    maxChildren: number = MAX_NODE_CHILDREN,
  ): Promise<AtSpiAccessibleRef[]> {
    const limit = Math.max(0, Math.floor(maxChildren));
    if (limit <= 0) return [];

    const iface = await this.getInterface(ref, "org.a11y.atspi.Accessible");
    if (!iface) return [];

    const direct = (iface as any)["GetChildren"];
    if (typeof direct === "function") {
      const raw = await direct.call(iface);
      if (!Array.isArray(raw)) return [];
      return raw
        .map(parseAccessibleRef)
        .filter((v): v is AtSpiAccessibleRef => v !== null)
        .slice(0, limit);
    }

    const getChildCount = (iface as any)["GetChildCount"];
    const getChildAtIndex = (iface as any)["GetChildAtIndex"];
    if (typeof getChildCount !== "function" || typeof getChildAtIndex !== "function") return [];

    const countRaw = await getChildCount.call(iface);
    const count = typeof countRaw === "number" ? Math.max(0, Math.floor(countRaw)) : 0;
    const maxCount = Math.min(count, limit);
    const children: AtSpiAccessibleRef[] = [];
    for (let i = 0; i < maxCount; i++) {
      const childRaw = await getChildAtIndex.call(iface, i);
      const child = parseAccessibleRef(childRaw);
      if (child) children.push(child);
    }
    return children;
  }

  private async describeAccessible(ref: AtSpiAccessibleRef): Promise<{
    elementRef: string;
    role: string;
    name: string;
    bounds: DesktopUiRect;
    actions: string[];
    states: string[];
  }> {
    const elementRef = toAtSpiElementRef(ref);

    const accessible = await this.getInterface(ref, "org.a11y.atspi.Accessible");
    const component = await this.getInterface(ref, "org.a11y.atspi.Component");
    const action = await this.getInterface(ref, "org.a11y.atspi.Action");

    const roleRaw = accessible ? await (accessible as any)["GetRoleName"]?.() : undefined;
    const nameRaw = accessible ? await (accessible as any)["GetName"]?.() : undefined;

    const role = normalizeRole(normalizeMaybe(roleRaw));
    const name = normalizeName(normalizeMaybe(nameRaw));

    const extentsFn = component ? (component as any)["GetExtents"] : undefined;
    const extentsRaw =
      typeof extentsFn === "function" ? await extentsFn.call(component, 0) : undefined;
    const bounds = toRect(extentsRaw);

    const actions: string[] = [];
    if (action) {
      const getNActions = (action as any)["GetNActions"];
      const countRaw = typeof getNActions === "function" ? await getNActions.call(action) : 0;
      const count = typeof countRaw === "number" ? Math.max(0, Math.floor(countRaw)) : 0;
      const getName = (action as any)["GetName"];
      const getActionName = (action as any)["GetActionName"];

      for (let i = 0; i < count && actions.length < MAX_NODE_ACTIONS; i++) {
        const fn =
          typeof getName === "function"
            ? getName
            : typeof getActionName === "function"
              ? getActionName
              : null;
        if (!fn) break;
        const raw = await fn.call(action, i);
        const name = typeof raw === "string" ? clampTrimmed(raw, MAX_ACTION_CHARS) : "";
        if (name) actions.push(name);
      }
    }

    let states: string[] = [];
    if (accessible) {
      const getState = (accessible as any)["GetState"];
      if (typeof getState === "function") {
        try {
          states = parseAtSpiStates(await getState.call(accessible))
            .map((state) => clampTrimmed(state, MAX_STATE_CHARS))
            .filter((state) => state.length > 0)
            .slice(0, MAX_NODE_STATES);
        } catch {
          states = [];
        }
      }
    }

    return {
      elementRef,
      role,
      name,
      bounds,
      actions,
      states,
    };
  }

  private async resolveRootAccessible(): Promise<AtSpiAccessibleRef | null> {
    const available = await this.isAvailable();
    if (!available) return null;
    return ATSPI_ROOT_ACCESSIBLE_REF;
  }

  async snapshot(args: DesktopSnapshotArgs): Promise<DesktopA11ySnapshot> {
    const rootRef = await this.resolveRootAccessible();
    if (!rootRef) throw new Error("AT-SPI root unavailable");

    const visited = new Set<string>();
    let remainingNodes = Math.max(1, Math.floor(args.max_nodes));

    const build = async (
      ref: AtSpiAccessibleRef,
      depth: number,
    ): Promise<DesktopUiTree["root"] | null> => {
      const key = `${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
      if (visited.has(key)) return null;
      if (remainingNodes <= 0) return null;
      visited.add(key);
      remainingNodes -= 1;

      const info = await this.describeAccessible(ref);

      const node: DesktopUiTree["root"] = {
        ref: info.elementRef,
        role: info.role,
        name: info.name,
        states: info.states,
        bounds: info.bounds,
        actions: info.actions,
        children: [],
      };

      if (depth >= DEFAULT_A11Y_MAX_DEPTH) return node;
      if (remainingNodes <= 0) return node;

      const childLimit = Math.min(MAX_NODE_CHILDREN, remainingNodes);
      const children = await this.getChildren(ref, childLimit);
      for (const childRef of children) {
        if (remainingNodes <= 0) break;
        const childNode = await build(childRef, depth + 1);
        if (!childNode) continue;
        node.children.push(childNode);
        if (node.children.length >= MAX_NODE_CHILDREN) break;
      }

      return node;
    };

    const rootNode = await build(rootRef, 1);
    if (!rootNode) throw new Error("AT-SPI snapshot unavailable");

    return {
      windows: extractWindowsFromTree(rootNode),
      tree: { root: rootNode },
    };
  }

  async query(args: DesktopQueryArgs): Promise<DesktopQueryMatch[]> {
    const selector = args.selector;
    if (selector.kind === "ocr") {
      throw new Error("AT-SPI query does not support OCR selectors");
    }

    if (selector.kind === "ref") {
      const ref = parseAtSpiElementRef(selector.ref);
      if (!ref) return [];
      const info = await this.describeAccessible(ref);
      return [
        {
          kind: "a11y",
          element_ref: info.elementRef,
          node: {
            role: info.role,
            name: info.name,
            states: info.states,
            bounds: info.bounds,
            actions: info.actions,
          },
        },
      ];
    }

    const rootRef = await this.resolveRootAccessible();
    if (!rootRef) return [];

    const visited = new Set<string>();
    let remainingNodes = QUERY_MAX_NODES;
    const matches: DesktopQueryMatch[] = [];

    const walk = async (ref: AtSpiAccessibleRef, depth: number): Promise<void> => {
      if (matches.length >= args.limit) return;
      if (remainingNodes <= 0) return;
      if (depth > DEFAULT_A11Y_MAX_DEPTH) return;

      const key = `${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
      if (visited.has(key)) return;
      visited.add(key);
      remainingNodes -= 1;

      const info = await this.describeAccessible(ref);
      const node: DesktopUiNodeSummary = {
        role: info.role,
        name: info.name,
        states: info.states,
        bounds: info.bounds,
        actions: info.actions,
      };

      if (matchesSelector({ selector, node })) {
        matches.push({
          kind: "a11y",
          element_ref: info.elementRef,
          node,
        });
        if (matches.length >= args.limit) return;
      }

      if (depth >= DEFAULT_A11Y_MAX_DEPTH) return;

      const childLimit = Math.min(MAX_NODE_CHILDREN, remainingNodes);
      const children = await this.getChildren(ref, childLimit);
      for (const child of children) {
        if (matches.length >= args.limit) break;
        if (remainingNodes <= 0) break;
        await walk(child, depth + 1);
      }
    };

    await walk(rootRef, 1);

    return matches;
  }

  async act(args: DesktopActArgs): Promise<DesktopA11yActResult> {
    if (args.action.kind === "right_click" || args.action.kind === "double_click") {
      throw new Error(`AT-SPI act does not support ${args.action.kind} actions`);
    }

    const selector = args.target;
    if (selector.kind === "ocr") {
      throw new Error("AT-SPI act does not support OCR selectors");
    }

    let ref: AtSpiAccessibleRef | null = null;
    if (selector.kind === "ref") {
      ref = parseAtSpiElementRef(selector.ref);
    } else {
      const matches = await this.query({ op: "query", selector, limit: 1 } as DesktopQueryArgs);
      const match = matches[0];
      if (match?.kind === "a11y") {
        ref = parseAtSpiElementRef(match.element_ref);
      }
    }

    if (!ref) throw new Error("AT-SPI target not found");

    if (args.action.kind === "focus") {
      const component = await this.getInterface(ref, "org.a11y.atspi.Component");
      const grab = component ? (component as any)["GrabFocus"] : undefined;
      if (typeof grab !== "function") throw new Error("AT-SPI focus unsupported");
      await grab.call(component);
      return { resolved_element_ref: toAtSpiElementRef(ref) };
    }

    const action = await this.getInterface(ref, "org.a11y.atspi.Action");
    if (!action) throw new Error("AT-SPI action unsupported");

    const getNActions = (action as any)["GetNActions"];
    const countRaw = typeof getNActions === "function" ? await getNActions.call(action) : 0;
    const count = typeof countRaw === "number" ? Math.max(0, Math.floor(countRaw)) : 0;

    const getName = (action as any)["GetName"];
    const getActionName = (action as any)["GetActionName"];
    const doAction = (action as any)["DoAction"];
    if (typeof doAction !== "function") throw new Error("AT-SPI action unsupported");

    const candidates = ["click", "activate", "press"];
    let chosenIndex: number | null = null;
    for (let i = 0; i < count; i++) {
      const fn =
        typeof getName === "function"
          ? getName
          : typeof getActionName === "function"
            ? getActionName
            : null;
      if (!fn) break;
      const raw = await fn.call(action, i);
      const name = normalizeMaybe(raw)?.toLowerCase();
      if (!name) continue;
      if (candidates.includes(name)) {
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex === null) throw new Error("AT-SPI click/activate unsupported");

    await doAction.call(action, chosenIndex);
    return { resolved_element_ref: toAtSpiElementRef(ref) };
  }
}
