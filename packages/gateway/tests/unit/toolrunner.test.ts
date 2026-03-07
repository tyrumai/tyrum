import { describe, it, expect, vi, afterEach } from "vitest";
import { runToolRunnerFromStdio } from "../../src/toolrunner.js";

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function suppressStderr() {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((chunk: any) => {
      writes.push(String(chunk));
      return true;
    }) as never);

  return {
    writes,
    restore: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toolrunner", () => {
  it("returns 2 on invalid JSON payload", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({ payloadB64: b64url("not-json") });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("toolrunner input error");
  });

  it("returns 2 when plan_id/step_index are invalid", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          plan_id: "",
          step_index: -1,
          action: {},
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
  });

  it("returns 2 when action schema is invalid", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          plan_id: "plan-1",
          step_index: 0,
          action: {},
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("invalid action");
  });

  it("returns 2 when tenant_id is missing", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid tenant_id");
  });

  it("returns 2 when tenant_id is blank", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "   ",
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid tenant_id");
  });
});
