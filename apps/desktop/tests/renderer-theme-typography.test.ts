import { describe, expect, it } from "vitest";

import { fonts } from "../src/renderer/theme.ts";

describe("renderer theme typography", () => {
  it("uses an OS-default sans font stack", () => {
    expect(fonts.sans).toContain("system-ui");
    expect(fonts.sans).not.toContain("Inter");
  });

  it("uses an OS-default monospace font stack", () => {
    expect(fonts.mono).toContain("ui-monospace");
    expect(fonts.mono).not.toContain("JetBrains");
  });
});
