import { z } from "zod";

/** Client capability kinds. */
export const ClientCapability = z.enum([
  "playwright",
  "android",
  "desktop",
  "cli",
  "http",
]);
export type ClientCapability = z.infer<typeof ClientCapability>;

