import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";

export type PolicyEffectiveBundle = {
  sha256: string;
  bundle: PolicyBundleT;
  sources: {
    deployment: string;
    agent: string | null;
    playbook: "inline" | null;
  };
};

export type PolicyConfigRevision = {
  revision: number;
  created_at?: string | null;
  created_by?: unknown;
  reason?: string | null;
  reverted_from_revision?: number | null;
};

export interface PolicyConfigSectionProps {
  effective: PolicyEffectiveBundle | null;
  currentRevision: PolicyConfigRevision | null;
  revisions: PolicyConfigRevision[];
  loadBusy: boolean;
  loadError: unknown;
  saveBusy: boolean;
  saveError: unknown;
  revertBusy: boolean;
  revertError: unknown;
  canMutate: boolean;
  requestEnter: () => void;
  onRefresh: () => void;
  onSave: (bundle: PolicyBundleT, reason: string) => Promise<void>;
  onRevert: (revision: number, reason: string) => Promise<void>;
}
