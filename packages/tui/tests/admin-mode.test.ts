import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGateway } from "../../client/tests/conformance/harness.js";
import { createTuiCore } from "../src/core.js";
import { isAdminModeActive } from "@tyrum/operator-core";

describe("tui admin mode", () => {
  it("mints an elevated device token and toggles admin mode state", async () => {
    const harness = await startGateway();
    const home = await mkdtemp(join(tmpdir(), "tyrum-tui-"));
    const identityPath = join(home, "tui", "device-identity.json");
    let runtime: Awaited<ReturnType<typeof createTuiCore>> | null = null;

    try {
      runtime = await createTuiCore({
        wsUrl: harness.wsUrl,
        httpBaseUrl: harness.baseUrl,
        token: harness.adminToken,
        deviceIdentityPath: identityPath,
        reconnect: false,
      });

      expect(isAdminModeActive(runtime.manager.getCore().adminModeStore.getSnapshot())).toBe(false);

      await runtime.enterAdminMode(harness.adminToken, { ttlSeconds: 60 });

      const entered = runtime.manager.getCore().adminModeStore.getSnapshot();
      expect(isAdminModeActive(entered)).toBe(true);
      expect(entered.elevatedToken).toBeTruthy();
      expect(entered.expiresAt).toBeTruthy();
      expect(entered.remainingMs).not.toBeNull();

      runtime.exitAdminMode();

      expect(isAdminModeActive(runtime.manager.getCore().adminModeStore.getSnapshot())).toBe(false);
    } finally {
      await Promise.allSettled([
        harness.stop(),
        runtime?.dispose(),
        rm(home, { recursive: true, force: true }),
      ]);
    }
  });
});
