import { describe, expect, it } from "vitest";
import { toErrorMessage } from "../src/renderer/lib/errors.js";

describe("toErrorMessage", () => {
  it("strips Electron IPC wrapper prefixes", () => {
    const message = toErrorMessage(
      new Error(
        "Error invoking remote method 'gateway:start': Error: listen EADDRINUSE: address already in use 127.0.0.1:8788",
      ),
    );
    expect(message).toBe(
      "listen EADDRINUSE: address already in use 127.0.0.1:8788",
    );
  });

  it("returns a safe fallback for unknown values", () => {
    expect(toErrorMessage({})).toBe("Unknown error.");
  });
});
