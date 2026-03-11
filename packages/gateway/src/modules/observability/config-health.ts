import { AgentConfig } from "@tyrum/schemas";
import type { ModelsDevService } from "../models/models-dev-service.js";
import type { SqlDb } from "../../statestore/types.js";
import { isMissingTableError } from "./db-errors.js";

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

type CatalogLookup = Map<string, Set<string>>;

async function safeAll<T>(
  db: SqlDb,
  sql: string,
  params: readonly unknown[],
): Promise<{ rows: T[]; missingTable: boolean }> {
  try {
    return { rows: await db.all<T>(sql, params), missingTable: false };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { rows: [], missingTable: true };
    }
    throw error;
  }
}

export type ConfigHealthIssue = {
  code:
    | "no_provider_accounts"
    | "no_model_presets"
    | "execution_profile_unassigned"
    | "execution_profile_provider_unconfigured"
    | "execution_profile_model_unavailable"
    | "agent_model_unconfigured"
    | "agent_provider_unconfigured"
    | "agent_model_unavailable";
  severity: "warning" | "error";
  message: string;
  target: {
    kind: "deployment" | "execution_profile" | "agent";
    id: string | null;
  };
};

export type ConfigHealthStatus = {
  status: "ok" | "issues";
  issues: ConfigHealthIssue[];
};

