import { describe, expect, it } from "vitest";
import {
  capabilitiesForProfile,
  getAllowlistMode,
} from "../src/renderer/lib/permission-profile.js";

describe("permission profile mapping", () => {
  it("maps safe profile to least-privilege capability defaults", () => {
    expect(capabilitiesForProfile("safe")).toEqual({
      desktop: true,
      playwright: false,
      cli: false,
      http: false,
    });
  });

  it("maps balanced profile to full capability defaults with allowlists active", () => {
    const caps = capabilitiesForProfile("balanced");
    expect(caps).toEqual({
      desktop: true,
      playwright: true,
      cli: true,
      http: true,
    });
    expect(getAllowlistMode("balanced", caps)).toEqual({
      cli: "active",
      web: "active",
    });
  });

  it("maps poweruser profile to allowlists inactive", () => {
    const caps = capabilitiesForProfile("poweruser");
    expect(getAllowlistMode("poweruser", caps)).toEqual({
      cli: "inactive",
      web: "inactive",
    });
  });
});
