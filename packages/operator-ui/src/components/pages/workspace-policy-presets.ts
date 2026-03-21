import { TyrumHttpClientError } from "@tyrum/operator-app/browser";
import { PolicyBundle } from "@tyrum/contracts";

export type WorkspacePolicyPresetKey = "safest" | "moderate" | "power_user";
type PolicyDecision = "allow" | "require_approval" | "deny";

type PolicyRuleSet = {
  default: PolicyDecision;
  allow: string[];
  require_approval: string[];
  deny: string[];
};

type WorkspacePolicyBundleInput = {
  v: 1;
  tools: {
    allow: string[];
    require_approval: string[];
    deny: string[];
  };
  network_egress: PolicyRuleSet;
  secrets: PolicyRuleSet;
  connectors: PolicyRuleSet;
  artifacts: {
    default: "allow";
  };
  provenance: {
    untrusted_shell_requires_approval: boolean;
  };
  approvals: {
    auto_review: {
      mode: "auto_review" | "manual_only";
    };
  };
};

function validateWorkspacePolicyBundle(
  bundle: WorkspacePolicyBundleInput,
): WorkspacePolicyBundleInput {
  PolicyBundle.parse(bundle);
  return bundle;
}

export const WORKSPACE_POLICY_PRESET_OPTIONS: ReadonlyArray<{
  key: WorkspacePolicyPresetKey;
  label: string;
  description: string;
}> = [
  {
    key: "safest",
    label: "Safest",
    description: "Deny tools and external access by default.",
  },
  {
    key: "moderate",
    label: "Moderate",
    description: "Balanced defaults with approval-gated network, secrets, and connectors.",
  },
  {
    key: "power_user",
    label: "Power user",
    description: "Allow broad access across tools and external surfaces.",
  },
] as const;

export function buildWorkspacePolicyBundle(
  preset: WorkspacePolicyPresetKey,
): WorkspacePolicyBundleInput {
  if (preset === "safest") {
    return validateWorkspacePolicyBundle({
      v: 1,
      tools: { allow: [], require_approval: [], deny: ["*"] },
      network_egress: { default: "deny", allow: [], require_approval: [], deny: [] },
      secrets: { default: "deny", allow: [], require_approval: [], deny: [] },
      connectors: { default: "deny", allow: [], require_approval: [], deny: [] },
      artifacts: { default: "allow" },
      provenance: { untrusted_shell_requires_approval: true },
      approvals: { auto_review: { mode: "auto_review" } },
    });
  }

  if (preset === "power_user") {
    return validateWorkspacePolicyBundle({
      v: 1,
      tools: { allow: ["*"], require_approval: [], deny: [] },
      network_egress: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      secrets: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      connectors: { default: "deny", allow: ["*"], require_approval: [], deny: [] },
      artifacts: { default: "allow" },
      provenance: { untrusted_shell_requires_approval: false },
      approvals: { auto_review: { mode: "auto_review" } },
    });
  }

  return validateWorkspacePolicyBundle({
    v: 1,
    tools: { allow: [], require_approval: [], deny: [] },
    network_egress: { default: "require_approval", allow: [], require_approval: [], deny: [] },
    secrets: { default: "require_approval", allow: [], require_approval: [], deny: [] },
    connectors: {
      default: "require_approval",
      allow: ["telegram:*"],
      require_approval: [],
      deny: [],
    },
    artifacts: { default: "allow" },
    provenance: { untrusted_shell_requires_approval: true },
    approvals: { auto_review: { mode: "auto_review" } },
  });
}

type DeploymentPolicyConfigUpdater = {
  updateDeployment(input: { bundle: WorkspacePolicyBundleInput; reason: string }): Promise<unknown>;
};

export async function saveWorkspacePolicyDeployment(input: {
  policyConfig: DeploymentPolicyConfigUpdater | undefined;
  preset: WorkspacePolicyPresetKey;
}): Promise<void> {
  if (!input.policyConfig) {
    throw new Error("Workspace policy configuration is unavailable on this gateway.");
  }

  try {
    await input.policyConfig.updateDeployment({
      bundle: buildWorkspacePolicyBundle(input.preset),
      reason: "onboarding: configure workspace policy",
    });
  } catch (error) {
    if (
      error instanceof TyrumHttpClientError &&
      error.status === 404 &&
      error.error === "not_found"
    ) {
      throw new Error("Workspace policy configuration is unavailable on this gateway.");
    }
    throw error;
  }
}
