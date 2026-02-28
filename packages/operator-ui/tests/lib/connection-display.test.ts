import { describe, expect, it } from "vitest";
import { getConnectionDisplay } from "../../src/lib/connection-display.js";

describe("getConnectionDisplay", () => {
  it("maps connection statuses to dot variant, pulse and label", () => {
    expect(getConnectionDisplay("disconnected")).toEqual({
      variant: "danger",
      pulse: false,
      label: "Disconnected",
    });

    expect(getConnectionDisplay("connecting")).toEqual({
      variant: "primary",
      pulse: true,
      label: "Connecting",
    });

    expect(getConnectionDisplay("connected")).toEqual({
      variant: "success",
      pulse: false,
      label: "Connected",
    });
  });
});
