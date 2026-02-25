import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/playbooks");

describe("POST /playbooks/:id/execute", () => {
  const originalFlag = process.env["TYRUM_ENGINE_API_ENABLED"];

  beforeEach(() => {
    process.env["TYRUM_ENGINE_API_ENABLED"] = "1";
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env["TYRUM_ENGINE_API_ENABLED"];
    } else {
      process.env["TYRUM_ENGINE_API_ENABLED"] = originalFlag;
    }
  });

  it("enqueues playbook steps into the durable execution engine", async () => {
    const container = await createTestContainer();
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { playbooks });

    const res = await app.request("/playbooks/test-playbook/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "key-1", lane: "lane-1" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; job_id: string; run_id: string };
    expect(body.status).toBe("ok");
    expect(body.job_id).toBeTruthy();
    expect(body.run_id).toBeTruthy();

    const job = await container.db.get<{ job_id: string; latest_run_id: string | null }>(
      "SELECT job_id, latest_run_id FROM execution_jobs WHERE job_id = ?",
      [body.job_id],
    );
    expect(job?.job_id).toBe(body.job_id);
    expect(job?.latest_run_id).toBe(body.run_id);

    const steps = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE run_id = ?",
      [body.run_id],
    );
    expect(steps?.n).toBeGreaterThan(0);

    await container.db.close();
  });
});
