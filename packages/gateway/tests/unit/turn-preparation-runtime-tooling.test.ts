import { AgentConfig, DeploymentConfig } from "@tyrum/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { describeArtifactsForPromptMock } = vi.hoisted(() => ({
  describeArtifactsForPromptMock: vi.fn(),
}));

vi.mock("../../src/modules/agent/runtime/attachment-analysis.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/modules/agent/runtime/attachment-analysis.js")>();
  return {
    ...actual,
    describeArtifactsForPrompt: describeArtifactsForPromptMock,
  };
});

import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { createToolExecutorForTurnPreparation } from "../../src/modules/agent/runtime/turn-preparation-runtime-tooling.js";
import {
  registerTempHomeLifecycle,
  requireHomeDir,
  stubMcpManager,
} from "./tool-executor.shared-test-support.js";

function makeAgentConfig() {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    attachments: { input_mode: "helper" },
  });
}

function makeDeploymentConfig() {
  return DeploymentConfig.parse({
    attachments: {
      helperModel: { model: null },
      maxUploadBytes: 1024 * 1024,
      maxAnalysisBytes: 2048,
    },
  });
}

describe("turn preparation runtime tooling", () => {
  const home = registerTempHomeLifecycle("turn-prep-runtime-tooling-");

  beforeEach(() => {
    describeArtifactsForPromptMock.mockReset();
  });

  it("forwards the artifact store to artifact.describe helper analysis", async () => {
    const db = {} as never;
    const artifactStore = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
    describeArtifactsForPromptMock.mockResolvedValue({
      artifactIds: ["artifact-1"],
      summary: "Stored artifact summary.",
    });

    const toolExecutor = await createToolExecutorForTurnPreparation({
      deps: {
        home: requireHomeDir(home),
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: stubMcpManager(),
        plugins: undefined,
        policyService: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        opts: {
          container: {
            db,
            deploymentConfig: makeDeploymentConfig(),
            artifactStore: artifactStore as never,
            logger,
            redactionEngine: undefined,
            secretResolutionAuditDal: undefined,
            identityScopeDal: {} as never,
            nodePairingDal: {} as never,
            presenceDal: {} as never,
            conversationNodeAttachmentDal: {} as never,
          },
        } as never,
        fetchImpl,
        secretProvider: undefined,
        conversationDal: {} as never,
        defaultHeartbeatSeededScopes: new Set<string>(),
        cleanupAtMs: 0,
        setCleanupAtMs: vi.fn(),
        instanceOwner: "instance-1",
        tenantId: "tenant-1",
      },
      ctx: {
        config: makeAgentConfig(),
        identity: {} as never,
        skills: [],
        mcpServers: [],
      },
      conversation: {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        conversation_id: "conversation-1",
      } as never,
      executionProfile: {
        id: "interaction",
        profile: getExecutionProfile("interaction"),
        source: "interaction_default",
      },
    });

    const result = await toolExecutor.execute("artifact.describe", "call-artifact-1", {
      artifact_id: "artifact-1",
      prompt: "Summarize the artifact.",
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("Stored artifact summary.");
    expect(describeArtifactsForPromptMock).toHaveBeenCalledWith({
      deps: expect.objectContaining({
        artifactStore,
        db,
        fetchImpl,
        logger,
        maxAnalysisBytes: 2048,
        tenantId: "tenant-1",
      }),
      args: {
        artifact_ids: ["artifact-1"],
        prompt: "Summarize the artifact.",
      },
    });
  });
});
