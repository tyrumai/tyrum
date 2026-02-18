import { describe, expect, it } from "vitest";
import config from "../vite.config.ts";

describe("desktop vite config", () => {
  it("uses relative asset base for Electron file:// renderer", () => {
    expect(config.base).toBe("./");
  });
});
