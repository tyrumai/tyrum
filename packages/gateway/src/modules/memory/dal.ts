import type { SqlDb } from "../../statestore/types.js";

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
    agentId: string,
    factKey: string,
    factValue: unknown,
    source: string,
    observedAt: string,
    confidence: number,
  ): Promise<number> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO facts (agent_id, fact_key, fact_value, source, observed_at, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        agentId,
        factKey,
        JSON.stringify(factValue),
        source,
        observedAt,
        confidence,
        nowIso,
      ],
    );
    if (!row) {
      throw new Error("failed to insert fact");
    }
    return Number(row.id);
  }

  async getFacts(agentId: string): Promise<FactRow[]> {
    const rows = await this.db.all<RawFactRow>(
      "SELECT * FROM facts WHERE agent_id = ? ORDER BY observed_at DESC",
      [agentId],
    );
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  async getFactsByKey(agentId: string, factKey: string): Promise<FactRow[]> {
    const rows = await this.db.all<RawFactRow>(
      "SELECT * FROM facts WHERE agent_id = ? AND fact_key = ? ORDER BY observed_at DESC",
      [agentId, factKey],
    );
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  // --- Episodic Events ---

  async insertEpisodicEvent(
    agentId: string,
    eventId: string,
    occurredAt: string,
    channel: string,
    eventType: string,
    payload: unknown,
  ): Promise<number> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<{ id: number }>(
      `INSERT INTO episodic_events (agent_id, event_id, occurred_at, channel, event_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [agentId, eventId, occurredAt, channel, eventType, JSON.stringify(payload), nowIso],
    );
    if (!row) {
      throw new Error("failed to insert episodic event");
    }
    return Number(row.id);
  }

  async getEpisodicEvents(agentId: string, limit = 100): Promise<EpisodicEventRow[]> {
    const rows = await this.db.all<RawEpisodicEventRow>(
      "SELECT * FROM episodic_events WHERE agent_id = ? ORDER BY occurred_at DESC LIMIT ?",
      [agentId, limit],
    );
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload) as unknown,
      created_at: normalizeTime(r.created_at),
    }));
  }

  // --- Capability Memories ---

  async upsertCapabilityMemory(
    agentId: string,
    capabilityType: string,
    capabilityIdentifier: string,
    executorKind: string,
    data: CapabilityMemoryData,
  ): Promise<{ inserted: boolean; successCount: number }> {
    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<{ id: number; success_count: number }>(
        `SELECT id, success_count FROM capability_memories
         WHERE agent_id = ? AND capability_type = ? AND capability_identifier = ? AND executor_kind = ?`,
        [agentId, capabilityType, capabilityIdentifier, executorKind],
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
          (agent_id, capability_type, capability_identifier, executor_kind,
           selectors, outcome_metadata, cost_profile, anti_bot_notes,
           result_summary, success_count, last_success_at, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          agentId,
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
        ],
      );
      return { inserted: true, successCount: 1 };
    });
  }

  async getCapabilityMemories(
    agentId: string,
    capabilityType?: string,
  ): Promise<CapabilityMemoryRow[]> {
    const rows: RawCapabilityMemoryRow[] = capabilityType !== undefined
      ? await this.db.all<RawCapabilityMemoryRow>(
          `SELECT * FROM capability_memories
           WHERE agent_id = ? AND capability_type = ?
           ORDER BY updated_at DESC`,
          [agentId, capabilityType],
        )
      : await this.db.all<RawCapabilityMemoryRow>(
          `SELECT * FROM capability_memories
           WHERE agent_id = ?
           ORDER BY updated_at DESC`,
          [agentId],
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
    agentId: string,
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO pam_profiles (agent_id, profile_id, version, profile_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, profile_id) DO UPDATE SET
         version = excluded.version,
         profile_data = excluded.profile_data,
         updated_at = ?`,
      [
        agentId,
        profileId,
        version ?? null,
        JSON.stringify(profileData),
        nowIso,
        nowIso,
        nowIso,
      ],
    );
  }

  async getPamProfile(agentId: string, profileId: string): Promise<ProfileRow | undefined> {
    const row = await this.db.get<RawProfileRow>(
      "SELECT * FROM pam_profiles WHERE agent_id = ? AND profile_id = ?",
      [agentId, profileId],
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
    agentId: string,
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO pvp_profiles (agent_id, profile_id, version, profile_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, profile_id) DO UPDATE SET
         version = excluded.version,
         profile_data = excluded.profile_data,
         updated_at = ?`,
      [
        agentId,
        profileId,
        version ?? null,
        JSON.stringify(profileData),
        nowIso,
        nowIso,
        nowIso,
      ],
    );
  }

  async getPvpProfile(agentId: string, profileId: string): Promise<ProfileRow | undefined> {
    const row = await this.db.get<RawProfileRow>(
      "SELECT * FROM pvp_profiles WHERE agent_id = ? AND profile_id = ?",
      [agentId, profileId],
    );
    if (!row) return undefined;
    return {
      ...row,
      profile_data: JSON.parse(row.profile_data) as unknown,
      created_at: normalizeTime(row.created_at),
      updated_at: normalizeTime(row.updated_at),
    };
  }
}
