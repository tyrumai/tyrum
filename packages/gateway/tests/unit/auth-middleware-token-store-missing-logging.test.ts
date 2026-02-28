import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Logger, type LogFields } from "../../src/modules/observability/logger.js";

class TestLogger extends Logger {
  readonly errors: Array<{ msg: string; fields?: LogFields }> = [];

  constructor() {
    super({ level: "silent" });
  }

  override debug(): void {}

  override info(): void {}

  override warn(): void {}

  override error(msg: string, fields?: LogFields): void {
    this.errors.push({ msg, fields });
  }
}

describe("auth middleware missing token store logging", () => {
  it("logs missing tokenStore once per middleware instance", async () => {
    vi.resetModules();
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");

    const loggerA = new TestLogger();
    const appA = new Hono();
    appA.use("*", createAuthMiddleware(undefined, { logger: loggerA }));
    appA.get("/healthz", (c) => c.text("ok"));

    await appA.request("/healthz");
    await appA.request("/healthz");
    expect(loggerA.errors).toHaveLength(1);
    expect(loggerA.errors[0]?.msg).toBe("auth.token_store_missing");

    const loggerB = new TestLogger();
    const appB = new Hono();
    appB.use("*", createAuthMiddleware(undefined, { logger: loggerB }));
    appB.get("/healthz", (c) => c.text("ok"));

    await appB.request("/healthz");
    expect(loggerB.errors).toHaveLength(1);
  });
});

