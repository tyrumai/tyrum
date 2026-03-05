import { describe, expect, it } from "vitest";
import { splitHostAndPort } from "../../src/index.js";

describe("splitHostAndPort", () => {
  it("detects unbracketed IPv6 host:port", () => {
    expect(splitHostAndPort("::1:8788")).toEqual({ host: "::1", port: "8788" });
  });
});
