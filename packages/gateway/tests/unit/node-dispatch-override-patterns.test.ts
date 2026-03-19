import { describe, expect, it } from "vitest";
import {
  expandLegacyNodeDispatchOverridePatterns,
  hasLegacyUmbrellaNodeDispatchPattern,
} from "@tyrum/runtime-policy";

describe("node dispatch override pattern compatibility", () => {
  it("detects legacy umbrella capability patterns", () => {
    expect(
      hasLegacyUmbrellaNodeDispatchPattern("capability:tyrum.desktop;action:Desktop;op:act"),
    ).toBe(true);
    expect(
      hasLegacyUmbrellaNodeDispatchPattern("capability:tyrum.desktop.act;action:Desktop;op:act"),
    ).toBe(false);
  });

  it("expands legacy umbrella capability patterns to a family wildcard", () => {
    expect(
      expandLegacyNodeDispatchOverridePatterns("capability:tyrum.desktop;action:Desktop;op:act"),
    ).toEqual([
      "capability:tyrum.desktop;action:Desktop;op:act",
      "capability:tyrum.desktop.*;action:Desktop;op:act",
    ]);
  });

  it("leaves exact split descriptor patterns unchanged", () => {
    expect(
      expandLegacyNodeDispatchOverridePatterns(
        "capability:tyrum.desktop.snapshot;action:Desktop;op:snapshot",
      ),
    ).toEqual(["capability:tyrum.desktop.snapshot;action:Desktop;op:snapshot"]);
  });
});
