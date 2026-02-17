import { z } from "zod";

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

/** Discriminated union of all desktop action argument types. */
export const DesktopActionArgs = z.discriminatedUnion("op", [
  DesktopScreenshotArgs,
  DesktopMouseArgs,
  DesktopKeyboardArgs,
]);
export type DesktopActionArgs = z.infer<typeof DesktopActionArgs>;
