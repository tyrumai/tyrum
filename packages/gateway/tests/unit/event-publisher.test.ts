import { describe, expect, it, vi } from "vitest";
import { EventPublisher, GATEWAY_EVENT_TOPIC } from "../../src/modules/backplane/event-publisher.js";

describe("EventPublisher", () => {
  function mockOutboxDal() {
    return {
      enqueue: vi.fn().mockResolvedValue({
        id: 1,
        topic: GATEWAY_EVENT_TOPIC,
        target_edge_id: null,
        payload: {},
        created_at: new Date().toISOString(),
      }),
    };
  }

  it("publishes event with generated event_id", async () => {
    const dal = mockOutboxDal();
    const publisher = new EventPublisher(dal as any);

    const eventId = await publisher.publish("run.started", { run_id: "abc" });

    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(dal.enqueue).toHaveBeenCalledOnce();
    expect(dal.enqueue).toHaveBeenCalledWith(
      GATEWAY_EVENT_TOPIC,
      expect.objectContaining({
        event_id: eventId,
        kind: "run.started",
        payload: { run_id: "abc" },
      }),
      { targetEdgeId: null },
    );
  });

  it("passes targetEdgeId when provided", async () => {
    const dal = mockOutboxDal();
    const publisher = new EventPublisher(dal as any);

    await publisher.publish("presence.online", {}, { targetEdgeId: "edge-1" });

    expect(dal.enqueue).toHaveBeenCalledWith(
      GATEWAY_EVENT_TOPIC,
      expect.any(Object),
      { targetEdgeId: "edge-1" },
    );
  });

  it("includes occurred_at in ISO format", async () => {
    const dal = mockOutboxDal();
    const publisher = new EventPublisher(dal as any);

    await publisher.publish("step.completed", {});

    const envelope = dal.enqueue.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(typeof envelope.occurred_at).toBe("string");
    expect(() => new Date(envelope.occurred_at as string)).not.toThrow();
  });
});
