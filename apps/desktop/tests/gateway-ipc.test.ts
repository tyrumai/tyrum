import { describe, expect, it } from "vitest";
import { getGatewayStatusSnapshot } from "../src/main/ipc/gateway-status.js";

describe("getGatewayStatusSnapshot", () => {
  it("returns running status so newly mounted tabs reflect live gateway state", () => {
    const snapshot = getGatewayStatusSnapshot("running", 8080);

    expect(snapshot).toEqual({
      status: "running",
      port: 8080,
    });
  });

  it("defaults to stopped when no manager status is available", () => {
    const snapshot = getGatewayStatusSnapshot(undefined, 8080);

    expect(snapshot).toEqual({
      status: "stopped",
      port: 8080,
    });
  });
});
