import { describe, expect, it } from "vitest";
import { formatFatalErrorForConsole } from "../../src/index.js";

describe("formatFatalErrorForConsole", () => {
  it("formats Error instances as '<name>: <message>'", () => {
    expect(formatFatalErrorForConsole(new Error("boom"))).toBe("Error: boom");
    expect(formatFatalErrorForConsole(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("formats non-Error thrown values as '<typeof>: <stringified>'", () => {
    expect(formatFatalErrorForConsole("raw string")).toBe("string: raw string");
    expect(formatFatalErrorForConsole({ hello: "world" })).toBe('object: {"hello":"world"}');
    expect(formatFatalErrorForConsole(null)).toBe("object: null");
  });

  it("redacts URI userinfo in the formatted output", () => {
    const secret = "postgres://user:supersecret@db.example.com:5432/tyrum";
    const err = new Error(`boom ${secret}`);
    err.name = `Error ${secret}`;
    (err as NodeJS.ErrnoException).code = secret;

    const formatted = formatFatalErrorForConsole(err);

    expect(formatted).toContain("Error");
    expect(formatted).toContain("boom");
    expect(formatted).toContain("postgres://***@db.example.com:5432/tyrum");
    expect(formatted).not.toContain(secret);
    expect(formatted).not.toContain("user:supersecret");
  });

  it("does not redact '@' outside URI userinfo", () => {
    expect(formatFatalErrorForConsole("http://example.com/@user")).toBe(
      "string: http://example.com/@user",
    );
    expect(formatFatalErrorForConsole("http://example.com?x=a@b")).toBe(
      "string: http://example.com?x=a@b",
    );
  });

  it("truncates output to 500 characters", () => {
    const longString = "a".repeat(600);
    const formatted = formatFatalErrorForConsole(longString);

    expect(formatted).toBe(`string: ${longString}`.slice(0, 500));
    expect(formatted.length).toBe(500);
  });

  it("does not throw when formatting pathological thrown values", () => {
    const pathological = {
      toJSON() {
        return undefined;
      },
      [Symbol.toPrimitive]() {
        throw new Error("nope");
      },
    };

    expect(() => formatFatalErrorForConsole(pathological)).not.toThrow();
    expect(formatFatalErrorForConsole(pathological)).toContain("object:");
  });
});
