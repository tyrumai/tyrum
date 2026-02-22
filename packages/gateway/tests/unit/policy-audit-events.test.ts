import { describe, it, expect, vi } from "vitest";
import { SlashCommandRegistry } from "../../src/ws/slash-commands.js";
import { PolicyBundleManager } from "../../src/modules/policy/bundle.js";
import type { EventPublisher } from "../../src/modules/backplane/event-publisher.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockEventPublisher(): EventPublisher & { calls: Array<{ kind: string; payload: unknown }> } {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  return {
    calls,
    publish: vi.fn(async (kind: string, payload: unknown) => {
      calls.push({ kind, payload });
      return "mock-event-id";
    }),
  };
}

function createDenyPolicy(domain: string): PolicyBundleManager {
  const mgr = new PolicyBundleManager();
  mgr.addBundle({
    rules: [{ domain, action: "deny", priority: 0, description: `Deny ${domain}` }],
    precedence: "deployment",
  });
  return mgr;
}

function createAllowPolicy(): PolicyBundleManager {
  return new PolicyBundleManager(); // no rules => allow
}

/* ------------------------------------------------------------------ */
/*  9a: Slash command policy blocking                                   */
/* ------------------------------------------------------------------ */

describe("slash command policy gate", () => {
  it("blocks non-readonly commands when policy denies", async () => {
    const registry = new SlashCommandRegistry();
    registry.register("deploy", async () => ({ output: "deployed" }), "Deploy app");

    const policy = createDenyPolicy("commands");
    const result = await registry.execute("/deploy", "client-1", { policyBundleManager: policy });

    expect(result.output).toBe("Command /deploy blocked by policy");
  });

  it("allows readonly commands even when policy denies", async () => {
    const registry = new SlashCommandRegistry();
    registry.register("help", async () => ({ output: "help text" }), "Show help", { readonly: true });

    const policy = createDenyPolicy("commands");
    const result = await registry.execute("/help", "client-1", { policyBundleManager: policy });

    expect(result.output).toBe("help text");
  });

  it("allows non-readonly commands when no policy manager is provided", async () => {
    const registry = new SlashCommandRegistry();
    registry.register("deploy", async () => ({ output: "deployed" }), "Deploy app");

    const result = await registry.execute("/deploy", "client-1");
    expect(result.output).toBe("deployed");
  });

  it("allows non-readonly commands when policy allows", async () => {
    const registry = new SlashCommandRegistry();
    registry.register("deploy", async () => ({ output: "deployed" }), "Deploy app");

    const policy = createAllowPolicy();
    const result = await registry.execute("/deploy", "client-1", { policyBundleManager: policy });

    expect(result.output).toBe("deployed");
  });
});

/* ------------------------------------------------------------------ */
/*  9d: Artifact agent_id scoping                                      */
/* ------------------------------------------------------------------ */

