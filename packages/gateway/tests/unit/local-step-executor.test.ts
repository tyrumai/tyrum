import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ActionPrimitive } from "@tyrum/schemas";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("../../src/modules/agent/tool-executor.js", () => ({
  isBlockedUrl: vi.fn().mockReturnValue(false),
  resolvesToBlockedAddress: vi.fn().mockResolvedValue(false),
  sanitizeEnv: vi.fn().mockReturnValue({}),
}));

import { spawn } from "node:child_process";
import {
  isBlockedUrl,
  resolvesToBlockedAddress,
} from "../../src/modules/agent/tool-executor.js";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";

const mockSpawn = vi.mocked(spawn);
const mockIsBlockedUrl = vi.mocked(isBlockedUrl);
const mockResolvesToBlockedAddress = vi.mocked(resolvesToBlockedAddress);

/* ---------- helpers ---------- */

function makeAction(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return { type, args: args ?? {} };
}

function createMockChild(exitCode: number | null = 0, stdout = "", stderr = "") {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {
      this.push(Buffer.from(stdout));
      this.push(null);
    },
  });
  child.stderr = new Readable({
    read() {
      this.push(Buffer.from(stderr));
      this.push(null);
    },
  });
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit("close", exitCode, null), 5);
  return child;
}

function createMockChildWithSignal(signal: string, stdout = "", stderr = "") {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {
      this.push(Buffer.from(stdout));
      this.push(null);
    },
  });
  child.stderr = new Readable({
    read() {
      this.push(Buffer.from(stderr));
      this.push(null);
    },
  });
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit("close", null, signal), 5);
  return child;
}

function createMockChildWithError(errorMessage: string) {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({ read() { this.push(null); } });
  child.stderr = new Readable({ read() { this.push(null); } });
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit("error", new Error(errorMessage)), 5);
  return child;
}

function mockFetchResponse(
  body: string,
  status = 200,
  contentType = "application/json",
): Response {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { "content-type": contentType },
  });
}

/* ---------- suite ---------- */

const mockFetch = vi.fn<(...args: any[]) => Promise<Response>>();

