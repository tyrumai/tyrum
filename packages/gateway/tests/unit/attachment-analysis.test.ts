import { Buffer } from "node:buffer";
import { AgentConfig, DeploymentConfig } from "@tyrum/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());
const getArtifactRowsByIdsMock = vi.hoisted(() => vi.fn());
const rowToArtifactRefMock = vi.hoisted(() => vi.fn());
const synthArtifactRefFromRowMock = vi.hoisted(() => vi.fn());
const extractArtifactIdFromUrlMock = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

vi.mock("../../src/modules/artifact/dal.js", () => ({
  extractArtifactIdFromUrl: extractArtifactIdFromUrlMock,
  getArtifactRowsByIds: getArtifactRowsByIdsMock,
  rowToArtifactRef: rowToArtifactRefMock,
  synthArtifactRefFromRow: synthArtifactRefFromRowMock,
}));

import {
  createAttachmentDownloadFunction,
  describeArtifactsForPrompt,
  prepareAttachmentInputForPrompt,
  rewriteHistoryMessagesForHelperMode,
} from "../../src/modules/agent/runtime/attachment-analysis.js";

function makeAgentConfig(inputMode: "helper" | "native" = "helper") {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    attachments: { input_mode: inputMode },
  });
}

function makeDeploymentConfig() {
  return DeploymentConfig.parse({
    attachments: {
      helperModel: { model: null },
      maxUploadBytes: 1024 * 1024,
      maxAnalysisBytes: 1024 * 1024,
    },
  });
}

function makeDeps(
  overrides?: Partial<Parameters<typeof prepareAttachmentInputForPrompt>[0]["deps"]>,
) {
  return {
    container: {
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    } as never,
    fetchImpl: fetch,
    secretProvider: undefined,
    languageModelOverride: undefined,
    instanceOwner: "instance-test",
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    agentConfig: makeAgentConfig(),
    deploymentConfig: makeDeploymentConfig(),
    primaryModel: {} as never,
    ...overrides,
  };
}

