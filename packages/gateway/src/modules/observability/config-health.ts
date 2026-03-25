import { AgentConfig } from "@tyrum/contracts";
import type { ModelsDevService } from "../models/models-dev-service.js";
import {
  normalizePublicExecutionProfileId,
  PUBLIC_EXECUTION_PROFILE_IDS,
} from "../models/public-execution-profiles.js";
import type { SqlDb } from "../../statestore/types.js";
import { isMissingTableError } from "./db-errors.js";

const EXECUTION_PROFILE_IDS = PUBLIC_EXECUTION_PROFILE_IDS;

type CatalogLookup = Map<string, Set<string>>;
type CatalogLoadResult = {
  lookup: CatalogLookup | null;
  lastError: string | null;
};

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
    | "model_catalog_refresh_failed"
    | "workspace_policy_unconfigured"
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
): Promise<CatalogLoadResult> {
  if (modelsDev) {
    try {
      const loaded = await modelsDev.ensureLoaded();
      return {
        lookup: buildCatalogLookup(loaded.catalog),
        lastError: loaded.status.last_error,
      };
    } catch (error) {
      const loadError = error instanceof Error ? error.message : String(error);
      // Intentional: config health falls back to the cached DB snapshot when the in-memory
      // models.dev service is unavailable.
      if (!db) {
        return { lookup: null, lastError: loadError };
      }

      try {
        const row = await db.get<{ json: string; last_error: string | null }>(
          `SELECT json, last_error
           FROM models_dev_cache
           WHERE id = 1`,
        );
        if (!row?.json) return { lookup: null, lastError: loadError };
        try {
          return {
            lookup: buildCatalogLookup(JSON.parse(row.json) as unknown),
            lastError: row.last_error ?? loadError,
          };
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          return {
            lookup: null,
            lastError: row.last_error ?? message,
          };
        }
      } catch {
        // Intentional: config health falls back to the last observed load error when the
        // cached DB snapshot cannot be read at all.
        return { lookup: null, lastError: loadError };
      }
    }
  }

  if (!db) return { lookup: null, lastError: null };

  try {
    const row = await db.get<{ json: string; last_error: string | null }>(
      `SELECT json, last_error
       FROM models_dev_cache
       WHERE id = 1`,
    );
    if (!row?.json) return { lookup: null, lastError: row?.last_error ?? null };
    try {
      return {
        lookup: buildCatalogLookup(JSON.parse(row.json) as unknown),
        lastError: row.last_error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        lookup: null,
        lastError: row.last_error ?? message,
      };
    }
  } catch {
    // Intentional: config health degrades to "unknown catalog availability" when the cache table
    // is absent or unreadable, and other issues still surface separately.
    return { lookup: null, lastError: null };
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

  const [
    deploymentPolicyResult,
    providerResult,
    presetResult,
    assignmentResult,
    agentResult,
    catalogState,
  ] = await Promise.all([
    safeAll<{ revision: number }>(
      input.db,
      `SELECT revision
       FROM policy_bundle_config_revisions
       WHERE tenant_id = ?
         AND scope_kind = 'deployment'
         AND agent_id IS NULL
       ORDER BY revision DESC
       LIMIT 1`,
      [input.tenantId],
    ),
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
    deploymentPolicyResult.missingTable ||
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
  const catalogLookup = catalogState.lookup;

  const issues: ConfigHealthIssue[] = [];
  if (deploymentPolicyResult.rows.length === 0) {
    issues.push({
      code: "workspace_policy_unconfigured",
      severity: "warning",
      message: "Workspace policy has not been configured.",
      target: { kind: "deployment", id: null },
    });
  }

  if (catalogState.lastError) {
    issues.push({
      code: "model_catalog_refresh_failed",
      severity: catalogLookup ? "warning" : "error",
      message: catalogLookup
        ? `Model catalog refresh failed: ${catalogState.lastError}. Tyrum is using the last cached catalog snapshot.`
        : `Model catalog refresh failed: ${catalogState.lastError}. No cached catalog snapshot is available.`,
      target: { kind: "deployment", id: null },
    });
  }

  const activeProviderKeys = new Set(
    providerRows
      .filter((row) => row.status === "active")
      .map((row) => row.provider_key)
      .filter((providerKey) => providerKey.trim().length > 0),
  );
  const presetsByKey = new Map(presetRows.map((row) => [row.preset_key, row]));
  const assignmentsByProfileId = new Map<string, string>();
  for (const row of assignmentRows) {
    const profileId = normalizePublicExecutionProfileId(row.execution_profile_id);
    if (!profileId) {
      continue;
    }
    if (row.execution_profile_id === profileId || !assignmentsByProfileId.has(profileId)) {
      assignmentsByProfileId.set(profileId, row.preset_key);
    }
  }

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
