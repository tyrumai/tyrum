import type { SqlDb } from "../../statestore/types.js";
import { resolveAgentId, withAgentScope } from "../agent/agent-scope.js";

// --- Row types returned by queries ---

export interface FactRow {
  id: number;
  fact_key: string;
  fact_value: unknown;
  source: string;
  observed_at: string;
  confidence: number;
  created_at: string;
}

export interface EpisodicEventRow {
  id: number;
  event_id: string;
  occurred_at: string;
  channel: string;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface CapabilityMemoryRow {
  id: number;
  capability_type: string;
  capability_identifier: string;
  executor_kind: string;
  selectors: unknown | null;
  outcome_metadata: unknown | null;
  cost_profile: unknown | null;
  anti_bot_notes: string | null;
  result_summary: string | null;
  success_count: number;
  last_success_at: string | null;
  metadata: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface CapabilityMemoryData {
  selectors?: unknown;
  outcomeMetadata?: unknown;
  costProfile?: unknown;
  antiBotNotes?: string;
  resultSummary?: string;
  lastSuccessAt?: string;
  metadata?: unknown;
}

export interface ProfileRow {
  id: number;
  profile_id: string;
  version: string | null;
  profile_data: unknown;
  created_at: string;
  updated_at: string;
}

// --- Raw row types from SQLite (JSON fields stored as TEXT) ---

interface RawFactRow {
  id: number;
  fact_key: string;
  fact_value: string;
  source: string;
  observed_at: string;
  confidence: number;
  created_at: string | Date;
}

interface RawEpisodicEventRow {
  id: number;
  event_id: string;
  occurred_at: string;
  channel: string;
  event_type: string;
  payload: string;
  created_at: string | Date;
}

interface RawCapabilityMemoryRow {
  id: number;
  capability_type: string;
  capability_identifier: string;
  executor_kind: string;
  selectors: string | null;
  outcome_metadata: string | null;
  cost_profile: string | null;
  anti_bot_notes: string | null;
  result_summary: string | null;
  success_count: number;
  last_success_at: string | null;
  metadata: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawProfileRow {
  id: number;
  profile_id: string;
  version: string | null;
  profile_data: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseJsonField(raw: string | null): unknown | null {
  if (raw === null) return null;
  return JSON.parse(raw) as unknown;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class MemoryDal {
  constructor(private db: SqlDb) {}

  // --- Facts ---

  async insertFact(
    factKey: string,
    factValue: unknown,
    source: string,
    observedAt: string,
    confidence: number,
    agentId?: string,
  ): Promise<number> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO facts (fact_key, fact_value, source, observed_at, confidence, created_at, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        factKey,
        JSON.stringify(factValue),
        source,
        observedAt,
        confidence,
        nowIso,
        resolveAgentId(agentId),
      ],
    );
    if (!row) {
      throw new Error("failed to insert fact");
    }
    return Number(row.id);
  }

  async getFacts(agentId?: string): Promise<FactRow[]> {
    const base = withAgentScope(
      "SELECT * FROM facts",
      agentId ?? "",
      [],
    );
    const rows = await this.db.all<RawFactRow>(
      `${base.query} ORDER BY observed_at DESC`,
      base.params,
    );
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  async getFactsByKey(factKey: string, agentId?: string): Promise<FactRow[]> {
    const base = withAgentScope(
      "SELECT * FROM facts WHERE fact_key = ?",
      agentId ?? "",
      [factKey],
    );
    const rows = await this.db.all<RawFactRow>(
      `${base.query} ORDER BY observed_at DESC`,
      base.params,
    );
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  // --- Episodic Events ---

  async insertEpisodicEvent(
    eventId: string,
    occurredAt: string,
    channel: string,
    eventType: string,
    payload: unknown,
    agentId?: string,
  ): Promise<number> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO episodic_events (event_id, occurred_at, channel, event_type, payload, created_at, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [eventId, occurredAt, channel, eventType, JSON.stringify(payload), nowIso, resolveAgentId(agentId)],
    );
    if (!row) {
      throw new Error("failed to insert episodic event");
    }
    return Number(row.id);
  }

  async getEpisodicEvents(limit = 100, agentId?: string): Promise<EpisodicEventRow[]> {
    const base = withAgentScope(
      "SELECT * FROM episodic_events",
      agentId ?? "",
      [],
    );
    const rows = await this.db.all<RawEpisodicEventRow>(
      `${base.query} ORDER BY occurred_at DESC LIMIT ?`,
      [...base.params, limit],
    );
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  // --- Capability Memories ---

  async upsertCapabilityMemory(
    capabilityType: string,
    capabilityIdentifier: string,
    executorKind: string,
    data: CapabilityMemoryData,
    agentId?: string,
  ): Promise<{ inserted: boolean; successCount: number }> {
    return await this.db.transaction(async (tx) => {
      const scopedLookup = withAgentScope(
        `SELECT id, success_count FROM capability_memories
         WHERE capability_type = ? AND capability_identifier = ? AND executor_kind = ?`,
        agentId ?? "",
        [capabilityType, capabilityIdentifier, executorKind],
      );
      const existing = await tx.get<{ id: number; success_count: number }>(
        scopedLookup.query,
        scopedLookup.params,
      );

      if (existing) {
        const newCount = existing.success_count + 1;
        const nowIso = new Date().toISOString();
        await tx.run(
          `UPDATE capability_memories SET
            selectors = ?,
            outcome_metadata = ?,
            cost_profile = ?,
            anti_bot_notes = ?,
            result_summary = ?,
            success_count = ?,
            last_success_at = ?,
            metadata = ?,
            updated_at = ?
          WHERE id = ?`,
          [
            data.selectors !== undefined ? JSON.stringify(data.selectors) : null,
            data.outcomeMetadata !== undefined ? JSON.stringify(data.outcomeMetadata) : null,
            data.costProfile !== undefined ? JSON.stringify(data.costProfile) : null,
            data.antiBotNotes ?? null,
            data.resultSummary ?? null,
            newCount,
            data.lastSuccessAt ?? null,
            data.metadata !== undefined ? JSON.stringify(data.metadata) : null,
            nowIso,
            existing.id,
          ],
        );
        return { inserted: false, successCount: newCount };
      }

      const nowIso = new Date().toISOString();
      await tx.run(
        `INSERT INTO capability_memories
          (capability_type, capability_identifier, executor_kind,
           selectors, outcome_metadata, cost_profile, anti_bot_notes,
           result_summary, success_count, last_success_at, metadata, created_at, updated_at, agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [
          capabilityType,
          capabilityIdentifier,
          executorKind,
          data.selectors !== undefined ? JSON.stringify(data.selectors) : null,
          data.outcomeMetadata !== undefined ? JSON.stringify(data.outcomeMetadata) : null,
          data.costProfile !== undefined ? JSON.stringify(data.costProfile) : null,
          data.antiBotNotes ?? null,
          data.resultSummary ?? null,
          data.lastSuccessAt ?? null,
          data.metadata !== undefined ? JSON.stringify(data.metadata) : null,
          nowIso,
          nowIso,
          resolveAgentId(agentId),
        ],
      );
      return { inserted: true, successCount: 1 };
    });
  }

  async getCapabilityMemories(
    capabilityType?: string,
    agentId?: string,
  ): Promise<CapabilityMemoryRow[]> {
    let baseQuery: string;
    let baseParams: unknown[];

    if (capabilityType !== undefined) {
      const scoped = withAgentScope(
        "SELECT * FROM capability_memories WHERE capability_type = ?",
        agentId ?? "",
        [capabilityType],
      );
      baseQuery = scoped.query;
      baseParams = scoped.params;
    } else {
      const scoped = withAgentScope(
        "SELECT * FROM capability_memories",
        agentId ?? "",
        [],
      );
      baseQuery = scoped.query;
      baseParams = scoped.params;
    }

    const rows = await this.db.all<RawCapabilityMemoryRow>(
      `${baseQuery} ORDER BY updated_at DESC`,
      baseParams,
    );
    return rows.map((r) => ({
      ...r,
      selectors: parseJsonField(r.selectors),
      outcome_metadata: parseJsonField(r.outcome_metadata),
      cost_profile: parseJsonField(r.cost_profile),
      metadata: parseJsonField(r.metadata),
      created_at: normalizeTime(r.created_at),
      updated_at: normalizeTime(r.updated_at),
    }));
  }

  // --- PAM Profiles ---

  async upsertPamProfile(
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO pam_profiles (profile_id, version, profile_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         version = excluded.version,
         profile_data = excluded.profile_data,
         updated_at = ?`,
      [
        profileId,
        version ?? null,
        JSON.stringify(profileData),
        nowIso,
        nowIso,
        nowIso,
      ],
    );
  }

  async getPamProfile(profileId: string): Promise<ProfileRow | undefined> {
    const row = await this.db.get<RawProfileRow>(
      "SELECT * FROM pam_profiles WHERE profile_id = ?",
      [profileId],
    );
    if (!row) return undefined;
    return {
      ...row,
      profile_data: JSON.parse(row.profile_data) as unknown,
      created_at: normalizeTime(row.created_at),
      updated_at: normalizeTime(row.updated_at),
    };
  }

  // --- PVP Profiles ---

  async upsertPvpProfile(
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO pvp_profiles (profile_id, version, profile_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         version = excluded.version,
         profile_data = excluded.profile_data,
         updated_at = ?`,
      [
        profileId,
        version ?? null,
        JSON.stringify(profileData),
        nowIso,
        nowIso,
        nowIso,
      ],
    );
  }

  async getPvpProfile(profileId: string): Promise<ProfileRow | undefined> {
    const row = await this.db.get<RawProfileRow>(
      "SELECT * FROM pvp_profiles WHERE profile_id = ?",
      [profileId],
    );
    if (!row) return undefined;
    return {
      ...row,
      profile_data: JSON.parse(row.profile_data) as unknown,
      created_at: normalizeTime(row.created_at),
      updated_at: normalizeTime(row.updated_at),
    };
  }

  // --- Delete methods ---

  async deleteFact(id: number, agentId?: string): Promise<boolean> {
    const scoped = withAgentScope(
      "DELETE FROM facts WHERE id = ?",
      agentId ?? "",
      [id],
    );
    const result = await this.db.run(scoped.query, scoped.params);
    return (result.changes ?? 0) > 0;
  }

  async deleteEpisodicEvent(id: number, agentId?: string): Promise<boolean> {
    const scoped = withAgentScope(
      "DELETE FROM episodic_events WHERE id = ?",
      agentId ?? "",
      [id],
    );
    const result = await this.db.run(scoped.query, scoped.params);
    return (result.changes ?? 0) > 0;
  }

  async deleteCapabilityMemory(id: number, agentId?: string): Promise<boolean> {
    const scoped = withAgentScope(
      "DELETE FROM capability_memories WHERE id = ?",
      agentId ?? "",
      [id],
    );
    const result = await this.db.run(scoped.query, scoped.params);
    return (result.changes ?? 0) > 0;
  }
}
