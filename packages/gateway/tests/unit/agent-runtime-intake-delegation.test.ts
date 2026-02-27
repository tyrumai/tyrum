import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { buildAgentTurnKey } from "../../src/modules/agent/turn-key.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import { buildAgentSessionKey } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime (intake delegation)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("creates a work item + intake event when intake_mode=delegate_execute", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "Implement the requested change in the background.",
      intake_mode: "delegate_execute",
    });

    expect(res.reply.toLowerCase()).toContain("delegat");

    const workboard = new WorkboardDal(container.db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const { items } = await workboard.listItems({ scope });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("action");

    const workItemId = items[0]!.work_item_id;
    expect(res.reply).toContain(workItemId);

    const { events } = await workboard.listEvents({ scope, work_item_id: workItemId });
    expect(events.some((evt) => evt.kind === "intake.mode_selected")).toBe(true);

    const { subagents } = await workboard.listSubagents({ scope });
    expect(subagents.some((s) => s.work_item_id === workItemId)).toBe(true);
  });

  it("delegates when an intake_mode override exists for the session key", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const key = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "test",
      containerKind: "channel",
      threadId: "thread-1",
    });

    await container.db.run(
      `INSERT INTO intake_mode_overrides (key, lane, intake_mode, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      [key, "main", "delegate_execute", Date.now()],
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "Implement the requested change in the background.",
    });

    expect(res.reply.toLowerCase()).toContain("delegat");
  });

  it("uses metadata.tyrum_key for intake overrides + work item created_from_session_key", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const key = buildAgentSessionKey({
      agentId: "default",
      container: "channel",
      channel: "telegram",
      account: "work",
      id: "thread-1",
    });

    await container.db.run(
      `INSERT INTO intake_mode_overrides (key, lane, intake_mode, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      [key, "main", "delegate_execute", Date.now()],
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    const res = await runtime.turn({
      channel: "telegram:work",
      thread_id: "thread-1",
      message: "Implement the requested change in the background.",
      metadata: {
        tyrum_key: key,
        lane: "main",
      },
    });

    expect(res.reply.toLowerCase()).toContain("delegat");

    const workboard = new WorkboardDal(container.db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const { items } = await workboard.listItems({ scope });
    expect(items).toHaveLength(1);
    expect(items[0]!.created_from_session_key).toBe(key);

    const { events } = await workboard.listEvents({ scope, work_item_id: items[0]!.work_item_id });
    const intakeEvent = events.find((evt) => evt.kind === "intake.mode_selected");
    expect(intakeEvent?.payload).toMatchObject({
      mode: "delegate_execute",
      reason_code: "override",
    });
  });
});
