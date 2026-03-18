import { z } from "zod";

// ---------------------------------------------------------------------------
// Browser automation schemas — Playwright MCP tool set
// ---------------------------------------------------------------------------
// Each action gets an Args and Result schema. All use `.strict()`.
// No `op` field — the operation identifier is part of the dispatch layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Navigate
// ---------------------------------------------------------------------------

export const BrowserNavigateArgs = z
  .object({
    url: z.string().url(),
  })
  .strict();
export type BrowserNavigateArgs = z.infer<typeof BrowserNavigateArgs>;

export const BrowserNavigateResult = z
  .object({
    url: z.string(),
    title: z.string().optional(),
  })
  .strict();
export type BrowserNavigateResult = z.infer<typeof BrowserNavigateResult>;

// ---------------------------------------------------------------------------
// 2. Navigate back
// ---------------------------------------------------------------------------

export const BrowserNavigateBackArgs = z.object({}).strict();
export type BrowserNavigateBackArgs = z.infer<typeof BrowserNavigateBackArgs>;

export const BrowserNavigateBackResult = z
  .object({
    url: z.string(),
    title: z.string().optional(),
  })
  .strict();
export type BrowserNavigateBackResult = z.infer<typeof BrowserNavigateBackResult>;

// ---------------------------------------------------------------------------
// 3. Snapshot
// ---------------------------------------------------------------------------

export const BrowserSnapshotArgs = z
  .object({
    selector: z.string().optional(),
  })
  .strict();
export type BrowserSnapshotArgs = z.infer<typeof BrowserSnapshotArgs>;

export const BrowserSnapshotResult = z
  .object({
    snapshot: z.string(),
  })
  .strict();
export type BrowserSnapshotResult = z.infer<typeof BrowserSnapshotResult>;

// ---------------------------------------------------------------------------
// 4. Click
// ---------------------------------------------------------------------------

export const BrowserClickArgs = z
  .object({
    selector: z.string().min(1),
    button: z.enum(["left", "right", "middle"]).default("left").optional(),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  })
  .strict();
export type BrowserClickArgs = z.infer<typeof BrowserClickArgs>;

export const BrowserClickResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserClickResult = z.infer<typeof BrowserClickResult>;

// ---------------------------------------------------------------------------
// 5. Type
// ---------------------------------------------------------------------------

export const BrowserTypeArgs = z
  .object({
    selector: z.string().min(1),
    text: z.string(),
    submit: z.boolean().default(false).optional(),
  })
  .strict();
export type BrowserTypeArgs = z.infer<typeof BrowserTypeArgs>;

export const BrowserTypeResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserTypeResult = z.infer<typeof BrowserTypeResult>;

// ---------------------------------------------------------------------------
// 6. Fill form
// ---------------------------------------------------------------------------

export const BrowserFillFormArgs = z
  .object({
    selector: z.string().min(1),
    value: z.string(),
  })
  .strict();
export type BrowserFillFormArgs = z.infer<typeof BrowserFillFormArgs>;

export const BrowserFillFormResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserFillFormResult = z.infer<typeof BrowserFillFormResult>;

// ---------------------------------------------------------------------------
// 7. Select option
// ---------------------------------------------------------------------------

export const BrowserSelectOptionArgs = z
  .object({
    selector: z.string().min(1),
    values: z.array(z.string().min(1)),
  })
  .strict();
export type BrowserSelectOptionArgs = z.infer<typeof BrowserSelectOptionArgs>;

export const BrowserSelectOptionResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserSelectOptionResult = z.infer<typeof BrowserSelectOptionResult>;

// ---------------------------------------------------------------------------
// 8. Hover
// ---------------------------------------------------------------------------

export const BrowserHoverArgs = z
  .object({
    selector: z.string().min(1),
  })
  .strict();
export type BrowserHoverArgs = z.infer<typeof BrowserHoverArgs>;

export const BrowserHoverResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserHoverResult = z.infer<typeof BrowserHoverResult>;

// ---------------------------------------------------------------------------
// 9. Drag
// ---------------------------------------------------------------------------

export const BrowserDragArgs = z
  .object({
    source_selector: z.string().min(1),
    target_selector: z.string().min(1),
  })
  .strict();
export type BrowserDragArgs = z.infer<typeof BrowserDragArgs>;

export const BrowserDragResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserDragResult = z.infer<typeof BrowserDragResult>;

// ---------------------------------------------------------------------------
// 10. Press key
// ---------------------------------------------------------------------------

export const BrowserPressKeyArgs = z
  .object({
    key: z.string().min(1),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
  })
  .strict();
export type BrowserPressKeyArgs = z.infer<typeof BrowserPressKeyArgs>;

export const BrowserPressKeyResult = z
  .object({
    snapshot: z.string().optional(),
  })
  .strict();
export type BrowserPressKeyResult = z.infer<typeof BrowserPressKeyResult>;

// ---------------------------------------------------------------------------
// 11. Screenshot
// ---------------------------------------------------------------------------

export const BrowserScreenshotArgs = z
  .object({
    selector: z.string().optional(),
    full_page: z.boolean().default(false).optional(),
  })
  .strict();
export type BrowserScreenshotArgs = z.infer<typeof BrowserScreenshotArgs>;

