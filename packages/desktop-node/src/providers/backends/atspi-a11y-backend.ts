import type { ClientInterface, MessageBus } from "dbus-next";

import type {
  DesktopActArgs,
  DesktopQueryArgs,
  DesktopQueryMatch,
  DesktopSnapshotArgs,
  DesktopUiNodeSummary,
  DesktopUiTree,
} from "@tyrum/contracts";

import { DEFAULT_A11Y_MAX_DEPTH } from "../a11y/prune-ui-tree.js";
import {
  MAX_ACTION_CHARS,
  MAX_NODE_ACTIONS,
  MAX_NODE_CHILDREN,
  MAX_NODE_STATES,
  MAX_STATE_CHARS,
  clampTrimmed,
} from "../a11y/schema-clamps.js";
import type {
  DesktopA11yActResult,
  DesktopA11yBackend,
  DesktopA11ySnapshot,
} from "./desktop-a11y-backend.js";

import {
  type AtSpiAccessibleRef,
  ATSPI_REF_SEPARATOR,
  ATSPI_REGISTRY_BUS_NAME,
  ATSPI_ROOT_ACCESSIBLE_PATH,
  ATSPI_ROOT_ACCESSIBLE_REF,
  QUERY_MAX_NODES,
  QUERY_MAX_CHILDREN,
  toNonNegativeInt,
  normalizeDbusBoolean,
  parseAtSpiStates,
  toAtSpiElementRef,
  parseAtSpiElementRef,
  parseAccessibleRef,
  normalizeMaybe,
  normalizeRole,
  normalizeName,
  toRect,
  matchesSelector,
  extractWindowsFromTree,
  loadDbus,
  getAtSpiDynamicMethod,
} from "./atspi-a11y-backend-helpers.js";

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
        const getAddress = getAtSpiDynamicMethod(busIface, "GetAddress");
        const address = await getAddress?.call(busIface);
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
      const getRoleName = getAtSpiDynamicMethod(accessible, "GetRoleName");
      if (!getRoleName) return false;
      const role = normalizeMaybe(await getRoleName.call(accessible));
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
    const getChildren = getAtSpiDynamicMethod(iface, "GetChildren");
    if (getChildren) {
      const raw = await getChildren.call(iface);
      if (!Array.isArray(raw)) return [];
      return raw
        .map(parseAccessibleRef)
        .filter((v): v is AtSpiAccessibleRef => v !== null)
        .slice(0, limit);
    }

    const getChildCount = getAtSpiDynamicMethod(iface, "GetChildCount");
    const getChildAtIndex = getAtSpiDynamicMethod(iface, "GetChildAtIndex");
    if (!getChildCount || !getChildAtIndex) return [];
    const countRaw = await getChildCount.call(iface);
    const count = toNonNegativeInt(countRaw);
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
    bounds: import("@tyrum/contracts").DesktopUiRect;
    actions: string[];
    states: string[];
  }> {
    const elementRef = toAtSpiElementRef(ref);
    const accessible = await this.getInterface(ref, "org.a11y.atspi.Accessible");
    const component = await this.getInterface(ref, "org.a11y.atspi.Component");
    const action = await this.getInterface(ref, "org.a11y.atspi.Action");
    const roleRaw = accessible
      ? await getAtSpiDynamicMethod(accessible, "GetRoleName")?.call(accessible)
      : undefined;
    const nameRaw = accessible
      ? await getAtSpiDynamicMethod(accessible, "GetName")?.call(accessible)
      : undefined;
    const role = normalizeRole(normalizeMaybe(roleRaw));
    const accessibleName = normalizeName(normalizeMaybe(nameRaw));
    const extentsFn = component ? getAtSpiDynamicMethod(component, "GetExtents") : undefined;
    const extentsRaw =
      typeof extentsFn === "function" ? await extentsFn.call(component, 0) : undefined;
    const bounds = toRect(extentsRaw);
    const actions: string[] = [];
    if (action) {
      const getNActions = getAtSpiDynamicMethod(action, "GetNActions");
      const countRaw = typeof getNActions === "function" ? await getNActions.call(action) : 0;
      const count = toNonNegativeInt(countRaw);
      const getName = getAtSpiDynamicMethod(action, "GetName");
      const getActionName = getAtSpiDynamicMethod(action, "GetActionName");

      for (let i = 0; i < count && actions.length < MAX_NODE_ACTIONS; i++) {
        const fn =
          typeof getName === "function"
            ? getName
            : typeof getActionName === "function"
              ? getActionName
              : null;
        if (!fn) break;
        const raw = await fn.call(action, i);
        const actionName = normalizeMaybe(raw);
        if (actionName) actions.push(clampTrimmed(actionName, MAX_ACTION_CHARS));
      }
    }
    let states: string[] = [];
    if (accessible) {
      const getState = getAtSpiDynamicMethod(accessible, "GetState");
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
    return { elementRef, role, name: accessibleName, bounds, actions, states };
  }

  private async resolveRootAccessible(): Promise<AtSpiAccessibleRef | null> {
    return (await this.isAvailable()) ? ATSPI_ROOT_ACCESSIBLE_REF : null;
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

    return { windows: extractWindowsFromTree(rootNode), tree: { root: rootNode } };
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
        matches.push({ kind: "a11y", element_ref: info.elementRef, node });
        if (matches.length >= args.limit) return;
      }
      if (depth >= DEFAULT_A11Y_MAX_DEPTH) return;
      const childLimit = Math.min(QUERY_MAX_CHILDREN, remainingNodes);
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
      if (match?.kind === "a11y") ref = parseAtSpiElementRef(match.element_ref);
    }

    if (!ref) throw new Error("AT-SPI target not found");

    if (args.action.kind === "focus") {
      const component = await this.getInterface(ref, "org.a11y.atspi.Component");
      const grab = component ? getAtSpiDynamicMethod(component, "GrabFocus") : undefined;
      if (typeof grab !== "function") throw new Error("AT-SPI focus unsupported");
      await grab.call(component);
      return { resolved_element_ref: toAtSpiElementRef(ref) };
    }

    const action = await this.getInterface(ref, "org.a11y.atspi.Action");
    if (!action) throw new Error("AT-SPI action unsupported");

    const getNActions = getAtSpiDynamicMethod(action, "GetNActions");
    const countRaw = typeof getNActions === "function" ? await getNActions.call(action) : 0;
    const count = toNonNegativeInt(countRaw);

    const getName = getAtSpiDynamicMethod(action, "GetName");
    const getActionName = getAtSpiDynamicMethod(action, "GetActionName");
    const doAction = getAtSpiDynamicMethod(action, "DoAction");
    if (typeof doAction !== "function") throw new Error("AT-SPI action unsupported");

    const actionNameFn =
      typeof getName === "function"
        ? getName
        : typeof getActionName === "function"
          ? getActionName
          : null;
    const candidates = new Set(["click", "activate", "press"]);
    const candidateIndices: number[] = [];
    const actionNamesByIndex: Array<string | undefined> = [];
    if (actionNameFn) {
      for (let i = 0; i < count && i < MAX_NODE_ACTIONS; i++) {
        const raw = await actionNameFn.call(action, i);
        const name = normalizeMaybe(raw)?.toLowerCase();
        actionNamesByIndex[i] = name;
        if (!name) continue;
        if (candidates.has(name)) candidateIndices.push(i);
      }
    }

    const indicesToTry = candidateIndices.length > 0 ? candidateIndices : [0];

    let lastError: unknown;
    for (const index of indicesToTry) {
      let didAct: unknown;
      try {
        didAct = await doAction.call(action, index);
      } catch (err) {
        lastError = err;
        continue;
      }

      if (normalizeDbusBoolean(didAct) === false) {
        const actionName = actionNamesByIndex[index];
        lastError = new Error(
          `DoAction(${index}${actionName ? `:${actionName}` : ""}) returned ${String(didAct)}`,
        );
        continue;
      }
      return { resolved_element_ref: toAtSpiElementRef(ref) };
    }

    if (lastError instanceof Error) {
      throw new Error(`AT-SPI click/activate unsupported (${lastError.message})`, {
        cause: lastError,
      });
    }
    throw new Error("AT-SPI click/activate unsupported");
  }
}
