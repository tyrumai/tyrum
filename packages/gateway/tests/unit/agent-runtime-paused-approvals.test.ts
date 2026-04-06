import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { maybeResolvePausedTurn } from "../../src/modules/agent/runtime/turn-engine-bridge.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime paused approvals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("resumes an approved paused run when the approval is discovered from turn scope", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-paused-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({ container, home: homeDir });

    const key = "agent:default:test:thread-1";
    const jobId = randomUUID();
    const turnId = randomUUID();

    await container.db.run(
      `INSERT INTO turn_jobs (
	         tenant_id,
	         job_id,
	         agent_id,
	         workspace_id,
	         conversation_key,
	         status,
	         trigger_json
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, jobId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, "queued", "{}"],
    );
    await container.db.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
	       VALUES (?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, turnId, jobId, key, "paused", 1],
    );

    const resumeToken = "resume-token-from-context";
    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "approve",
      motivation: "Resume the paused run using the token stored in approval context.",
      kind: "workflow_step",
      turnId,
      context: { resume_token: resumeToken },
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      reason: "approved",
    });

    const resumeTurn = vi.spyOn(runtime.turnController, "resumeTurn").mockResolvedValue(turnId);
    const cancelTurn = vi
      .spyOn(runtime.turnController, "cancelTurn")
      .mockResolvedValue("cancelled");

    const resolved = await maybeResolvePausedTurn(
      {
        approvalDal: container.approvalDal,
        db: container.db,
        turnController: runtime.turnController,
      },
      turnId,
    );

    expect(resolved).toBe(true);
    expect(resumeTurn).toHaveBeenCalledWith(resumeToken);
    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("cancels a denied paused run when the approval is discovered from turn scope", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-paused-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({ container, home: homeDir });

    const key = "agent:default:test:thread-denied";
    const jobId = randomUUID();
    const turnId = randomUUID();

    await container.db.run(
      `INSERT INTO turn_jobs (
	         tenant_id,
	         job_id,
	         agent_id,
	         workspace_id,
	         conversation_key,
	         status,
	         trigger_json
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, jobId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, "queued", "{}"],
    );
    await container.db.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
	       VALUES (?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, turnId, jobId, key, "paused", 1],
    );

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "approve",
      motivation: "Deny the paused run using the approval linked to the turn.",
      kind: "workflow_step",
      turnId,
      status: "awaiting_human",
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "denied",
      reason: "denied",
    });

    const resumeTurn = vi.spyOn(runtime.turnController, "resumeTurn").mockResolvedValue(turnId);
    const cancelTurn = vi
      .spyOn(runtime.turnController, "cancelTurn")
      .mockResolvedValue("cancelled");

    const resolved = await maybeResolvePausedTurn(
      {
        approvalDal: container.approvalDal,
        db: container.db,
        turnController: runtime.turnController,
      },
      turnId,
    );

    expect(resolved).toBe(true);
    expect(resumeTurn).not.toHaveBeenCalled();
    expect(cancelTurn).toHaveBeenCalledWith(turnId, "denied");
  });

  it("keeps polling when a paused turn checkpoint has no usable approval id", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-paused-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({ container, home: homeDir });
    const key = "agent:default:test:thread-empty-approval";
    const jobId = randomUUID();
    const turnId = randomUUID();

    await container.db.run(
      `INSERT INTO turn_jobs (
	         tenant_id,
	         job_id,
	         agent_id,
	         workspace_id,
	         conversation_key,
	         status,
	         trigger_json
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, jobId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, "queued", "{}"],
    );
    await container.db.run(
      `INSERT INTO turns (
	         tenant_id,
	         turn_id,
	         job_id,
	         conversation_key,
	         status,
	         attempt,
	         checkpoint_json
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        turnId,
        jobId,
        key,
        "paused",
        1,
        JSON.stringify({ resume_approval_id: "   " }),
      ],
    );

    const resumeTurn = vi.spyOn(runtime.turnController, "resumeTurn").mockResolvedValue(turnId);
    const cancelTurn = vi
      .spyOn(runtime.turnController, "cancelTurn")
      .mockResolvedValue("cancelled");

    const resolved = await maybeResolvePausedTurn(
      {
        approvalDal: container.approvalDal,
        db: container.db,
        turnController: runtime.turnController,
      },
      turnId,
    );

    expect(resolved).toBe(false);
    expect(resumeTurn).not.toHaveBeenCalled();
    expect(cancelTurn).not.toHaveBeenCalled();
  });
});
