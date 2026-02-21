/**
 * SlashCommand schema tests — verifies parse and reject for
 * SlashCommandPayload and SlashCommandResult.
 */

import { describe, it, expect } from "vitest";
import { SlashCommandPayload, SlashCommandResult } from "../src/index.js";

// ---------------------------------------------------------------------------
// SlashCommandPayload
// ---------------------------------------------------------------------------

describe("SlashCommandPayload", () => {
  it("parses valid payload", () => {
    const result = SlashCommandPayload.parse({ input: "/status" });
    expect(result.input).toBe("/status");
  });

  it("parses payload with any non-empty input", () => {
    const result = SlashCommandPayload.parse({ input: "hello world" });
    expect(result.input).toBe("hello world");
  });

  it("rejects empty input", () => {
    expect(() => SlashCommandPayload.parse({ input: "" })).toThrow();
  });

  it("rejects missing input", () => {
    expect(() => SlashCommandPayload.parse({})).toThrow();
  });

  it("rejects extra properties (strict)", () => {
    expect(() =>
      SlashCommandPayload.parse({ input: "/status", extra: true }),
    ).toThrow();
  });

  it("rejects non-string input", () => {
    expect(() => SlashCommandPayload.parse({ input: 42 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SlashCommandResult
// ---------------------------------------------------------------------------

describe("SlashCommandResult", () => {
  it("parses result with output only", () => {
    const result = SlashCommandResult.parse({ output: "pong" });
    expect(result.output).toBe("pong");
    expect(result.data).toBeUndefined();
  });

  it("parses result with output and data", () => {
    const result = SlashCommandResult.parse({
      output: "ok",
      data: { count: 5 },
    });
    expect(result.output).toBe("ok");
    expect(result.data).toEqual({ count: 5 });
  });

  it("parses result with null data", () => {
    const result = SlashCommandResult.parse({
      output: "ok",
      data: null,
    });
    expect(result.output).toBe("ok");
    expect(result.data).toBeNull();
  });

  it("parses result with empty output", () => {
    const result = SlashCommandResult.parse({ output: "" });
    expect(result.output).toBe("");
  });

  it("rejects missing output", () => {
    expect(() => SlashCommandResult.parse({})).toThrow();
  });

  it("rejects extra properties (strict)", () => {
    expect(() =>
      SlashCommandResult.parse({ output: "ok", extra: true }),
    ).toThrow();
  });

  it("rejects non-string output", () => {
    expect(() => SlashCommandResult.parse({ output: 42 })).toThrow();
  });
});
