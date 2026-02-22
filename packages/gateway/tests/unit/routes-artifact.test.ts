import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createArtifactRoutes } from "../../src/routes/artifact.js";

describe("artifact routes", () => {
  const sampleMeta = {
    id: "art-1",
    run_id: "run-1",
    step_id: "step-1",
    mime_type: "text/plain",
    agent_id: "agent-a",
    created_at: "2025-06-01T00:00:00Z",
  };

  function setup(overrides: {
    getById?: unknown;
    get?: unknown;
    listByRun?: unknown;
    listByStep?: unknown;
  } = {}) {
    const artifactMetadataDal = {
      getById: vi.fn().mockImplementation(async (_artifactId: string, agentId?: string) => {
        if ("getById" in overrides) return overrides.getById;
        return agentId === sampleMeta.agent_id ? sampleMeta : undefined;
      }),
      listByRun: vi.fn().mockResolvedValue("listByRun" in overrides ? overrides.listByRun : [sampleMeta]),
      listByStep: vi.fn().mockResolvedValue("listByStep" in overrides ? overrides.listByStep : [sampleMeta]),
    };
    const artifactStore = {
      get: vi.fn().mockResolvedValue("get" in overrides ? overrides.get : { body: Buffer.from("hello") }),
    };
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };
    const app = new Hono();
    app.route(
      "/",
      createArtifactRoutes({ artifactMetadataDal, artifactStore, eventPublisher } as never),
    );
    return { app, artifactMetadataDal, artifactStore, eventPublisher };
  }

  // --- GET /artifacts/:id (metadata) ---

  it("GET /artifacts/:id returns metadata", async () => {
    const { app } = setup();
    const res = await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-a" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: typeof sampleMeta };
    expect(body.artifact).toMatchObject({ id: "art-1", run_id: "run-1" });
  });

  it("GET /artifacts/:id returns 404 when not found", async () => {
    const { app } = setup({ getById: undefined });
    const res = await app.request("/artifacts/missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // --- GET /artifacts/:id?content=true ---

  it("GET /artifacts/:id?content=true streams content with correct Content-Type", async () => {
    const { app } = setup();
    const res = await app.request("/artifacts/art-1?content=true", {
      headers: { "X-Tyrum-Agent-Id": "agent-a" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    const text = await res.text();
    expect(text).toBe("hello");
  });

  it("GET /artifacts/:id?content=true returns 404 when blob not found", async () => {
    const { app } = setup({ get: undefined });
    const res = await app.request("/artifacts/art-1?content=true", {
      headers: { "X-Tyrum-Agent-Id": "agent-a" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("blob_not_found");
  });

  // --- Agent-id scoping ---

  it("GET /artifacts/:id with X-Tyrum-Agent-Id mismatch returns 404", async () => {
    const { app } = setup();
    const res = await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-b" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("GET /artifacts/:id with matching X-Tyrum-Agent-Id succeeds", async () => {
    const { app } = setup();
    const res = await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-a" },
    });
    expect(res.status).toBe(200);
  });

  // --- GET /artifacts (list) ---

  it("GET /artifacts?run_id=x lists by run", async () => {
    const { app, artifactMetadataDal } = setup();
    const res = await app.request("/artifacts?run_id=run-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(1);
    expect(artifactMetadataDal.listByRun).toHaveBeenCalledWith("run-1");
  });

  it("GET /artifacts?step_id=x lists by step", async () => {
    const { app, artifactMetadataDal } = setup();
    const res = await app.request("/artifacts?step_id=step-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(1);
    expect(artifactMetadataDal.listByStep).toHaveBeenCalledWith("step-1");
  });

  it("GET /artifacts returns 400 when no filter provided", async () => {
    const { app } = setup();
    const res = await app.request("/artifacts");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  // --- Event publisher ---

  it("calls eventPublisher.publish on artifact fetch", async () => {
    const { app, eventPublisher } = setup();
    await app.request("/artifacts/art-1", {
      headers: { "X-Tyrum-Agent-Id": "agent-a" },
    });
    // publish is fire-and-forget but should have been called
    expect(eventPublisher.publish).toHaveBeenCalledWith("artifact.fetched", {
      artifact_id: "art-1",
      run_id: "run-1",
    });
  });
});
