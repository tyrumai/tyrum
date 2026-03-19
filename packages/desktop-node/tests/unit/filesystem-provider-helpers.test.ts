import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSandboxed,
  truncateOutput,
  sanitizeEnv,
} from "../../src/providers/filesystem-provider-helpers.js";

// ---------------------------------------------------------------------------
// assertSandboxed
// ---------------------------------------------------------------------------

describe("assertSandboxed", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "assert-sandboxed-"));
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a relative path within sandbox", () => {
    expect(assertSandboxed(root, "foo/bar.txt")).toBe(join(root, "foo/bar.txt"));
  });

  it("accepts the sandbox root itself", () => {
    expect(assertSandboxed(root, ".")).toBe(root);
  });

  it("accepts an absolute path within sandbox", () => {
    const path = join(root, "deep/file.ts");
    expect(assertSandboxed(root, path)).toBe(path);
  });

  it("blocks traversal via ../", () => {
    expect(() => assertSandboxed(root, "../etc/passwd")).toThrow("Path escapes sandbox");
  });

  it("blocks traversal via absolute path outside sandbox", () => {
    expect(() => assertSandboxed(root, "/etc/passwd")).toThrow("Path escapes sandbox");
  });

  it("blocks sneaky traversal with nested ../", () => {
    expect(() => assertSandboxed(root, "foo/../../etc/passwd")).toThrow("Path escapes sandbox");
  });

  it("blocks symlinks that resolve outside the sandbox", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "assert-sandboxed-outside-"));

    try {
      await mkdir(join(outsideRoot, "secrets"), { recursive: true });
      await symlink(outsideRoot, join(root, "escape"));

      expect(() => assertSandboxed(root, "escape/secrets/top-secret.txt")).toThrow(
        "Path escapes sandbox",
      );
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// truncateOutput
// ---------------------------------------------------------------------------

describe("truncateOutput", () => {
  it("returns the full string when within limit", () => {
    expect(truncateOutput("hello", 100)).toBe("hello");
  });

  it("truncates and appends marker when exceeding limit", () => {
    const result = truncateOutput("hello world", 5);
    expect(result).toContain("... (truncated)");
    expect(result.startsWith("hello")).toBe(true);
  });

  it("handles exact boundary size", () => {
    const text = "abcd";
    expect(truncateOutput(text, Buffer.byteLength(text))).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// sanitizeEnv
// ---------------------------------------------------------------------------

describe("sanitizeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("removes TYRUM_ prefixed keys", () => {
    vi.stubEnv("TYRUM_SECRET", "s3cret");
    vi.stubEnv("HOME", "/home/test");
    const result = sanitizeEnv();
    expect(result).not.toHaveProperty("TYRUM_SECRET");
    expect(result).toHaveProperty("HOME");
  });

  it("removes GATEWAY_ prefixed keys", () => {
    vi.stubEnv("GATEWAY_TOKEN", "tok");
    vi.stubEnv("PATH", "/usr/bin");
    const result = sanitizeEnv();
    expect(result).not.toHaveProperty("GATEWAY_TOKEN");
    expect(result).toHaveProperty("PATH");
  });

  it("keeps unrelated keys", () => {
    vi.stubEnv("EDITOR", "vim");
    const result = sanitizeEnv();
    expect(result.EDITOR).toBe("vim");
  });
});
