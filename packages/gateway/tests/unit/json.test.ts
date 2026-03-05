import { describe, expect, it } from "vitest";
import { safeJsonParse } from "../../src/utils/json.js";

describe("safeJsonParse", () => {
  it("returns fallback when JSON is malformed", () => {
    expect(safeJsonParse("{", { ok: true })).toEqual({ ok: true });
  });

  it("returns fallback when JSON parses to the wrong shape", () => {
    expect(safeJsonParse("{}", [] as unknown[])).toEqual([]);
    expect(safeJsonParse("[]", {} as Record<string, unknown>)).toEqual({});
  });
});