describe("artifact agent_id scoping", () => {
  // We test the logic inline — a minimal Hono test
  // Import the route factory and create a test app
  it("returns 404 when agent_id mismatches", async () => {
    const { createArtifactRoutes } = await import("../../src/routes/artifact.js");
    const { Hono } = await import("hono");

    const mockMeta = {
      artifact_id: "art-1",
      run_id: "run-1",
      agent_id: "agent-alpha",
      mime_type: "text/plain",
    };

    const app = new Hono();
    app.route(
      "/",
      createArtifactRoutes({
        artifactMetadataDal: {
          getById: vi.fn().mockImplementation(async (_artifactId: string, agentId?: string) => {
            return agentId === "agent-alpha" ? mockMeta : undefined;
          }),
          listByRun: vi.fn().mockResolvedValue([]),
          listByStep: vi.fn().mockResolvedValue([]),
        } as any,
        artifactStore: {
          get: vi.fn(),
          put: vi.fn(),
        } as any,
      }),
    );

    const resp = await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-beta" },
    });

    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("passes when agent_id matches", async () => {
    const { createArtifactRoutes } = await import("../../src/routes/artifact.js");
    const { Hono } = await import("hono");

    const mockMeta = {
      artifact_id: "art-1",
      run_id: "run-1",
      agent_id: "agent-alpha",
      mime_type: "text/plain",
    };

    const app = new Hono();
    app.route(
      "/",
      createArtifactRoutes({
        artifactMetadataDal: {
          getById: vi.fn().mockImplementation(async (_artifactId: string, agentId?: string) => {
            return agentId === "agent-alpha" ? mockMeta : undefined;
          }),
          listByRun: vi.fn().mockResolvedValue([]),
          listByStep: vi.fn().mockResolvedValue([]),
        } as any,
        artifactStore: {
          get: vi.fn(),
          put: vi.fn(),
        } as any,
      }),
    );

    const resp = await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-alpha" },
    });

    expect(resp.status).toBe(200);
  });

  it("passes when no agent_id header is present", async () => {
    const { createArtifactRoutes } = await import("../../src/routes/artifact.js");
    const { Hono } = await import("hono");

    const mockMeta = {
      artifact_id: "art-1",
      run_id: "run-1",
      agent_id: "agent-alpha",
    };

    const app = new Hono();
    app.route(
      "/",
      createArtifactRoutes({
        artifactMetadataDal: {
          getById: vi.fn().mockImplementation(async (_artifactId: string, agentId?: string) => {
            return agentId === "agent-alpha" ? mockMeta : undefined;
          }),
          listByRun: vi.fn().mockResolvedValue([]),
          listByStep: vi.fn().mockResolvedValue([]),
        } as any,
        artifactStore: {
          get: vi.fn(),
          put: vi.fn(),
        } as any,
      }),
    );

    const resp = await app.request("/artifacts/art-1");
    expect(resp.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/*  9f: Secret event emissions                                         */
/* ------------------------------------------------------------------ */

describe("secret audit events", () => {
  it("emits secret.revoked on DELETE", async () => {
    const { createSecretRoutes } = await import("../../src/routes/secret.js");
    const { Hono } = await import("hono");
    const publisher = createMockEventPublisher();

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProvider: {
          store: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          resolve: vi.fn(),
          revoke: vi.fn().mockResolvedValue(true),
        } as any,
        eventPublisher: publisher,
      }),
    );

    const resp = await app.request("/secrets/handle-123", { method: "DELETE" });
    expect(resp.status).toBe(200);

    // Wait for fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(publisher.calls).toContainEqual({
      kind: "secret.revoked",
      payload: { handle_id: "handle-123" },
    });
  });

  it("emits secret.rotated on POST /:id/rotate", async () => {
    const { createSecretRoutes } = await import("../../src/routes/secret.js");
    const { Hono } = await import("hono");
    const publisher = createMockEventPublisher();

    const mockProvider = {
      store: vi.fn().mockResolvedValue({ handle_id: "new-handle", scope: "test" }),
      list: vi.fn().mockResolvedValue([{ handle_id: "old-handle", scope: "test" }]),
      resolve: vi.fn(),
      revoke: vi.fn().mockResolvedValue(true),
    };

    const app = new Hono();
    app.route(
      "/",
      createSecretRoutes({
        secretProvider: mockProvider as any,
        eventPublisher: publisher,
      }),
    );

    const resp = await app.request("/secrets/old-handle/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new-secret-value" }),
    });

    expect(resp.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));
    expect(publisher.calls).toContainEqual({
      kind: "secret.rotated",
      payload: {
        old_handle_id: "old-handle",
        new_handle_id: "new-handle",
        scope: "test",
      },
    });
  });
});

/* ------------------------------------------------------------------ */
/*  9h: Auth profile event emissions                                   */
/* ------------------------------------------------------------------ */

describe("auth profile audit events", () => {
  it("emits auth_profile.created on POST", async () => {
    const { createModelRoutes } = await import("../../src/routes/model.js");
    const { Hono } = await import("hono");
    const publisher = createMockEventPublisher();

    const app = new Hono();
    app.route(
      "/",
      createModelRoutes({
        authProfileDal: {
          create: vi.fn().mockResolvedValue({ profile_id: "p-1", provider: "openai" }),
          listAll: vi.fn().mockResolvedValue([]),
          getById: vi.fn(),
          deactivate: vi.fn(),
        } as any,
        eventPublisher: publisher,
      }),
    );

    const resp = await app.request("/model/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai" }),
    });

    expect(resp.status).toBe(201);
    await new Promise((r) => setTimeout(r, 10));

    const created = publisher.calls.find((c) => c.kind === "auth_profile.created");
    expect(created).toBeDefined();
    expect((created!.payload as any).provider).toBe("openai");
  });

  it("emits auth_profile.updated on POST /:id/rotate", async () => {
    const { createModelRoutes } = await import("../../src/routes/model.js");
    const { Hono } = await import("hono");
    const publisher = createMockEventPublisher();

    const app = new Hono();
    app.route(
      "/",
      createModelRoutes({
        authProfileDal: {
          create: vi.fn(),
          listAll: vi.fn(),
          getById: vi.fn().mockResolvedValue({ profile_id: "p-1", provider: "openai" }),
          deactivate: vi.fn(),
        } as any,
        eventPublisher: publisher,
      }),
    );

    const resp = await app.request("/model/profiles/p-1/rotate", { method: "POST" });
    expect(resp.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    const updated = publisher.calls.find((c) => c.kind === "auth_profile.updated");
    expect(updated).toBeDefined();
    expect((updated!.payload as any).action).toBe("rotated");
  });

  it("emits auth_profile.deleted on DELETE", async () => {
    const { createModelRoutes } = await import("../../src/routes/model.js");
    const { Hono } = await import("hono");
    const publisher = createMockEventPublisher();

    const app = new Hono();
    app.route(
      "/",
      createModelRoutes({
        authProfileDal: {
          create: vi.fn(),
          listAll: vi.fn(),
          getById: vi.fn(),
          deactivate: vi.fn(),
        } as any,
        eventPublisher: publisher,
      }),
    );

    const resp = await app.request("/model/profiles/p-1", { method: "DELETE" });
    expect(resp.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    const deleted = publisher.calls.find((c) => c.kind === "auth_profile.deleted");
    expect(deleted).toBeDefined();
    expect((deleted!.payload as any).profile_id).toBe("p-1");
  });
});