function splitProviderModelId(value: string): {
  providerKey: string;
  modelId: string;
} | null {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return null;
  return {
    providerKey: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

function buildCatalogLookup(raw: unknown): CatalogLookup {
  const lookup = new Map<string, Set<string>>();
  if (!raw || typeof raw !== "object") return lookup;

  for (const [providerKey, providerValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!providerValue || typeof providerValue !== "object") continue;
    const models = (providerValue as Record<string, unknown>)["models"];
    if (!models || typeof models !== "object") {
      lookup.set(providerKey, new Set<string>());
      continue;
    }
    lookup.set(providerKey, new Set(Object.keys(models as Record<string, unknown>)));
  }

  return lookup;
}

async function loadCatalogLookup(
  db: SqlDb | undefined,
  modelsDev: ModelsDevService | undefined,
): Promise<CatalogLookup | null> {
  if (modelsDev) {
    try {
      const loaded = await modelsDev.ensureLoaded();
      return buildCatalogLookup(loaded.catalog);
    } catch (error) {
      void error;
      // Intentional: config health falls back to the cached DB snapshot when the in-memory
      // models.dev service is unavailable.
    }
  }

  if (!db) return null;

  try {
    const row = await db.get<{ json: string }>(
      `SELECT json
       FROM models_dev_cache
       WHERE id = 1`,
    );
    if (!row?.json) return null;
    return buildCatalogLookup(JSON.parse(row.json) as unknown);
  } catch (error) {
    void error;
    return null;
  }
}

function hasCatalogModel(
  catalogLookup: CatalogLookup | null,
  providerKey: string,
  modelId: string,
): boolean | null {
  if (!catalogLookup) return null;
  const models = catalogLookup.get(providerKey);
  if (!models) return false;
  return models.has(modelId);
}

export async function loadConfigHealth(input: {
  db: SqlDb | undefined;
  tenantId: string;
  modelsDev: ModelsDevService | undefined;
}): Promise<ConfigHealthStatus> {
  if (!input.db) {
    return {
      status: "ok",
      issues: [],
    };
  }

  const [providerResult, presetResult, assignmentResult, agentResult, catalogLookup] =
    await Promise.all([
      safeAll<{ provider_key: string; status: string }>(
        input.db,
        `SELECT provider_key, status
       FROM auth_profiles
       WHERE tenant_id = ?
       ORDER BY updated_at DESC, auth_profile_id DESC
       LIMIT 500`,
        [input.tenantId],
      ),
      safeAll<{ preset_key: string; provider_key: string; model_id: string }>(
        input.db,
        `SELECT preset_key, provider_key, model_id
       FROM configured_model_presets
       WHERE tenant_id = ?
       ORDER BY preset_key ASC`,
        [input.tenantId],
      ),
      safeAll<{ execution_profile_id: string; preset_key: string }>(
        input.db,
        `SELECT execution_profile_id, preset_key
       FROM execution_profile_model_assignments
       WHERE tenant_id = ?
       ORDER BY execution_profile_id ASC`,
        [input.tenantId],
      ),
      safeAll<{ agent_key: string; config_json: string | null }>(
        input.db,
        `SELECT a.agent_key, ac.config_json
       FROM agents a
       LEFT JOIN agent_configs ac
         ON ac.tenant_id = a.tenant_id
        AND ac.agent_id = a.agent_id
        AND ac.revision = (
          SELECT MAX(ac2.revision)
          FROM agent_configs ac2
          WHERE ac2.tenant_id = a.tenant_id
            AND ac2.agent_id = a.agent_id
        )
       WHERE a.tenant_id = ?
       ORDER BY a.agent_key ASC`,
        [input.tenantId],
      ),
      loadCatalogLookup(input.db, input.modelsDev),
    ]);

  if (
    providerResult.missingTable ||
    presetResult.missingTable ||
    assignmentResult.missingTable ||
    agentResult.missingTable
  ) {
    return {
      status: "ok",
      issues: [],
    };
  }

  const providerRows = providerResult.rows;
  const presetRows = presetResult.rows;
  const assignmentRows = assignmentResult.rows;
  const agentRows = agentResult.rows;

  const issues: ConfigHealthIssue[] = [];
  const activeProviderKeys = new Set(
    providerRows
      .filter((row) => row.status === "active")
      .map((row) => row.provider_key)
      .filter((providerKey) => providerKey.trim().length > 0),
  );
  const presetsByKey = new Map(presetRows.map((row) => [row.preset_key, row]));
  const assignmentsByProfileId = new Map(
    assignmentRows.map((row) => [row.execution_profile_id, row.preset_key]),
  );

  if (activeProviderKeys.size === 0) {
    issues.push({
      code: "no_provider_accounts",
      severity: "error",
      message: "No active provider accounts are configured.",
      target: { kind: "deployment", id: null },
    });
  }

  if (presetRows.length === 0) {
    issues.push({
      code: "no_model_presets",
      severity: "warning",
      message: "No model presets are configured.",
      target: { kind: "deployment", id: null },
    });
  }

  for (const executionProfileId of EXECUTION_PROFILE_IDS) {
    const presetKey = assignmentsByProfileId.get(executionProfileId);
    if (!presetKey) {
      issues.push({
        code: "execution_profile_unassigned",
        severity: "warning",
        message: `Execution profile '${executionProfileId}' is set to None.`,
        target: { kind: "execution_profile", id: executionProfileId },
      });
      continue;
    }

    const preset = presetsByKey.get(presetKey);
    if (!preset) continue;

    if (!activeProviderKeys.has(preset.provider_key)) {
      issues.push({
        code: "execution_profile_provider_unconfigured",
        severity: "error",
        message: `Execution profile '${executionProfileId}' targets provider '${preset.provider_key}', but no active account is configured for it.`,
        target: { kind: "execution_profile", id: executionProfileId },
      });
    }

    const available = hasCatalogModel(catalogLookup, preset.provider_key, preset.model_id);
    if (available === false) {
      issues.push({
        code: "execution_profile_model_unavailable",
        severity: "error",
        message: `Execution profile '${executionProfileId}' targets unavailable model '${preset.provider_key}/${preset.model_id}'.`,
        target: { kind: "execution_profile", id: executionProfileId },
      });
    }
  }

  for (const row of agentRows) {
    if (!row.config_json) {
      issues.push({
        code: "agent_model_unconfigured",
        severity: "error",
        message: `Agent '${row.agent_key}' has no persisted primary model.`,
        target: { kind: "agent", id: row.agent_key },
      });
      continue;
    }

    let configJson: unknown;
    try {
      configJson = JSON.parse(row.config_json) as unknown;
    } catch (error) {
      void error;
      issues.push({
        code: "agent_model_unavailable",
        severity: "error",
        message: `Agent '${row.agent_key}' has an invalid primary model configuration.`,
        target: { kind: "agent", id: row.agent_key },
      });
      continue;
    }

    const parsed = AgentConfig.safeParse(configJson);
    if (!parsed.success || parsed.data.model.model === null) {
      issues.push({
        code: "agent_model_unconfigured",
        severity: "error",
        message: `Agent '${row.agent_key}' has no primary model configured.`,
        target: { kind: "agent", id: row.agent_key },
      });
      continue;
    }

    const modelRef = splitProviderModelId(parsed.data.model.model);
    if (!modelRef) {
      issues.push({
        code: "agent_model_unavailable",
        severity: "error",
        message: `Agent '${row.agent_key}' has an invalid primary model configuration.`,
        target: { kind: "agent", id: row.agent_key },
      });
      continue;
    }

    if (!activeProviderKeys.has(modelRef.providerKey)) {
      issues.push({
        code: "agent_provider_unconfigured",
        severity: "error",
        message: `Agent '${row.agent_key}' targets provider '${modelRef.providerKey}', but no active account is configured for it.`,
        target: { kind: "agent", id: row.agent_key },
      });
    }

    const available = hasCatalogModel(catalogLookup, modelRef.providerKey, modelRef.modelId);
    if (available === false) {
      issues.push({
        code: "agent_model_unavailable",
        severity: "error",
        message: `Agent '${row.agent_key}' targets unavailable model '${parsed.data.model.model}'.`,
        target: { kind: "agent", id: row.agent_key },
      });
    }
  }

  const sortedIssues = issues.toSorted((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "error" ? -1 : 1;
    }
    if (left.target.kind !== right.target.kind) {
      return left.target.kind.localeCompare(right.target.kind);
    }
    return (left.target.id ?? left.code).localeCompare(right.target.id ?? right.code);
  });

  return {
    status: sortedIssues.length > 0 ? "issues" : "ok",
    issues: sortedIssues,
  };
}
