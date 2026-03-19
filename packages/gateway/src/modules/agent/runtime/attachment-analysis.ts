import { generateText, type LanguageModel } from "ai";
import type {
  AgentConfig as AgentConfigT,
  DeploymentConfig as DeploymentConfigT,
  TyrumUIMessage,
  TyrumUIMessagePart,
} from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import type { Logger } from "../../observability/logger.js";
import {
  extractArtifactIdFromUrl,
  getArtifactRowsByIds,
  rowToArtifactRef,
} from "../../artifact/dal.js";
import { normalizeArtifactDescribeArgs } from "../../artifact/describe-args.js";
import {
  isFileMessagePart,
  isTextMessagePart,
  renderTurnPartsText,
  type FileMessagePart,
} from "../../ai-sdk/attachment-parts.js";
import { resolveSessionModelDetailed } from "./session-model-resolution.js";
import type { ResolveSessionModelDeps } from "./session-model-resolution.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { ArtifactStore } from "../../artifact/store.js";

type AttachmentFileInput = {
  artifactId?: string;
  url: string;
  mediaType: string;
  filename?: string;
};

type PreparedAttachment = {
  artifactId?: string;
  url: string;
  mediaType: string;
  filename?: string;
  sizeBytes?: number;
};

type AttachmentAnalysisDeps = {
  db: SqlDb;
  tenantId: string;
  fetchImpl?: typeof fetch;
  artifactStore?: ArtifactStore;
  logger?: Logger;
  resolveModel: () => Promise<LanguageModel>;
  maxAnalysisBytes: number;
};

export type AttachmentUserContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mediaType: string; filename?: string };

type PrepareAttachmentInputDeps = {
  container: ResolveSessionModelDeps["container"] & {
    artifactStore: ArtifactStore;
    db: SqlDb;
    deploymentConfig: DeploymentConfigT;
    logger: Logger;
  };
  fetchImpl?: typeof fetch;
  secretProvider?: SecretProvider;
  languageModelOverride?: LanguageModel;
  instanceOwner: string;
  tenantId: string;
  sessionId: string;
  agentConfig: AgentConfigT;
  deploymentConfig: DeploymentConfigT;
  primaryModel: LanguageModel;
};

export type PreparedAttachmentPromptInput = {
  inputMode: AgentConfigT["attachments"]["input_mode"];
  currentTurnParts: AttachmentUserContentPart[];
  shouldRewriteHistoryForModel: boolean;
  helperSummaryText?: string;
};

export type AttachmentAnalysisResult = {
  summary: string;
  analyzed_artifact_ids: string[];
  skipped: Array<{ artifact_id?: string; reason: string }>;
};

function renderSkippedSummary(skipped: AttachmentAnalysisResult["skipped"]): string {
  if (skipped.length === 0) {
    return "";
  }
  return [
    "Attachment analysis unavailable.",
    ...skipped.map((entry) =>
      entry.artifact_id ? `- ${entry.artifact_id}: ${entry.reason}` : `- ${entry.reason}`,
    ),
  ].join("\n");
}

