import { describe, expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTestClient,
  getHeader,
  jsonResponse,
  makeFetchMock,
} from "./http-client.test-support.js";

describe("desktop environment HTTP client", () => {
  it("lists hosts and environments", async () => {
    const fetch = makeFetchMock(async (input) => {
      const url = String(input);
      if (url.endsWith("/desktop-environment-hosts")) {
        return jsonResponse({
          status: "ok",
          hosts: [
            {
              host_id: "host-1",
              label: "Primary runtime",
              version: "0.1.0",
              docker_available: true,
              healthy: true,
              last_seen_at: "2026-01-01T00:00:00.000Z",
              last_error: null,
            },
          ],
        });
      }
      return jsonResponse({
        status: "ok",
        environments: [
          {
            environment_id: "env-1",
            host_id: "host-1",
            label: "Research desktop",
            image_ref: "registry.example.test/desktop:latest",
            managed_kind: "docker",
            status: "running",
            desired_running: true,
            node_id: "node-desktop-1",
            last_seen_at: "2026-01-01T00:00:00.000Z",
            last_error: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    });

    const client = createTestClient({ fetch });

    const [hosts, environments] = await Promise.all([
      client.desktopEnvironmentHosts.list(),
      client.desktopEnvironments.list(),
    ]);

    expect(hosts.hosts[0]?.host_id).toBe("host-1");
    expect(environments.environments[0]?.environment_id).toBe("env-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("creates, mutates, and fetches logs for a desktop environment", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/config/desktop-environments/defaults") && init?.method === "GET") {
        return jsonResponse({
          status: "ok",
          default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
          revision: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: null,
          reverted_from_revision: null,
        });
      }
      if (url.endsWith("/config/desktop-environments/defaults") && init?.method === "PUT") {
        return jsonResponse({
          status: "ok",
          default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:sha-1234",
          revision: 2,
          created_at: "2026-01-01T00:00:02.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "roll forward",
          reverted_from_revision: null,
        });
      }
      if (url.endsWith("/desktop-environments") && init?.method === "POST") {
        return jsonResponse(
          {
            status: "ok",
            environment: {
              environment_id: "env-1",
              host_id: "host-1",
              label: "Research desktop",
              image_ref: "registry.example.test/desktop:latest",
              managed_kind: "docker",
              status: "stopped",
              desired_running: false,
              node_id: null,
              last_seen_at: null,
              last_error: null,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          },
          201,
        );
      }
      if (url.endsWith("/start")) {
        return jsonResponse({
          status: "ok",
          environment: {
            environment_id: "env-1",
            host_id: "host-1",
            label: "Research desktop",
            image_ref: "registry.example.test/desktop:latest",
            managed_kind: "docker",
            status: "starting",
            desired_running: true,
            node_id: null,
            last_seen_at: null,
            last_error: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:01.000Z",
          },
        });
      }
      if (url.endsWith("/logs")) {
        return jsonResponse({
          status: "ok",
          environment_id: "env-1",
          logs: ["desktop runtime booting", "desktop runtime ready"],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = createTestClient({ fetch });

    const defaults = await client.desktopEnvironments.getDefaults();
    const updatedDefaults = await client.desktopEnvironments.updateDefaults({
      default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:sha-1234",
      reason: "roll forward",
    });
    const created = await client.desktopEnvironments.create({
      host_id: "host-1",
      label: "Research desktop",
      image_ref: "registry.example.test/desktop:latest",
      desired_running: false,
    });
    const started = await client.desktopEnvironments.start("env-1");
    const logs = await client.desktopEnvironments.logs("env-1");

    expect(defaults.default_image_ref).toBe("ghcr.io/tyrumai/tyrum-desktop-sandbox:stable");
    expect(updatedDefaults.default_image_ref).toBe(
      "ghcr.io/tyrumai/tyrum-desktop-sandbox:sha-1234",
    );
    expect(created.environment.environment_id).toBe("env-1");
    expect(started.environment.status).toBe("starting");
    expect(logs.logs).toEqual(["desktop runtime booting", "desktop runtime ready"]);

    const [createUrl, createInit] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[2] as [string, RequestInit];
    expect(createUrl).toBe("https://gateway.example/desktop-environments");
    expect(createInit.method).toBe("POST");
    expect(getHeader(createInit, "authorization")).toBe("Bearer root-token");
  });

  it("creates a managed desktop takeover conversation", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      const url = String(input);
      expect(url).toBe("https://gateway.example/desktop-environments/env-1/takeover-token");
      expect(init?.method).toBe("POST");
      expect(getHeader(init, "authorization")).toBe("Bearer root-token");
      return jsonResponse({
        status: "ok",
        conversation: {
          conversation_id: "conversation-1",
          entry_url: "https://gateway.example/desktop-takeover/s/token-1/vnc.html?autoconnect=true",
          expires_at: "2026-01-01T00:30:00.000Z",
        },
      });
    });

    const client = createTestClient({ fetch });
    const result = await client.desktopEnvironments.createTakeoverConversation("env-1");

    expect(result).toEqual({
      status: "ok",
      conversation: {
        conversation_id: "conversation-1",
        entry_url: "https://gateway.example/desktop-takeover/s/token-1/vnc.html?autoconnect=true",
        expires_at: "2026-01-01T00:30:00.000Z",
      },
    });
  });
});
