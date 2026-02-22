import { describe, it, expect } from "vitest";
import { createWebUiRoutes, type WebUiDeps } from "../../src/routes/web-ui.js";

describe("/app/live", () => {
  function buildDeps(): WebUiDeps {
    return {
      approvalDal: {} as WebUiDeps["approvalDal"],
      memoryDal: {} as WebUiDeps["memoryDal"],
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: {} as WebUiDeps["canvasDal"],
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
    };
  }

  it("auto-responds to gateway ping heartbeats", async () => {
    const app = createWebUiRoutes(buildDeps());
    const res = await app.request("/app/live?token=test-token");
    expect(res.status).toBe(200);
    const html = await res.text();

    // Regression: the live console must reply to gateway heartbeat `ping` requests
    // or the gateway will evict the connection after the heartbeat timeout.
    expect(html).toContain('type: "ping"');
    expect(html).toContain("ok: true");
    expect(html).toContain("request_id: msg.request_id");
  });
});

