import { canonicalizeToolIdList, type PolicyBundle as PolicyBundleT } from "@tyrum/contracts";

export type PolicyDecisionValue = "allow" | "require_approval" | "deny";

export type PolicyStringRow = {
  id: string;
  value: string;
};

export type PolicyKeyNumberRow = {
  id: string;
  key: string;
  value: string;
};

export type PolicyKeySensitivityRow = {
  id: string;
  key: string;
  normal: string;
  sensitive: string;
};

export type PolicyDomainFormState = {
  defaultDecision?: PolicyDecisionValue;
  allow: PolicyStringRow[];
  requireApproval: PolicyStringRow[];
  deny: PolicyStringRow[];
};

export type PolicyArtifactsFormState = {
  defaultDecision: PolicyDecisionValue;
  retentionDefaultDays: string;
  retentionByLabel: PolicyKeyNumberRow[];
  retentionBySensitivity: {
    normal: string;
    sensitive: string;
  };
  retentionByLabelSensitivity: PolicyKeySensitivityRow[];
  quotaDefaultMaxBytes: string;
  quotaByLabel: PolicyKeyNumberRow[];
  quotaBySensitivity: {
    normal: string;
    sensitive: string;
  };
  quotaByLabelSensitivity: PolicyKeySensitivityRow[];
};

export type PolicyFormState = {
  approvals: {
    autoReviewMode: "auto_review" | "manual_only";
  };
  tools: PolicyDomainFormState;
  networkEgress: PolicyDomainFormState;
  secrets: PolicyDomainFormState;
  connectors: PolicyDomainFormState;
  artifacts: PolicyArtifactsFormState;
  provenance: {
    untrustedShellRequiresApproval: boolean;
  };
};

function createRowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createStringRows(values: readonly string[], prefix: string): PolicyStringRow[] {
  return values.map((value) => ({
    id: createRowId(prefix),
    value,
  }));
}

function createKeyNumberRows(
  values: Record<string, number> | undefined,
  prefix: string,
): PolicyKeyNumberRow[] {
  return Object.entries(values ?? {}).map(([key, value]) => ({
    id: createRowId(prefix),
    key,
    value: String(value),
  }));
}

function createKeySensitivityRows(
  values: Record<string, { normal?: number; sensitive?: number }> | undefined,
  prefix: string,
): PolicyKeySensitivityRow[] {
  return Object.entries(values ?? {}).map(([key, value]) => ({
    id: createRowId(prefix),
    key,
    normal: value.normal === undefined ? "" : String(value.normal),
    sensitive: value.sensitive === undefined ? "" : String(value.sensitive),
  }));
}

function createDomainFormState(
  value:
    | {
        default?: PolicyDecisionValue;
        allow?: string[];
        require_approval?: string[];
        deny?: string[];
      }
    | undefined,
  fallback: PolicyDecisionValue,
  prefix: string,
): PolicyDomainFormState {
  return {
    defaultDecision: value?.default ?? fallback,
    allow: createStringRows(value?.allow ?? [], `${prefix}-allow`),
    requireApproval: createStringRows(value?.require_approval ?? [], `${prefix}-approval`),
    deny: createStringRows(value?.deny ?? [], `${prefix}-deny`),
  };
}

function createToolDomainFormState(
  value:
    | {
        allow?: string[];
        require_approval?: string[];
        deny?: string[];
      }
    | undefined,
  prefix: string,
): PolicyDomainFormState {
  return {
    allow: createStringRows(value?.allow ?? [], `${prefix}-allow`),
    requireApproval: createStringRows(value?.require_approval ?? [], `${prefix}-approval`),
    deny: createStringRows(value?.deny ?? [], `${prefix}-deny`),
  };
}

function parsePositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function normalizeStringRows(
  rows: PolicyStringRow[],
  transform?: (value: string) => readonly string[],
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of rows) {
    const trimmed = row.value.trim();
    if (!trimmed) continue;
    const normalizedValues = transform ? transform(trimmed) : [trimmed];
    for (const normalized of normalizedValues) {
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(normalized);
    }
  }
  return values;
}

function normalizeKeyNumberRows(rows: PolicyKeyNumberRow[]): Record<string, number> | undefined {
  const values = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.key.trim();
    const value = parsePositiveInt(row.value);
    if (!key || value === undefined) return acc;
    acc[key] = value;
    return acc;
  }, {});
  return Object.keys(values).length > 0 ? values : undefined;
}

