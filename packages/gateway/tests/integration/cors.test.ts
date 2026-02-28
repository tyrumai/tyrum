import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createContainer } from "../../src/container.js";
import { createTestContainer } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

async function withEnvVar(
  key: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[key];
  try {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

function parseCommaHeader(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

describe("CORS", () => {
  it("adds CORS headers for configured origins from gateway config", async () => {
    const gatewayConfig = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_CORS_ORIGINS: "http://localhost:3000",
    });
    const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

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
    await withEnvVar("TYRUM_CORS_ORIGINS", "http://localhost:3000", async () => {
      const container = await createTestContainer();
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
    });

    await withEnvVar("TYRUM_CORS_ORIGINS", undefined, async () => {
      const container = await createTestContainer();
      try {
        const app = createApp(container);
        const res = await app.request("/healthz", {
          headers: { Origin: "http://localhost:3000" },
        });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      } finally {
        await container.db.close();
      }
    });
  });

  it("responds to preflight OPTIONS with expected headers", async () => {
    await withEnvVar("TYRUM_CORS_ORIGINS", "http://localhost:3000", async () => {
      const container = await createTestContainer();
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
        expect(methods.sort()).toEqual(["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"].sort());

        const headers = parseCommaHeader(res.headers.get("Access-Control-Allow-Headers"));
        expect(headers.sort()).toEqual(["Authorization", "Content-Type"].sort());
      } finally {
        await container.db.close();
      }
    });
  });
});
