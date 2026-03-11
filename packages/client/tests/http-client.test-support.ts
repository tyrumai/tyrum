import { expect, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTyrumHttpClient, type TyrumHttpFetch } from "../src/index.js";

const clientApiPaths = [
  "authTokens.list",
  "authTokens.issue",
  "authTokens.revoke",
  "deviceTokens.issue",
  "deviceTokens.revoke",
  "secrets.store",
  "secrets.list",
  "secrets.revoke",
  "secrets.rotate",
  "policy.getBundle",
  "policy.listOverrides",
  "policy.createOverride",
  "policy.revokeOverride",
  "authProfiles.list",
  "authProfiles.create",
  "authProfiles.update",
  "authProfiles.disable",
  "authProfiles.enable",
  "authPins.list",
  "authPins.set",
  "plugins.list",
  "plugins.get",
  "contracts.getCatalog",
  "contracts.getSchema",
  "models.status",
  "models.refresh",
  "models.listProviders",
  "models.getProvider",
  "models.listProviderModels",
  "providerConfig.listRegistry",
  "providerConfig.listProviders",
  "providerConfig.createAccount",
  "providerConfig.updateAccount",
  "providerConfig.deleteAccount",
  "providerConfig.deleteProvider",
  "modelConfig.listPresets",
  "modelConfig.listAvailable",
  "modelConfig.createPreset",
  "modelConfig.updatePreset",
  "modelConfig.deletePreset",
  "modelConfig.listAssignments",
  "modelConfig.updateAssignments",
  "status.get",
  "usage.get",
  "presence.list",
  "pairings.list",
  "pairings.approve",
  "pairings.deny",
  "pairings.revoke",
] as const;

const adminApiPaths = [
  "agentConfig.list",
  "agentConfig.get",
  "agentConfig.update",
  "agentList.get",
  "agentStatus.get",
  "routingConfig.get",
  "routingConfig.listRevisions",
  "routingConfig.listObservedTelegramThreads",
  "routingConfig.getTelegramConfig",
  "routingConfig.update",
  "routingConfig.updateTelegramConfig",
  "routingConfig.revert",
  "audit.listPlans",
  "audit.exportReceiptBundle",
  "audit.verify",
  "audit.forget",
  "context.get",
  "context.list",
  "context.detail",
  "artifacts.getMetadata",
  "artifacts.getBytes",
  "health.get",
  "toolRegistry.list",
  "extensions.list",
  "extensions.get",
  "extensions.importSkill",
  "extensions.uploadSkill",
  "extensions.importMcp",
  "extensions.uploadMcp",
  "extensions.toggle",
  "extensions.revert",
  "extensions.refresh",
] as const;

type MockTyrumHttpFetch = TyrumHttpFetch & ReturnType<typeof vi.fn>;
type TestClientOptions = Partial<Parameters<typeof createTyrumHttpClient>[0]>;

function readPath(target: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, target);
}

export function expectApiSurface(client: ReturnType<typeof createTyrumHttpClient>): void {
  for (const path of clientApiPaths) {
    expect(typeof readPath(client, path)).toBe("function");
  }

  const admin = client as unknown as Record<string, unknown>;
  for (const path of adminApiPaths) {
    expect(typeof readPath(admin, path)).toBe("function");
  }
}

export function createTestClient(options: TestClientOptions = {}) {
  return createTyrumHttpClient({
    baseUrl: "https://gateway.example",
    auth: { type: "bearer", token: "root-token" },
    ...options,
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function getHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

export function makeFetchMock(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
): MockTyrumHttpFetch {
  return vi.fn(impl) as unknown as MockTyrumHttpFetch;
}

export function mockJsonFetch(body: unknown, status = 200): MockTyrumHttpFetch {
  return makeFetchMock(async () => jsonResponse(body, status));
}

export function samplePairing(): Record<string, unknown> {
  const now = "2026-02-25T12:00:00.000Z";
  return {
    pairing_id: 7,
    status: "approved",
    trust_level: "local",
    requested_at: now,
    node: {
      node_id: "node-1",
      label: "Node 1",
      capabilities: ["http"],
      last_seen_at: now,
    },
    capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
    resolution: {
      decision: "approved",
      resolved_at: now,
      reason: "approved by operator",
    },
    resolved_at: now,
  };
}

export function sampleAuthProfile(): Record<string, unknown> {
  return {
    auth_profile_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    auth_profile_key: "openai-default",
    provider_key: "openai",
    type: "api_key",
    secret_keys: {},
    labels: {},
    status: "active",
    created_at: "2026-02-25T00:00:00.000Z",
    updated_at: "2026-02-25T00:00:00.000Z",
  };
}