function normalizeKeySensitivityRows(
  rows: PolicyKeySensitivityRow[],
): Record<string, { normal?: number; sensitive?: number }> | undefined {
  const values = rows.reduce<Record<string, { normal?: number; sensitive?: number }>>(
    (acc, row) => {
      const key = row.key.trim();
      if (!key) return acc;
      const normal = parsePositiveInt(row.normal);
      const sensitive = parsePositiveInt(row.sensitive);
      if (normal === undefined && sensitive === undefined) return acc;
      acc[key] = {
        ...acc[key],
        ...(normal === undefined ? {} : { normal }),
        ...(sensitive === undefined ? {} : { sensitive }),
      };
      return acc;
    },
    {},
  );
  return Object.keys(values).length > 0 ? values : undefined;
}

function normalizeSensitivityInput(value: {
  normal: string;
  sensitive: string;
}): { normal?: number; sensitive?: number } | undefined {
  const normal = parsePositiveInt(value.normal);
  const sensitive = parsePositiveInt(value.sensitive);
  if (normal === undefined && sensitive === undefined) return undefined;
  return {
    ...(normal === undefined ? {} : { normal }),
    ...(sensitive === undefined ? {} : { sensitive }),
  };
}

function expandToolIds(value: string): readonly string[] {
  return canonicalizeToolIdList([value]);
}

function toDomainBundle(
  value: PolicyDomainFormState,
  fallbackDefault: PolicyDecisionValue,
  normalizeToolIds = false,
) {
  return {
    default: value.defaultDecision ?? fallbackDefault,
    allow: normalizeStringRows(value.allow, normalizeToolIds ? expandToolIds : undefined),
    require_approval: normalizeStringRows(
      value.requireApproval,
      normalizeToolIds ? expandToolIds : undefined,
    ),
    deny: normalizeStringRows(value.deny, normalizeToolIds ? expandToolIds : undefined),
  };
}

function toToolDomainBundle(value: PolicyDomainFormState) {
  return {
    allow: normalizeStringRows(value.allow, expandToolIds),
    require_approval: normalizeStringRows(value.requireApproval, expandToolIds),
    deny: normalizeStringRows(value.deny, expandToolIds),
  };
}

export function createBlankStringRow(prefix: string): PolicyStringRow {
  return { id: createRowId(prefix), value: "" };
}

export function createBlankKeyNumberRow(prefix: string): PolicyKeyNumberRow {
  return { id: createRowId(prefix), key: "", value: "" };
}

export function createBlankKeySensitivityRow(prefix: string): PolicyKeySensitivityRow {
  return { id: createRowId(prefix), key: "", normal: "", sensitive: "" };
}

export function normalizeToolRows(rows: PolicyStringRow[]): PolicyStringRow[] {
  const seen = new Set<string>();
  const nextRows: PolicyStringRow[] = [];

  for (const row of rows) {
    const trimmed = row.value.trim();
    if (!trimmed) {
      nextRows.push(row);
      continue;
    }

    const canonicalValues = canonicalizeToolIdList([trimmed]);
    if (canonicalValues.length === 0) {
      continue;
    }

    let inserted = false;
    for (const [index, canonical] of canonicalValues.entries()) {
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      nextRows.push(
        canonical === row.value && index === 0 && !inserted
          ? row
          : {
              ...row,
              id: inserted ? createRowId(row.id) : row.id,
              value: canonical,
            },
      );
      inserted = true;
    }
  }

  return nextRows;
}

