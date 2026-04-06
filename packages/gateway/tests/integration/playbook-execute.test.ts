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
  it("creates a durable workflow run for playbook execution", async () => {
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

    const body = (await res.json()) as {
      status: string;
      workflow_run_id: string;
      steps_count: number;
    };
    expect(body.status).toBe("ok");
    expect(body.workflow_run_id).toBeTruthy();
    expect(body.steps_count).toBeGreaterThan(0);

    const run = await container.db.get<{ workflow_run_id: string; status: string }>(
      "SELECT workflow_run_id, status FROM workflow_runs WHERE workflow_run_id = ?",
      [body.workflow_run_id],
    );
    expect(run).toMatchObject({
      workflow_run_id: body.workflow_run_id,
      status: "queued",
    });

    const steps = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_run_steps WHERE workflow_run_id = ?",
      [body.workflow_run_id],
    );
    expect(steps?.n).toBe(body.steps_count);

    await container.db.close();
  });
});
