import { Buffer } from "node:buffer";
import { basename } from "node:path";
import {
  AgentConfig,
  type ManagedExtensionDetail,
  type ManagedExtensionSourceDescriptor,
  type ManagedExtensionSummary,
} from "@tyrum/schemas";
import { z } from "zod";
import type { RuntimePackageRevision } from "../modules/agent/runtime-package-dal.js";
import { RuntimePackageDal } from "../modules/agent/runtime-package-dal.js";
import {
  buildManagedMcpPackageFromFiles,
  buildManagedMcpPackageFromSpec,
  buildManagedSkillPackageFromFiles,
  buildManagedSkillPackageFromMarkdown,
  ensureManagedExtensionMaterialized,
  parseManagedMcpPackage,
  parseManagedSkillPackage,
} from "../modules/extensions/managed.js";
import { extractZipArchive, isZipArchive } from "../modules/extensions/archive.js";
import type { SqlDb } from "../statestore/types.js";

export const extensionKindSchema = z.enum(["skill", "mcp"]);

export const toggleRequestSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const revertRequestSchema = z
  .object({
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const uploadRequestSchema = z
  .object({
    key: z.string().trim().min(1).optional(),
    filename: z.string().trim().min(1).optional(),
    content_type: z.string().trim().min(1).optional(),
    content_base64: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const skillImportRequestSchema = z
  .object({
    source: z.literal("direct-url"),
    url: z.string().trim().url(),
    key: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const mcpImportRequestSchema = z.discriminatedUnion("source", [
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

function decodeText(buffer: Buffer): string {
  return buffer.toString("utf-8").replace(/^\uFEFF/u, "");
}

function inferFilenameFromHeaders(response: Response, url: string): string | undefined {
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/iu.exec(contentDisposition);
  if (match?.[1]) return basename(match[1].trim());
  try {
    return basename(new URL(url).pathname) || undefined;
  } catch {
    return undefined;
  }
}

export async function downloadArtifact(url: string): Promise<{
  body: Buffer;
  filename?: string;
  contentType?: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed with HTTP ${String(response.status)}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    filename: inferFilenameFromHeaders(response, url),
    contentType: response.headers.get("content-type") ?? undefined,
  };
}

export async function buildSkillPackageFromArtifact(input: {
  key?: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  source: "direct-url" | "upload";
  url?: string;
}): Promise<ReturnType<typeof buildManagedSkillPackageFromMarkdown>> {
  if (isZipArchive(input.buffer)) {
    const files = await extractZipArchive(input.buffer);
    return buildManagedSkillPackageFromFiles({
      key: input.key,
      files,
      source:
        input.source === "direct-url"
          ? {
              kind: "direct-url",
              url: input.url ?? "",
              filename: input.filename,
              content_type: input.contentType,
            }
          : {
              kind: "upload",
              filename: input.filename,
              content_type: input.contentType,
            },
    });
  }
  return buildManagedSkillPackageFromMarkdown({
    key: input.key,
    markdown: decodeText(input.buffer),
    source:
      input.source === "direct-url"
        ? {
            kind: "direct-url",
            url: input.url ?? "",
            filename: input.filename,
            content_type: input.contentType,
          }
        : {
            kind: "upload",
            filename: input.filename,
            content_type: input.contentType,
          },
  });
}

export async function buildMcpPackageFromArtifact(input: {
  key?: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  source: "direct-url" | "upload";
  url?: string;
}) {
  if (isZipArchive(input.buffer)) {
    const files = await extractZipArchive(input.buffer);
    return buildManagedMcpPackageFromFiles({
      key: input.key,
      files,
      source:
        input.source === "direct-url"
          ? {
              kind: "direct-url",
              url: input.url ?? "",
              mode: "archive",
              filename: input.filename,
              content_type: input.contentType,
            }
          : {
              kind: "upload",
              filename: input.filename,
              content_type: input.contentType,
            },
    });
  }
  return buildManagedMcpPackageFromFiles({
    key: input.key,
    files: [{ path: "server.yml", content: input.buffer }],
    source:
      input.source === "direct-url"
        ? {
            kind: "direct-url",
            url: input.url ?? "",
            mode: "archive",
            filename: input.filename,
            content_type: input.contentType,
          }
        : {
            kind: "upload",
            filename: input.filename,
            content_type: input.contentType,
          },
  });
}

export async function listLatestAgentConfigs(db: SqlDb, tenantId: string): Promise<AgentConfig[]> {
  const rows = await db.all<{ config_json: string }>(
    `SELECT current.config_json
     FROM agent_configs current
     WHERE current.tenant_id = ?
       AND current.revision = (
         SELECT MAX(inner_cfg.revision)
         FROM agent_configs inner_cfg
         WHERE inner_cfg.tenant_id = current.tenant_id
           AND inner_cfg.agent_id = current.agent_id
       )`,
    [tenantId],
  );
  return rows.flatMap((row) => {
    try {
      const parsed = AgentConfig.safeParse(JSON.parse(row.config_json) as unknown);
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export function countAssignments(
  configs: readonly AgentConfig[],
  kind: "skill" | "mcp",
  key: string,
): number {
  return configs.filter((config) =>
    kind === "skill" ? config.skills.enabled.includes(key) : config.mcp.enabled.includes(key),
  ).length;
}

function sourceDescriptorForSkill(
  source: ReturnType<typeof parseManagedSkillPackage>["source"],
): ManagedExtensionSourceDescriptor {
  return source.kind === "direct-url"
    ? {
        kind: "direct-url",
        url: source.url,
        filename: source.filename ?? null,
      }
    : {
        kind: "upload",
        filename: source.filename ?? null,
      };
}

function sourceDescriptorForMcp(
  source: ReturnType<typeof parseManagedMcpPackage>["source"],
): ManagedExtensionSourceDescriptor {
  if (source.kind === "direct-url") {
    return {
      kind: "direct-url",
      url: source.url,
      mode: source.mode,
      filename: source.filename ?? null,
    };
  }
  if (source.kind === "npm") {
    return {
      kind: "npm",
      npm_spec: source.npm_spec,
      command: source.command,
      args: source.args,
    };
  }
  return {
    kind: "upload",
    filename: source.filename ?? null,
  };
}

export async function buildExtensionSummary(input: {
  tenantId: string;
  stateMode: "local" | "shared";
  home: string;
  kind: "skill" | "mcp";
  revision: RuntimePackageRevision;
  assignmentCount: number;
}): Promise<ManagedExtensionSummary> {
  if (input.kind === "skill") {
    const pkg = parseManagedSkillPackage(input.revision.packageData, input.revision.packageKey);
    const materializedPath = await ensureManagedExtensionMaterialized({
      home: input.home,
      tenantId: input.tenantId,
      stateMode: input.stateMode,
      kind: "skill",
      revision: input.revision,
    });
    return {
      kind: "skill",
      key: pkg.key,
      name: pkg.manifest.meta.name,
      description: pkg.manifest.meta.description ?? null,
      version: pkg.manifest.meta.version ?? null,
      enabled: input.revision.enabled,
      revision: input.revision.revision,
      source: sourceDescriptorForSkill(pkg.source),
      refreshable: pkg.source.kind === "direct-url",
      materialized_path: materializedPath ?? null,
      assignment_count: input.assignmentCount,
      transport: null,
    };
  }

  const pkg = parseManagedMcpPackage(input.revision.packageData, input.revision.packageKey);
  const materializedPath = await ensureManagedExtensionMaterialized({
    home: input.home,
    tenantId: input.tenantId,
    stateMode: input.stateMode,
    kind: "mcp",
    revision: input.revision,
  });
  return {
    kind: "mcp",
    key: pkg.key,
    name: pkg.spec.name,
    description: null,
    version: null,
    enabled: input.revision.enabled,
    revision: input.revision.revision,
    source: sourceDescriptorForMcp(pkg.source),
    refreshable: pkg.source.kind === "direct-url" || pkg.source.kind === "npm",
    materialized_path: materializedPath ?? null,
    assignment_count: input.assignmentCount,
    transport: pkg.spec.transport,
  };
}

export async function buildExtensionDetail(input: {
  tenantId: string;
  stateMode: "local" | "shared";
  home: string;
  kind: "skill" | "mcp";
  revision: RuntimePackageRevision;
  assignmentCount: number;
  runtimePackageDal: RuntimePackageDal;
}): Promise<ManagedExtensionDetail> {
  const summary = await buildExtensionSummary(input);
  const revisions = await input.runtimePackageDal.listRevisions({
    tenantId: input.tenantId,
    packageKind: input.kind,
    packageKey: input.revision.packageKey,
  });
  if (input.kind === "skill") {
    const pkg = parseManagedSkillPackage(input.revision.packageData, input.revision.packageKey);
    return {
      ...summary,
      manifest: pkg.manifest,
      spec: null,
      files: pkg.files.map((file) => file.path),
      revisions: revisions.map((revision) => ({
        revision: revision.revision,
        enabled: revision.enabled,
        created_at: revision.createdAt,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      })),
    };
  }
  const pkg = parseManagedMcpPackage(input.revision.packageData, input.revision.packageKey);
  return {
    ...summary,
    manifest: null,
    spec: pkg.spec,
    files: pkg.files.map((file) => file.path),
    revisions: revisions.map((revision) => ({
      revision: revision.revision,
      enabled: revision.enabled,
      created_at: revision.createdAt,
      reason: revision.reason ?? null,
      reverted_from_revision: revision.revertedFromRevision ?? null,
    })),
  };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new Error("invalid json");
  }
}

export function decodeUploadedBuffer(contentBase64: string): Buffer {
  try {
    return Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("invalid base64 upload payload");
  }
}

export function buildManagedMcpImportPackage(input: z.infer<typeof mcpImportRequestSchema>) {
  if (input.source === "npm") {
    return buildManagedMcpPackageFromSpec({
      key: input.key,
      spec: {
        id: input.key ?? input.npm_spec,
        name: input.name ?? input.key ?? input.npm_spec,
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", input.npm_spec],
      },
      source: {
        kind: "npm",
        npm_spec: input.npm_spec,
        command: "npx",
        args: ["-y"],
      },
    });
  }
  return buildManagedMcpPackageFromSpec({
    key: input.key,
    spec: {
      id: input.key ?? input.url,
      name: input.name ?? input.key ?? input.url,
      enabled: true,
      transport: "remote",
      url: input.url,
    },
    source: {
      kind: "direct-url",
      url: input.url,
      mode: "remote",
    },
  });
}

export { buildManagedMcpPackageFromSpec, parseManagedMcpPackage };
