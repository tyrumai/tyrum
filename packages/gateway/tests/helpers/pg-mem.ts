import { DataType, newDb } from "pg-mem";

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
  return mem;
}
