import { z } from "zod";

export const PermissionProfile = z.enum(["safe", "balanced", "poweruser"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

// NOTE: Zod 4 does not apply inner field defaults when the outer object uses
// `.default({})`. We must supply fully-populated default objects so that
// `DesktopNodeConfig.parse({})` produces a complete config with all defaults.

export const DesktopNodeConfig = z.object({
  version: z.literal(1).default(1),
  mode: z.enum(["embedded", "remote"]).default("embedded"),
  remote: z
    .object({
      wsUrl: z.string().default("ws://127.0.0.1:8080/ws"),
      tokenRef: z.string().default(""),
    })
    .default({ wsUrl: "ws://127.0.0.1:8080/ws", tokenRef: "" }),
  embedded: z
    .object({
      port: z.number().int().min(1024).max(65535).default(8080),
      tokenRef: z.string().default(""),
      dbPath: z.string().default(""),
    })
    .default({ port: 8080, tokenRef: "", dbPath: "" }),
  permissions: z
    .object({
      profile: PermissionProfile.default("balanced"),
      overrides: z.record(z.string(), z.boolean()).default({}),
    })
    .default({ profile: "balanced", overrides: {} }),
  capabilities: z
    .object({
      desktop: z.boolean().default(true),
      playwright: z.boolean().default(false),
      cli: z.boolean().default(false),
      http: z.boolean().default(false),
    })
    .default({ desktop: true, playwright: false, cli: false, http: false }),
  cli: z
    .object({
      allowedCommands: z.array(z.string()).default([]),
      allowedWorkingDirs: z.array(z.string()).default([]),
    })
    .default({ allowedCommands: [], allowedWorkingDirs: [] }),
  web: z
    .object({
      allowedDomains: z.array(z.string()).default([]),
      headless: z.boolean().default(true),
    })
    .default({ allowedDomains: [], headless: true }),
});
export type DesktopNodeConfig = z.infer<typeof DesktopNodeConfig>;

export const DEFAULT_CONFIG: DesktopNodeConfig = DesktopNodeConfig.parse({});
