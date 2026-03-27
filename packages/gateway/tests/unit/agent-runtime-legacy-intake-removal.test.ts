import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

async function createHomeDir(): Promise<string> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
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
      "    - read",
      "conversations:",
      "  ttl_days: 30",
      "  max_turns: 20",
      "memory:",
      "  v1: { enabled: false }",
    ].join("\n"),
    "utf-8",
  );
  return homeDir;
}

describe("AgentRuntime legacy intake removal", () => {
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

  it("ignores legacy intake_mode inputs and keeps the turn inline", async () => {
    homeDir = await createHomeDir();
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    });

    const legacyRequest = {
      channel: "test",
      thread_id: "thread-1",
      message: "Implement the requested change in the background.",
      intake_mode: "delegate_execute",
    } as const;

    const res = await runtime.turn(legacyRequest as never);
    expect(res.reply).toBe("ok");

    const workboard = new WorkboardDal(container.db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    const { items } = await workboard.listItems({ scope });
    expect(items).toHaveLength(0);
  });
});
