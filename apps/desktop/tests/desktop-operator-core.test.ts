import { describe, expect, it } from "vitest";
import { headersToRecord } from "../src/renderer/lib/desktop-operator-core.js";

describe("headersToRecord", () => {
  it("returns undefined for undefined input", () => {
    expect(headersToRecord(undefined)).toBeUndefined();
  });

  it("converts HeadersInit into a plain record with normalized keys", () => {
    const record = headersToRecord({
      Authorization: "Bearer token",
      "X-Test": "1",
    });

    expect(record).toEqual({
      authorization: "Bearer token",
      "x-test": "1",
    });
  });
});
