import { Buffer } from "node:buffer";
import type {
  ExtensionKind as ExtensionKindT,
  ManagedExtensionDetail,
  ManagedExtensionSummary,
} from "@tyrum/schemas";
import type { GatewayContainer } from "../../container.js";
import { RuntimePackageDal } from "../agent/runtime-package-dal.js";
import {
  buildManagedMcpPackageFromSpec,
  parseManagedMcpPackage,
  parseManagedSkillPackage,
} from "./managed.js";
import {
  buildMcpPackageFromArchive,
  buildSkillPackageFromArtifact,
  decodeUploadedBuffer,
  downloadArtifact,
} from "./package-source.js";
import type { SqlDb } from "../../statestore/types.js";
import { ExtensionDefaultsDal } from "./defaults-dal.js";
import { buildExtensionInventory } from "./inventory.js";

export type ExtensionKind = "skill" | "mcp";
export type ExtensionStateMode = "local" | "shared";

export interface SkillImportInput {
  key?: string;
  url: string;
  enabled?: boolean;
  reason?: string;
}

export interface UploadInput {
  key?: string;
  filename?: string;
  contentType?: string;
  contentBase64: string;
  enabled?: boolean;
  reason?: string;
}

export type McpImportInput =
  | {
      source: "direct-url";
      url: string;
      mode: "remote" | "archive";
      key?: string;
      name?: string;
      enabled?: boolean;
      reason?: string;
    }
  | {
      source: "npm";
      npmSpec: string;
      key?: string;
      name?: string;
      enabled?: boolean;
      reason?: string;
    };

export class ExtensionsService {
  private readonly db: SqlDb;
  private readonly runtimePackageDal: RuntimePackageDal;
  private readonly defaultsDal: ExtensionDefaultsDal;
  private readonly stateMode: ExtensionStateMode;
  private readonly home: string;

  constructor(deps: {
    db: SqlDb;
    container: Pick<GatewayContainer, "config" | "deploymentConfig">;
  }) {
    this.db = deps.db;
    this.runtimePackageDal = new RuntimePackageDal(deps.db);
    this.defaultsDal = new ExtensionDefaultsDal(deps.db);
    this.stateMode = deps.container.deploymentConfig.state.mode === "shared" ? "shared" : "local";
    this.home = deps.container.config.tyrumHome ?? "";
  }

  private async loadInventory(
    tenantId: string,
    kind: ExtensionKindT,
  ): Promise<ManagedExtensionDetail[]> {
    return await buildExtensionInventory({
      db: this.db,
      tenantId,
      kind,
      stateMode: this.stateMode,
      home: this.home,
    });
  }

  private async getInventoryDetail(
    tenantId: string,
    kind: ExtensionKind,
    key: string,
  ): Promise<ManagedExtensionDetail | null> {
    const inventory = await this.loadInventory(tenantId, kind);
    return inventory.find((item) => item.key === key) ?? null;
  }

  listExtensions = async (
    tenantId: string,
    kind: ExtensionKind,
  ): Promise<ManagedExtensionSummary[]> => {
    return await this.loadInventory(tenantId, kind);
  };

  getExtensionDetail = async (
    tenantId: string,
    kind: ExtensionKind,
    key: string,
  ): Promise<ManagedExtensionDetail | null> => {
    return await this.getInventoryDetail(tenantId, kind, key);
  };

  importSkill = async (
    tenantId: string,
    tokenId: string,
    input: SkillImportInput,
  ): Promise<ManagedExtensionDetail> => {
    const artifact = await downloadArtifact(input.url);
    const pkg = await buildSkillPackageFromArtifact({
      key: input.key,
      buffer: artifact.body,
      filename: artifact.filename,
      contentType: artifact.contentType,
      source: "direct-url",
      url: input.url,
    });
    const revision = await this.runtimePackageDal.set({
      tenantId,
      packageKind: "skill",
      packageKey: pkg.key,
      packageData: pkg,
      enabled: input.enabled !== false,
      createdBy: { kind: "tenant.token", token_id: tokenId },
      reason: input.reason,
    });
    const detail = await this.getInventoryDetail(tenantId, "skill", revision.packageKey);
    if (!detail) throw new Error("expected imported skill inventory detail");
    return detail;
  };