describe("LocalStepExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockIsBlockedUrl.mockReturnValue(false);
    mockResolvesToBlockedAddress.mockResolvedValue(false);
  });

  const executor = createLocalStepExecutor({ tyrumHome: "/tmp/tyrum-test" });

  /* ============ HTTP ============ */

  describe("HTTP execution", () => {
    it("executes HTTP GET successfully with JSON body", async () => {
      const jsonBody = JSON.stringify({ message: "ok" });
      mockFetch.mockResolvedValue(mockFetchResponse(jsonBody, 200, "application/json"));

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/api" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(true);
      expect(result.evidence?.http?.status).toBe(200);
      expect(result.evidence?.json).toEqual({ message: "ok" });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("returns error for missing URL argument", async () => {
      const result = await executor.execute(
        makeAction("Http", {}),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing required argument: url");
    });

    it("returns error for blocked URL", async () => {
      mockIsBlockedUrl.mockReturnValue(true);

      const result = await executor.execute(
        makeAction("Http", { url: "http://169.254.169.254/metadata" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked url");
    });

    it("returns error when resolvesToBlockedAddress is true", async () => {
      mockResolvesToBlockedAddress.mockResolvedValue(true);

      const result = await executor.execute(
        makeAction("Http", { url: "https://internal.example.com" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked url");
    });

    it("handles timeout correctly", async () => {
      // Mock fetch that respects the abort signal, simulating a slow server
      mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        }),
      );

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/slow", timeout_ms: 50 }),
        "plan-1",
        0,
        100,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles fetch error", async () => {
      mockFetch.mockRejectedValue(new Error("network failure"));

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/down" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("network failure");
    });

    it("detects JSON content type and includes json evidence", async () => {
      const payload = { data: [1, 2, 3] };
      mockFetch.mockResolvedValue(
        mockFetchResponse(JSON.stringify(payload), 200, "application/json; charset=utf-8"),
      );

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/json" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(true);
      expect(result.evidence?.json).toEqual(payload);
    });

    it("detects HTML content type and includes dom evidence", async () => {
      const html = "<html><body>Hello</body></html>";
      mockFetch.mockResolvedValue(
        mockFetchResponse(html, 200, "text/html"),
      );

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/page" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(true);
      expect(result.evidence?.dom?.html).toBe(html);
    });

    it("truncates response body at MAX_OUTPUT_BYTES (32768)", async () => {
      const largeBody = "x".repeat(65_536);
      mockFetch.mockResolvedValue(
        mockFetchResponse(largeBody, 200, "text/plain"),
      );

      const result = await executor.execute(
        makeAction("Http", { url: "https://example.com/large" }),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(true);
      expect((result.result as any).truncated).toBe(true);
    });

    it("parses custom headers from args", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse("{}", 200));

      await executor.execute(
        makeAction("Http", {
          url: "https://example.com/api",
          headers: { Authorization: "Bearer token", Accept: "application/json" },
        }),
        "plan-1",
        0,
        30_000,
      );

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1]?.headers).toEqual({
        Authorization: "Bearer token",
        Accept: "application/json",
      });
    });

    it("returns unsupported action type error for unknown types", async () => {
      const result = await executor.execute(
        makeAction("Pay" as any, {}),
        "plan-1",
        0,
        30_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("unsupported action type");
    });
  });

  /* ============ CLI ============ */

  describe("CLI execution", () => {
    it("executes CLI command successfully", async () => {
      const child = createMockChild(0, "hello stdout", "");
      mockSpawn.mockReturnValue(child as any);

      const result = await executor.execute(
        makeAction("CLI", { cmd: "echo", args: ["hello"] }),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(true);
      expect((result.result as any).stdout).toBe("hello stdout");
      expect((result.result as any).exit_code).toBe(0);
    });

    it("returns error for missing cmd argument", async () => {
      const result = await executor.execute(
        makeAction("CLI", {}),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing required argument: cmd");
    });

    it("handles non-zero exit code", async () => {
      const child = createMockChild(1, "", "some error");
      mockSpawn.mockReturnValue(child as any);

      const result = await executor.execute(
        makeAction("CLI", { cmd: "false" }),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("command failed with exit code 1");
    });

    it("handles process signal termination", async () => {
      const child = createMockChildWithSignal("SIGKILL");
      mockSpawn.mockReturnValue(child as any);

      const result = await executor.execute(
        makeAction("CLI", { cmd: "sleep", args: ["100"] }),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("command terminated by signal SIGKILL");
    });

    it("handles spawn error", async () => {
      const child = createMockChildWithError("ENOENT: command not found");
      mockSpawn.mockReturnValue(child as any);

      const result = await executor.execute(
        makeAction("CLI", { cmd: "nonexistent" }),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(false);
      expect((result.result as any)?.stderr).toContain("ENOENT");
    });

    it("validates sandbox — rejects path traversal in cwd", async () => {
      await expect(
        executor.execute(
          makeAction("CLI", { cmd: "ls", cwd: "../../etc" }),
          "plan-1",
          0,
          60_000,
        ),
      ).rejects.toThrow("path escapes workspace");
    });

    it("truncates stdout at MAX_OUTPUT_BYTES", async () => {
      const largeOutput = "A".repeat(65_536);
      const child = createMockChild(0, largeOutput, "");
      mockSpawn.mockReturnValue(child as any);

      const result = await executor.execute(
        makeAction("CLI", { cmd: "cat", args: ["bigfile"] }),
        "plan-1",
        0,
        60_000,
      );

      expect(result.success).toBe(true);
      const stdout = (result.result as any).stdout as string;
      expect(stdout.length).toBeLessThanOrEqual(32_768);
    });
  });

  /* ============ Secret resolution ============ */

  describe("secret resolution", () => {
    it("resolves secret handles in args", async () => {
      const mockSecretProvider = {
        list: vi.fn().mockResolvedValue([
          { handle_id: "api-key-1", name: "API Key" },
        ]),
        resolve: vi.fn().mockResolvedValue("sk-secret-123"),
        store: vi.fn(),
        delete: vi.fn(),
      };

      const executorWithSecrets = createLocalStepExecutor({
        tyrumHome: "/tmp/tyrum-test",
        secretProvider: mockSecretProvider,
      });

      mockFetch.mockResolvedValue(mockFetchResponse("{}", 200));

      await executorWithSecrets.execute(
        makeAction("Http", {
          url: "https://example.com/api",
          headers: { Authorization: "secret:api-key-1" },
        }),
        "plan-1",
        0,
        30_000,
      );

      expect(mockSecretProvider.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ handle_id: "api-key-1" }),
      );
    });

    it("passes through non-secret values unchanged", async () => {
      const mockSecretProvider = {
        list: vi.fn().mockResolvedValue([]),
        resolve: vi.fn(),
        store: vi.fn(),
        delete: vi.fn(),
      };

      const executorWithSecrets = createLocalStepExecutor({
        tyrumHome: "/tmp/tyrum-test",
        secretProvider: mockSecretProvider,
      });

      mockFetch.mockResolvedValue(mockFetchResponse("{}", 200));

      await executorWithSecrets.execute(
        makeAction("Http", {
          url: "https://example.com/api",
          headers: { "X-Custom": "plain-value" },
        }),
        "plan-1",
        0,
        30_000,
      );

      // The header should arrive unchanged in the fetch call
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1]?.headers).toEqual(
        expect.objectContaining({ "X-Custom": "plain-value" }),
      );
      // resolve should not have been called since no handles matched
      expect(mockSecretProvider.resolve).not.toHaveBeenCalled();
    });
  });
});
