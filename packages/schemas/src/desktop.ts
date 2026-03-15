import { z } from "zod";

// ---------------------------------------------------------------------------
// Desktop automation contract v1 — shared primitives + bounds
// ---------------------------------------------------------------------------

const MAX_ELEMENT_REF_CHARS = 512;
const MAX_WINDOW_REF_CHARS = 256;

const MAX_ROLE_CHARS = 64;
const MAX_NAME_CHARS = 512;
const MAX_VALUE_CHARS = 512;

const MAX_NODE_STATES = 32;
const MAX_NODE_ACTIONS = 32;
const MAX_NODE_CHILDREN = 128;

const MAX_TREE_NODES = 2_048;
const MAX_TREE_TEXT_CHARS = 32_768;

const MAX_WINDOWS = 32;
const MAX_QUERY_MATCHES = 64;
const MAX_OCR_TEXT_CHARS = 512;

const trimmed = (max: number) => z.string().trim().max(max);
const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const DesktopElementRef = trimmedNonEmpty(MAX_ELEMENT_REF_CHARS);
export type DesktopElementRef = z.infer<typeof DesktopElementRef>;

export const DesktopWindowRef = trimmedNonEmpty(MAX_WINDOW_REF_CHARS);
export type DesktopWindowRef = z.infer<typeof DesktopWindowRef>;

export const DesktopBackendMode = z.enum(["a11y", "pixel", "hybrid"]);
export type DesktopBackendMode = z.infer<typeof DesktopBackendMode>;

export const DesktopBackendPermissions = z
  .object({
    accessibility: z.boolean(),
    screen_capture: z.boolean(),
    input_control: z.boolean(),
  })
  .strict();
export type DesktopBackendPermissions = z.infer<typeof DesktopBackendPermissions>;

export const DesktopUiRect = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();
export type DesktopUiRect = z.infer<typeof DesktopUiRect>;

const DesktopUiRole = trimmedNonEmpty(MAX_ROLE_CHARS);
const DesktopUiText = trimmed(MAX_NAME_CHARS);
const DesktopUiValue = trimmed(MAX_VALUE_CHARS);

const DesktopUiState = trimmedNonEmpty(64);
const DesktopUiAction = trimmedNonEmpty(64);

type DesktopUiNodeValue = {
  ref?: DesktopElementRef;
  role: string;
  name: string;
  value?: string;
  states: string[];
  bounds: DesktopUiRect;
  actions: string[];
  children: DesktopUiNodeValue[];
};

export const DesktopUiNode: z.ZodType<DesktopUiNodeValue> = z.lazy(() =>
  z
    .object({
      ref: DesktopElementRef.optional(),
      role: DesktopUiRole,
      name: DesktopUiText,
      value: DesktopUiValue.optional(),
      states: z.array(DesktopUiState).max(MAX_NODE_STATES).default([]),
      bounds: DesktopUiRect,
      actions: z.array(DesktopUiAction).max(MAX_NODE_ACTIONS).default([]),
      children: z.array(DesktopUiNode).max(MAX_NODE_CHILDREN).default([]),
    })
    .strict(),
);
export type DesktopUiNode = z.infer<typeof DesktopUiNode>;

export const DesktopUiNodeSummary = z
  .object({
    role: DesktopUiRole,
    name: DesktopUiText,
    value: DesktopUiValue.optional(),
    states: z.array(DesktopUiState).max(MAX_NODE_STATES).default([]),
    bounds: DesktopUiRect,
    actions: z.array(DesktopUiAction).max(MAX_NODE_ACTIONS).default([]),
  })
  .strict();
export type DesktopUiNodeSummary = z.infer<typeof DesktopUiNodeSummary>;

