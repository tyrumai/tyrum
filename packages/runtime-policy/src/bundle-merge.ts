import type { Decision, PolicyBundle as PolicyBundleT } from "@tyrum/contracts";
import { PolicyBundle } from "@tyrum/contracts";
import { mostRestrictiveDecision, normalizeDomain, type PolicyDomainConfig } from "./domain.js";

function unionStrings(a: readonly string[], b: readonly string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  return [...new Set([...a, ...b])];
}

function mergeDomain(
  domains: Array<PolicyDomainConfig | undefined>,
  fallbackDefault: Decision,
): PolicyDomainConfig {
  let defaultDecision: Decision = fallbackDefault;
  let allow: string[] = [];
  let requireApproval: string[] = [];
  let deny: string[] = [];

  for (const domain of domains) {
    if (!domain) continue;
    defaultDecision = mostRestrictiveDecision(defaultDecision, domain.default);
    allow = unionStrings(allow, domain.allow);
    requireApproval = unionStrings(requireApproval, domain.require_approval);
    deny = unionStrings(deny, domain.deny);
  }

  return {
    default: defaultDecision,
    allow,
    require_approval: requireApproval,
    deny,
  };
}

function mergeToolDomain(
  domains: Array<
    | {
        allow?: readonly string[];
        require_approval?: readonly string[];
        deny?: readonly string[];
      }
    | undefined
  >,
): {
  allow: string[];
  require_approval: string[];
  deny: string[];
} {
  let allow: string[] = [];
  let requireApproval: string[] = [];
  let deny: string[] = [];

  for (const domain of domains) {
    if (!domain) continue;
    allow = unionStrings(allow, domain.allow ?? []);
    requireApproval = unionStrings(requireApproval, domain.require_approval ?? []);
    deny = unionStrings(deny, domain.deny ?? []);
  }

  return {
    allow,
    require_approval: requireApproval,
    deny,
  };
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function minOrUndefined(values: readonly number[]): number | undefined {
  return values.length > 0 ? Math.min(...values) : undefined;
}

function mergeBySensitivity(values: Array<Record<string, unknown>>): {
  normal?: number;
  sensitive?: number;
} {
  return {
    normal: values
      .map((value) => value["normal"])
      .filter(isPositiveFiniteNumber)
      .reduce<number | undefined>(
        (acc, number) => (acc === undefined ? number : Math.min(acc, number)),
        undefined,
      ),
    sensitive: values
      .map((value) => value["sensitive"])
      .filter(isPositiveFiniteNumber)
      .reduce<number | undefined>(
        (acc, number) => (acc === undefined ? number : Math.min(acc, number)),
        undefined,
      ),
  };
}

function mergeByLabel(
  bundles: Array<PolicyBundleT | undefined>,
  pick: (bundle: NonNullable<PolicyBundleT["artifacts"]>) => Record<string, unknown> | undefined,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const bundle of bundles) {
    const artifacts = bundle?.artifacts;
    if (!artifacts) continue;
    const raw = pick(artifacts);
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (!isPositiveFiniteNumber(value)) continue;
      const previous = merged[label];
      merged[label] = previous === undefined ? value : Math.min(previous, value);
    }
  }
  return merged;
}

function mergeByLabelSensitivity(
  bundles: Array<PolicyBundleT | undefined>,
  pick: (bundle: NonNullable<PolicyBundleT["artifacts"]>) => Record<string, unknown> | undefined,
): Record<string, { normal?: number; sensitive?: number }> {
  const merged: Record<string, { normal?: number; sensitive?: number }> = {};
  for (const bundle of bundles) {
    const artifacts = bundle?.artifacts;
    if (!artifacts) continue;
    const raw = pick(artifacts);
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      const entry = merged[label] ?? (merged[label] = {});

      const normal = (value as Record<string, unknown>)["normal"];
      if (isPositiveFiniteNumber(normal)) {
        entry.normal = entry.normal === undefined ? normal : Math.min(entry.normal, normal);
      }

      const sensitive = (value as Record<string, unknown>)["sensitive"];
      if (isPositiveFiniteNumber(sensitive)) {
        entry.sensitive =
          entry.sensitive === undefined ? sensitive : Math.min(entry.sensitive, sensitive);
      }
    }
  }
  return merged;
}