describe("attachment analysis runtime", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    getArtifactRowsByIdsMock.mockReset();
    getArtifactRowsByIdsMock.mockResolvedValue([]);
    rowToArtifactRefMock.mockReset();
    synthArtifactRefFromRowMock.mockReset();
    extractArtifactIdFromUrlMock.mockReset();
    extractArtifactIdFromUrlMock.mockReturnValue(undefined);
  });

  it("injects helper summaries and strips current-turn file parts from the main prompt", async () => {
    generateTextMock.mockResolvedValue({
      text: "Settings page with a red connection error.",
    } as never);

    const result = await prepareAttachmentInputForPrompt({
      deps: makeDeps(),
      parts: [
        { type: "text", text: "What does this screenshot show?" },
        {
          type: "file",
          url: "https://example.com/screenshot.png",
          mediaType: "image/png",
          filename: "screenshot.png",
        },
      ],
    });

    expect(result.shouldRewriteHistoryForModel).toBe(true);
    expect(result.helperSummaryText).toBe("Settings page with a red connection error.");
    expect(result.currentTurnParts).toEqual([
      { type: "text", text: "What does this screenshot show?" },
    ]);
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("falls back to native attachment handling when helper analysis fails", async () => {
    generateTextMock.mockRejectedValue(new Error("vision unavailable"));
    const warn = vi.fn();

    const result = await prepareAttachmentInputForPrompt({
      deps: makeDeps({
        container: {
          logger: { warn, info: vi.fn(), error: vi.fn() },
        } as never,
      }),
      parts: [
        {
          type: "file",
          url: "https://example.com/screenshot.png",
          mediaType: "image/png",
          filename: "screenshot.png",
        },
      ],
    });

    expect(result.shouldRewriteHistoryForModel).toBe(true);
    expect(result.helperSummaryText).toContain("Attachment analysis unavailable:");
    expect(result.currentTurnParts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "agents.attachments.helper_analysis_failed",
      expect.objectContaining({ conversation_id: "conversation-1" }),
    );
  });

  it("rewrites stored file messages into text summaries for helper mode", () => {
    const rewritten = rewriteHistoryMessagesForHelperMode([
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Please inspect this." },
          {
            type: "file",
            url: "https://example.com/screenshot.png",
            mediaType: "image/png",
            filename: "screenshot.png",
          },
        ],
      },
    ]);

    expect(rewritten[0]?.parts).toEqual([
      {
        type: "text",
        text: "Please inspect this.",
      },
      {
        type: "text",
        text: "Attachments:\n- filename=screenshot.png mime_type=image/png",
      },
    ]);
  });

  it("enforces maxAnalysisBytes while downloading attachment bytes", async () => {
    const download = createAttachmentDownloadFunction({
      fetchImpl: vi.fn(
        async () => new Response("abcdef", { headers: { "content-type": "text/plain" } }),
      ),
      maxBytes: 4,
    });

    await expect(
      download([{ url: new URL("https://example.com/file.txt"), isUrlSupportedByModel: false }]),
    ).rejects.toThrow(/maxAnalysisBytes/);
  });

  it("loads artifact-backed downloads directly from the artifact store", async () => {
    extractArtifactIdFromUrlMock.mockReturnValue("artifact-1");
    const artifactStore = {
      get: vi.fn(async () => ({
        ref: {
          mime_type: "text/plain",
        },
        body: Buffer.from("stored-bytes", "utf8"),
      })),
    };
    const fetchImpl = vi.fn();
    const download = createAttachmentDownloadFunction({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      artifactStore: artifactStore as never,
      maxBytes: 1024,
    });

    const result = await download([
      { url: new URL("https://example.com/a/artifact-1"), isUrlSupportedByModel: false },
    ]);

    expect(artifactStore.get).toHaveBeenCalledWith("artifact-1");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        data: expect.any(Uint8Array),
        mediaType: "text/plain",
      },
    ]);
    expect(Buffer.from(result[0]!.data)).toEqual(Buffer.from("stored-bytes", "utf8"));
  });

  it("enforces maxUploadBytes for inline attachment payloads", async () => {
    const result = prepareAttachmentInputForPrompt({
      deps: makeDeps({
        deploymentConfig: DeploymentConfig.parse({
          attachments: {
            helperModel: { model: null },
            maxUploadBytes: 3,
            maxAnalysisBytes: 1024 * 1024,
          },
        }),
      }),
      parts: [
        {
          type: "file",
          url: "data:text/plain;base64,YWJjZA==",
          mediaType: "text/plain",
          filename: "note.txt",
        },
      ],
    });

    await expect(result).rejects.toThrow(/maxUploadBytes/);
  });

  it("describes stored artifacts through the shared helper-model path", async () => {
    generateTextMock.mockResolvedValue({ text: "Invoice showing a total of 42 USD." } as never);
    const artifactId = "123e4567-e89b-12d3-a456-426614174000";
    getArtifactRowsByIdsMock.mockResolvedValue([{ artifact_id: artifactId }]);
    rowToArtifactRefMock.mockReturnValue({
      artifact_id: artifactId,
      uri: `artifact://${artifactId}`,
      external_url: `https://example.com/a/${artifactId}`,
      kind: "file",
      media_class: "document",
      created_at: "2026-03-18T00:00:00.000Z",
      mime_type: "application/pdf",
      size_bytes: Buffer.byteLength("pdf-bytes"),
    });

    const result = await describeArtifactsForPrompt({
      deps: {
        db: {} as never,
        tenantId: "tenant-1",
        publicBaseUrl: "https://example.com",
        fetchImpl: fetch,
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
        resolveModel: async () => ({}) as never,
        maxAnalysisBytes: 1024 * 1024,
      },
      args: {
        artifact_id: artifactId,
        prompt: "Summarize the total amount.",
      },
    });

    expect(result.artifactIds).toEqual([artifactId]);
    expect(result.summary).toBe("Invoice showing a total of 42 USD.");
    expect(generateTextMock).toHaveBeenCalledOnce();
  });
});
