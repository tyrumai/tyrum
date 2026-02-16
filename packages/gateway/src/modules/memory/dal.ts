import type Database from "better-sqlite3";

// --- Row types returned by queries ---

export interface FactRow {
  id: number;
  subject_id: string;
  fact_key: string;
  fact_value: unknown;
  source: string;
  observed_at: string;
  confidence: number;
  created_at: string;
}

export interface EpisodicEventRow {
  id: number;
  subject_id: string;
  event_id: string;
  occurred_at: string;
  channel: string;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface CapabilityMemoryRow {
  id: number;
  subject_id: string;
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
  subject_id: string;
  profile_id: string;
  version: string | null;
  profile_data: unknown;
  created_at: string;
  updated_at: string;
}

// --- Raw row types from SQLite (JSON fields stored as TEXT) ---

interface RawFactRow {
  id: number;
  subject_id: string;
  fact_key: string;
  fact_value: string;
  source: string;
  observed_at: string;
  confidence: number;
  created_at: string;
}

interface RawEpisodicEventRow {
  id: number;
  subject_id: string;
  event_id: string;
  occurred_at: string;
  channel: string;
  event_type: string;
  payload: string;
  created_at: string;
}

interface RawCapabilityMemoryRow {
  id: number;
  subject_id: string;
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
  created_at: string;
  updated_at: string;
}

interface RawProfileRow {
  id: number;
  subject_id: string;
  profile_id: string;
  version: string | null;
  profile_data: string;
  created_at: string;
  updated_at: string;
}

function parseJsonField(raw: string | null): unknown | null {
  if (raw === null) return null;
  return JSON.parse(raw) as unknown;
}

export class MemoryDal {
  constructor(private db: Database.Database) {}

  // --- Facts ---

  insertFact(
    subjectId: string,
    factKey: string,
    factValue: unknown,
    source: string,
    observedAt: string,
    confidence: number,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO facts (subject_id, fact_key, fact_value, source, observed_at, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        subjectId,
        factKey,
        JSON.stringify(factValue),
        source,
        observedAt,
        confidence,
      );
    return Number(result.lastInsertRowid);
  }

