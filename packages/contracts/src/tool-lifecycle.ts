import { z } from "zod";

export const ToolLifecycleStatus = z.enum([
  "input-streaming",
  "input-available",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "output-available",
  "output-error",
  "approval-requested",
  "output-denied",
  "cancelled",
]);
export type ToolLifecycleStatus = z.infer<typeof ToolLifecycleStatus>;
