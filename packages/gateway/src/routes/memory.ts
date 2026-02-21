/**
 * Memory CRUD routes — facts, episodic events, capability memories.
 */

import { Hono } from "hono";
import type { MemoryDal } from "../modules/memory/dal.js";
import { scanForSecretPatterns } from "../modules/redaction/engine.js";

const secretScanEnabled = (() => {
  const raw = process.env["TYRUM_MEMORY_SECRET_SCAN"]?.trim().toLowerCase();
  if (!raw) return true; // default on
  return !["0", "false", "off", "no"].includes(raw);
})();

export function createMemoryRoutes(memoryDal: MemoryDal): Hono {
  const memory = new Hono();

  // --- Facts ---

  memory.get("/memory/facts", async (c) => {
    const facts = await memoryDal.getFacts();
    return c.json({ facts });
  });

  memory.post("/memory/facts", async (c) => {
    const body = (await c.req.json()) as {
      fact_key?: string;
      fact_value?: unknown;
      source?: string;
      observed_at?: string;
      confidence?: number;
    };

    const { fact_key, fact_value, source, observed_at, confidence } =
      body;

    if (
      !fact_key ||
      fact_value === undefined ||
      !source ||
      !observed_at ||
      confidence === undefined
    ) {
      return c.json(
        {
          error: "invalid_request",
          message:
            "fact_key, fact_value, source, observed_at, and confidence are required",
        },
        400,
      );
    }

    if (secretScanEnabled) {
      const textToScan = `${fact_key} ${JSON.stringify(fact_value)}`;
      const secretPatterns = scanForSecretPatterns(textToScan);
      if (secretPatterns.length > 0) {
        return c.json(
          {
            error: "secret_pattern_detected",
            message: `Potential secret patterns detected: ${secretPatterns.join(", ")}. Refusing to store.`,
            patterns: secretPatterns,
          },
          422,
        );
      }
    }

    const id = await memoryDal.insertFact(
      fact_key,
      fact_value,
      source,
      observed_at,
      confidence,
    );
    return c.json({ id }, 201);
  });

  memory.delete("/memory/facts/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json({ error: "invalid_id", message: "id must be a number" }, 400);
    }
    const deleted = await memoryDal.deleteFact(id);
    if (!deleted) {
      return c.json({ error: "not_found", message: "fact not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  // --- Episodic Events ---

  memory.get("/memory/events", async (c) => {
    const events = await memoryDal.getEpisodicEvents();
    return c.json({ events });
  });

  memory.post("/memory/events", async (c) => {
    const body = (await c.req.json()) as {
      event_id?: string;
      occurred_at?: string;
      channel?: string;
      event_type?: string;
      payload?: unknown;
    };

    const { event_id, occurred_at, channel, event_type, payload } =
      body;

    if (
      !event_id ||
      !occurred_at ||
      !channel ||
      !event_type ||
      payload === undefined
    ) {
      return c.json(
        {
          error: "invalid_request",
          message:
            "event_id, occurred_at, channel, event_type, and payload are required",
        },
        400,
      );
    }

    if (secretScanEnabled) {
      const textToScan = `${event_type} ${JSON.stringify(payload)}`;
      const secretPatterns = scanForSecretPatterns(textToScan);
      if (secretPatterns.length > 0) {
        return c.json(
          {
            error: "secret_pattern_detected",
            message: `Potential secret patterns detected: ${secretPatterns.join(", ")}. Refusing to store.`,
            patterns: secretPatterns,
          },
          422,
        );
      }
    }

    const id = await memoryDal.insertEpisodicEvent(
      event_id,
      occurred_at,
      channel,
      event_type,
      payload,
    );
    return c.json({ id }, 201);
  });

  memory.delete("/memory/events/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json({ error: "invalid_id", message: "id must be a number" }, 400);
    }
    const deleted = await memoryDal.deleteEpisodicEvent(id);
    if (!deleted) {
      return c.json({ error: "not_found", message: "event not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  // --- Capability Memories ---

  memory.get("/memory/capabilities", async (c) => {
    const capabilityType = c.req.query("capability_type");
    const capabilities = await memoryDal.getCapabilityMemories(capabilityType);
    return c.json({ capabilities });
  });

  memory.post("/memory/capabilities", async (c) => {
    const body = (await c.req.json()) as {
      capability_type?: string;
      capability_identifier?: string;
      executor_kind?: string;
      data?: {
        selectors?: unknown;
        outcomeMetadata?: unknown;
        costProfile?: unknown;
        antiBotNotes?: string;
        resultSummary?: string;
        lastSuccessAt?: string;
        metadata?: unknown;
      };
    };

    const {
      capability_type,
      capability_identifier,
      executor_kind,
      data,
    } = body;

    if (
      !capability_type ||
      !capability_identifier ||
      !executor_kind
    ) {
      return c.json(
        {
          error: "invalid_request",
          message:
            "capability_type, capability_identifier, and executor_kind are required",
        },
        400,
      );
    }

    const result = await memoryDal.upsertCapabilityMemory(
      capability_type,
      capability_identifier,
      executor_kind,
      data ?? {},
    );
    return c.json(result, 201);
  });

  memory.delete("/memory/capabilities/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json({ error: "invalid_id", message: "id must be a number" }, 400);
    }
    const deleted = await memoryDal.deleteCapabilityMemory(id);
    if (!deleted) {
      return c.json({ error: "not_found", message: "capability not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  return memory;
}
