import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertSandboxed,
  truncateOutput,
  sanitizeEnv,
} from "../../src/providers/filesystem-provider-helpers.js";

// ---------------------------------------------------------------------------
// assertSandboxed
// ---------------------------------------------------------------------------

describe("assertSandboxed", () => {
  const root = "/sandbox";

  it("resolves a relative path within sandbox", () => {
    expect(assertSandboxed(root, "foo/bar.txt")).toBe("/sandbox/foo/bar.txt");
  });

  it("accepts the sandbox root itself", () => {
    expect(assertSandboxed(root, ".")).toBe("/sandbox");
  });

  it("accepts an absolute path within sandbox", () => {
    expect(assertSandboxed(root, "/sandbox/deep/file.ts")).toBe("/sandbox/deep/file.ts");
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
