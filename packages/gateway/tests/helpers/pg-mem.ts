import { DataType, newDb } from "pg-mem";
import { normalizeSessionTitle } from "../../src/modules/agent/session-dal-helpers.js";

const SESSION_TITLES_MIGRATION_MARKERS = [
  "ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  "FROM jsonb_array_elements(",
] as const;
const SESSION_TRANSCRIPT_MIGRATION_MARKERS = [
  "UPDATE sessions",
  "SET turns_json = COALESCE(",
  "jsonb_array_elements(sessions.turns_json::jsonb)",
] as const;

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

function isSessionTitlesMigration(sql: string): boolean {
  return SESSION_TITLES_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function isSessionTranscriptMigration(sql: string): boolean {
  return SESSION_TRANSCRIPT_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

function toSqlTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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

function migrateLegacyTurnsToTranscript(turnsJson: string, createdAt: string, sessionId: string): string {
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
          role:
            role === "user" || role === "assistant" || role === "system" ? role : "assistant",
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

function registerCommonPgFunctions(mem: ReturnType<typeof newDb>): void {
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
    if (isSessionTitlesMigration(sql)) {
      applySessionTitlesMigration(mem);
      return [];
    }
    if (isSessionTranscriptMigration(sql)) {
      applySessionTranscriptMigration(mem);
      return [];
    }
    return null;
  });
  return mem;
}
