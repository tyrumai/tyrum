import { describe, expect, it, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";

describe("Memory CRUD routes", () => {
  let app: Hono;

  beforeEach(() => {
    const result = createTestApp();
    app = result.app;
  });

  describe("Facts", () => {
    it("creates and retrieves a fact", async () => {
      const createRes = await app.request("/memory/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: "sub-1",
          fact_key: "name",
          fact_value: "Alice",
          source: "user",
          observed_at: "2025-01-15T10:00:00Z",
          confidence: 0.9,
        }),
      });

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: number };
      expect(created.id).toBeGreaterThan(0);

      const getRes = await app.request("/memory/facts/sub-1");
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as {
        facts: Array<{ fact_key: string; fact_value: unknown }>;
      };
      expect(body.facts.length).toBe(1);
      expect(body.facts[0]!.fact_key).toBe("name");
      expect(body.facts[0]!.fact_value).toBe("Alice");
    });

    it("returns empty array for unknown subject", async () => {
      const res = await app.request("/memory/facts/unknown");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { facts: unknown[] };
      expect(body.facts).toEqual([]);
    });

    it("returns 400 for incomplete fact", async () => {
      const res = await app.request("/memory/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_id: "sub-1" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Episodic events", () => {
    it("creates and retrieves an event", async () => {
      const createRes = await app.request("/memory/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: "sub-1",
          event_id: "evt-1",
          occurred_at: "2025-01-15T10:00:00Z",
          channel: "telegram",
          event_type: "message",
          payload: { text: "hello" },
        }),
      });

      expect(createRes.status).toBe(201);

      const getRes = await app.request("/memory/events/sub-1");
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as {
        events: Array<{
          event_id: string;
          payload: unknown;
        }>;
      };
      expect(body.events.length).toBe(1);
      expect(body.events[0]!.event_id).toBe("evt-1");
      expect(body.events[0]!.payload).toEqual({ text: "hello" });
    });
  });

  describe("Capability memories", () => {
    it("creates and retrieves a capability memory", async () => {
      const createRes = await app.request("/memory/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: "sub-1",
          capability_type: "web_scrape",
          capability_identifier: "example.com",
          executor_kind: "playwright",
          data: {
            selectors: { title: "h1" },
            resultSummary: "Scraped successfully",
          },
        }),
      });

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        inserted: boolean;
        successCount: number;
      };
      expect(created.inserted).toBe(true);
      expect(created.successCount).toBe(1);

      const getRes = await app.request("/memory/capabilities/sub-1");
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as {
        capabilities: Array<{
          capability_type: string;
          selectors: unknown;
        }>;
      };
      expect(body.capabilities.length).toBe(1);
      expect(body.capabilities[0]!.capability_type).toBe("web_scrape");
    });

    it("upserts capability memory and increments count", async () => {
      const base = {
        subject_id: "sub-1",
        capability_type: "web_scrape",
        capability_identifier: "example.com",
        executor_kind: "playwright",
      };

      await app.request("/memory/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
      });

      const res = await app.request("/memory/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        inserted: boolean;
        successCount: number;
      };
      expect(body.inserted).toBe(false);
      expect(body.successCount).toBe(2);
    });
  });
});
