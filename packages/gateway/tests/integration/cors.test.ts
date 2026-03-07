import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

function parseCommaHeader(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

describe("CORS", () => {
  it("adds CORS headers for configured origins from gateway config", async () => {
    const container = await createTestContainer({
      deploymentConfig: { server: { corsOrigins: ["http://localhost:3000"] } },
    });

    try {
      const app = createApp(container);
      const allowed = await app.request("/healthz", {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    } finally {
      await container.db.close();
    }
  });

  it("adds CORS headers only for configured origins", async () => {
    const container = await createTestContainer({
      deploymentConfig: { server: { corsOrigins: ["http://localhost:3000"] } },
    });
    try {
      const app = createApp(container);

      const allowed = await app.request("/healthz", {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");

      const blocked = await app.request("/healthz", {
        headers: { Origin: "http://evil.com" },
      });
      expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();

      const sameOrigin = await app.request("/healthz");
      expect(sameOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
    } finally {
      await container.db.close();
    }

    const containerNoCors = await createTestContainer();
    try {
      const app = createApp(containerNoCors);
      const res = await app.request("/healthz", {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    } finally {
      await containerNoCors.db.close();
    }
  });

  it("responds to preflight OPTIONS with expected headers", async () => {
    const container = await createTestContainer({
      deploymentConfig: { server: { corsOrigins: ["http://localhost:3000"] } },
    });
    try {
      const app = createApp(container);
      const res = await app.request("/healthz", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(res.headers.get("Access-Control-Max-Age")).toBe("3600");

      const methods = parseCommaHeader(res.headers.get("Access-Control-Allow-Methods"));
      expect(methods.toSorted()).toEqual(
        ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"].toSorted(),
      );

      const headers = parseCommaHeader(res.headers.get("Access-Control-Allow-Headers"));
      expect(headers.toSorted()).toEqual(["Authorization", "Content-Type"].toSorted());
    } finally {
      await container.db.close();
    }
  });
});
