import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayClient } from "./gateway-client";

describe("GatewayClient", () => {
  const baseUrl = "http://localhost:8080";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct headers without auth token", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.healthz();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/healthz",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );

    const callHeaders = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(callHeaders).not.toHaveProperty("Authorization");
  });

  it("includes Authorization header when token is provided", async () => {
    const client = new GatewayClient({ baseUrl, token: "test-token-123" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.healthz();

    const callHeaders = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(callHeaders.Authorization).toBe("Bearer test-token-123");
  });

  it("throws an error on non-ok response", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.healthz()).rejects.toThrow(
      "Gateway request failed: 502",
    );
  });

  it("sends POST with JSON body for agentTurn", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ reply: "hello" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = {
      channel: "web",
      thread_id: "t-1",
      message: "hi",
    };
    await client.agentTurn(req);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/agent/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(req),
      }),
    );
  });

  it("appends limit query parameter for getEvents", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.getEvents(10);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/memory/events?limit=10",
      expect.any(Object),
    );
  });

  it("fetches approval list via getApprovals", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockApprovals = [{ id: "appr-1", status: "pending" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ approvals: mockApprovals }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getApprovals();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/approvals",
      expect.any(Object),
    );
    expect(result).toEqual(mockApprovals);
  });

  it("fetches single approval via getApproval", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockApproval = { id: "appr-1", status: "pending" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ approval: mockApproval }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getApproval("appr-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/approvals/appr-1",
      expect.any(Object),
    );
    expect(result).toEqual(mockApproval);
  });

  it("sends POST with decision for respondToApproval", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockResponse = {
      id: "appr-1",
      status: "approved",
      responded_at: "2026-02-17T11:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ approval: mockResponse }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.respondToApproval("appr-1", "approved", "Looks good");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/approvals/appr-1/respond",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approved", reason: "Looks good" }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it("encodes approval ID in URL for getApproval", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "appr/special" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.getApproval("appr/special");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/approvals/appr%2Fspecial",
      expect.any(Object),
    );
  });

  it("fetches canvas metadata via getCanvasMeta", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockMeta = {
      id: "canvas-1",
      title: "Report",
      content_type: "text/html",
      created_at: "2026-02-17T10:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockMeta),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getCanvasMeta("canvas-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/canvas/canvas-1/meta",
      expect.any(Object),
    );
    expect(result).toEqual(mockMeta);
  });

  it("fetches canvas HTML as text via getCanvasHtml", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockHtml = "<h1>Hello</h1>";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(mockHtml),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getCanvasHtml("canvas-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/canvas/canvas-1",
      expect.any(Object),
    );
    expect(result).toBe(mockHtml);
  });

  it("throws on non-ok response for getCanvasHtml", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("not found"),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.getCanvasHtml("missing")).rejects.toThrow(
      "Gateway request failed: 404",
    );
  });

  it("fetches playbooks list via getPlaybooks", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockPlaybooks = [{ id: "pb-1", name: "Daily Report" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ playbooks: mockPlaybooks }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getPlaybooks();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/playbooks",
      expect.any(Object),
    );
    expect(result).toEqual(mockPlaybooks);
  });

  it("sends POST for runPlaybook", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockResult = { run_id: "run-1", status: "started", started_at: "2026-02-17T11:00:00Z" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResult),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.runPlaybook("pb-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/playbooks/pb-1/run",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(mockResult);
  });

  it("fetches watchers list via getWatchers", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockWatchers = [{ id: "w-1", active: true }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ watchers: mockWatchers }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getWatchers();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/watchers",
      expect.any(Object),
    );
    expect(result).toEqual(mockWatchers);
  });

  it("sends POST with body for createWatcher", async () => {
    const client = new GatewayClient({ baseUrl });
    const req = { trigger_type: "periodic" as const, trigger_config: { intervalMs: 60000 }, plan_id: "plan-1" };
    const mockWatcher = { id: "w-new", ...req, active: true, created_at: "2026-02-17T12:00:00Z" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.createWatcher(req);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/watchers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(req),
      }),
    );
    expect(result).toEqual(mockWatcher);
  });

  it("sends PATCH for toggleWatcher", async () => {
    const client = new GatewayClient({ baseUrl });
    const mockWatcher = { id: "w-1", active: false };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockWatcher),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.toggleWatcher("w-1", false);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/watchers/w-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(result).toEqual(mockWatcher);
  });

  it("sends DELETE for deleteWatcher", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(null),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.deleteWatcher("w-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/watchers/w-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("encodes watcher ID in URL for toggleWatcher", async () => {
    const client = new GatewayClient({ baseUrl });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "w/special", active: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.toggleWatcher("w/special", true);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/watchers/w%2Fspecial",
      expect.any(Object),
    );
  });
});
