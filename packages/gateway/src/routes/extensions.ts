import {
  ExtensionsDetailResponse,
  ExtensionsListResponse,
  ExtensionsMutateResponse,
} from "@tyrum/contracts";
import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { GatewayContainer } from "../container.js";
import { requireAuthClaims, requireTenantId } from "../modules/auth/claims.js";
import {
  ExtensionsService,
  type McpImportInput,
  type UploadInput,
} from "../modules/extensions/service.js";
import { UnsafeExtensionUrlError } from "../modules/extensions/package-source.js";
import type { SqlDb } from "../statestore/types.js";

const extensionKindSchema = z.enum(["skill", "mcp"]);

const toggleRequestSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const revertRequestSchema = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const uploadRequestSchema = z
  .object({
    key: z.string().trim().min(1).optional(),
    filename: z.string().trim().min(1).optional(),
    content_type: z.string().trim().min(1).optional(),
    content_base64: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const defaultsUpdateRequestSchema = z
  .object({
    default_access: z.enum(["inherit", "allow", "deny"]),
    settings_format: z.enum(["json", "yaml"]).optional(),
    settings_text: z.string().optional(),
  })
  .strict();

const parseMcpSettingsRequestSchema = z
  .object({
    settings_format: z.enum(["json", "yaml"]),
    settings_text: z.string(),
  })
  .strict();

const skillImportRequestSchema = z
  .object({
    source: z.literal("direct-url"),
    url: z.string().trim().url(),
    key: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const mcpImportRequestSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("direct-url"),
      url: z.string().trim().url(),
      mode: z.enum(["remote", "archive"]).default("remote"),
      key: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      enabled: z.boolean().optional(),
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal("npm"),
      npm_spec: z.string().trim().min(1),
      key: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      enabled: z.boolean().optional(),
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ success: true; data: T } | { success: false; message: string }> {
  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch (error) {
    void error;
    return { success: false, message: "invalid json" };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, message: parsed.error.message };
  }
  return { success: true, data: parsed.data };
}

function toRouteErrorResponse(error: unknown): {
  status: 400;
  body: { error: string; message: string };
} {
  if (error instanceof UnsafeExtensionUrlError) {
    return {
      status: 400,
      body: { error: "invalid_request", message: error.message },
    };
  }
  throw error;
}

function toUploadInput(parsed: z.output<typeof uploadRequestSchema>): UploadInput {
  return {
    key: parsed.key,
    filename: parsed.filename,
    contentType: parsed.content_type,
    contentBase64: parsed.content_base64,
    enabled: parsed.enabled,
    reason: parsed.reason,
  };
}

function toMcpImportInput(parsed: z.output<typeof mcpImportRequestSchema>): McpImportInput {
  if (parsed.source === "npm") {
    return {
      source: "npm",
      npmSpec: parsed.npm_spec,
      key: parsed.key,
      name: parsed.name,
      enabled: parsed.enabled,
      reason: parsed.reason,
    };
  }
  return {
    source: "direct-url",
    url: parsed.url,
    mode: parsed.mode,
    key: parsed.key,
    name: parsed.name,
    enabled: parsed.enabled,
    reason: parsed.reason,
  };
}

function parseStructuredSettings(input: {
  kind: z.infer<typeof extensionKindSchema>;
  settingsFormat?: "json" | "yaml";
  settingsText?: string;
}): { replaceSettings: boolean; settings?: Record<string, unknown> } {
  if (typeof input.settingsText !== "string") {
    return { replaceSettings: false };
  }
  const trimmed = input.settingsText.trim();
  if (trimmed.length === 0) return { replaceSettings: true };
  if (input.kind !== "mcp") {
    throw new Error("settings are only supported for MCP extensions");
  }

  const parsed =
    input.settingsFormat === "yaml"
      ? (parseYaml(trimmed) as unknown)
      : (JSON.parse(trimmed) as unknown);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("settings must be an object");
  }
  return {
    replaceSettings: true,
    settings: parsed as Record<string, unknown>,
  };
}

export function createExtensionsRoutes(deps: {
  db: SqlDb;
  container: Pick<GatewayContainer, "config" | "deploymentConfig">;
}): Hono {
  const app = new Hono();
  const service = new ExtensionsService(deps);

  app.get("/config/extensions/:kind", async (c) => {
    const tenantId = requireTenantId(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const items = await service.listExtensions(tenantId, kind);
    return c.json(ExtensionsListResponse.parse({ items }), 200);
  });

  app.get("/config/extensions/:kind/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const key = c.req.param("key").trim();
    const item = await service.getExtensionDetail(tenantId, kind, key);
    if (!item) {
      return c.json({ error: "not_found", message: `extension '${key}' not found` }, 404);
    }
    return c.json(ExtensionsDetailResponse.parse({ item }), 200);
  });

  app.post("/config/extensions/skill/import", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsed = await parseJsonBody(c.req.raw, skillImportRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    try {
      const item = await service.importSkill(tenantId, claims.token_id, parsed.data);
      return c.json(ExtensionsMutateResponse.parse({ item }), 200);
    } catch (error) {
      const response = toRouteErrorResponse(error);
      return c.json(response.body, response.status);
    }
  });

  app.post("/config/extensions/skill/upload", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsed = await parseJsonBody(c.req.raw, uploadRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    const item = await service.uploadSkill(tenantId, claims.token_id, toUploadInput(parsed.data));
    return c.json(ExtensionsMutateResponse.parse({ item }), 200);
  });

  app.post("/config/extensions/mcp/import", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsed = await parseJsonBody(c.req.raw, mcpImportRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    try {
      const item = await service.importMcp(
        tenantId,
        claims.token_id,
        toMcpImportInput(parsed.data),
      );
      return c.json(ExtensionsMutateResponse.parse({ item }), 200);
    } catch (error) {
      const response = toRouteErrorResponse(error);
      return c.json(response.body, response.status);
    }
  });

  app.post("/config/extensions/mcp/upload", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const parsed = await parseJsonBody(c.req.raw, uploadRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    const item = await service.uploadMcp(tenantId, claims.token_id, toUploadInput(parsed.data));
    return c.json(ExtensionsMutateResponse.parse({ item }), 200);
  });

  app.post("/config/extensions/:kind/:key/toggle", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const key = c.req.param("key").trim();
    const parsed = await parseJsonBody(c.req.raw, toggleRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    const item = await service.toggleExtension({
      tenantId,
      tokenId: claims.token_id,
      kind,
      key,
      enabled: parsed.data.enabled,
      reason: parsed.data.reason,
    });
    if (!item) {
      return c.json({ error: "not_found", message: `extension '${key}' not found` }, 404);
    }
    return c.json(ExtensionsMutateResponse.parse({ item }), 200);
  });

  app.post("/config/extensions/:kind/:key/revert", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const key = c.req.param("key").trim();
    const parsed = await parseJsonBody(c.req.raw, revertRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }
    const item = await service.revertExtension({
      tenantId,
      tokenId: claims.token_id,
      kind,
      key,
      revision: parsed.data.revision,
      reason: parsed.data.reason,
    });
    return c.json(ExtensionsMutateResponse.parse({ item }), 200);
  });

  app.post("/config/extensions/:kind/:key/refresh", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const key = c.req.param("key").trim();
    let item;
    try {
      item = await service.refreshExtension({
        tenantId,
        tokenId: claims.token_id,
        kind,
        key,
      });
    } catch (error) {
      const response = toRouteErrorResponse(error);
      return c.json(response.body, response.status);
    }
    if (!item) {
      return c.json({ error: "not_found", message: `extension '${key}' not found` }, 404);
    }
    return c.json(ExtensionsMutateResponse.parse({ item }), 200);
  });

  app.put("/config/extensions/:kind/:key/defaults", async (c) => {
    const tenantId = requireTenantId(c);
    const kind = extensionKindSchema.parse(c.req.param("kind"));
    const key = c.req.param("key").trim();
    const parsed = await parseJsonBody(c.req.raw, defaultsUpdateRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }

    try {
      const settingsUpdate = parseStructuredSettings({
        kind,
        settingsFormat: parsed.data.settings_format,
        settingsText: parsed.data.settings_text,
      });
      const item = await service.updateDefaults({
        tenantId,
        kind,
        key,
        defaultAccess: parsed.data.default_access,
        replaceSettings: settingsUpdate.replaceSettings,
        settings: settingsUpdate.settings,
      });
      if (!item) {
        return c.json({ error: "not_found", message: `extension '${key}' not found` }, 404);
      }
      return c.json(ExtensionsMutateResponse.parse({ item }), 200);
    } catch (error) {
      return c.json(
        {
          error: "invalid_request",
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  app.post("/config/extensions/mcp/parse-settings", async (c) => {
    requireTenantId(c);
    const parsed = await parseJsonBody(c.req.raw, parseMcpSettingsRequestSchema);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.message }, 400);
    }

    try {
      const settingsUpdate = parseStructuredSettings({
        kind: "mcp",
        settingsFormat: parsed.data.settings_format,
        settingsText: parsed.data.settings_text,
      });
      if (!settingsUpdate.settings) {
        return c.json(
          { error: "invalid_request", message: "settings must be a non-empty object" },
          400,
        );
      }
      return c.json({ settings: settingsUpdate.settings }, 200);
    } catch (error) {
      return c.json(
        {
          error: "invalid_request",
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  return app;
}
