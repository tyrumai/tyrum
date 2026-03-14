import {
  ExtensionsDetailResponse,
  ExtensionsListResponse,
  ExtensionsMutateResponse,
  type ExtensionKind,
  type ExtensionsDetailResponse as ExtensionsDetailResponseT,
  type ExtensionsListResponse as ExtensionsListResponseT,
  type ExtensionsMutateResponse as ExtensionsMutateResponseT,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const extensionKindSchema = z.enum(["skill", "mcp"]);
const extensionKeySchema = z.string().trim().min(1);

const skillImportInputSchema = z
  .object({
    url: z.string().trim().url(),
    key: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const uploadInputSchema = z
  .object({
    key: z.string().trim().min(1).optional(),
    filename: z.string().trim().min(1).optional(),
    content_type: z.string().trim().min(1).optional(),
    content_base64: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const mcpImportInputSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("direct-url"),
      url: z.string().trim().url(),
      mode: z.enum(["remote", "archive"]).optional(),
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

const toggleInputSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const revertInputSchema = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const defaultsUpdateInputSchema = z
  .object({
    default_access: z.enum(["inherit", "allow", "deny"]),
    settings_format: z.enum(["json", "yaml"]).optional(),
    settings_text: z.string().optional(),
  })
  .strict();

const parseMcpSettingsInputSchema = z
  .object({
    settings_format: z.enum(["json", "yaml"]),
    settings_text: z.string(),
  })
  .strict();

const parseMcpSettingsResponseSchema = z
  .object({
    settings: z.record(z.string(), z.unknown()),
  })
  .strict();

export type SkillImportInput = z.infer<typeof skillImportInputSchema>;
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type McpImportInput = z.infer<typeof mcpImportInputSchema>;
export type ExtensionsToggleInput = z.infer<typeof toggleInputSchema>;
export type ExtensionsRevertInput = z.infer<typeof revertInputSchema>;
export type ExtensionsDefaultsUpdateInput = z.infer<typeof defaultsUpdateInputSchema>;
export type ExtensionsParseMcpSettingsInput = z.infer<typeof parseMcpSettingsInputSchema>;
export type ExtensionsParseMcpSettingsResult = z.infer<typeof parseMcpSettingsResponseSchema>;

export interface ExtensionsApi {
  list(kind: ExtensionKind, options?: TyrumRequestOptions): Promise<ExtensionsListResponseT>;
  get(
    kind: ExtensionKind,
    key: string,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsDetailResponseT>;
  importSkill(
    input: SkillImportInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  uploadSkill(
    input: UploadInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  importMcp(
    input: McpImportInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  uploadMcp(input: UploadInput, options?: TyrumRequestOptions): Promise<ExtensionsMutateResponseT>;
  toggle(
    kind: ExtensionKind,
    key: string,
    input: ExtensionsToggleInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  revert(
    kind: ExtensionKind,
    key: string,
    input: ExtensionsRevertInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  refresh(
    kind: ExtensionKind,
    key: string,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  updateDefaults(
    kind: ExtensionKind,
    key: string,
    input: ExtensionsDefaultsUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsMutateResponseT>;
  parseMcpSettings(
    input: ExtensionsParseMcpSettingsInput,
    options?: TyrumRequestOptions,
  ): Promise<ExtensionsParseMcpSettingsResult>;
}

export function createExtensionsApi(transport: HttpTransport): ExtensionsApi {
  return {
    async list(kind, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      return await transport.request({
        method: "GET",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}`,
        response: ExtensionsListResponse,
        signal: options?.signal,
      });
    },

    async get(kind, key, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      const parsedKey = validateOrThrow(extensionKeySchema, key, "extension key");
      return await transport.request({
        method: "GET",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}/${encodeURIComponent(parsedKey)}`,
        response: ExtensionsDetailResponse,
        signal: options?.signal,
      });
    },

    async importSkill(input, options) {
      const payload = validateOrThrow(skillImportInputSchema, input, "skill import input");
      return await transport.request({
        method: "POST",
        path: "/config/extensions/skill/import",
        body: { source: "direct-url", ...payload },
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async uploadSkill(input, options) {
      const payload = validateOrThrow(uploadInputSchema, input, "skill upload input");
      return await transport.request({
        method: "POST",
        path: "/config/extensions/skill/upload",
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async importMcp(input, options) {
      const payload = validateOrThrow(mcpImportInputSchema, input, "MCP import input");
      return await transport.request({
        method: "POST",
        path: "/config/extensions/mcp/import",
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async uploadMcp(input, options) {
      const payload = validateOrThrow(uploadInputSchema, input, "MCP upload input");
      return await transport.request({
        method: "POST",
        path: "/config/extensions/mcp/upload",
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async toggle(kind, key, input, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      const parsedKey = validateOrThrow(extensionKeySchema, key, "extension key");
      const payload = validateOrThrow(toggleInputSchema, input, "toggle input");
      return await transport.request({
        method: "POST",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}/${encodeURIComponent(parsedKey)}/toggle`,
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async revert(kind, key, input, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      const parsedKey = validateOrThrow(extensionKeySchema, key, "extension key");
      const payload = validateOrThrow(revertInputSchema, input, "revert input");
      return await transport.request({
        method: "POST",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}/${encodeURIComponent(parsedKey)}/revert`,
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async refresh(kind, key, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      const parsedKey = validateOrThrow(extensionKeySchema, key, "extension key");
      return await transport.request({
        method: "POST",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}/${encodeURIComponent(parsedKey)}/refresh`,
        body: {},
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async updateDefaults(kind, key, input, options) {
      const parsedKind = validateOrThrow(extensionKindSchema, kind, "extension kind");
      const parsedKey = validateOrThrow(extensionKeySchema, key, "extension key");
      const payload = validateOrThrow(defaultsUpdateInputSchema, input, "defaults input");
      return await transport.request({
        method: "PUT",
        path: `/config/extensions/${encodeURIComponent(parsedKind)}/${encodeURIComponent(parsedKey)}/defaults`,
        body: payload,
        response: ExtensionsMutateResponse,
        signal: options?.signal,
      });
    },

    async parseMcpSettings(input, options) {
      const payload = validateOrThrow(
        parseMcpSettingsInputSchema,
        input,
        "MCP settings parse input",
      );
      return await transport.request({
        method: "POST",
        path: "/config/extensions/mcp/parse-settings",
        body: payload,
        response: parseMcpSettingsResponseSchema,
        signal: options?.signal,
      });
    },
  };
}
