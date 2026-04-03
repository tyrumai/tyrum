import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import {
  hasPendingApprovalInMessages,
  loadPausedApprovalSnapshotMessages,
} from "../../src/app/modules/ai-sdk/paused-approval-snapshot.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { projectConversationMessages } from "../../src/ws/protocol/ai-sdk-chat-projected-messages.js";
import { seedPausedApprovalTurn } from "./ai-sdk-chat-ops.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ai-sdk chat projected messages", () => {
  let container: GatewayContainer | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("injects approval into a fully overlapping paused snapshot without duplicating messages", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-projected-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-approval-projected",
      containerKind: "channel",
    });

    await seedPausedApprovalTurn({
      assistantText: "Let me check that first.",
      container,
      conversation,
      tenantId: DEFAULT_TENANT_ID,
      toolCallId: "tc-bash-projected-1",
      toolCommand: "printf smoke-approval",
      toolId: "bash",
      userText: "run a safe shell command",
    });

    const approval = await container.approvalDal.getLatestByTurnId({
      tenantId: DEFAULT_TENANT_ID,
      turnId: "turn-approval-1",
    });
    expect(approval).toBeTruthy();
    if (!approval) {
      throw new Error("expected seeded approval");
    }

    const baseMessages = loadPausedApprovalSnapshotMessages(approval.context);
    expect(baseMessages).toBeTruthy();
    if (!baseMessages) {
      throw new Error("expected paused approval snapshot messages");
    }
    expect(hasPendingApprovalInMessages(baseMessages)).toBe(false);

    const projectedMessages = await projectConversationMessages({
      db: container.db,
      messages: baseMessages,
      tenantId: DEFAULT_TENANT_ID,
      conversationKey: conversation.conversation_key,
    });

    expect(projectedMessages).toHaveLength(baseMessages.length + 1);
    expect(hasPendingApprovalInMessages(projectedMessages)).toBe(true);
    expect(projectedMessages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(projectedMessages.filter((message) => message.role === "assistant")).toHaveLength(2);
    expect(
      projectedMessages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && typeof part.text === "string" ? [part.text] : [],
        ),
      ),
    ).toEqual(["run a safe shell command", "Let me check that first."]);
  });
});
