import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import {
  buildRuntimePrompt,
  canPatternMatchMcpToolId,
  resetGitRootCacheForTests,
  resolveGitRoot,
} from "../../src/modules/agent/runtime/turn-preparation-runtime.js";

describe("turn preparation runtime helpers", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    resetGitRootCacheForTests();
    vi.restoreAllMocks();
  });

  it("caches git root lookups per home directory", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo\n", ""));
      return {} as never;
    });

    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo");
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/workspace", "rev-parse", "--show-toplevel"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("refreshes cached git roots after the ttl expires", async () => {
    execFileMock.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-1\n", ""));
      return {} as never;
    });
    execFileMock.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-2\n", ""));
      return {} as never;
    });

    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(0);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-1");

    now.mockReturnValue(30_000);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-1");

    now.mockReturnValue(61_000);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-2");

    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("includes the resolved git root in the runtime prompt", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-root\n", ""));
      return {} as never;
    });

    const prompt = await buildRuntimePrompt({
      nowIso: "2026-03-09T00:00:00.000Z",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      channel: "test",
      threadId: "thread-1",
      home: "/workspace-prompt",
      stateMode: "local",
      model: "model-1",
    });

    expect(prompt).toContain("Git repo root: /repo-root");
    expect(prompt).not.toContain("Approval workflow available:");
  });

  it("accepts wildcard allow-list patterns that can match an MCP tool id", () => {
    expect(canPatternMatchMcpToolId("*.weather.*")).toBe(true);
    expect(canPatternMatchMcpToolId("m?p.weather.*")).toBe(true);
    expect(canPatternMatchMcpToolId("mcp*")).toBe(true);
    expect(canPatternMatchMcpToolId("calendar.*")).toBe(false);
  });
});
