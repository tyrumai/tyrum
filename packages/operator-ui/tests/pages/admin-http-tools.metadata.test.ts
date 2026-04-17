import { describe, expect, it } from "vitest";
import {
  lifecycleBadgeVariant,
  visibilityBadgeVariant,
} from "../../src/components/pages/admin-http-tools.metadata.js";

describe("admin-http-tools metadata helpers", () => {
  it("uses one lifecycle badge mapping across tool metadata surfaces", () => {
    expect(lifecycleBadgeVariant("canonical")).toBe("success");
    expect(lifecycleBadgeVariant("alias")).toBe("outline");
    expect(lifecycleBadgeVariant("deprecated")).toBe("warning");
  });

  it("uses one visibility badge mapping across tool metadata surfaces", () => {
    expect(visibilityBadgeVariant("public")).toBe("success");
    expect(visibilityBadgeVariant("internal")).toBe("warning");
    expect(visibilityBadgeVariant("runtime_only")).toBe("default");
  });
});