export function policyBundleToFormState(bundle: PolicyBundleT): PolicyFormState {
  return {
    approvals: {
      autoReviewMode: bundle.approvals?.auto_review?.mode ?? "auto_review",
    },
    tools: createToolDomainFormState(bundle.tools, "tools"),
    networkEgress: createDomainFormState(bundle.network_egress, "deny", "network-egress"),
    secrets: createDomainFormState(bundle.secrets, "deny", "secrets"),
    connectors: createDomainFormState(bundle.connectors, "deny", "connectors"),
    artifacts: {
      defaultDecision: bundle.artifacts?.default ?? "allow",
      retentionDefaultDays:
        bundle.artifacts?.retention?.default_days === undefined
          ? ""
          : String(bundle.artifacts.retention.default_days),
      retentionByLabel: createKeyNumberRows(
        bundle.artifacts?.retention?.by_label,
        "retention-label",
      ),
      retentionBySensitivity: {
        normal:
          bundle.artifacts?.retention?.by_sensitivity?.normal === undefined
            ? ""
            : String(bundle.artifacts.retention.by_sensitivity.normal),
        sensitive:
          bundle.artifacts?.retention?.by_sensitivity?.sensitive === undefined
            ? ""
            : String(bundle.artifacts.retention.by_sensitivity.sensitive),
      },
      retentionByLabelSensitivity: createKeySensitivityRows(
        bundle.artifacts?.retention?.by_label_sensitivity,
        "retention-label-sensitivity",
      ),
      quotaDefaultMaxBytes:
        bundle.artifacts?.quota?.default_max_bytes === undefined
          ? ""
          : String(bundle.artifacts.quota.default_max_bytes),
      quotaByLabel: createKeyNumberRows(bundle.artifacts?.quota?.by_label, "quota-label"),
      quotaBySensitivity: {
        normal:
          bundle.artifacts?.quota?.by_sensitivity?.normal === undefined
            ? ""
            : String(bundle.artifacts.quota.by_sensitivity.normal),
        sensitive:
          bundle.artifacts?.quota?.by_sensitivity?.sensitive === undefined
            ? ""
            : String(bundle.artifacts.quota.by_sensitivity.sensitive),
      },
      quotaByLabelSensitivity: createKeySensitivityRows(
        bundle.artifacts?.quota?.by_label_sensitivity,
        "quota-label-sensitivity",
      ),
    },
    provenance: {
      untrustedShellRequiresApproval: bundle.provenance?.untrusted_shell_requires_approval ?? true,
    },
  };
}

export function policyFormStateToBundle(state: PolicyFormState): PolicyBundleT {
  const retentionDefaultDays = parsePositiveInt(state.artifacts.retentionDefaultDays);
  const quotaDefaultMaxBytes = parsePositiveInt(state.artifacts.quotaDefaultMaxBytes);
  const retentionByLabel = normalizeKeyNumberRows(state.artifacts.retentionByLabel);
  const quotaByLabel = normalizeKeyNumberRows(state.artifacts.quotaByLabel);
  const retentionBySensitivity = normalizeSensitivityInput(state.artifacts.retentionBySensitivity);
  const quotaBySensitivity = normalizeSensitivityInput(state.artifacts.quotaBySensitivity);
  const retentionByLabelSensitivity = normalizeKeySensitivityRows(
    state.artifacts.retentionByLabelSensitivity,
  );
  const quotaByLabelSensitivity = normalizeKeySensitivityRows(
    state.artifacts.quotaByLabelSensitivity,
  );

  return {
    v: 1,
    approvals: {
      auto_review: {
        mode: state.approvals.autoReviewMode,
      },
    },
    tools: toToolDomainBundle(state.tools),
    network_egress: toDomainBundle(state.networkEgress, "deny"),
    secrets: toDomainBundle(state.secrets, "deny"),
    connectors: toDomainBundle(state.connectors, "deny"),
    artifacts: {
      default: state.artifacts.defaultDecision,
      retention:
        retentionDefaultDays === undefined &&
        retentionByLabel === undefined &&
        retentionBySensitivity === undefined &&
        retentionByLabelSensitivity === undefined
          ? undefined
          : {
              ...(retentionDefaultDays === undefined ? {} : { default_days: retentionDefaultDays }),
              ...(retentionByLabel === undefined ? {} : { by_label: retentionByLabel }),
              ...(retentionBySensitivity === undefined
                ? {}
                : { by_sensitivity: retentionBySensitivity }),
              ...(retentionByLabelSensitivity === undefined
                ? {}
                : { by_label_sensitivity: retentionByLabelSensitivity }),
            },
      quota:
        quotaDefaultMaxBytes === undefined &&
        quotaByLabel === undefined &&
        quotaBySensitivity === undefined &&
        quotaByLabelSensitivity === undefined
          ? undefined
          : {
              ...(quotaDefaultMaxBytes === undefined
                ? {}
                : { default_max_bytes: quotaDefaultMaxBytes }),
              ...(quotaByLabel === undefined ? {} : { by_label: quotaByLabel }),
              ...(quotaBySensitivity === undefined ? {} : { by_sensitivity: quotaBySensitivity }),
              ...(quotaByLabelSensitivity === undefined
                ? {}
                : { by_label_sensitivity: quotaByLabelSensitivity }),
            },
    },
    provenance: {
      untrusted_shell_requires_approval: state.provenance.untrustedShellRequiresApproval,
    },
  };
}

export function stringifyPolicyBundle(bundle: PolicyBundleT): string {
  return JSON.stringify(bundle);
}
