/**
 * HTTP SDK conformance tests.
 *
 * Validates `createTyrumHttpClient` behavior against a real gateway instance:
 * - Bearer auth works end-to-end
 * - Device token issue/revoke lifecycle
 * - Policy bundle + overrides CRUD
 * - Status, presence, usage, models, pairings endpoints
 * - JSON Schema contract endpoint
 * - Proper error responses for auth failures
 * - Auth strategy variants (bearer, none)
 *
 * All tests are hermetic: random ports, in-memory SQLite, temp token dirs.
 *
 * Note: Secrets and Plugins routes require optional providers/registries and
 * are not available in the minimal test gateway configuration.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createTyrumHttpClient, TyrumHttpClientError } from "../../src/index.js";
import type { TyrumHttpClient } from "../../src/index.js";
import { startGateway, type GatewayHarness } from "./harness.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedClient(gw: GatewayHarness): TyrumHttpClient {
  return createTyrumHttpClient({
    baseUrl: gw.baseUrl,
    auth: { type: "bearer", token: gw.adminToken },
  });
}

// ---------------------------------------------------------------------------
// Read-only endpoint tests — share a single gateway instance
// ---------------------------------------------------------------------------

describe("HTTP SDK conformance — read-only endpoints", () => {
  let gw: GatewayHarness;

  beforeAll(async () => {
    gw = await startGateway();
  });

  afterAll(async () => {
    await gw.stop();
  });

  it("status.get returns valid StatusResponse with bearer auth", async () => {
    const client = authedClient(gw);

    const status = await client.status.get();
    expect(status.status).toBe("ok");
    expect(typeof status.version).toBe("string");
    expect(status.version.length).toBeGreaterThan(0);
    expect(typeof status.role).toBe("string");
    expect(typeof status.db_kind).toBe("string");
  });

  it("status.get rejects with http_error for invalid bearer token", async () => {
    const client = createTyrumHttpClient({
      baseUrl: gw.baseUrl,
      auth: { type: "bearer", token: "invalid-token" },
    });

    await expect(client.status.get()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "http_error",
      status: 401,
    });
  });

  it("status.get rejects with http_error for auth type none", async () => {
    const client = createTyrumHttpClient({
      baseUrl: gw.baseUrl,
      auth: { type: "none" },
    });

    await expect(client.status.get()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "http_error",
      status: 401,
    });
  });

  it("policy.getBundle returns a valid policy bundle response", async () => {
    const client = authedClient(gw);

    const bundle = await client.policy.getBundle();
    expect(bundle.status).toBe("ok");
    expect(typeof bundle.generated_at).toBe("string");
    expect(bundle.effective).toBeDefined();
  });

  it("presence.list returns valid response with entries array", async () => {
    const client = authedClient(gw);

    const result = await client.presence.list();
    expect(result.status).toBe("ok");
    expect(Array.isArray(result.entries)).toBe(true);
    expect(typeof result.generated_at).toBe("string");
  });

  it("usage.get returns valid response for global scope", async () => {
    const client = authedClient(gw);

    const result = await client.usage.get();
    expect(result).toBeDefined();
  });

  it("contracts.getCatalog returns the JSON Schema catalog", async () => {
    const client = authedClient(gw);

    const catalog = await client.contracts.getCatalog();
    expect(catalog).toBeDefined();
    expect(typeof catalog).toBe("object");
  });

  it("models.status returns valid response", async () => {
    const client = authedClient(gw);

    const result = await client.models.status();
    expect(result.status).toBe("ok");
  });

  it("models.listProviders returns provider array", async () => {
    const client = authedClient(gw);

    const result = await client.models.listProviders();
    expect(Array.isArray(result.providers)).toBe(true);
  });

  it("pairings.list returns valid response", async () => {
    const client = authedClient(gw);

    const result = await client.pairings.list();
    expect(result.status).toBe("ok");
    expect(Array.isArray(result.pairings)).toBe(true);
  });

  it("rejects invalid request bodies before hitting the gateway", async () => {
    const client = authedClient(gw);

    await expect(
      client.deviceTokens.issue({
        device_id: "",
        role: "client",
        scopes: [],
      }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });
  });
});

// ---------------------------------------------------------------------------
// Stateful lifecycle tests — each gets a fresh gateway instance
// ---------------------------------------------------------------------------

describe("HTTP SDK conformance — stateful lifecycles", () => {
  const defaultAgentId = "00000000-0000-4000-8000-000000000002";
  let gw: GatewayHarness | undefined;

  afterEach(async () => {
    if (gw) {
      await gw.stop();
      gw = undefined;
    }
  });

  it("device token issue → use → revoke lifecycle", async () => {
    gw = await startGateway();
    const admin = authedClient(gw);

    // Issue a device token
    const issued = await admin.deviceTokens.issue({
      device_id: "conformance-device-1",
      role: "client",
      scopes: ["operator.read"],
      ttl_seconds: 300,
    });

    expect(issued.token_kind).toBe("device");
    expect(typeof issued.token).toBe("string");
    expect(issued.token.length).toBeGreaterThan(0);
    expect(issued.device_id).toBe("conformance-device-1");
    expect(issued.role).toBe("client");

    // Use the device token to access status
    const deviceClient = createTyrumHttpClient({
      baseUrl: gw.baseUrl,
      auth: { type: "bearer", token: issued.token },
    });
    const status = await deviceClient.status.get();
    expect(status.status).toBe("ok");

    // Revoke the device token
    const revoked = await admin.deviceTokens.revoke({ token: issued.token });
    expect(revoked.revoked).toBe(true);

    // The revoked token should no longer work
    await expect(deviceClient.status.get()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "http_error",
      status: 401,
    });
  });

  it("policy override create → list → revoke lifecycle", async () => {
    gw = await startGateway();
    const client = authedClient(gw);

    // Create an override
    const created = await client.policy.createOverride({
      agent_id: defaultAgentId,
      tool_id: "bash",
      pattern: "*",
    });
    expect(created.override.status).toBe("active");
    expect(created.override.agent_id).toBe(defaultAgentId);
    const overrideId = created.override.policy_override_id;

    // List overrides — should include the created one
    const listed = await client.policy.listOverrides();
    expect(listed.overrides.length).toBeGreaterThanOrEqual(1);
    const found = listed.overrides.find((o) => o.policy_override_id === overrideId);
    expect(found).toBeDefined();

    // Revoke the override
    const revoked = await client.policy.revokeOverride({
      policy_override_id: overrideId,
    });
    expect(revoked.override.status).toBe("revoked");
  });
});
