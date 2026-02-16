/**
 * Memory CRUD routes — facts, episodic events, capability memories.
 */

import { Hono } from "hono";
import type { MemoryDal } from "../modules/memory/dal.js";

export function createMemoryRoutes(memoryDal: MemoryDal): Hono {
  const memory = new Hono();

  // --- Facts ---

  memory.get("/memory/facts/:subjectId", (c) => {
    const subjectId = c.req.param("subjectId");
    const facts = memoryDal.getFacts(subjectId);
    return c.json({ facts });
  });

  memory.post("/memory/facts", async (c) => {
    const body = (await c.req.json()) as {
      subject_id?: string;
      fact_key?: string;
      fact_value?: unknown;
      source?: string;
      observed_at?: string;
      confidence?: number;
    };

    const { subject_id, fact_key, fact_value, source, observed_at, confidence } =
      body;

    if (
      !subject_id ||
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
            "subject_id, fact_key, fact_value, source, observed_at, and confidence are required",
        },
        400,
      );
    }

    const id = memoryDal.insertFact(
      subject_id,
      fact_key,
      fact_value,
      source,
      observed_at,
      confidence,
    );
    return c.json({ id }, 201);
  });

  // --- Episodic Events ---

  memory.get("/memory/events/:subjectId", (c) => {
    const subjectId = c.req.param("subjectId");
    const events = memoryDal.getEpisodicEvents(subjectId);
    return c.json({ events });
  });

  memory.post("/memory/events", async (c) => {
    const body = (await c.req.json()) as {
      subject_id?: string;
      event_id?: string;
      occurred_at?: string;
      channel?: string;
      event_type?: string;
      payload?: unknown;
    };

    const { subject_id, event_id, occurred_at, channel, event_type, payload } =
      body;

    if (
      !subject_id ||
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
            "subject_id, event_id, occurred_at, channel, event_type, and payload are required",
        },
        400,
      );
    }

    const id = memoryDal.insertEpisodicEvent(
      subject_id,
      event_id,
      occurred_at,
      channel,
      event_type,
      payload,
    );
    return c.json({ id }, 201);
  });

  // --- Capability Memories ---

  memory.get("/memory/capabilities/:subjectId", (c) => {
    const subjectId = c.req.param("subjectId");
    const capabilityType = c.req.query("capability_type");
    const capabilities = memoryDal.getCapabilityMemories(
      subjectId,
      capabilityType,
    );
    return c.json({ capabilities });
  });

  memory.post("/memory/capabilities", async (c) => {
    const body = (await c.req.json()) as {
      subject_id?: string;
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
      subject_id,
      capability_type,
      capability_identifier,
      executor_kind,
      data,
    } = body;

    if (
      !subject_id ||
      !capability_type ||
      !capability_identifier ||
      !executor_kind
    ) {
      return c.json(
        {
          error: "invalid_request",
          message:
            "subject_id, capability_type, capability_identifier, and executor_kind are required",
        },
        400,
      );
    }

    const result = memoryDal.upsertCapabilityMemory(
      subject_id,
      capability_type,
      capability_identifier,
      executor_kind,
      data ?? {},
    );
    return c.json(result, 201);
  });

  return memory;
}
