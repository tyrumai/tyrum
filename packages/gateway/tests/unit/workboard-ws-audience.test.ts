import { describe, expect, it } from "vitest";
import { WORKBOARD_WS_AUDIENCE } from "../../src/ws/workboard-audience.js";

describe("WORKBOARD_WS_AUDIENCE", () => {
  it("targets operator clients with read+write scopes", () => {
    expect(WORKBOARD_WS_AUDIENCE).toEqual({
      roles: ["client"],
      required_scopes: ["operator.read", "operator.write"],
    });
  });
});

