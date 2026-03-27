import { DataType, newDb } from "pg-mem";
import { normalizeSessionTitle } from "../../src/modules/agent/session-dal-helpers.js";
import {
  applyConversationTurnCleanBreakMigration,
  buildJsonbObjectFromTextArgs,
  isApplyingConversationTurnCleanBreakMigration,
  isConversationTurnCleanBreakMigration,
  parseJsonbSetPath,
  setJsonbPath,
  toJsonText,
} from "./pg-mem-conversation-turn-clean-break.js";

const SESSION_TITLES_MIGRATION_MARKERS = [
  "ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  "FROM jsonb_array_elements(",
] as const;
const SESSION_TRANSCRIPT_MIGRATION_MARKERS = [
  "UPDATE sessions",
  "SET turns_json = COALESCE(",
  "jsonb_array_elements(sessions.turns_json::jsonb)",
] as const;
const AGENT_ACCESS_DEFAULTS_TOOLS_MIGRATION_MARKERS = [
  "UPDATE agent_configs",
  "config_json::jsonb - 'tools'",
  "jsonb_array_elements_text",
  '\'["read","write","edit","apply_patch","glob","grep"]\'::jsonb',
] as const;
const GUARDIAN_REVIEW_MIGRATION_MARKERS = [
  "CREATE TABLE IF NOT EXISTS review_entries",
  "CURRENT_TIMESTAMP AT TIME ZONE 'UTC'",
] as const;
const WORKBOARD_CONVERSATION_TURN_STORAGE_MIGRATION_MARKERS = [
  "ALTER TABLE work_items RENAME COLUMN created_from_session_id TO created_from_conversation_id;",
  "ALTER TABLE work_clarifications RENAME COLUMN answered_by_session_key TO answered_by_conversation_key;",
] as const;
const FILESYSTEM_TOOL_IDS = ["read", "write", "edit", "apply_patch", "glob", "grep"] as const;

type SessionTitleMigrationRow = {
  tenant_id: string;
  session_id: string;
  session_key: string;
  turns_json: string;
  workspace_id: string;
  channel_thread_id: string;
};
type SessionTranscriptMigrationRow = {
  tenant_id: string;
  session_id: string;
  turns_json: string;
  created_at: string;
};
type AgentAccessDefaultsMigrationRow = {
  config_json: string;
};

function isSessionTitlesMigration(sql: string): boolean {
  return SESSION_TITLES_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function isSessionTranscriptMigration(sql: string): boolean {
  return SESSION_TRANSCRIPT_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function isAgentAccessDefaultsToolsMigration(sql: string): boolean {
  return AGENT_ACCESS_DEFAULTS_TOOLS_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function isGuardianReviewMigration(sql: string): boolean {
  return GUARDIAN_REVIEW_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function isWorkboardConversationTurnStorageMigration(sql: string): boolean {
  return WORKBOARD_CONVERSATION_TURN_STORAGE_MIGRATION_MARKERS.every((marker) =>
    sql.includes(marker),
  );
}

function toSqlTextLiteral(value: unknown): string {
  const normalized =
    value instanceof Date ? value.toISOString() : typeof value === "string" ? value : String(value);
  return `'${normalized.replaceAll("'", "''")}'`;
}

function deriveBackfilledSessionTitle(turnsJson: string): string {
  try {
    const parsed = JSON.parse(turnsJson) as unknown;
    if (!Array.isArray(parsed)) return "";
    for (const turn of parsed) {
      if (!turn || typeof turn !== "object") continue;
      const record = turn as Record<string, unknown>;
      if ((record["role"] !== "user" && record["role"] !== "assistant") || !record["content"]) {
        continue;
      }
      if (typeof record["content"] !== "string") continue;
      const title = normalizeSessionTitle(record["content"]);
      if (title.length > 0) return title;
    }
  } catch {
    return "";
  }
  return "";
}

function migrateLegacyTurnsToTranscript(
  turnsJson: string,
  createdAt: string,
  sessionId: string,
): string {
  try {
    const parsed = JSON.parse(turnsJson) as unknown;
    if (!Array.isArray(parsed)) return turnsJson;
    const hasLegacyTurns = parsed.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      return typeof record["role"] === "string" && record["kind"] === undefined;
    });
    if (!hasLegacyTurns) return turnsJson;
    return JSON.stringify(
      parsed.map((item, index) => {
        const record =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : {};
        const role = record["role"];
        return {
          kind: "text",
          id: `${sessionId}-migrated-${index + 1}`,
          role: role === "user" || role === "assistant" || role === "system" ? role : "assistant",
          content: typeof record["content"] === "string" ? record["content"] : "",
          created_at:
            typeof record["timestamp"] === "string" && record["timestamp"].trim().length > 0
              ? record["timestamp"]
              : createdAt,
        };
      }),
    );
  } catch {
    return turnsJson;
  }
}

function applySessionTitlesMigration(mem: ReturnType<typeof newDb>): void {
  mem.public.none("ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  const sessions = mem.public.many<SessionTitleMigrationRow>(
    "SELECT tenant_id, session_id, session_key, turns_json, workspace_id, channel_thread_id FROM sessions",
  );

  for (const session of sessions) {
    const thread = mem.public.many<{ provider_thread_id: string | null }>(
      `SELECT provider_thread_id
         FROM channel_threads
        WHERE tenant_id = ${toSqlTextLiteral(session.tenant_id)}
          AND workspace_id = ${toSqlTextLiteral(session.workspace_id)}
          AND channel_thread_id = ${toSqlTextLiteral(session.channel_thread_id)}
        LIMIT 1`,
    )[0];
    const providerThreadId =
      typeof thread?.provider_thread_id === "string" ? thread.provider_thread_id : "";
    const title =
      deriveBackfilledSessionTitle(session.turns_json) || providerThreadId || session.session_key;

    mem.public.none(
      `UPDATE sessions
          SET title = ${toSqlTextLiteral(title)}
        WHERE tenant_id = ${toSqlTextLiteral(session.tenant_id)}
          AND session_id = ${toSqlTextLiteral(session.session_id)}`,
    );
  }
}

function applySessionTranscriptMigration(mem: ReturnType<typeof newDb>): void {
  const sessions = mem.public.many<SessionTranscriptMigrationRow>(
    "SELECT tenant_id, session_id, turns_json, created_at FROM sessions",
  );
  for (const session of sessions) {
    const migrated = migrateLegacyTurnsToTranscript(
      session.turns_json,
      session.created_at,
      session.session_id,
    );
    if (migrated === session.turns_json) continue;
    mem.public.none(
      `UPDATE sessions
          SET turns_json = ${toSqlTextLiteral(migrated)}
        WHERE tenant_id = ${toSqlTextLiteral(session.tenant_id)}
          AND session_id = ${toSqlTextLiteral(session.session_id)}`,
    );
  }
}

function buildExpandedFilesystemAllowList(entries: readonly string[]): string[] {
  const orderById = new Map<string, number>();
  entries.forEach((entry, index) => {
    const ordinality = (index + 1) * 10;
    if (entry === "tool.fs.*") {
      FILESYSTEM_TOOL_IDS.forEach((toolId, fsIndex) => {
        const orderKey = ordinality + fsIndex + 1;
        const current = orderById.get(toolId);
        if (current === undefined || orderKey < current) {
          orderById.set(toolId, orderKey);
        }
      });
      return;
    }

    const current = orderById.get(entry);
    if (current === undefined || ordinality < current) {
      orderById.set(entry, ordinality);
    }
  });

  return [...orderById.entries()]
    .toSorted((left, right) => left[1] - right[1])
    .map(([toolId]) => toolId);
}

function migrateAgentAccessDefaultsToolsConfig(configJson: string): string {
  const parsed = JSON.parse(configJson) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return configJson;
  }

  const tools =
    parsed["tools"] && typeof parsed["tools"] === "object" && !Array.isArray(parsed["tools"])
      ? (parsed["tools"] as Record<string, unknown>)
      : undefined;
  if (!tools || !Array.isArray(tools["allow"])) {
    return configJson;
  }
  if (tools["default_mode"] !== undefined || tools["deny"] !== undefined) {
    return configJson;
  }

  const allowEntries = (tools["allow"] as unknown[]).map((entry) => toJsonText(entry).trim());
  const nextTools = allowEntries.some((entry) => entry === "*" || entry === "tool.*")
    ? { default_mode: "allow", allow: [], deny: [] }
    : allowEntries.some((entry) => entry === "tool.fs.*")
      ? {
          default_mode: "deny",
          allow: buildExpandedFilesystemAllowList(allowEntries),
          deny: [],
        }
      : {
          default_mode: "deny",
          allow: tools["allow"],
          deny: [],
        };

  return JSON.stringify({
    ...parsed,
    tools: nextTools,
  });
}

function applyAgentAccessDefaultsToolsMigration(mem: ReturnType<typeof newDb>): void {
  const configs = mem.public.many<AgentAccessDefaultsMigrationRow>(
    "SELECT config_json FROM agent_configs",
  );
  for (const config of configs) {
    const migrated = migrateAgentAccessDefaultsToolsConfig(config.config_json);
    if (migrated === config.config_json) continue;
    mem.public.none(
      `UPDATE agent_configs
          SET config_json = ${toSqlTextLiteral(migrated)}
        WHERE config_json = ${toSqlTextLiteral(config.config_json)}`,
    );
  }
}

function applyGuardianReviewMigration(mem: ReturnType<typeof newDb>, sql: string): void {
  mem.public.none(
    sql.replace(
      /created_at\s+TEXT NOT NULL DEFAULT\s+\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\),/g,
      "created_at             TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',",
    ),
  );
}

function applyWorkboardConversationTurnStorageMigration(mem: ReturnType<typeof newDb>): void {
  const statements = [
    "ALTER TABLE work_items RENAME COLUMN created_from_session_id TO created_from_conversation_id",
    "ALTER TABLE work_items RENAME COLUMN created_from_session_key TO created_from_conversation_key",
    "ALTER TABLE work_item_tasks RENAME COLUMN run_id TO turn_id",
    "ALTER TABLE subagents RENAME COLUMN session_id TO conversation_id",
    "ALTER TABLE subagents RENAME COLUMN session_key TO conversation_key",
    "ALTER TABLE subagents RENAME COLUMN parent_session_key TO parent_conversation_key",
    "ALTER TABLE work_artifacts RENAME COLUMN created_by_run_id TO created_by_turn_id",
    "ALTER TABLE work_decisions RENAME COLUMN created_by_run_id TO created_by_turn_id",
    "ALTER TABLE work_item_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id",
    "ALTER TABLE agent_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id",
    "ALTER TABLE work_scope_activity RENAME COLUMN last_active_session_key TO last_active_conversation_key",
    "ALTER TABLE work_clarifications RENAME COLUMN requested_for_session_key TO requested_for_conversation_key",
    "ALTER TABLE work_clarifications RENAME COLUMN answered_by_session_key TO answered_by_conversation_key",
  ];
  for (const statement of statements) {
    mem.public.none(statement);
  }
}

function registerCommonPgFunctions(mem: ReturnType<typeof newDb>): void {
  mem.public.registerFunction({
    name: "nullif",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (left: string | null, right: string | null) => {
      if (left === null) return null;
      return left === right ? null : left;
    },
  });

  mem.public.registerFunction({
    name: "trim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });

  mem.public.registerFunction({
    name: "btrim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });

  mem.public.registerFunction({
    name: "strpos",
    args: [DataType.text, DataType.text],
    returns: DataType.integer,
    implementation: (haystack: string, needle: string) => {
      const idx = haystack.indexOf(needle);
      return idx >= 0 ? idx + 1 : 0;
    },
  });

  mem.public.registerFunction({
    name: "replace",
    args: [DataType.text, DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (value: string, search: string, replacement: string) => {
      if (search.length === 0) return value;
      return value.replaceAll(search, replacement);
    },
  });

  mem.public.registerFunction({
    name: "jsonb_array_length",
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: (value: unknown) => {
      if (!Array.isArray(value)) {
        throw new Error("cannot get array length of a scalar/object");
      }
      return value.length;
    },
  });

  mem.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      if (typeof value === "object") return "object";
      if (typeof value === "string") return "string";
      if (typeof value === "number") return "number";
      if (typeof value === "boolean") return "boolean";
      return "unknown";
    },
  });

  mem.public.registerFunction({
    name: "jsonb_set",
    args: [DataType.jsonb, DataType.text, DataType.jsonb, DataType.bool],
    returns: DataType.jsonb,
    implementation: (
      value: unknown,
      pathText: string,
      replacement: unknown,
      createMissing: boolean,
    ) => {
      const path = parseJsonbSetPath(pathText);
      if (path.length === 0) return structuredClone(value);
      return setJsonbPath(value, path, replacement, createMissing);
    },
  });

  mem.public.registerFunction({
    name: "jsonb_build_object",
    argsVariadic: DataType.text,
    returns: DataType.jsonb,
    implementation: (...args: Array<string | null>) => buildJsonbObjectFromTextArgs(args),
  });

  mem.public.registerFunction({
    name: "pg_input_is_valid",
    args: [DataType.text, DataType.text],
    returns: DataType.bool,
    implementation: (value: string, targetType: string) => {
      if (!targetType || !targetType.toLowerCase().includes("json")) return false;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
  });
}

function registerNoopPlpgsql(mem: ReturnType<typeof newDb>): void {
  mem.registerLanguage("plpgsql", ({ code }) => {
    return () => {
      const source = String(code);
      const isIfExistsGuard = /IF\s+EXISTS\s*\(/i.test(source);
      const hasExecute = /EXECUTE\s+'/i.test(source);
      if (!isIfExistsGuard || !hasExecute) {
        throw new Error(
          "pg-mem does not execute plpgsql blocks; extend this stub or avoid DO $$ in migrations",
        );
      }
      // No-op: pg-mem has no plpgsql interpreter. Our Postgres migrations only use
      // DO $$ guards for backwards compatibility; the mainline schema is covered
      // by contract tests without needing to execute these blocks.
    };
  });
}

export function createPgMemDb(): ReturnType<typeof newDb> {
  const mem = newDb();
  registerCommonPgFunctions(mem);
  registerNoopPlpgsql(mem);
  mem.public.interceptQueries((sql) => {
    if (isApplyingConversationTurnCleanBreakMigration()) {
      return null;
    }
    if (isSessionTitlesMigration(sql)) {
      applySessionTitlesMigration(mem);
      return [];
    }
    if (isSessionTranscriptMigration(sql)) {
      applySessionTranscriptMigration(mem);
      return [];
    }
    if (isAgentAccessDefaultsToolsMigration(sql)) {
      applyAgentAccessDefaultsToolsMigration(mem);
      return [];
    }
    if (isGuardianReviewMigration(sql)) {
      applyGuardianReviewMigration(mem, sql);
      return [];
    }
    if (isWorkboardConversationTurnStorageMigration(sql)) {
      applyWorkboardConversationTurnStorageMigration(mem);
      return [];
    }
    if (isConversationTurnCleanBreakMigration(sql)) {
      applyConversationTurnCleanBreakMigration({ mem, toSqlTextLiteral });
      return [];
    }
    return null;
  });
  return mem;
}
