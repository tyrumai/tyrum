import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const closeDb = vi.fn(async () => {});
const ensureLoaded = vi.fn(async () => {
  throw new Error("models.dev load failed");
});
const listProviders = vi.fn(async () => []);
const policyStatus = vi.fn(async () => {
  return {
    enabled: true,
    observe_only: false,
    effective_sha256: "deadbeef",
    sources: { deployment: "default", agent: null },
  };
});
const createContainerAsync = vi.fn(async () => {
  return {
    db: { close: closeDb },
    modelsDev: { ensureLoaded },
    oauthProviderRegistry: { list: listProviders },
    policyService: { getStatus: policyStatus },
  } as any;
});

vi.mock("../../src/container.js", () => {
  return {
    createContainer: vi.fn(),
    createContainerAsync,
  };
});

describe("tyrum check", () => {
  afterEach(() => {
    closeDb.mockClear();
    ensureLoaded.mockClear();
    listProviders.mockClear();
    policyStatus.mockClear();
    createContainerAsync.mockClear();
    delete process.env["GATEWAY_DB_PATH"];
    delete process.env["GATEWAY_HOST"];
    delete process.env["GATEWAY_PORT"];
    delete process.env["GATEWAY_TOKEN"];
    delete process.env["TYRUM_HOME"];
    delete process.env["TYRUM_SECRET_PROVIDER"];
    delete process.env["TYRUM_POLICY_ENABLED"];
    delete process.env["TYRUM_POLICY_MODE"];
    delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
  });

  it("closes the database connection on check failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env["GATEWAY_DB_PATH"] = ":memory:";

    const { runCli } = await import("../../src/index.js");
    const code = await runCli(["check"]);

    expect(code).toBe(1);
    expect(closeDb).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("prints static and live diagnostics for auth, policy, plugins, secrets, and exposure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env["GATEWAY_DB_PATH"] = ":memory:";
    process.env["GATEWAY_HOST"] = "127.0.0.1";
    process.env["GATEWAY_PORT"] = "8788";
    process.env["GATEWAY_TOKEN"] = "test-token";
    process.env["TYRUM_HOME"] = "/tmp/tyrum-test-home";
    process.env["TYRUM_SECRET_PROVIDER"] = "env";

    ensureLoaded.mockResolvedValueOnce({
      status: {
        source: "default",
        provider_count: 1,
        model_count: 2,
        last_error: null,
      },
    } as any);

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const { runCli } = await import("../../src/index.js");
    const code = await runCli(["check"]);

    expect(code).toBe(0);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("check: failed"));

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("check: ok");
    expect(output).toContain("static.exposure: host=127.0.0.1 port=8788 is_exposed=false");
    expect(output).toContain("static.auth: admin_token_source=env");
    expect(output).toContain("static.policy: enabled=true observe_only=false sha256=deadbeef");
    expect(output).toContain("static.plugins:");
    expect(output).toContain("static.secrets: provider=env handles=0");
    expect(output).toContain("live.http:");

    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not send the admin token when probing non-loopback hosts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env["GATEWAY_DB_PATH"] = ":memory:";
    process.env["GATEWAY_HOST"] = "10.0.0.1";
    process.env["GATEWAY_PORT"] = "8788";
    process.env["GATEWAY_TOKEN"] = "test-token";
    process.env["TYRUM_HOME"] = "/tmp/tyrum-test-home";
    process.env["TYRUM_SECRET_PROVIDER"] = "env";

    ensureLoaded.mockResolvedValueOnce({
      status: {
        source: "default",
        provider_count: 1,
        model_count: 2,
        last_error: null,
      },
    } as any);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { runCli } = await import("../../src/index.js");
    const code = await runCli(["check"]);

    expect(code).toBe(0);

    const allHeaders = fetchMock.mock.calls
      .map((call) => call[1])
      .filter(Boolean)
      .map((init) => (init as RequestInit).headers)
      .filter(Boolean);

    for (const headers of allHeaders) {
      expect(new Headers(headers as any).get("authorization")).toBeNull();
    }

    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("counts plugin manifests missing required fields as invalid", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-test-home-"));

    try {
      await mkdir(join(tyrumHome, "plugins", "bad-plugin"), { recursive: true });
      await writeFile(
        join(tyrumHome, "plugins", "bad-plugin", "plugin.json"),
        JSON.stringify({ id: "bad-plugin", name: "Bad plugin", version: "0.0.1" }),
        "utf-8",
      );

      process.env["GATEWAY_DB_PATH"] = ":memory:";
      process.env["GATEWAY_HOST"] = "127.0.0.1";
      process.env["GATEWAY_PORT"] = "8788";
      process.env["GATEWAY_TOKEN"] = "test-token";
      process.env["TYRUM_HOME"] = tyrumHome;
      process.env["TYRUM_SECRET_PROVIDER"] = "env";

      ensureLoaded.mockResolvedValueOnce({
        status: {
          source: "default",
          provider_count: 1,
          model_count: 2,
          last_error: null,
        },
      } as any);

      vi.stubGlobal("fetch", vi.fn(async () => {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }));

      const { runCli } = await import("../../src/index.js");
      const code = await runCli(["check"]);

      expect(code).toBe(0);

      const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("static.plugins:");
      expect(output).toContain("invalid=1");
      expect(output).toContain("manifests=workspace:0");
    } finally {
      await rm(tyrumHome, { recursive: true, force: true });
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