export function createAttachmentDownloadFunction(input: {
  fetchImpl: typeof fetch | undefined;
  artifactStore?: ArtifactStore;
  maxBytes: number;
}) {
  const downloadFetch = input.fetchImpl ?? fetch;
  return async (
    downloads: Array<{ url: URL; isUrlSupportedByModel: boolean }>,
  ): Promise<Array<{ data: Uint8Array; mediaType: string | undefined } | null>> =>
    await Promise.all(
      downloads.map(async (download) => {
        if (download.isUrlSupportedByModel) {
          return null;
        }
        const artifactId = extractArtifactIdFromUrl(download.url.toString());
        if (artifactId && input.artifactStore) {
          const stored = await input.artifactStore.get(artifactId);
          if (stored) {
            if (stored.body.byteLength > input.maxBytes) {
              throw new Error(
                `attachment exceeds maxAnalysisBytes (${String(stored.body.byteLength)} > ${String(input.maxBytes)}) for ${download.url.toString()}`,
              );
            }
            return {
              data: new Uint8Array(
                stored.body.buffer as ArrayBuffer,
                stored.body.byteOffset,
                stored.body.byteLength,
              ),
              mediaType: stored.ref.mime_type ?? undefined,
            };
          }
        }
        const response = await downloadFetch(download.url, { method: "GET" });
        if (!response.ok) {
          throw new Error(
            `attachment download failed (${String(response.status)}) for ${download.url.toString()}`,
          );
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > input.maxBytes) {
          throw new Error(
            `attachment exceeds maxAnalysisBytes (${String(arrayBuffer.byteLength)} > ${String(input.maxBytes)}) for ${download.url.toString()}`,
          );
        }
        return {
          data: new Uint8Array(arrayBuffer),
          mediaType: response.headers.get("content-type") ?? undefined,
        };
      }),
    );
}

function artifactIdFromFile(file: AttachmentFileInput): string | undefined {
  return file.artifactId ?? extractArtifactIdFromUrl(file.url);
}