export const BrowserScreenshotResult = z
  .object({
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
export type BrowserScreenshotResult = z.infer<typeof BrowserScreenshotResult>;

// ---------------------------------------------------------------------------
// 12. Evaluate
// ---------------------------------------------------------------------------

export const BrowserEvaluateArgs = z
  .object({
    expression: z.string().min(1),
  })
  .strict();
export type BrowserEvaluateArgs = z.infer<typeof BrowserEvaluateArgs>;

export const BrowserEvaluateResult = z
  .object({
    result: z.unknown(),
  })
  .strict();
export type BrowserEvaluateResult = z.infer<typeof BrowserEvaluateResult>;

// ---------------------------------------------------------------------------
// 13. Wait for
// ---------------------------------------------------------------------------

export const BrowserWaitForArgs = z
  .object({
    selector: z.string().min(1).optional(),
    url: z.string().optional(),
    text: z.string().optional(),
    timeout_ms: z.number().int().min(0).max(60_000).default(30_000).optional(),
  })
  .strict();
export type BrowserWaitForArgs = z.infer<typeof BrowserWaitForArgs>;

export const BrowserWaitForResult = z
  .object({
    matched: z.boolean(),
  })
  .strict();
export type BrowserWaitForResult = z.infer<typeof BrowserWaitForResult>;

// ---------------------------------------------------------------------------
// 14. Tabs
// ---------------------------------------------------------------------------

export const BrowserTabsArgs = z
  .object({
    switch_to: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BrowserTabsArgs = z.infer<typeof BrowserTabsArgs>;

export const BrowserTabsResult = z
  .object({
    tabs: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          url: z.string(),
          title: z.string().optional(),
        })
        .strict(),
    ),
    active_index: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserTabsResult = z.infer<typeof BrowserTabsResult>;

// ---------------------------------------------------------------------------
// 15. Upload file
// ---------------------------------------------------------------------------

export const BrowserUploadFileArgs = z
  .object({
    selector: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type BrowserUploadFileArgs = z.infer<typeof BrowserUploadFileArgs>;

export const BrowserUploadFileResult = z
  .object({
    uploaded: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserUploadFileResult = z.infer<typeof BrowserUploadFileResult>;

// ---------------------------------------------------------------------------
// 16. Console messages
// ---------------------------------------------------------------------------

export const BrowserConsoleMessagesArgs = z
  .object({
    clear: z.boolean().default(false).optional(),
  })
  .strict();
export type BrowserConsoleMessagesArgs = z.infer<typeof BrowserConsoleMessagesArgs>;

export const BrowserConsoleMessagesResult = z
  .object({
    messages: z.array(
      z
        .object({
          type: z.string(),
          text: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type BrowserConsoleMessagesResult = z.infer<typeof BrowserConsoleMessagesResult>;

// ---------------------------------------------------------------------------
// 17. Network requests
// ---------------------------------------------------------------------------

export const BrowserNetworkRequestsArgs = z.object({}).strict();
export type BrowserNetworkRequestsArgs = z.infer<typeof BrowserNetworkRequestsArgs>;

export const BrowserNetworkRequestsResult = z
  .object({
    requests: z.array(
      z
        .object({
          method: z.string(),
          url: z.string(),
          status: z.number().int().optional(),
          content_type: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type BrowserNetworkRequestsResult = z.infer<typeof BrowserNetworkRequestsResult>;

// ---------------------------------------------------------------------------
// 18. Resize
// ---------------------------------------------------------------------------

export const BrowserResizeArgs = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type BrowserResizeArgs = z.infer<typeof BrowserResizeArgs>;

export const BrowserResizeResult = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type BrowserResizeResult = z.infer<typeof BrowserResizeResult>;

// ---------------------------------------------------------------------------
// 19. Close
// ---------------------------------------------------------------------------

export const BrowserCloseArgs = z.object({}).strict();
export type BrowserCloseArgs = z.infer<typeof BrowserCloseArgs>;

export const BrowserCloseResult = z.object({}).strict();
export type BrowserCloseResult = z.infer<typeof BrowserCloseResult>;

// ---------------------------------------------------------------------------
// 20. Handle dialog
// ---------------------------------------------------------------------------

export const BrowserHandleDialogArgs = z
  .object({
    accept: z.boolean(),
    prompt_text: z.string().optional(),
  })
  .strict();
export type BrowserHandleDialogArgs = z.infer<typeof BrowserHandleDialogArgs>;

export const BrowserHandleDialogResult = z
  .object({
    dialog_type: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();
export type BrowserHandleDialogResult = z.infer<typeof BrowserHandleDialogResult>;

// ---------------------------------------------------------------------------
// 21. Run code
// ---------------------------------------------------------------------------

export const BrowserRunCodeArgs = z
  .object({
    code: z.string().min(1),
  })
  .strict();
export type BrowserRunCodeArgs = z.infer<typeof BrowserRunCodeArgs>;

export const BrowserRunCodeResult = z
  .object({
    result: z.unknown(),
  })
  .strict();
export type BrowserRunCodeResult = z.infer<typeof BrowserRunCodeResult>;

// ---------------------------------------------------------------------------
// 22. Launch
// ---------------------------------------------------------------------------

export const BrowserLaunchArgs = z
  .object({
    headless: z.boolean().optional(),
    browser: z.enum(["chromium"]).default("chromium").optional(),
  })
  .strict();
export type BrowserLaunchArgs = z.infer<typeof BrowserLaunchArgs>;

export const BrowserLaunchResult = z
  .object({
    headless: z.boolean(),
    browser: z.string(),
  })
  .strict();
export type BrowserLaunchResult = z.infer<typeof BrowserLaunchResult>;
