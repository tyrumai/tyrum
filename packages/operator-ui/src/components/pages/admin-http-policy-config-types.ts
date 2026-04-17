import type {
  DeploymentPolicyConfigGetResponse as PolicyConfigDeployment,
  DeploymentPolicyConfigRevision as PolicyConfigRevision,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/contracts";
import type { ToolRegistryEntry } from "./admin-http-tools.metadata.js";

export type { PolicyConfigDeployment, PolicyConfigRevision, ToolRegistryEntry };

export type PolicyEffectiveBundle = {
  sha256: string;
  bundle: PolicyBundleT;
  sources: {
    deployment: string;
    agent: string | null;
    playbook: "inline" | null;
  };
};

export interface PolicyConfigSectionProps {
  effective: PolicyEffectiveBundle | null;
  currentRevision: PolicyConfigDeployment | null;
  revisions: PolicyConfigRevision[];
  configUnavailable: boolean;
  loadBusy: boolean;
  loadError: unknown;
  saveBusy: boolean;
  revertBusy: boolean;
  canMutate: boolean;
  requestEnter: () => void;
  onRefresh: () => void;
  onSave: (bundle: PolicyBundleT, reason: string) => Promise<boolean>;
  onRevert: (revision: number, reason: string) => Promise<void | false>;
  toolRegistry?: ToolRegistryEntry[];
}
