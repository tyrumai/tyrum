/**
 * Memory CRUD routes — facts, episodic events, capability memories.
 */

import { Hono } from "hono";
import type { MemoryDal } from "../modules/memory/dal.js";

function looksLikeSecret(value: unknown): boolean {
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return "";
          }
        })();
  if (!text) return false;

  if (text.includes("secret:")) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) return true;
  if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) return true;
  return false;
}

export function createMemoryRoutes(memoryDal: MemoryDal): Hono {
  const memory = new Hono();

  const agentIdFromReq = (c: {
    req: {
      query: (key: string) => string | undefined;
      header: (key: string) => string | undefined;
    };
  }): string => {
    return c.req.query("agent_id")?.trim() || c.req.header("x-tyrum-agent-id")?.trim() || "default";
  };

  // --- Facts ---

  memory.get("/memory/facts", async (c) => {
    const facts = await memoryDal.getFacts(agentIdFromReq(c));
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

    const { fact_key, fact_value, source, observed_at, confidence } = body;

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
          message: "fact_key, fact_value, source, observed_at, and confidence are required",
        },
        400,
      );
    }

    if (looksLikeSecret(fact_value)) {
      return c.json(
        {
          error: "invalid_request",
          message: "refusing to store secret-like values in durable memory",
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
      agentIdFromReq(c),
    );
    return c.json({ id }, 201);
  });

  // --- Episodic Events ---

  memory.get("/memory/events", async (c) => {
    const events = await memoryDal.getEpisodicEvents(100, agentIdFromReq(c));
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

    const { event_id, occurred_at, channel, event_type, payload } = body;

    if (!event_id || !occurred_at || !channel || !event_type || payload === undefined) {
      return c.json(
        {
          error: "invalid_request",
          message: "event_id, occurred_at, channel, event_type, and payload are required",
        },
        400,
      );
    }

    if (looksLikeSecret(payload)) {
      return c.json(
        {
          error: "invalid_request",
          message: "refusing to store secret-like values in durable memory",
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
      agentIdFromReq(c),
    );
    return c.json({ id }, 201);
  });

  // --- Capability Memories ---

  memory.get("/memory/capabilities", async (c) => {
    const capabilityType = c.req.query("capability_type");
    const capabilities = await memoryDal.getCapabilityMemories(capabilityType, agentIdFromReq(c));
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

    const { capability_type, capability_identifier, executor_kind, data } = body;

    if (!capability_type || !capability_identifier || !executor_kind) {
      return c.json(
        {
          error: "invalid_request",
          message: "capability_type, capability_identifier, and executor_kind are required",
        },
        400,
      );
    }

    if (looksLikeSecret(data)) {
      return c.json(
        {
          error: "invalid_request",
          message: "refusing to store secret-like values in durable memory",
        },
        400,
      );
    }

    const result = await memoryDal.upsertCapabilityMemory(
      capability_type,
      capability_identifier,
      executor_kind,
      data ?? {},
      agentIdFromReq(c),
    );
    return c.json(result, 201);
  });

  // --- Forget ---

  memory.post("/memory/forget", async (c) => {
    const body = (await c.req.json()) as {
      confirm?: string;
      fact_key?: string;
      event_id?: string;
      capability_id?: number;
      embedding_id?: string;
      pam_profile_id?: string;
      pvp_profile_id?: string;
    };

    if (body.confirm !== "FORGET") {
      return c.json({ error: "invalid_request", message: "confirm must be 'FORGET'" }, 400);
    }

    const deleted: Record<string, number> = {};

    if (typeof body.fact_key === "string" && body.fact_key.trim().length > 0) {
      deleted.facts = await memoryDal.forgetFactsByKey(body.fact_key.trim(), agentIdFromReq(c));
    }
    if (typeof body.event_id === "string" && body.event_id.trim().length > 0) {
      deleted.episodic_events = await memoryDal.forgetEpisodicEventByEventId(
        body.event_id.trim(),
        agentIdFromReq(c),
      );
    }
    if (typeof body.capability_id === "number" && Number.isFinite(body.capability_id)) {
      deleted.capability_memories = await memoryDal.forgetCapabilityMemoryById(
        Math.floor(body.capability_id),
        agentIdFromReq(c),
      );
    }
    if (typeof body.embedding_id === "string" && body.embedding_id.trim().length > 0) {
      deleted.vector_metadata = await memoryDal.forgetVectorMetadataByEmbeddingId(
        body.embedding_id.trim(),
        agentIdFromReq(c),
      );
    }
    if (typeof body.pam_profile_id === "string" && body.pam_profile_id.trim().length > 0) {
      deleted.pam_profiles = await memoryDal.forgetPamProfile(
        body.pam_profile_id.trim(),
        agentIdFromReq(c),
      );
    }
    if (typeof body.pvp_profile_id === "string" && body.pvp_profile_id.trim().length > 0) {
      deleted.pvp_profiles = await memoryDal.forgetPvpProfile(
        body.pvp_profile_id.trim(),
        agentIdFromReq(c),
      );
    }

    if (Object.keys(deleted).length === 0) {
      return c.json(
        {
          error: "invalid_request",
          message:
            "provide at least one selector (fact_key, event_id, capability_id, embedding_id, pam_profile_id, pvp_profile_id)",
        },
        400,
      );
    }

    return c.json({
      status: "ok",
      deleted,
    });
  });

  return memory;
}
