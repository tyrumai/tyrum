import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers.js";

describe("gateway app global error handling", () => {
  it("returns structured JSON for unhandled exceptions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { app } = await createTestApp();

      app.get("/__boom", () => {
        throw new Error("boom");
      });

      const res = await app.request("/__boom");
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
      const body = (await res.json()) as { error: string; message: string };
      expect(body).toEqual({ error: "internal_error", message: "An unexpected error occurred" });

      const unhandledRecords = logSpy.mock.calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string" && arg.startsWith("{"))
        .map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return undefined;
          }
        })
        .filter(
          (record): record is { msg: unknown } => typeof record === "object" && record !== null,
        )
        .filter((record) => record.msg === "http.unhandled_error");

      expect(unhandledRecords).toHaveLength(1);
      const record = unhandledRecords[0] as Record<string, unknown>;
      expect(record["method"]).toBe("GET");
      expect(record["path"]).toBe("/__boom");
      expect(typeof record["request_id"]).toBe("string");
      expect(record["error_name"]).toBe("Error");
      expect(record["error_message"]).toBe("boom");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns structured JSON for unknown routes", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/__does_not_exist__");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({ error: "not_found", message: "route not found" });
  });
});
