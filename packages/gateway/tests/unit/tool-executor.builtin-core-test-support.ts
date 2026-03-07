import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../../src/modules/workspace/lease.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createTextFetchMock,
  createToolExecutor,
  requireHomeDir,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

export function registerToolExecutorBuiltinCoreTests(home: HomeDirState): void {
  it("fs.read returns file content", async () => {
    const homeDir = requireHomeDir(home);
    await writeFile(join(homeDir, "test.txt"), "hello world", "utf-8");

    const result = await createToolExecutor({ homeDir }).execute("tool.fs.read", "call-1", {
      path: "test.txt",
    });

    expect(result.tool_call_id).toBe("call-1");
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("hello world");
    expect(result.error).toBeUndefined();
  });

  it("fs.read returns error for missing path argument", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.fs.read",
      "call-2",
      {},
    );

    expect(result.error).toBe("missing required argument: path");
  });

  it("http.fetch performs outbound request", async () => {
    const mockFetch = createTextFetchMock("response-body");
    const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      fetchImpl: mockFetch,
      dnsLookup,
    }).execute("tool.http.fetch", "call-3", {
      url: "https://example.com/api",
    });

    expect(result.output).toContain("response-body");
    expect(result.output).toContain('<data source="web">');
    expect(result.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ method: "GET" }),
    );
    expect(dnsLookup).toHaveBeenCalledWith("example.com");
  });

  it("http.fetch blocks requests to private network addresses", async () => {
    const mockFetch = createTextFetchMock("should-not-fetch");

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      fetchImpl: mockFetch,
    }).execute("tool.http.fetch", "call-ssrf-1", {
      url: "http://169.254.169.254/latest/meta-data/",
    });

    expect(result.error).toContain("blocked url");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("http.fetch blocks hostnames that resolve to private addresses", async () => {
    const mockFetch = createTextFetchMock("should-not-fetch");
    const dnsLookup = vi.fn(async () => [{ address: "10.0.0.42", family: 4 as const }]);

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      fetchImpl: mockFetch,
      dnsLookup,
    }).execute("tool.http.fetch", "call-ssrf-2", {
      url: "https://example.com/private",
    });

    expect(result.error).toContain("blocked url");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(dnsLookup).toHaveBeenCalledWith("example.com");
  });

  it("http.fetch returns error for missing url", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.http.fetch",
      "call-4",
      {},
    );

    expect(result.error).toBe("missing required argument: url");
  });

  it("fs.write writes file content", async () => {
    const homeDir = requireHomeDir(home);

    const result = await createToolExecutor({ homeDir }).execute("tool.fs.write", "call-5", {
      path: "test.txt",
      content: "data",
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("Wrote");

    const written = await readFile(join(homeDir, "test.txt"), "utf-8");
    expect(written).toBe("data");
  });

  it("tool.exec executes commands", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.exec",
      "call-6",
      { command: "echo hi" },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("hi");
    expect(result.output).toContain("[exit code:");
  });

  it("tool.exec timeout includes workspace lease wait", async () => {
    const db = openTestSqliteDb();
    const tenantId = DEFAULT_TENANT_ID;
    const workspaceId = DEFAULT_WORKSPACE_ID;
    const timeoutMs = 600;
    const releaseAfterMs = 450;

    try {
      await acquireWorkspaceLease(db, {
        tenantId,
        workspaceId,
        owner: "other-owner",
        ttlMs: 60_000,
      });

      const releaseDone = new Promise<void>((resolve) => {
        setTimeout(() => {
          void releaseWorkspaceLease(db, {
            tenantId,
            workspaceId,
            owner: "other-owner",
          })
            .then(resolve)
            .catch(() => resolve());
        }, releaseAfterMs);
      });

      const executor = createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId,
          agentId: null,
          workspaceId,
          ownerPrefix: "test-tool",
        },
      });

      const startedAtMs = Date.now();
      const result = await executor.execute("tool.exec", "call-lease-timeout-1", {
        command: "sleep 1",
        timeout_ms: timeoutMs,
      });
      const durationMs = Date.now() - startedAtMs;

      await releaseDone;

      expect(result.error).toBeUndefined();
      expect(durationMs).toBeLessThan(timeoutMs + 250);
    } finally {
      await db.close();
    }
  });

  it("unknown tool returns error", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.unknown",
      "call-8",
      {},
    );

    expect(result.error).toBe("unknown tool: tool.unknown");
  });

  it("rejects invalid automation schedule steps before dispatching to the service", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: null,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal: new IdentityScopeDal(db),
      }).execute("tool.automation.schedule.create", "call-schedule-invalid-steps-1", {
        kind: "cron",
        cadence: { type: "interval", interval_ms: 60_000 },
        execution: {
          kind: "steps",
          steps: [{ type: "Nope", args: {} }],
        },
      });

      expect(result.output).toBe("");
      expect(result.error).toMatch(/invalid steps schedule action/i);
    } finally {
      await db.close();
    }
  });

  it("fails closed when automation schedule tools are invoked without a tenant id", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: "   ",
          agentId: null,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal: new IdentityScopeDal(db),
      }).execute("tool.automation.schedule.list", "call-schedule-missing-tenant-1", {});

      expect(result.output).toBe("");
      expect(result.error).toBe("tenantId is required");
    } finally {
      await db.close();
    }
  });
}
