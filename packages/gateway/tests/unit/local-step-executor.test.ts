import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActionPrimitive } from "@tyrum/schemas";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";

describe("LocalStepExecutor playbook output contracts", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function makeExecutor() {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-local-step-executor-"));
    return createLocalStepExecutor({ tyrumHome: homeDir });
  }

  it("applies max_output_bytes cap for CLI output", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(64))"],
        max_output_bytes: 16,
      },
    });

    const res = await executor.execute(action, "plan-1", 0, 5_000);
    expect(res.success).toBe(true);
    const result = res.result as { stdout?: string; truncated?: boolean };
    expect(result.stdout).toBe("x".repeat(16));
    expect(result.truncated).toBe(true);
  });

  it("fails when playbook output contract requires JSON but CLI output is text", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('not-json')"],
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-2", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("expected JSON");
  });

  it("fails when playbook output JSON schema validation fails", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('{\"ok\":false}')"],
        __playbook: {
          output: {
            type: "json",
            schema: {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { const: true },
              },
              additionalProperties: false,
            },
          },
        },
      },
    });

    const res = await executor.execute(action, "plan-3", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("schema");
  });

  it("fails when playbook output contract requires JSON but HTTP response is text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } })),
    );

    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://1.1.1.1/example",
        method: "GET",
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-4", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("expected JSON");
  });
});
