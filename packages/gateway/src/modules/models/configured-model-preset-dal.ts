import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";

export interface ConfiguredModelPresetRow {
  tenant_id: string;
  preset_id: string;
  preset_key: string;
  display_name: string;
  provider_key: string;
  model_id: string;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RawConfiguredModelPresetRow {
  tenant_id: string;
  preset_id: string;
  preset_key: string;
  display_name: string;
  provider_key: string;
  model_id: string;
  options_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseOptions(value: string): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toRow(raw: RawConfiguredModelPresetRow): ConfiguredModelPresetRow {
  return {
    tenant_id: raw.tenant_id,
    preset_id: raw.preset_id,
    preset_key: raw.preset_key,
    display_name: raw.display_name,
    provider_key: raw.provider_key,
    model_id: raw.model_id,
    options: parseOptions(raw.options_json),
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class ConfiguredModelPresetDal {
  constructor(private readonly db: SqlDb) {}

  async list(input: {
    tenantId: string;
    providerKey?: string;
  }): Promise<ConfiguredModelPresetRow[]> {
    const providerKey = input.providerKey?.trim();
    const rows = await (providerKey
      ? this.db.all<RawConfiguredModelPresetRow>(
          `SELECT *
           FROM configured_model_presets
           WHERE tenant_id = ? AND provider_key = ?
           ORDER BY display_name ASC, preset_key ASC`,
          [input.tenantId, providerKey],
        )
      : this.db.all<RawConfiguredModelPresetRow>(
          `SELECT *
           FROM configured_model_presets
           WHERE tenant_id = ?
           ORDER BY display_name ASC, preset_key ASC`,
          [input.tenantId],
        ));
    return rows.map(toRow);
  }

  async getByKey(input: {
    tenantId: string;
    presetKey: string;
  }): Promise<ConfiguredModelPresetRow | undefined> {
    const row = await this.db.get<RawConfiguredModelPresetRow>(
      `SELECT *
       FROM configured_model_presets
       WHERE tenant_id = ? AND preset_key = ?
       LIMIT 1`,
      [input.tenantId, input.presetKey],
    );
    return row ? toRow(row) : undefined;
  }

  async create(input: {
    tenantId: string;
    presetKey: string;
    displayName: string;
    providerKey: string;
    modelId: string;
    options: Record<string, unknown>;
  }): Promise<ConfiguredModelPresetRow> {
    const presetId = randomUUID();
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO configured_model_presets (
         tenant_id,
         preset_id,
         preset_key,
         display_name,
         provider_key,
         model_id,
         options_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId,
        presetId,
        input.presetKey,
        input.displayName,
        input.providerKey,
        input.modelId,
        JSON.stringify(input.options),
        nowIso,
        nowIso,
      ],
    );
    const row = await this.getByKey({ tenantId: input.tenantId, presetKey: input.presetKey });
    if (!row) throw new Error("configured model preset create failed");
    return row;
  }

  async updateByKey(input: {
    tenantId: string;
    presetKey: string;
    displayName?: string;
    options?: Record<string, unknown>;
  }): Promise<ConfiguredModelPresetRow | undefined> {
    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [new Date().toISOString()];

    if (input.displayName !== undefined) {
      updates.push("display_name = ?");
      values.push(input.displayName.trim());
    }
    if (input.options !== undefined) {
      updates.push("options_json = ?");
      values.push(JSON.stringify(input.options));
    }

    await this.db.run(
      `UPDATE configured_model_presets
       SET ${updates.join(", ")}
       WHERE tenant_id = ? AND preset_key = ?`,
      [...values, input.tenantId, input.presetKey],
    );
    return await this.getByKey({ tenantId: input.tenantId, presetKey: input.presetKey });
  }

  async deleteByKey(input: { tenantId: string; presetKey: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM configured_model_presets
       WHERE tenant_id = ? AND preset_key = ?`,
      [input.tenantId, input.presetKey],
    );
    return res.changes === 1;
  }
}
