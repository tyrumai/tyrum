import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("/config/tools", () => {
  it("returns 404 for a missing explicit agent without creating it", async () => {
    const { request, container, agents } = await createTestApp();
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const response = await request("/config/tools?agent_key=missing-agent");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "not_found",
      message: "agent 'missing-agent' not found",
    });

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);

    await agents?.shutdown();
    await container.db.close();
  });
});
