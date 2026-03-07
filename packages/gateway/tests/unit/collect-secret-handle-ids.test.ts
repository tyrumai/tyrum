import { describe, expect, it } from "vitest";
import { collectSecretHandleIds } from "../../src/modules/secret/collect-secret-handle-ids.js";

describe("collectSecretHandleIds", () => {
  it("collects secret handle ids from nested args", () => {
    const ids = collectSecretHandleIds({
      a: "secret:h1",
      b: ["x", { c: "secret: h2 " }],
      c: { d: "secret:h1" },
      d: "secret:",
      e: "not-a-secret:h3",
    }).toSorted();

    expect(ids).toEqual(["h1", "h2"]);
  });
});
