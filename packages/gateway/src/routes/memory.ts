/**
 * Memory CRUD routes — facts, episodic events, capability memories.
 */

import { Hono } from "hono";
import type { MemoryDal } from "../modules/memory/dal.js";

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

    const id = await memoryDal.insertFact(
      fact_key,
      fact_value,
      source,
      observed_at,
      confidence,
    );
    return c.json({ id }, 201);
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

    const id = await memoryDal.insertEpisodicEvent(
      event_id,
      occurred_at,
      channel,
      event_type,
      payload,
    );
    return c.json({ id }, 201);
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

  return memory;
}
