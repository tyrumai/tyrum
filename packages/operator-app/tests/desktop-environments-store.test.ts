import { describe, expect, it, vi } from "vitest";
import { createDesktopEnvironmentHostsStore } from "../src/stores/desktop-environment-hosts-store.js";
import { createDesktopEnvironmentsStore } from "../src/stores/desktop-environments-store.js";
import {
  sampleDesktopEnvironment,
  sampleDesktopEnvironmentHost,
} from "./operator-core.test-support.js";

describe("desktop environment stores", () => {
  it("refreshes hosts and environments and tracks logs", async () => {
    const host = sampleDesktopEnvironmentHost();
    const environment = sampleDesktopEnvironment();
    const http = {
      desktopEnvironmentHosts: {
        list: vi.fn(async () => ({ status: "ok", hosts: [host] }) as const),
      },
      desktopEnvironments: {
        list: vi.fn(async () => ({ status: "ok", environments: [environment] }) as const),
        getDefaults: vi.fn(
          async () =>
            ({
              status: "ok",
              default_image_ref: "ghcr.io/rhernaus/tyrum-desktop-sandbox:stable",
              revision: 1,
              created_at: "2026-03-10T12:00:00.000Z",
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: null,
              reverted_from_revision: null,
            }) as const,
        ),
        get: vi.fn(async () => ({ status: "ok", environment }) as const),
        create: vi.fn(async () => ({ status: "ok", environment }) as const),
        updateDefaults: vi.fn(
          async (input: { default_image_ref: string; reason?: string }) =>
            ({
              status: "ok",
              default_image_ref: input.default_image_ref,
              revision: 2,
              created_at: "2026-03-10T12:00:00.000Z",
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: input.reason ?? null,
              reverted_from_revision: null,
            }) as const,
        ),
        update: vi.fn(
          async () =>
            ({
              status: "ok",
              environment: { ...environment, label: "Updated label" },
            }) as const,
        ),
        start: vi.fn(async () => ({ status: "ok", environment }) as const),
        stop: vi.fn(
          async () =>
            ({
              status: "ok",
              environment: { ...environment, status: "stopped", desired_running: false },
            }) as const,
        ),
        reset: vi.fn(
          async () =>
            ({
              status: "ok",
              environment: { ...environment, updated_at: "2026-01-01T00:00:01.000Z" },
            }) as const,
        ),
        remove: vi.fn(async () => ({ status: "ok", deleted: true }) as const),
        logs: vi.fn(
          async () =>
            ({
              status: "ok",
              environment_id: environment.environment_id,
              logs: ["booting runtime", "runtime ready"],
            }) as const,
        ),
        takeoverUrl: vi.fn(
          async () =>
            ({
              status: "ok",
              takeover_url: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
            }) as const,
        ),
      },
    } as any;

    const hostsStore = createDesktopEnvironmentHostsStore(http).store;
    const environmentsStore = createDesktopEnvironmentsStore(http).store;

    await hostsStore.refresh();
    await environmentsStore.refresh();

    expect(hostsStore.getSnapshot().orderedIds).toEqual([host.host_id]);
    expect(environmentsStore.getSnapshot().orderedIds).toEqual([environment.environment_id]);

    const updated = await environmentsStore.update(environment.environment_id, {
      label: "Updated label",
    });
    expect(updated.label).toBe("Updated label");
    expect(environmentsStore.getSnapshot().byId[environment.environment_id]?.label).toBe(
      "Updated label",
    );

    const stopped = await environmentsStore.stop(environment.environment_id);
    expect(stopped.status).toBe("stopped");
    expect(environmentsStore.getSnapshot().byId[environment.environment_id]?.desired_running).toBe(
      false,
    );

    const logs = await environmentsStore.refreshLogs(environment.environment_id);
    expect(logs).toEqual(["booting runtime", "runtime ready"]);
    expect(environmentsStore.getSnapshot().logsById[environment.environment_id]?.lines).toContain(
      "runtime ready",
    );

    const deleted = await environmentsStore.remove(environment.environment_id);
    expect(deleted).toBe(true);
    expect(environmentsStore.getSnapshot().orderedIds).toEqual([]);
  });
});