export function mergePolicyBundles(bundles: Array<PolicyBundleT | undefined>): PolicyBundleT {
  const base = PolicyBundle.parse({ v: 1 });

  const tools = mergeToolDomain(bundles.map((bundle) => bundle?.tools));
  const networkEgress = mergeDomain(
    bundles.map((bundle) =>
      bundle?.network_egress
        ? normalizeDomain(bundle.network_egress, "require_approval")
        : undefined,
    ),
    normalizeDomain(base.network_egress, "require_approval").default,
  );
  const secrets = mergeDomain(
    bundles.map((bundle) =>
      bundle?.secrets ? normalizeDomain(bundle.secrets, "require_approval") : undefined,
    ),
    normalizeDomain(base.secrets, "require_approval").default,
  );
  const connectors = mergeDomain(
    bundles.map((bundle) =>
      bundle?.connectors ? normalizeDomain(bundle.connectors, "require_approval") : undefined,
    ),
    normalizeDomain(base.connectors, "require_approval").default,
  );

  const artifactsDefault = bundles.reduce<Decision>(
    (decision, bundle) =>
      bundle?.artifacts?.default
        ? mostRestrictiveDecision(decision, bundle.artifacts.default)
        : decision,
    base.artifacts?.default ?? "allow",
  );
  const retentionDefault = minOrUndefined(
    bundles
      .map((bundle) => bundle?.artifacts?.retention?.default_days)
      .filter(isPositiveFiniteNumber),
  );
  const quotaDefault = minOrUndefined(
    bundles
      .map((bundle) => bundle?.artifacts?.quota?.default_max_bytes)
      .filter(isPositiveFiniteNumber),
  );

  const retentionBySensitivity = mergeBySensitivity(
    bundles
      .map((bundle) => bundle?.artifacts?.retention?.by_sensitivity)
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object"),
  );
  const quotaBySensitivity = mergeBySensitivity(
    bundles
      .map((bundle) => bundle?.artifacts?.quota?.by_sensitivity)
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object"),
  );

  const retentionByLabel = mergeByLabel(
    bundles,
    (artifacts) => artifacts.retention?.by_label as Record<string, unknown> | undefined,
  );
  const quotaByLabel = mergeByLabel(
    bundles,
    (artifacts) => artifacts.quota?.by_label as Record<string, unknown> | undefined,
  );
  const retentionByLabelSensitivity = mergeByLabelSensitivity(
    bundles,
    (artifacts) => artifacts.retention?.by_label_sensitivity as Record<string, unknown> | undefined,
  );
  const quotaByLabelSensitivity = mergeByLabelSensitivity(
    bundles,
    (artifacts) => artifacts.quota?.by_label_sensitivity as Record<string, unknown> | undefined,
  );

  const provenanceValues = new Set(
    bundles
      .map((bundle) => bundle?.provenance?.untrusted_shell_requires_approval)
      .filter((value): value is boolean => typeof value === "boolean"),
  );
  const provenanceShellApproval = provenanceValues.has(true) || !provenanceValues.has(false);

  return PolicyBundle.parse({
    v: 1,
    tools,
    network_egress: networkEgress,
    secrets,
    connectors,
    artifacts: {
      default: artifactsDefault,
      retention:
        retentionDefault !== undefined ||
        Object.keys(retentionByLabel).length > 0 ||
        retentionBySensitivity.normal !== undefined ||
        retentionBySensitivity.sensitive !== undefined ||
        Object.keys(retentionByLabelSensitivity).length > 0
          ? {
              default_days: retentionDefault,
              by_label: Object.keys(retentionByLabel).length > 0 ? retentionByLabel : undefined,
              by_sensitivity:
                retentionBySensitivity.normal !== undefined ||
                retentionBySensitivity.sensitive !== undefined
                  ? retentionBySensitivity
                  : undefined,
              by_label_sensitivity:
                Object.keys(retentionByLabelSensitivity).length > 0
                  ? retentionByLabelSensitivity
                  : undefined,
            }
          : undefined,
      quota:
        quotaDefault !== undefined ||
        Object.keys(quotaByLabel).length > 0 ||
        quotaBySensitivity.normal !== undefined ||
        quotaBySensitivity.sensitive !== undefined ||
        Object.keys(quotaByLabelSensitivity).length > 0
          ? {
              default_max_bytes: quotaDefault,
              by_label: Object.keys(quotaByLabel).length > 0 ? quotaByLabel : undefined,
              by_sensitivity:
                quotaBySensitivity.normal !== undefined ||
                quotaBySensitivity.sensitive !== undefined
                  ? quotaBySensitivity
                  : undefined,
              by_label_sensitivity:
                Object.keys(quotaByLabelSensitivity).length > 0
                  ? quotaByLabelSensitivity
                  : undefined,
            }
          : undefined,
    },
    provenance: {
      untrusted_shell_requires_approval: provenanceShellApproval,
    },
  });
}
