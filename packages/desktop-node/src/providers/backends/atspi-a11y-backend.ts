import type { ClientInterface, MessageBus } from "dbus-next";

import type {
  DesktopActArgs,
  DesktopQueryArgs,
  DesktopQueryMatch,
  DesktopSnapshotArgs,
  DesktopUiNodeSummary,
  DesktopUiRect,
  DesktopUiTree,
} from "@tyrum/schemas";

import { DEFAULT_A11Y_MAX_DEPTH, pruneUiTree } from "../a11y/prune-ui-tree.js";
import {
  MAX_ACTION_CHARS,
  MAX_NAME_CHARS,
  MAX_NODE_ACTIONS,
  MAX_NODE_CHILDREN,
  MAX_ROLE_CHARS,
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

const QUERY_MAX_NODES = 2_048;

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

function isWindowRole(role: string): boolean {
  const normalized = role.toLowerCase();
  if (normalized.trim() === "desktop frame") return false;
  return (
    normalized.trim() === "frame" || normalized.includes("window") || normalized.includes("dialog")
  );
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

async function loadDbus(): Promise<typeof import("dbus-next")> {
  return await import("dbus-next");
}

export class AtSpiDesktopA11yBackend implements DesktopA11yBackend {
  private registry: ClientInterface | null = null;
  private bus: MessageBus | null = null;
  private connectPromise: Promise<void> | null = null;

  private async connect(): Promise<void> {
    if (this.registry && this.bus) return;
    if (this.connectPromise) return await this.connectPromise;

    this.connectPromise = (async () => {
      const dbus = await loadDbus();

      const session = dbus.sessionBus();
      try {
        const busObj = await session.getProxyObject("org.a11y.Bus", "/org/a11y/bus");
        const busIface = busObj.getInterface("org.a11y.Bus") as ClientInterface;
        const address = await (busIface as any)["GetAddress"]?.();
        const busAddress = normalizeMaybe(address);
        if (!busAddress)
          throw new Error("AT-SPI bus address unavailable (org.a11y.Bus.GetAddress)");

        const atspiBus = dbus.sessionBus({ busAddress });
        const registryObj = await atspiBus.getProxyObject(
          "org.a11y.atspi.Registry",
          "/org/a11y/atspi/registry",
        );
        const registryIface = registryObj.getInterface(
          "org.a11y.atspi.Registry",
        ) as ClientInterface;

        this.bus = atspiBus;
        this.registry = registryIface;
      } finally {
        session.disconnect();
      }
    })()
      .catch((err) => {
        this.bus?.disconnect();
        this.bus = null;
        this.registry = null;
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
      const registry = this.registry;
      if (!registry) return false;

      const fn = (registry as any)["GetDesktopCount"];
      if (typeof fn !== "function") return false;
      const count = await fn.call(registry);
      return typeof count === "number" ? count > 0 : false;
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

  private async getFocusedAccessible(): Promise<AtSpiAccessibleRef | null> {
    await this.connect();
    const registry = this.registry;
    if (!registry) return null;

    const fn = (registry as any)["GetFocus"];
    if (typeof fn !== "function") return null;
    const raw = await fn.call(registry);
    return parseAccessibleRef(raw);
  }

  private async getParent(ref: AtSpiAccessibleRef): Promise<AtSpiAccessibleRef | null> {
    const iface = await this.getInterface(ref, "org.a11y.atspi.Accessible");
    if (!iface) return null;
    const fn = (iface as any)["GetParent"];
    if (typeof fn !== "function") return null;
    const raw = await fn.call(iface);
    return parseAccessibleRef(raw);
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

    return {
      elementRef,
      role,
      name,
      bounds,
      actions,
      states: [],
    };
  }

  private async resolveRootAccessible(): Promise<AtSpiAccessibleRef | null> {
    const focus = await this.getFocusedAccessible();
    if (!focus) return null;

    let current: AtSpiAccessibleRef | null = focus;
    let candidate: AtSpiAccessibleRef = focus;

    for (let i = 0; i < 64; i++) {
      if (!current) break;

      const role = await this.describeAccessible(current)
        .then((d) => d.role)
        .catch(() => "unknown");
      if (isWindowRole(role)) {
        candidate = current;
      }
      const parentRef: AtSpiAccessibleRef | null = await this.getParent(current).catch(() => null);
      if (!parentRef) break;
      current = parentRef;
    }

    return candidate;
  }

  async snapshot(args: DesktopSnapshotArgs): Promise<DesktopA11ySnapshot> {
    const rootRef = await this.resolveRootAccessible();
    if (!rootRef) throw new Error("AT-SPI focus unavailable");

    const visited = new Set<string>();
    let remainingNodes = Math.max(1, Math.floor(args.max_nodes));

    const build = async (
      ref: AtSpiAccessibleRef,
      depth: number,
    ): Promise<DesktopUiTree["root"] | null> => {
      if (remainingNodes <= 0) return null;
      remainingNodes -= 1;

      const key = `${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
      if (visited.has(key)) return null;
      visited.add(key);

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

    const tree: DesktopUiTree = pruneUiTree(
      { root: rootNode },
      {
        maxNodes: args.max_nodes,
        maxTextChars: args.max_text_chars,
        maxDepth: DEFAULT_A11Y_MAX_DEPTH,
      },
    );

    return {
      windows: [],
      tree,
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
      if (depth >= DEFAULT_A11Y_MAX_DEPTH) return;
      remainingNodes -= 1;

      const key = `${ref.busName}${ATSPI_REF_SEPARATOR}${ref.objectPath}`;
      if (visited.has(key)) return;
      visited.add(key);

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