function estimateDataUrlBytes(url: string): number | undefined {
  const matched = url.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!matched) {
    return undefined;
  }
  const payload = matched[2]?.replace(/\s+/g, "") ?? "";
  if (payload.length === 0) {
    return 0;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function isAnalyzableMediaType(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase();
  return (
    normalized.startsWith("image/") ||
    normalized === "application/pdf" ||
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized.endsWith("+json") ||
    normalized === "application/xml" ||
    normalized.endsWith("+xml")
  );
}

function buildPrompt(input: {
  sourceText?: string;
  prompt?: string;
  skipped: AttachmentAnalysisResult["skipped"];
}): string {
  const sections: string[] = [
    "Analyze the provided attachments for another agent.",
    "Return concise plain text only.",
    "Describe what is visible or readable, extract relevant details, and mention uncertainty when needed.",
  ];

  if (input.prompt?.trim()) {
    sections.push(`Requested focus:\n${input.prompt.trim()}`);
  }
  if (input.sourceText?.trim()) {
    sections.push(`Related user text:\n${input.sourceText.trim()}`);
  }
  if (input.skipped.length > 0) {
    sections.push(
      `Skipped attachments:\n${input.skipped
        .map((entry) =>
          entry.artifact_id ? `- ${entry.artifact_id}: ${entry.reason}` : `- ${entry.reason}`,
        )
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

async function validateUploadLimit(input: {
  db: SqlDb;
  tenantId: string;
  files: readonly AttachmentFileInput[];
  maxUploadBytes: number;
}): Promise<void> {
  const artifactIds = input.files
    .map((file) => artifactIdFromFile(file))
    .filter((artifactId): artifactId is string => typeof artifactId === "string");
  const rows =
    artifactIds.length > 0 ? await getArtifactRowsByIds(input.db, input.tenantId, artifactIds) : [];
  const rowById = new Map(rows.map((row) => [row.artifact_id, row]));

  for (const file of input.files) {
    const artifactId = artifactIdFromFile(file);
    const artifactSize = artifactId
      ? (rowById.get(artifactId)?.size_bytes ?? undefined)
      : undefined;
    const inlineSize = estimateDataUrlBytes(file.url);
    const sizeBytes = artifactSize ?? inlineSize;
    if (typeof sizeBytes === "number" && sizeBytes > input.maxUploadBytes) {
      throw new Error(
        `attachment exceeds maxUploadBytes (${String(sizeBytes)} > ${String(input.maxUploadBytes)})`,
      );
    }
  }
}

async function prepareAttachments(
  deps: AttachmentAnalysisDeps,
  files: readonly AttachmentFileInput[],
): Promise<{ prepared: PreparedAttachment[]; skipped: AttachmentAnalysisResult["skipped"] }> {
  const artifactIds = files
    .map((file) => artifactIdFromFile(file))
    .filter((artifactId): artifactId is string => typeof artifactId === "string");
  const rows = await getArtifactRowsByIds(deps.db, deps.tenantId, artifactIds);
  const rowById = new Map(rows.map((row) => [row.artifact_id, row]));

  const prepared: PreparedAttachment[] = [];
  const skipped: AttachmentAnalysisResult["skipped"] = [];

  for (const file of files) {
    const artifactId = artifactIdFromFile(file);
    const row = artifactId ? rowById.get(artifactId) : undefined;
    const ref = row ? rowToArtifactRef(row) : undefined;
    const mediaType = ref?.mime_type ?? file.mediaType;
    const sizeBytes = ref?.size_bytes;

    if (!isAnalyzableMediaType(mediaType)) {
      skipped.push({
        artifact_id: artifactId,
        reason: `unsupported media type ${mediaType}`,
      });
      continue;
    }
    if (typeof sizeBytes === "number" && sizeBytes > deps.maxAnalysisBytes) {
      skipped.push({
        artifact_id: artifactId,
        reason: `size ${String(sizeBytes)} exceeds analysis limit ${String(deps.maxAnalysisBytes)}`,
      });
      continue;
    }

    prepared.push({
      artifactId,
      url: ref?.external_url ?? file.url,
      mediaType,
      filename: ref?.filename ?? file.filename,
      sizeBytes,
    });
  }

  return { prepared, skipped };
}

export async function analyzeAttachments(
  deps: AttachmentAnalysisDeps,
  input: {
    files: readonly AttachmentFileInput[];
    sourceText?: string;
    prompt?: string;
  },
): Promise<AttachmentAnalysisResult> {
  const { prepared, skipped } = await prepareAttachments(deps, input.files);
  if (prepared.length === 0) {
    return {
      summary: renderSkippedSummary(skipped),
      analyzed_artifact_ids: [],
      skipped,
    };
  }

  const model = await deps.resolveModel();
  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPrompt({
              sourceText: input.sourceText,
              prompt: input.prompt,
              skipped,
            }),
          },
          ...prepared.map((file) => ({
            type: "file" as const,
            data: file.url,
            mediaType: file.mediaType,
            ...(file.filename ? { filename: file.filename } : {}),
          })),
        ],
      },
    ],
    experimental_download: createAttachmentDownloadFunction({
      fetchImpl: deps.fetchImpl,
      artifactStore: deps.artifactStore,
      maxBytes: deps.maxAnalysisBytes,
    }),
  });

  return {
    summary: result.text.trim(),
    analyzed_artifact_ids: prepared
      .map((file) => file.artifactId)
      .filter((artifactId): artifactId is string => typeof artifactId === "string"),
    skipped,
  };
}

export async function describeArtifactsForPrompt(input: {
  deps: AttachmentAnalysisDeps;
  args: Record<string, unknown> | null;
}): Promise<{ artifactIds: string[]; summary: string }> {
  const { artifactIds, prompt } = normalizeArtifactDescribeArgs(input.args);
  if (artifactIds.length === 0) {
    throw new Error("artifact.describe requires artifact_id or artifact_ids");
  }
  const analysis = await analyzeAttachments(input.deps, {
    files: artifactIds.map((artifactId) => ({
      artifactId,
      url: `artifact://${artifactId}`,
      mediaType: "application/octet-stream",
    })),
    prompt,
  });
  return {
    artifactIds,
    summary: analysis.summary,
  };
}

function partToPromptContentPart(part: FileMessagePart): AttachmentUserContentPart {
  return {
    type: "file",
    data: part.url,
    mediaType: part.mediaType,
    ...(part.filename ? { filename: part.filename } : {}),
  };
}

