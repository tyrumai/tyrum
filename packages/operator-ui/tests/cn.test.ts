import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn.js";

describe("cn()", () => {
  it("joins classnames", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("merges tailwind classes", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
