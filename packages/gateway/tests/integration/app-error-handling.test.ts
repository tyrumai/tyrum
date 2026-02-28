import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "./helpers.js";

function parseStructuredLogRecords(logSpy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map((call) => call[0])
    .filter((arg): arg is string => typeof arg === "string" && arg.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null);
}

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

      const unhandledRecords = parseStructuredLogRecords(logSpy).filter(
        (record) => record["msg"] === "http.unhandled_error",
      );

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

  it("returns structured JSON for invalid request errors and logs a validation key", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { app } = await createTestApp();

      app.post("/__invalid", () => {
        const error = new Error("invalid payload");
        error.name = "ZodError";
        throw error;
      });

      const res = await app.request("/__invalid", { method: "POST" });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
      const body = (await res.json()) as { error: string; message: string };
      expect(body).toEqual({ error: "invalid_request", message: "invalid payload" });

      const invalidRequestRecords = parseStructuredLogRecords(logSpy).filter(
        (record) => record["msg"] === "http.invalid_request",
      );
      expect(invalidRequestRecords).toHaveLength(1);
      const record = invalidRequestRecords[0] as Record<string, unknown>;
      expect(record["method"]).toBe("POST");
      expect(record["path"]).toBe("/__invalid");
      expect(typeof record["request_id"]).toBe("string");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("preserves HTTPException status codes and does not misclassify them as unhandled errors", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const previousNodeEnv = process.env["NODE_ENV"];
    try {
      process.env["NODE_ENV"] = "production";
      const { app } = await createTestApp();

      const { HTTPException } = await import("hono/http-exception");
      app.get("/__teapot", () => {
        throw new HTTPException(418, { message: "teapot" });
      });

      const res = await app.request("/__teapot");
      expect(res.status).toBe(418);
      expect(await res.text()).toBe("teapot");

      const unhandledRecords = parseStructuredLogRecords(logSpy).filter(
        (record) => record["msg"] === "http.unhandled_error",
      );
      expect(unhandledRecords).toHaveLength(0);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = previousNodeEnv;
      }
      logSpy.mockRestore();
    }
  });

  it("omits error_stack from logs in production", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const previousNodeEnv = process.env["NODE_ENV"];
    try {
      process.env["NODE_ENV"] = "production";
      const { app } = await createTestApp();

      app.get("/__boom_no_stack", () => {
        throw new Error("boom");
      });

      const res = await app.request("/__boom_no_stack");
      expect(res.status).toBe(500);

      const unhandledRecords = parseStructuredLogRecords(logSpy).filter(
        (record) => record["msg"] === "http.unhandled_error",
      );
      expect(unhandledRecords).toHaveLength(1);
      const record = unhandledRecords[0] as Record<string, unknown>;
      expect(record).not.toHaveProperty("error_stack");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = previousNodeEnv;
      }
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
