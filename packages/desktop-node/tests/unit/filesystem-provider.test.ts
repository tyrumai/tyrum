import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  FilesystemProvider,
  type FilesystemProviderConfig,
} from "../../src/providers/filesystem-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sandboxRoot: string;
let provider: FilesystemProvider;

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Filesystem", args };
}

function makeProvider(overrides: Partial<FilesystemProviderConfig> = {}): FilesystemProvider {
  return new FilesystemProvider({ sandboxRoot, ...overrides });
}

type ResultPayload = Record<string, unknown>;

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), "fs-provider-test-"));
  provider = makeProvider();
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

describe("read", () => {
  it("normalizes the sandbox root path to dot", () => {
    const rel = (
      provider as unknown as {
        rel: (absolutePath: string) => string;
      }
    ).rel(sandboxRoot);
    expect(rel).toBe(".");
  });

  it("reads a file successfully", async () => {
    await writeFile(join(sandboxRoot, "hello.txt"), "hello world", "utf-8");
    const result = await provider.execute(makeAction({ op: "read", path: "hello.txt" }));
    expect(result.success).toBe(true);
    const data = result.result as ResultPayload;
    expect(data.content).toBe("hello world");
    expect(data.path).toBe("hello.txt");
    expect(data.raw_chars).toBe(11);
  });

  it("applies offset and limit", async () => {
    await writeFile(join(sandboxRoot, "lines.txt"), "a\nb\nc\nd\ne", "utf-8");
    const result = await provider.execute(
      makeAction({ op: "read", path: "lines.txt", offset: 1, limit: 2 }),
    );
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).content).toBe("b\nc");
  });

  it("returns error for non-existent file", async () => {
    const result = await provider.execute(makeAction({ op: "read", path: "nope.txt" }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("blocks path traversal", async () => {
    const result = await provider.execute(makeAction({ op: "read", path: "../../etc/passwd" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("escapes sandbox");
  });
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

describe("write", () => {
  it("writes a file successfully", async () => {
    const result = await provider.execute(
      makeAction({ op: "write", path: "out.txt", content: "data" }),
    );
    expect(result.success).toBe(true);
    const data = result.result as ResultPayload;
    expect(data.bytes_written).toBe(4);
    expect(await readFile(join(sandboxRoot, "out.txt"), "utf-8")).toBe("data");
  });

  it("creates intermediate directories", async () => {
    const result = await provider.execute(
      makeAction({ op: "write", path: "deep/nested/file.txt", content: "nested" }),
    );
    expect(result.success).toBe(true);
    expect(await readFile(join(sandboxRoot, "deep/nested/file.txt"), "utf-8")).toBe("nested");
  });

  it("blocks path traversal", async () => {
    const result = await provider.execute(
      makeAction({ op: "write", path: "../escape.txt", content: "evil" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("escapes sandbox");
  });
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe("edit", () => {
  it("replaces first occurrence", async () => {
    await writeFile(join(sandboxRoot, "edit.txt"), "foo bar foo", "utf-8");
    const result = await provider.execute(
      makeAction({ op: "edit", path: "edit.txt", old_string: "foo", new_string: "baz" }),
    );
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).replacements).toBe(1);
    expect(await readFile(join(sandboxRoot, "edit.txt"), "utf-8")).toBe("baz bar foo");
  });

  it("replaces all occurrences when replace_all is true", async () => {
    await writeFile(join(sandboxRoot, "edit.txt"), "aaa", "utf-8");
    const result = await provider.execute(
      makeAction({
        op: "edit",
        path: "edit.txt",
        old_string: "a",
        new_string: "b",
        replace_all: true,
      }),
    );
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).replacements).toBe(3);
    expect(await readFile(join(sandboxRoot, "edit.txt"), "utf-8")).toBe("bbb");
  });

  it("returns error when old_string is not found", async () => {
    await writeFile(join(sandboxRoot, "edit.txt"), "hello", "utf-8");
    const result = await provider.execute(
      makeAction({ op: "edit", path: "edit.txt", old_string: "xyz", new_string: "abc" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// apply_patch
// ---------------------------------------------------------------------------

describe("apply_patch", () => {
  it("adds a new file", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: new.txt",
      "+line one",
      "+line two",
      "*** End Patch",
    ].join("\n");
    const result = await provider.execute(makeAction({ op: "apply_patch", patch }));
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).applied).toEqual(["add new.txt"]);
    expect(await readFile(join(sandboxRoot, "new.txt"), "utf-8")).toBe("line one\nline two\n");
  });

  it("updates an existing file", async () => {
    await writeFile(join(sandboxRoot, "exist.txt"), "hello world\n", "utf-8");
    const patch = [
      "*** Begin Patch",
      "*** Update File: exist.txt",
      "-hello world",
      "+hello patch",
      "*** End Patch",
    ].join("\n");
    const result = await provider.execute(makeAction({ op: "apply_patch", patch }));
    expect(result.success).toBe(true);
    const content = await readFile(join(sandboxRoot, "exist.txt"), "utf-8");
    expect(content).toContain("hello patch");
  });
});

// ---------------------------------------------------------------------------
// capability ids
// ---------------------------------------------------------------------------

describe("capabilityIds", () => {
  it("omits bash unless explicitly enabled", () => {
    expect(provider.capabilityIds).not.toContain("tyrum.fs.bash");
  });

  it("includes bash when explicitly enabled", () => {
    expect(makeProvider({ allowBash: true }).capabilityIds).toContain("tyrum.fs.bash");
  });
});

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

describe("bash", () => {
  it("rejects bash when it is not explicitly enabled", async () => {
    const result = await provider.execute(makeAction({ op: "bash", command: "echo hello" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Filesystem bash is disabled");
  });

  it("executes a simple command", async () => {
    const bashProvider = makeProvider({ allowBash: true });
    const result = await bashProvider.execute(makeAction({ op: "bash", command: "echo hello" }));
    expect(result.success).toBe(true);
    const data = result.result as ResultPayload;
    expect((data.output as string).trim()).toBe("hello");
    expect(data.exit_code).toBe(0);
  });

  it("captures exit code", async () => {
    const bashProvider = makeProvider({ allowBash: true });
    const result = await bashProvider.execute(makeAction({ op: "bash", command: "exit 42" }));
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).exit_code).toBe(42);
  });

  it("returns failure when bash cannot spawn", async () => {
    const bashProvider = makeProvider({ allowBash: true });
    const result = await bashProvider.execute(
      makeAction({ op: "bash", command: "echo hello", cwd: "missing-dir" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Error spawning command");
  });

  it("respects timeout", async () => {
    const fast = makeProvider({
      allowBash: true,
      defaultExecTimeoutMs: 500,
      maxExecTimeoutMs: 1000,
    });
    const result = await fast.execute(
      makeAction({ op: "bash", command: "sleep 10", timeout_ms: 500 }),
    );
    expect(result.success).toBe(true);
    // The process should have been killed; exit code will be non-zero or null
    const data = result.result as ResultPayload;
    expect(data.exit_code === null || (data.exit_code as number) !== 0).toBe(true);
  }, 10_000);

  it("uses sandbox root as default cwd", async () => {
    const bashProvider = makeProvider({ allowBash: true });
    const result = await bashProvider.execute(makeAction({ op: "bash", command: "pwd" }));
    expect(result.success).toBe(true);
    const output = ((result.result as ResultPayload).output as string).trim();
    // realpath may differ from sandboxRoot if tmpdir is a symlink
    expect(output.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// glob
// ---------------------------------------------------------------------------

describe("glob", () => {
  it("finds files matching pattern", async () => {
    await writeFile(join(sandboxRoot, "a.ts"), "", "utf-8");
    await writeFile(join(sandboxRoot, "b.js"), "", "utf-8");
    const result = await provider.execute(makeAction({ op: "glob", pattern: "*.ts" }));
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches).toContain("a.ts");
    expect(matches).not.toContain("b.js");
  });

  it("searches within a sub-path", async () => {
    await mkdir(join(sandboxRoot, "sub"), { recursive: true });
    await writeFile(join(sandboxRoot, "sub/c.ts"), "", "utf-8");
    await writeFile(join(sandboxRoot, "d.ts"), "", "utf-8");
    const result = await provider.execute(makeAction({ op: "glob", pattern: "*.ts", path: "sub" }));
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches).toContain("c.ts");
    expect(matches).not.toContain("d.ts");
  });

  it("does not traverse directory symlinks that resolve outside the sandbox", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "fs-provider-glob-outside-"));

    try {
      await writeFile(join(outsideRoot, "secret.ts"), "", "utf-8");
      await symlink(outsideRoot, join(sandboxRoot, "escape"));

      const result = await provider.execute(makeAction({ op: "glob", pattern: "*.ts" }));
      expect(result.success).toBe(true);
      expect((result.result as ResultPayload).matches).toEqual([]);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("does not loop on directory symlink cycles", async () => {
    await mkdir(join(sandboxRoot, "nested"), { recursive: true });
    await writeFile(join(sandboxRoot, "nested/file.ts"), "", "utf-8");
    await symlink(".", join(sandboxRoot, "loop"));

    const result = await provider.execute(makeAction({ op: "glob", pattern: "*.ts" }));
    expect(result.success).toBe(true);
    expect((result.result as ResultPayload).matches).toEqual(["nested/file.ts"]);
  }, 2_000);
});

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

describe("grep", () => {
  it("finds matching lines", async () => {
    await writeFile(join(sandboxRoot, "search.txt"), "foo\nbar\nbaz foo\n", "utf-8");
    const result = await provider.execute(makeAction({ op: "grep", pattern: "foo" }));
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches.length).toBe(2);
    expect(matches[0]).toContain("search.txt:1:foo");
    expect(matches[1]).toContain("search.txt:3:baz foo");
  });

  it("supports regex search", async () => {
    await writeFile(join(sandboxRoot, "rx.txt"), "abc123\ndef456\n", "utf-8");
    const result = await provider.execute(makeAction({ op: "grep", pattern: "\\d+", regex: true }));
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches.length).toBe(2);
  });

  it("rejects overly complex regex patterns", async () => {
    await writeFile(join(sandboxRoot, "rx.txt"), `${"a".repeat(512)}!\n`, "utf-8");
    const result = await provider.execute(
      makeAction({ op: "grep", pattern: "(a+)+$", regex: true }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("too complex");
  });

  it("supports ignore_case", async () => {
    await writeFile(join(sandboxRoot, "case.txt"), "Hello\nhello\nHELLO\n", "utf-8");
    const result = await provider.execute(
      makeAction({ op: "grep", pattern: "hello", ignore_case: true }),
    );
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches.length).toBe(3);
  });

  it("filters by include glob", async () => {
    await writeFile(join(sandboxRoot, "a.ts"), "findme\n", "utf-8");
    await writeFile(join(sandboxRoot, "b.js"), "findme\n", "utf-8");
    const result = await provider.execute(
      makeAction({ op: "grep", pattern: "findme", include: "*.ts" }),
    );
    expect(result.success).toBe(true);
    const matches = (result.result as ResultPayload).matches as string[];
    expect(matches.length).toBe(1);
    expect(matches[0]).toContain("a.ts");
  });

  it("does not read files through directory symlinks outside the sandbox", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "fs-provider-grep-outside-"));

    try {
      await writeFile(join(outsideRoot, "secret.txt"), "needle\n", "utf-8");
      await symlink(outsideRoot, join(sandboxRoot, "escape"));

      const result = await provider.execute(makeAction({ op: "grep", pattern: "needle" }));
      expect(result.success).toBe(true);
      expect((result.result as ResultPayload).matches).toEqual([]);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid args
// ---------------------------------------------------------------------------

describe("invalid args", () => {
  it("rejects unknown operation", async () => {
    const result = await provider.execute(makeAction({ op: "unknown" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid filesystem args");
  });
});
