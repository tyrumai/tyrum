import type { DesktopUiNode, DesktopUiTree } from "@tyrum/schemas";

import {
  MAX_ACTION_CHARS,
  MAX_NAME_CHARS,
  MAX_NODE_ACTIONS,
  MAX_NODE_CHILDREN,
  MAX_NODE_STATES,
  MAX_ROLE_CHARS,
  MAX_STATE_CHARS,
  MAX_VALUE_CHARS,
  clampTrimmed,
} from "./schema-clamps.js";

export type UiTreeLimits = {
  maxNodes: number;
  maxTextChars: number;
  maxDepth: number;
};

export const DEFAULT_A11Y_MAX_DEPTH = 32;

function estimateNodeText(
  node: Pick<DesktopUiNode, "role" | "name" | "value" | "states" | "actions">,
): number {
  let chars = node.role.length + node.name.length;
  if (node.value) chars += node.value.length;
  for (const state of node.states) chars += state.length;
  for (const action of node.actions) chars += action.length;
  return chars;
}

function fitNodeTextToBudget(
  node: DesktopUiNode,
  budget: number,
): { node: DesktopUiNode; cost: number } {
  const safeBudget = Math.max(1, Math.floor(budget));

  let role = clampTrimmed(node.role, MAX_ROLE_CHARS);
  if (!role) role = "unknown";

  let name = clampTrimmed(node.name, MAX_NAME_CHARS);

  let value = node.value ? clampTrimmed(node.value, MAX_VALUE_CHARS) : undefined;
  if (value?.length === 0) value = undefined;

  let states = node.states
    .map((state) => clampTrimmed(state, MAX_STATE_CHARS))
    .filter((state) => state.length > 0)
    .slice(0, MAX_NODE_STATES);
  let actions = node.actions
    .map((action) => clampTrimmed(action, MAX_ACTION_CHARS))
    .filter((action) => action.length > 0)
    .slice(0, MAX_NODE_ACTIONS);

  const bounds = node.bounds;
  const ref = node.ref;

  const cost = () =>
    estimateNodeText({
      role,
      name,
      value,
      states,
      actions,
    });

  let current = cost();
  if (current <= safeBudget) {
    return {
      node: {
        ref,
        role,
        name,
        value,
        states,
        bounds,
        actions,
        children: [],
      },
      cost: current,
    };
  }

  actions = [];
  current = cost();
  if (current <= safeBudget) {
    return {
      node: {
        ref,
        role,
        name,
        value,
        states,
        bounds,
        actions,
        children: [],
      },
      cost: current,
    };
  }

  states = [];
  current = cost();
  if (current <= safeBudget) {
    return {
      node: {
        ref,
        role,
        name,
        value,
        states,
        bounds,
        actions,
        children: [],
      },
      cost: current,
    };
  }

  value = undefined;
  current = cost();
  if (current <= safeBudget) {
    return {
      node: {
        ref,
        role,
        name,
        value,
        states,
        bounds,
        actions,
        children: [],
      },
      cost: current,
    };
  }

  const allowedName = Math.max(0, safeBudget - role.length);
  if (name.length > allowedName) name = name.slice(0, allowedName);
  current = cost();
  if (current <= safeBudget) {
    return {
      node: {
        ref,
        role,
        name,
        value,
        states,
        bounds,
        actions,
        children: [],
      },
      cost: current,
    };
  }

  role = role.slice(0, Math.max(1, safeBudget));
  const allowedNameAfterRole = Math.max(0, safeBudget - role.length);
  if (name.length > allowedNameAfterRole) name = name.slice(0, allowedNameAfterRole);
  current = cost();

  return {
    node: {
      ref,
      role,
      name,
      value,
      states,
      bounds,
      actions,
      children: [],
    },
    cost: Math.min(current, safeBudget),
  };
}

export function pruneUiTree(input: DesktopUiTree, limits: UiTreeLimits): DesktopUiTree {
  const maxNodes = Math.max(1, Math.floor(limits.maxNodes));
  const maxTextChars = Math.max(1, Math.floor(limits.maxTextChars));
  const maxDepth = Math.max(1, Math.floor(limits.maxDepth));

  let remainingNodes = maxNodes;
  let remainingText = maxTextChars;

  const pruneNode = (node: DesktopUiNode, depth: number): DesktopUiNode | null => {
    if (remainingNodes <= 0) return null;
    if (remainingText <= 0) return null;

    remainingNodes -= 1;
    const fitted = fitNodeTextToBudget(node, remainingText);
    remainingText -= fitted.cost;

    if (depth >= maxDepth) return fitted.node;
    if (remainingNodes <= 0) return fitted.node;
    if (remainingText <= 0) return fitted.node;

    const children: DesktopUiNode[] = [];
    for (const child of node.children.slice(0, MAX_NODE_CHILDREN)) {
      const pruned = pruneNode(child, depth + 1);
      if (!pruned) break;
      children.push(pruned);
      if (remainingNodes <= 0 || remainingText <= 0) break;
    }

    return {
      ...fitted.node,
      children,
    };
  };

  const root = pruneNode(input.root, 1) ?? fitNodeTextToBudget(input.root, maxTextChars).node;

  return { root };
}