  uploadSkill = async (
    tenantId: string,
    tokenId: string,
    input: UploadInput,
  ): Promise<ManagedExtensionDetail> => {
    const pkg = await buildSkillPackageFromArtifact({
      key: input.key,
      buffer: this.decodeUploadedBuffer(input.contentBase64),
      filename: input.filename,
      contentType: input.contentType,
      source: "upload",
    });
    const revision = await this.runtimePackageDal.set({
      tenantId,
      packageKind: "skill",
      packageKey: pkg.key,
      packageData: pkg,
      enabled: input.enabled !== false,
      createdBy: { kind: "tenant.token", token_id: tokenId },
      reason: input.reason,
    });
    const detail = await this.getInventoryDetail(tenantId, "skill", revision.packageKey);
    if (!detail) throw new Error("expected uploaded skill inventory detail");
    return detail;
  };

  importMcp = async (
    tenantId: string,
    tokenId: string,
    input: McpImportInput,
  ): Promise<ManagedExtensionDetail> => {
    const pkg =
      input.source === "npm"
        ? buildManagedMcpPackageFromSpec({
            key: input.key,
            spec: {
              id: input.key ?? input.npmSpec,
              name: input.name ?? input.key ?? input.npmSpec,
              enabled: true,
              transport: "stdio",
              command: "npx",
              args: ["-y", input.npmSpec],
            },
            source: {
              kind: "npm",
              npm_spec: input.npmSpec,
              command: "npx",
              args: ["-y"],
            },
          })
        : input.mode === "remote"
          ? buildManagedMcpPackageFromSpec({
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
            })
          : await this.importArchiveMcp(input);

    const revision = await this.runtimePackageDal.set({
      tenantId,
      packageKind: "mcp",
      packageKey: pkg.key,
      packageData: pkg,
      enabled: input.enabled !== false,
      createdBy: { kind: "tenant.token", token_id: tokenId },
      reason: input.reason,
    });
    const detail = await this.getInventoryDetail(tenantId, "mcp", revision.packageKey);
    if (!detail) throw new Error("expected imported MCP inventory detail");
    return detail;
  };

  uploadMcp = async (
    tenantId: string,
    tokenId: string,
    input: UploadInput,
  ): Promise<ManagedExtensionDetail> => {
    const pkg = await buildMcpPackageFromArchive({
      key: input.key,
      buffer: this.decodeUploadedBuffer(input.contentBase64),
      filename: input.filename,
      contentType: input.contentType,
      source: "upload",
    });
    const revision = await this.runtimePackageDal.set({
      tenantId,
      packageKind: "mcp",
      packageKey: pkg.key,
      packageData: pkg,
      enabled: input.enabled !== false,
      createdBy: { kind: "tenant.token", token_id: tokenId },
      reason: input.reason,
    });
    const detail = await this.getInventoryDetail(tenantId, "mcp", revision.packageKey);
    if (!detail) throw new Error("expected uploaded MCP inventory detail");
    return detail;
  };

  toggleExtension = async (input: {
    tenantId: string;
    tokenId: string;
    kind: ExtensionKind;
    key: string;
    enabled: boolean;
    reason?: string;
  }): Promise<ManagedExtensionDetail | null> => {
    const existing = await this.runtimePackageDal.getLatest({
      tenantId: input.tenantId,
      packageKind: input.kind,
      packageKey: input.key,
    });
    if (!existing) return null;

    const revision = await this.runtimePackageDal.set({
      tenantId: input.tenantId,
      packageKind: input.kind,
      packageKey: input.key,
      packageData: existing.packageData,
      artifactId: existing.artifactId,
      enabled: input.enabled,
      createdBy: { kind: "tenant.token", token_id: input.tokenId },
      reason: input.reason,
    });
    return await this.getInventoryDetail(input.tenantId, input.kind, revision.packageKey);
  };

  revertExtension = async (input: {
    tenantId: string;
    tokenId: string;
    kind: ExtensionKind;
    key: string;
    revision: number;
    reason?: string;
  }): Promise<ManagedExtensionDetail> => {
    const revision = await this.runtimePackageDal.revertToRevision({
      tenantId: input.tenantId,
      packageKind: input.kind,
      packageKey: input.key,
      revision: input.revision,
      createdBy: { kind: "tenant.token", token_id: input.tokenId },
      reason: input.reason,
    });
    const detail = await this.getInventoryDetail(input.tenantId, input.kind, revision.packageKey);
    if (!detail) throw new Error("expected reverted extension inventory detail");
    return detail;
  };