export const DesktopUiTree = z
  .object({
    root: DesktopUiNode,
  })
  .strict()
  .superRefine((value, ctx) => {
    const stack: DesktopUiNodeValue[] = [value.root];
    let nodeCount = 0;
    let textChars = 0;

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;

      nodeCount += 1;
      if (nodeCount > MAX_TREE_NODES) {
        ctx.addIssue({
          code: "custom",
          path: ["root"],
          message: `ui tree exceeds max nodes (${MAX_TREE_NODES})`,
        });
        return;
      }

      textChars += node.role.length;
      textChars += node.name.length;
      if (node.value) textChars += node.value.length;
      for (const state of node.states) textChars += state.length;
      for (const action of node.actions) textChars += action.length;
      if (textChars > MAX_TREE_TEXT_CHARS) {
        ctx.addIssue({
          code: "custom",
          path: ["root"],
          message: `ui tree exceeds max text chars (${MAX_TREE_TEXT_CHARS})`,
        });
        return;
      }

      for (const child of node.children) {
        stack.push(child);
      }
    }
  });
export type DesktopUiTree = z.infer<typeof DesktopUiTree>;

export const DesktopWindow = z
  .object({
    ref: DesktopWindowRef,
    title: trimmed(512).optional(),
    bounds: DesktopUiRect,
    focused: z.boolean().optional(),
  })
  .strict();
export type DesktopWindow = z.infer<typeof DesktopWindow>;

// ---------------------------------------------------------------------------
// Desktop action arguments
// ---------------------------------------------------------------------------

/** Display target for a screenshot action. */
export const DesktopDisplayTarget = z.union([
  z.literal("primary"),
  z.literal("all"),
  z.object({ id: z.string() }),
]);
export type DesktopDisplayTarget = z.infer<typeof DesktopDisplayTarget>;

/** Arguments for a desktop screenshot action. */
export const DesktopScreenshotArgs = z.object({
  op: z.literal("screenshot"),
  display: DesktopDisplayTarget,
  format: z.enum(["png", "jpeg"]).default("png"),
  max_width: z.number().int().positive().optional(),
});
export type DesktopScreenshotArgs = z.infer<typeof DesktopScreenshotArgs>;

/** Arguments for a desktop mouse action. */
export const DesktopMouseArgs = z.object({
  op: z.literal("mouse"),
  action: z.enum(["move", "click", "drag"]),
  x: z.number(),
  y: z.number(),
  button: z.enum(["left", "right", "middle"]).optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});
export type DesktopMouseArgs = z.infer<typeof DesktopMouseArgs>;

/** Arguments for a desktop keyboard action. */
export const DesktopKeyboardArgs = z.object({
  op: z.literal("keyboard"),
  action: z.enum(["type", "press"]),
  text: z.string().optional(),
  key: z.string().optional(),
});
export type DesktopKeyboardArgs = z.infer<typeof DesktopKeyboardArgs>;

export const DesktopSelector = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ref"),
      ref: DesktopElementRef,
    })
    .strict(),
  z
    .object({
      kind: z.literal("a11y"),
      role: DesktopUiRole.optional(),
      name: DesktopUiText.optional(),
      states: z.array(DesktopUiState).max(MAX_NODE_STATES).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ocr"),
      text: trimmedNonEmpty(MAX_OCR_TEXT_CHARS),
      bounds: DesktopUiRect.optional(),
      case_insensitive: z.boolean().default(true),
    })
    .strict(),
]);
export type DesktopSelector = z.infer<typeof DesktopSelector>;

export const DesktopSnapshotArgs = z
  .object({
    op: z.literal("snapshot"),
    include_tree: z.boolean().default(false),
    max_nodes: z.number().int().min(1).max(MAX_TREE_NODES).default(MAX_TREE_NODES),
    max_text_chars: z.number().int().min(1).max(MAX_TREE_TEXT_CHARS).default(MAX_TREE_TEXT_CHARS),
  })
  .strict();
export type DesktopSnapshotArgs = z.infer<typeof DesktopSnapshotArgs>;

export const DesktopQueryArgs = z
  .object({
    op: z.literal("query"),
    selector: DesktopSelector,
    limit: z.number().int().min(1).max(MAX_QUERY_MATCHES).default(1),
  })
  .strict();
export type DesktopQueryArgs = z.infer<typeof DesktopQueryArgs>;

