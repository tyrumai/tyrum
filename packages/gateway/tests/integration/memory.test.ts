import { describe, expect, it, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";

describe("Memory CRUD routes", () => {
  let app: Hono;

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  describe("Facts", () => {
    it("creates and retrieves a fact", async () => {
      const createRes = await app.request("/memory/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

      const getRes = await app.request("/memory/facts");
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as {
        facts: Array<{ fact_key: string; fact_value: unknown }>;
      };
      expect(body.facts.length).toBe(1);
      expect(body.facts[0]!.fact_key).toBe("name");
      expect(body.facts[0]!.fact_value).toBe("Alice");
    });

    it("scopes facts by agent_id", async () => {
      const createA = await app.request("/memory/facts?agent_id=agent-a", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fact_key: "name",
          fact_value: "Alice",
          source: "user",
          observed_at: "2025-01-15T10:00:00Z",
          confidence: 0.9,
        }),
      });
      expect(createA.status).toBe(201);

      const createB = await app.request("/memory/facts?agent_id=agent-b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fact_key: "name",
          fact_value: "Bob",
          source: "user",
          observed_at: "2025-01-15T10:00:00Z",
          confidence: 0.9,
        }),
      });
      expect(createB.status).toBe(201);

      const getA = await app.request("/memory/facts?agent_id=agent-a");
      expect(getA.status).toBe(200);
      const bodyA = (await getA.json()) as {
        facts: Array<{ fact_key: string; fact_value: unknown }>;
      };
      expect(bodyA.facts).toHaveLength(1);
      expect(bodyA.facts[0]!.fact_value).toBe("Alice");

      const getB = await app.request("/memory/facts?agent_id=agent-b");
      expect(getB.status).toBe(200);
      const bodyB = (await getB.json()) as {
        facts: Array<{ fact_key: string; fact_value: unknown }>;
      };
      expect(bodyB.facts).toHaveLength(1);
      expect(bodyB.facts[0]!.fact_value).toBe("Bob");
    });

    it("returns empty array when no facts exist", async () => {
      const res = await app.request("/memory/facts");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { facts: unknown[] };
      expect(body.facts).toEqual([]);
    });

    it("returns 400 for incomplete fact", async () => {
      const res = await app.request("/memory/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact_key: "name" }),
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
          event_id: "evt-1",
          occurred_at: "2025-01-15T10:00:00Z",
          channel: "telegram",
          event_type: "message",
          payload: { text: "hello" },
        }),
      });

      expect(createRes.status).toBe(201);

      const getRes = await app.request("/memory/events");
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

      const getRes = await app.request("/memory/capabilities");
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