  refreshExtension = async (input: {
    tenantId: string;
    tokenId: string;
    kind: ExtensionKind;
    key: string;
  }): Promise<ManagedExtensionDetail | null> => {
    const existing = await this.runtimePackageDal.getLatest({
      tenantId: input.tenantId,
      packageKind: input.kind,
      packageKey: input.key,
    });
    if (!existing) return null;

    const nextPackage = await this.buildRefreshedPackage(
      input.kind,
      input.key,
      existing.packageData,
    );
    const revision = await this.runtimePackageDal.set({
      tenantId: input.tenantId,
      packageKind: input.kind,
      packageKey: input.key,
      packageData: nextPackage,
      enabled: existing.enabled,
      createdBy: { kind: "tenant.token", token_id: input.tokenId },
      reason: "refresh",
    });
    return await this.getInventoryDetail(input.tenantId, input.kind, revision.packageKey);
  };

  updateDefaults = async (input: {
    tenantId: string;
    kind: ExtensionKind;
    key: string;
    defaultAccess: "inherit" | "allow" | "deny";
    replaceSettings?: boolean;
    settings?: Record<string, unknown>;
  }): Promise<ManagedExtensionDetail | null> => {
    const existing = await this.getInventoryDetail(input.tenantId, input.kind, input.key);
    if (!existing) return null;

    const currentDefaults = await this.defaultsDal.get({
      tenantId: input.tenantId,
      kind: input.kind,
      extensionId: input.key,
    });
    const nextSettings = input.replaceSettings ? input.settings : currentDefaults?.settings;
    const shouldDelete = input.defaultAccess === "inherit" && !nextSettings;
    if (shouldDelete) {
      await this.defaultsDal.delete({
        tenantId: input.tenantId,
        kind: input.kind,
        extensionId: input.key,
      });
    } else {
      await this.defaultsDal.set({
        tenantId: input.tenantId,
        kind: input.kind,
        extensionId: input.key,
        ...(input.defaultAccess !== "inherit" ? { defaultAccess: input.defaultAccess } : {}),
        ...(nextSettings ? { settings: nextSettings } : {}),
      });
    }

    return await this.getInventoryDetail(input.tenantId, input.kind, input.key);
  };

  private decodeUploadedBuffer(contentBase64: string): Buffer {
    return decodeUploadedBuffer(contentBase64);
  }

  private importArchiveMcp = async (input: Extract<McpImportInput, { source: "direct-url" }>) => {
    const artifact = await downloadArtifact(input.url);
    return await buildMcpPackageFromArchive({
      key: input.key,
      buffer: artifact.body,
      filename: artifact.filename,
      contentType: artifact.contentType,
      source: "direct-url",
      url: input.url,
    });
  };

  private async buildRefreshedPackage(
    kind: ExtensionKind,
    key: string,
    packageData: unknown,
  ): Promise<unknown> {
    if (kind === "skill") {
      const skillPackage = parseManagedSkillPackage(packageData, key);
      if (skillPackage.source.kind !== "direct-url") {
        throw new Error("upload-based skills cannot be refreshed");
      }
      const artifact = await downloadArtifact(skillPackage.source.url);
      return await buildSkillPackageFromArtifact({
        key,
        buffer: artifact.body,
        filename: artifact.filename,
        contentType: artifact.contentType,
        source: "direct-url",
        url: skillPackage.source.url,
      });
    }

    const mcpPackage = parseManagedMcpPackage(packageData, key);
    if (mcpPackage.source.kind === "direct-url" && mcpPackage.source.mode === "archive") {
      const artifact = await downloadArtifact(mcpPackage.source.url);
      return await buildMcpPackageFromArchive({
        key,
        buffer: artifact.body,
        filename: artifact.filename,
        contentType: artifact.contentType,
        source: "direct-url",
        url: mcpPackage.source.url,
      });
    }
    if (mcpPackage.source.kind === "direct-url") {
      return buildManagedMcpPackageFromSpec({
        key,
        spec: mcpPackage.spec,
        source: {
          kind: "direct-url",
          url: mcpPackage.source.url,
          mode: mcpPackage.source.mode,
          filename: mcpPackage.source.filename,
          content_type: mcpPackage.source.content_type,
        },
      });
    }
    if (mcpPackage.source.kind === "npm") {
      return buildManagedMcpPackageFromSpec({
        key,
        spec: mcpPackage.spec,
        source: {
          kind: "npm",
          npm_spec: mcpPackage.source.npm_spec,
          command: mcpPackage.source.command,
          args: mcpPackage.source.args,
        },
      });
    }
    throw new Error("upload-based MCP servers cannot be refreshed");
  }
}