  getFacts(subjectId: string): FactRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM facts WHERE subject_id = ? ORDER BY observed_at DESC",
      )
      .all(subjectId) as RawFactRow[];
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
    }));
  }

  getFactsByKey(subjectId: string, factKey: string): FactRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM facts WHERE subject_id = ? AND fact_key = ? ORDER BY observed_at DESC",
      )
      .all(subjectId, factKey) as RawFactRow[];
    return rows.map((r) => ({
      ...r,
      fact_value: JSON.parse(r.fact_value) as unknown,
    }));
  }

  // --- Episodic Events ---

  insertEpisodicEvent(
    subjectId: string,
    eventId: string,
    occurredAt: string,
    channel: string,
    eventType: string,
    payload: unknown,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO episodic_events (subject_id, event_id, occurred_at, channel, event_type, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        subjectId,
        eventId,
        occurredAt,
        channel,
        eventType,
        JSON.stringify(payload),
      );
    return Number(result.lastInsertRowid);
  }

  getEpisodicEvents(subjectId: string, limit = 100): EpisodicEventRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM episodic_events WHERE subject_id = ? ORDER BY occurred_at DESC LIMIT ?",
      )
      .all(subjectId, limit) as RawEpisodicEventRow[];
    return rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload) as unknown,
    }));
  }

  // --- Capability Memories ---

  upsertCapabilityMemory(
    subjectId: string,
    capabilityType: string,
    capabilityIdentifier: string,
    executorKind: string,
    data: CapabilityMemoryData,
  ): { inserted: boolean; successCount: number } {
    const upsert = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT id, success_count FROM capability_memories
           WHERE subject_id = ? AND capability_type = ? AND capability_identifier = ? AND executor_kind = ?`,
        )
        .get(
          subjectId,
          capabilityType,
          capabilityIdentifier,
          executorKind,
        ) as { id: number; success_count: number } | undefined;

      if (existing) {
        const newCount = existing.success_count + 1;
        this.db
          .prepare(
            `UPDATE capability_memories SET
              selectors = ?,
              outcome_metadata = ?,
              cost_profile = ?,
              anti_bot_notes = ?,
              result_summary = ?,
              success_count = ?,
              last_success_at = ?,
              metadata = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
          )
          .run(
            data.selectors !== undefined
              ? JSON.stringify(data.selectors)
              : null,
            data.outcomeMetadata !== undefined
              ? JSON.stringify(data.outcomeMetadata)
              : null,
            data.costProfile !== undefined
              ? JSON.stringify(data.costProfile)
              : null,
            data.antiBotNotes ?? null,
            data.resultSummary ?? null,
            newCount,
            data.lastSuccessAt ?? null,
            data.metadata !== undefined
              ? JSON.stringify(data.metadata)
              : null,
            existing.id,
          );
        return { inserted: false, successCount: newCount };
      }

      this.db
        .prepare(
          `INSERT INTO capability_memories
            (subject_id, capability_type, capability_identifier, executor_kind,
             selectors, outcome_metadata, cost_profile, anti_bot_notes,
             result_summary, success_count, last_success_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          subjectId,
          capabilityType,
          capabilityIdentifier,
          executorKind,
          data.selectors !== undefined
            ? JSON.stringify(data.selectors)
            : null,
          data.outcomeMetadata !== undefined
            ? JSON.stringify(data.outcomeMetadata)
            : null,
          data.costProfile !== undefined
            ? JSON.stringify(data.costProfile)
            : null,
          data.antiBotNotes ?? null,
          data.resultSummary ?? null,
          data.lastSuccessAt ?? null,
          data.metadata !== undefined
            ? JSON.stringify(data.metadata)
            : null,
        );
      return { inserted: true, successCount: 1 };
    });

    return upsert();
  }

  getCapabilityMemories(
    subjectId: string,
    capabilityType?: string,
  ): CapabilityMemoryRow[] {
    let rows: RawCapabilityMemoryRow[];
    if (capabilityType !== undefined) {
      rows = this.db
        .prepare(
          `SELECT * FROM capability_memories
           WHERE subject_id = ? AND capability_type = ?
           ORDER BY updated_at DESC`,
        )
        .all(subjectId, capabilityType) as RawCapabilityMemoryRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM capability_memories
           WHERE subject_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(subjectId) as RawCapabilityMemoryRow[];
    }
    return rows.map((r) => ({
      ...r,
      selectors: parseJsonField(r.selectors),
      outcome_metadata: parseJsonField(r.outcome_metadata),
      cost_profile: parseJsonField(r.cost_profile),
      metadata: parseJsonField(r.metadata),
    }));
  }

  // --- PAM Profiles ---

  upsertPamProfile(
    subjectId: string,
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO pam_profiles (subject_id, profile_id, version, profile_data)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(subject_id, profile_id) DO UPDATE SET
           version = excluded.version,
           profile_data = excluded.profile_data,
           updated_at = datetime('now')`,
      )
      .run(subjectId, profileId, version ?? null, JSON.stringify(profileData));
  }

  getPamProfile(
    subjectId: string,
    profileId: string,
  ): ProfileRow | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM pam_profiles WHERE subject_id = ? AND profile_id = ?",
      )
      .get(subjectId, profileId) as RawProfileRow | undefined;
    if (!row) return undefined;
    return {
      ...row,
      profile_data: JSON.parse(row.profile_data) as unknown,
    };
  }

  // --- PVP Profiles ---

  upsertPvpProfile(
    subjectId: string,
    profileId: string,
    version: string | undefined,
    profileData: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO pvp_profiles (subject_id, profile_id, version, profile_data)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(subject_id, profile_id) DO UPDATE SET
           version = excluded.version,
           profile_data = excluded.profile_data,
           updated_at = datetime('now')`,
      )
      .run(subjectId, profileId, version ?? null, JSON.stringify(profileData));
  }

  getPvpProfile(
    subjectId: string,
    profileId: string,
  ): ProfileRow | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM pvp_profiles WHERE subject_id = ? AND profile_id = ?",
      )
      .get(subjectId, profileId) as RawProfileRow | undefined;
    if (!row) return undefined;
    return {
      ...row,
      profile_data: JSON.parse(row.profile_data) as unknown,
    };
  }
}
