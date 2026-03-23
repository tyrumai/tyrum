export type StructuredJsonDraftKind = "array" | "boolean" | "null" | "number" | "object" | "string";

export type StructuredJsonDraft =
  | {
      kind: "array";
      items: StructuredJsonDraftArrayItem[];
    }
  | {
      kind: "boolean";
      value: boolean;
    }
  | {
      kind: "null";
    }
  | {
      kind: "number";
      value: string;
    }
  | {
      kind: "object";
      entries: StructuredJsonDraftObjectEntry[];
    }
  | {
      kind: "string";
      value: string;
    };

export type StructuredJsonDraftArrayItem = {
  id: string;
  value: StructuredJsonDraft;
};

export type StructuredJsonDraftObjectEntry = {
  id: string;
  key: string;
  value: StructuredJsonDraft;
};

type StructuredJsonSerializeResult =
  | {
      value: unknown;
      errorMessage: null;
    }
  | {
      value: undefined;
      errorMessage: string;
    };

let nextStructuredJsonDraftId = 1;

function createDraftId(): string {
  const id = `json-draft-${String(nextStructuredJsonDraftId)}`;
  nextStructuredJsonDraftId += 1;
  return id;
}

export function createStructuredJsonDraft(kind: StructuredJsonDraftKind): StructuredJsonDraft {
  switch (kind) {
    case "array":
      return { kind, items: [] };
    case "boolean":
      return { kind, value: false };
    case "null":
      return { kind };
    case "number":
      return { kind, value: "0" };
    case "object":
      return { kind, entries: [] };
    case "string":
      return { kind, value: "" };
  }
}

export function createStructuredJsonObjectEntry(
  key = "field_1",
  value: StructuredJsonDraft = createStructuredJsonDraft("string"),
): StructuredJsonDraftObjectEntry {
  return {
    id: createDraftId(),
    key,
    value,
  };
}

export function createStructuredJsonArrayItem(
  value: StructuredJsonDraft = createStructuredJsonDraft("string"),
): StructuredJsonDraftArrayItem {
  return {
    id: createDraftId(),
    value,
  };
}

export function createStructuredJsonDraftFromValue(
  value: unknown,
  fallbackKind: StructuredJsonDraftKind = "object",
): StructuredJsonDraft {
  if (value === undefined) {
    return createStructuredJsonDraft(fallbackKind);
  }
  if (value === null) {
    return { kind: "null" };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      items: value.map((item) =>
        createStructuredJsonArrayItem(createStructuredJsonDraftFromValue(item)),
      ),
    };
  }
  if (typeof value === "object") {
    return {
      kind: "object",
      entries: Object.entries(value as Record<string, unknown>).map(([key, entryValue]) =>
        createStructuredJsonObjectEntry(key, createStructuredJsonDraftFromValue(entryValue)),
      ),
    };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }
  if (typeof value === "number") {
    return { kind: "number", value: String(value) };
  }
  return { kind: "string", value: String(value) };
}

export function structuredJsonValueSignature(value: unknown | undefined): string {
  if (value === undefined) {
    return "__undefined__";
  }
  return JSON.stringify(value);
}

export function serializeStructuredJsonDraft(
  draft: StructuredJsonDraft,
): StructuredJsonSerializeResult {
  return serializeStructuredJsonDraftAtPath(draft, "Value");
}

function serializeStructuredJsonDraftAtPath(
  draft: StructuredJsonDraft,
  path: string,
): StructuredJsonSerializeResult {
  switch (draft.kind) {
    case "string":
      return {
        value: draft.value,
        errorMessage: null,
      };
    case "number":
      return serializeStructuredJsonNumberDraft(draft.value, path);
    case "boolean":
      return {
        value: draft.value,
        errorMessage: null,
      };
    case "null":
      return {
        value: null,
        errorMessage: null,
      };
    case "array":
      return serializeStructuredJsonArrayDraft(draft.items, path);
    case "object":
      return serializeStructuredJsonObjectDraft(draft.entries, path);
  }
}

function serializeStructuredJsonNumberDraft(
  value: string,
  path: string,
): StructuredJsonSerializeResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      value: undefined,
      errorMessage: `${path} requires a number.`,
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return {
      value: undefined,
      errorMessage: `${path} must be a valid number.`,
    };
  }
  return {
    value: parsed,
    errorMessage: null,
  };
}

function serializeStructuredJsonArrayDraft(
  items: readonly StructuredJsonDraftArrayItem[],
  path: string,
): StructuredJsonSerializeResult {
  const result: unknown[] = [];
  for (const [index, item] of items.entries()) {
    const child = serializeStructuredJsonDraftAtPath(item.value, `${path}[${String(index + 1)}]`);
    if (child.errorMessage) {
      return child;
    }
    result.push(child.value);
  }
  return {
    value: result,
    errorMessage: null,
  };
}

function serializeStructuredJsonObjectDraft(
  entries: readonly StructuredJsonDraftObjectEntry[],
  path: string,
): StructuredJsonSerializeResult {
  const result: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const key = entry.key.trim();
    if (!key) {
      return {
        value: undefined,
        errorMessage: `${path} has an empty field name at row ${String(index + 1)}.`,
      };
    }
    if (seen.has(key)) {
      return {
        value: undefined,
        errorMessage: `${path} contains the duplicate field '${key}'.`,
      };
    }
    seen.add(key);

    const child = serializeStructuredJsonDraftAtPath(entry.value, `${path}.${key}`);
    if (child.errorMessage) {
      return child;
    }
    result[key] = child.value;
  }

  return {
    value: result,
    errorMessage: null,
  };
}