export const DesktopActAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click") }).strict(),
  z.object({ kind: z.literal("double_click") }).strict(),
  z.object({ kind: z.literal("right_click") }).strict(),
  z.object({ kind: z.literal("focus") }).strict(),
]);
export type DesktopActAction = z.infer<typeof DesktopActAction>;

export const DesktopActArgs = z
  .object({
    op: z.literal("act"),
    target: DesktopSelector,
    action: DesktopActAction,
  })
  .strict();
export type DesktopActArgs = z.infer<typeof DesktopActArgs>;

export const DesktopWaitForState = z.enum(["exists", "visible", "hidden"]);
export type DesktopWaitForState = z.infer<typeof DesktopWaitForState>;

export const DesktopWaitForArgs = z
  .object({
    op: z.literal("wait_for"),
    selector: DesktopSelector,
    state: DesktopWaitForState.default("exists"),
    timeout_ms: z.number().int().min(0).max(600_000).default(30_000),
    poll_ms: z.number().int().min(50).max(10_000).default(250),
  })
  .strict();
export type DesktopWaitForArgs = z.infer<typeof DesktopWaitForArgs>;

/** Discriminated union of all desktop action argument types. */
export const DesktopActionArgs = z.discriminatedUnion("op", [
  DesktopScreenshotArgs,
  DesktopMouseArgs,
  DesktopKeyboardArgs,
  DesktopSnapshotArgs,
  DesktopQueryArgs,
  DesktopActArgs,
  DesktopWaitForArgs,
]);
export type DesktopActionArgs = z.infer<typeof DesktopActionArgs>;

// ---------------------------------------------------------------------------
// Desktop action results / evidence (bounded)
// ---------------------------------------------------------------------------

export const DesktopSnapshotResult = z
  .object({
    op: z.literal("snapshot"),
    backend: z
      .object({
        mode: DesktopBackendMode,
        permissions: DesktopBackendPermissions,
      })
      .strict(),
    windows: z.array(DesktopWindow).max(MAX_WINDOWS).default([]),
    tree: DesktopUiTree.optional(),
  })
  .strict();
export type DesktopSnapshotResult = z.infer<typeof DesktopSnapshotResult>;

export const DesktopScreenshotResult = z
  .object({
    type: z.literal("screenshot"),
    mime: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    timestamp: z.string().datetime(),
    bytesBase64: z.string().min(1),
  })
  .strict();
export type DesktopScreenshotResult = z.infer<typeof DesktopScreenshotResult>;

export const DesktopQueryMatch = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("a11y"),
      element_ref: DesktopElementRef,
      node: DesktopUiNodeSummary,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ocr"),
      text: trimmedNonEmpty(MAX_OCR_TEXT_CHARS),
      bounds: DesktopUiRect,
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict(),
]);
export type DesktopQueryMatch = z.infer<typeof DesktopQueryMatch>;

export const DesktopQueryResult = z
  .object({
    op: z.literal("query"),
    matches: z.array(DesktopQueryMatch).max(MAX_QUERY_MATCHES).default([]),
  })
  .strict();
export type DesktopQueryResult = z.infer<typeof DesktopQueryResult>;

export const DesktopActResult = z
  .object({
    op: z.literal("act"),
    target: DesktopSelector,
    action: DesktopActAction,
    resolved_element_ref: DesktopElementRef.optional(),
  })
  .strict();
export type DesktopActResult = z.infer<typeof DesktopActResult>;

export const DesktopWaitForResult = z
  .object({
    op: z.literal("wait_for"),
    selector: DesktopSelector,
    state: DesktopWaitForState,
    status: z.enum(["satisfied", "timeout"]),
    elapsed_ms: z.number().int().nonnegative(),
    match: DesktopQueryMatch.optional(),
  })
  .strict();
export type DesktopWaitForResult = z.infer<typeof DesktopWaitForResult>;

export const DesktopAutomationResult = z.discriminatedUnion("op", [
  DesktopSnapshotResult,
  DesktopQueryResult,
  DesktopActResult,
  DesktopWaitForResult,
]);
export type DesktopAutomationResult = z.infer<typeof DesktopAutomationResult>;
