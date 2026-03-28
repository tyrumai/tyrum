import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";
import { createApp } from "../../src/app.js";
import { createTestContainer, decorateAppWithDefaultAuth } from "./helpers.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/playbooks");

describe("POST /playbooks/:id/execute", () => {
  it("enqueues playbook steps into the durable execution engine", async () => {
    const container = await createTestContainer({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });
    const authTokens = new AuthTokenService(container.db);
    const tenantToken = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const app = createApp(container, { playbooks, authTokens });
    decorateAppWithDefaultAuth(app, tenantToken.token);

    const res = await app.request("/playbooks/test-playbook/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "agent:default:main" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; job_id: string; turn_id: string };
    expect(body.status).toBe("ok");
    expect(body.job_id).toBeTruthy();
    expect(body.turn_id).toBeTruthy();

    const job = await container.db.get<{ job_id: string; turn_id: string | null }>(
      "SELECT job_id, latest_turn_id AS turn_id FROM turn_jobs WHERE job_id = ?",
      [body.job_id],
    );
    expect(job?.job_id).toBe(body.job_id);
    expect(job?.turn_id).toBe(body.turn_id);

    const steps = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE turn_id = ?",
      [body.turn_id],
    );
    expect(steps?.n).toBeGreaterThan(0);

    await container.db.close();
  });
});