async function resolveHelperModel(deps: PrepareAttachmentInputDeps): Promise<LanguageModel> {
  const helperModel =
    deps.deploymentConfig.attachments.helperModel.model !== null
      ? deps.deploymentConfig.attachments.helperModel
      : deps.agentConfig.model;
  if (helperModel.model === deps.agentConfig.model.model) {
    return deps.primaryModel;
  }

  const resolved = await resolveSessionModelDetailed(
    {
      container: deps.container,
      languageModelOverride: deps.languageModelOverride,
      secretProvider: deps.secretProvider,
      oauthLeaseOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl ?? fetch,
    },
    {
      config: {
        ...deps.agentConfig,
        model: helperModel,
      },
      tenantId: deps.tenantId,
      sessionId: deps.sessionId,
      fetchImpl: deps.fetchImpl ?? fetch,
    },
  );
  return resolved.model;
}

export async function prepareAttachmentInputForPrompt(input: {
  deps: PrepareAttachmentInputDeps;
  parts: readonly TyrumUIMessagePart[];
}): Promise<PreparedAttachmentPromptInput> {
  const textParts = input.parts
    .filter(isTextMessagePart)
    .map((part) => ({ type: "text" as const, text: part.text.trim() }))
    .filter((part) => part.text.length > 0);
  const fileParts = input.parts.filter(isFileMessagePart);
  const inputMode = input.deps.agentConfig.attachments.input_mode;
  await validateUploadLimit({
    db: input.deps.container.db,
    tenantId: input.deps.tenantId,
    files: fileParts.map((part) => ({
      url: part.url,
      mediaType: part.mediaType,
      filename: part.filename,
    })),
    maxUploadBytes: input.deps.deploymentConfig.attachments.maxUploadBytes,
  });

  if (inputMode === "native" || fileParts.length === 0) {
    return {
      inputMode,
      currentTurnParts: [...textParts, ...fileParts.map((part) => partToPromptContentPart(part))],
      shouldRewriteHistoryForModel: false,
      helperSummaryText: undefined,
    };
  }

  try {
    const analysis = await analyzeAttachments(
      {
        db: input.deps.container.db,
        tenantId: input.deps.tenantId,
        fetchImpl: input.deps.fetchImpl,
        artifactStore: input.deps.container.artifactStore,
        logger: input.deps.container.logger,
        resolveModel: async () => await resolveHelperModel(input.deps),
        maxAnalysisBytes: input.deps.deploymentConfig.attachments.maxAnalysisBytes,
      },
      {
        files: fileParts.map((part) => ({
          url: part.url,
          mediaType: part.mediaType,
          filename: part.filename,
        })),
        sourceText: renderTurnPartsText(input.parts),
      },
    );

    return {
      inputMode,
      currentTurnParts: textParts,
      shouldRewriteHistoryForModel: true,
      helperSummaryText: analysis.summary.trim() || undefined,
    };
  } catch (err) {
    input.deps.container.logger.warn("agents.attachments.helper_analysis_failed", {
      tenant_id: input.deps.tenantId,
      session_id: input.deps.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      inputMode,
      currentTurnParts: textParts,
      shouldRewriteHistoryForModel: true,
      helperSummaryText: `Attachment analysis unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function rewriteHistoryMessagesForHelperMode(
  messages: readonly TyrumUIMessage[],
): TyrumUIMessage[] {
  return messages.map((message) => {
    const textParts: TyrumUIMessagePart[] = [];
    const attachmentSummaries: string[] = [];

    for (const part of message.parts as TyrumUIMessagePart[]) {
      if (isTextMessagePart(part)) {
        textParts.push({ type: "text", text: part.text });
        continue;
      }
      if (isFileMessagePart(part)) {
        attachmentSummaries.push(
          [part.filename ? `filename=${part.filename}` : null, `mime_type=${part.mediaType}`]
            .filter((value): value is string => typeof value === "string")
            .join(" "),
        );
      }
    }

    if (attachmentSummaries.length > 0) {
      textParts.push({
        type: "text",
        text: `Attachments:\n${attachmentSummaries.map((entry) => `- ${entry}`).join("\n")}`,
      });
    }

    return {
      ...message,
      parts: textParts.length > 0 ? textParts : [{ type: "text", text: "" }],
    };
  });
}
