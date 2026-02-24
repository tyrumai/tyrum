import { describe, expect, it } from "vitest";

describe("gateway CLI fatal error logging", () => {
  it("formats fatal errors without including the raw message", async () => {
    const mod = (await import("../../src/index.js")) as unknown as Record<string, unknown>;
    const formatter = mod["formatFatalErrorForConsole"];
    expect(typeof formatter).toBe("function");

    const secret = "postgres://user:supersecret@db.example.com:5432/tyrum";
    const err = new Error(`boom ${secret}`);
    err.name = `Error ${secret}`;
    (err as NodeJS.ErrnoException).code = secret;
    const formatted = (formatter as (error: unknown) => string)(err);

    expect(formatted).toBe("Error");
    expect(formatted).not.toContain("boom");
    expect(formatted).not.toContain(secret);
  });
});
