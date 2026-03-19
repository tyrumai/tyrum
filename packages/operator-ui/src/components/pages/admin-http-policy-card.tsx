import { TyrumHttpClientError } from "@tyrum/operator-app/browser";
import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import {
  AdminAccessGateCard,
  isAdminAccessHttpError,
  useAdminHttpClient,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import {
  PolicyConfigSection,
  type PolicyConfigDeployment,
  type PolicyConfigRevision,
  type PolicyEffectiveBundle,
} from "./admin-http-policy-config.js";
import {
  PolicyOverridesSection,
  type PolicyAgentOption,
  type PolicyOverrideRecord,
  type PolicyToolOption,
} from "./admin-http-policy-overrides.js";

type PolicyConfigApi = {
  getDeployment: () => Promise<PolicyConfigDeployment>;
  listDeploymentRevisions: () => Promise<{ revisions: PolicyConfigRevision[] }>;
  updateDeployment: (input: { bundle: unknown; reason?: string }) => Promise<unknown>;
  revertDeployment: (input: { revision: number; reason?: string }) => Promise<unknown>;
};

type PolicyHttpClient = AdminHttpClient & {
  policyConfig?: PolicyConfigApi;
  agents?: {
    list: () => Promise<{
      agents: Array<{
        agent_id: string;
        agent_key: string;
        persona?: { name?: string };
      }>;
    }>;
  };
  toolRegistry?: {
    list: () => Promise<{
      status: "ok";
      tools: Array<{
        canonical_id: string;
        description: string;
      }>;
    }>;
  };
};

function isNotFoundError(error: unknown): boolean {
  return error instanceof TyrumHttpClientError && error.status === 404;
}

function normalizeAgentOptions(
  agents: Array<{
    agent_id: string;
    agent_key: string;
    persona?: { name?: string };
  }>,
): PolicyAgentOption[] {
  return agents
    .map((agent) => ({
      agentId: agent.agent_id.trim(),
      agentKey: agent.agent_key.trim(),
      displayName: agent.persona?.name?.trim() || agent.agent_key.trim(),
    }))
    .filter((agent) => agent.agentId && agent.agentKey)
    .toSorted((left, right) => left.agentKey.localeCompare(right.agentKey));
}

function normalizeToolOptions(
  tools: Array<{
    canonical_id: string;
    description: string;
  }>,
): PolicyToolOption[] {
  return tools
    .map((tool) => ({
      toolId: tool.canonical_id.trim(),
      description: tool.description,
    }))
    .filter((tool) => tool.toolId)
    .toSorted((left, right) => left.toolId.localeCompare(right.toolId));
}

function loadOptionalAuxiliary<T>(loader: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!loader) return Promise.resolve(fallback);
  return Promise.resolve()
    .then(() => loader())
    .catch(() => fallback);
}

async function loadOptionalPolicyConfig<T>(
  loader: (() => Promise<T>) | undefined,
  fallback: T,
): Promise<{ value: T; unavailable: boolean }> {
  if (!loader) {
    return { value: fallback, unavailable: true };
  }
  try {
    return { value: await loader(), unavailable: false };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { value: fallback, unavailable: true };
    }
    throw error;
  }
}

export function AdminHttpPolicyCard({
  core,
  canMutate,
  requestEnter,
}: {
  core: OperatorCore;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const readHttp = useAdminHttpClient() as PolicyHttpClient;
  const mutationHttp = useAdminMutationHttpClient() as PolicyHttpClient | null;
  const http = mutationHttp ?? readHttp;
  const [effective, setEffective] = React.useState<PolicyEffectiveBundle | null>(null);
  const [currentRevision, setCurrentRevision] = React.useState<PolicyConfigDeployment | null>(null);
  const [revisions, setRevisions] = React.useState<PolicyConfigRevision[]>([]);
  const [configUnavailable, setConfigUnavailable] = React.useState(false);
  const [overrides, setOverrides] = React.useState<PolicyOverrideRecord[]>([]);
  const [agents, setAgents] = React.useState<PolicyAgentOption[]>([]);
  const [tools, setTools] = React.useState<PolicyToolOption[]>([]);
  const [loadBusy, setLoadBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const [requiresAdminAccess, setRequiresAdminAccess] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [revertBusy, setRevertBusy] = React.useState(false);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [revokeBusy, setRevokeBusy] = React.useState(false);

  const requireMutationAccess = React.useCallback((): boolean => {
    if (canMutate) return true;
    requestEnter();
    return false;
  }, [canMutate, requestEnter]);

  const loadAll = React.useCallback(async (): Promise<void> => {
    setLoadBusy(true);
    setLoadError(null);
    try {
      if (!http.policyConfig) {
        throw new Error("Deployment policy config API unavailable.");
      }
      const [
        effectiveResult,
        revisionResult,
        revisionsResult,
        overridesResult,
        agentResult,
        toolResult,
      ] = await Promise.all([
        http.policy.getBundle(),
        loadOptionalPolicyConfig(http.policyConfig?.getDeployment, null),
        loadOptionalPolicyConfig(http.policyConfig?.listDeploymentRevisions, { revisions: [] }),
        http.policy.listOverrides({ limit: 500 }),
        loadOptionalAuxiliary(http.agents?.list, { agents: [] }),
        loadOptionalAuxiliary(http.toolRegistry?.list, { status: "ok" as const, tools: [] }),
      ]);
      setEffective(effectiveResult.effective);
      setCurrentRevision(revisionResult.value);
      setRevisions(revisionsResult.value.revisions);
      setConfigUnavailable(revisionResult.unavailable || revisionsResult.unavailable);
      setOverrides(overridesResult.overrides);
      setAgents(normalizeAgentOptions(agentResult.agents));
      setTools(normalizeToolOptions(toolResult.tools));
      setRequiresAdminAccess(false);
    } catch (error) {
      if (isAdminAccessHttpError(error)) {
        core.elevatedModeStore.exit();
        setRequiresAdminAccess(true);
        setLoadError(null);
        return;
      }
      setLoadError(error);
    } finally {
      setLoadBusy(false);
    }
  }, [core.elevatedModeStore, http]);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (requiresAdminAccess) {
    return (
      <AdminAccessGateCard
        title="Authorize admin access to load policy configuration"
        description="Policy configuration reads and writes require temporary admin access."
        onAuthorize={requestEnter}
      />
    );
  }

  return (
    <div className="grid gap-6" data-testid="admin-http-policy">
      <PolicyConfigSection
        effective={effective}
        currentRevision={currentRevision}
        revisions={revisions}
        configUnavailable={configUnavailable}
        loadBusy={loadBusy}
        loadError={loadError}
        saveBusy={saveBusy}
        revertBusy={revertBusy}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onRefresh={() => {
          void loadAll();
        }}
        onSave={async (bundle, reason) => {
          if (!requireMutationAccess()) return false;
          setSaveBusy(true);
          try {
            if (!mutationHttp?.policyConfig) {
              throw new Error("Deployment policy config API unavailable.");
            }
            await mutationHttp.policyConfig.updateDeployment({
              bundle,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            });
            await loadAll();
            return true;
          } catch (error) {
            toast.error("Policy save failed", { description: formatErrorMessage(error) });
            return false;
          } finally {
            setSaveBusy(false);
          }
        }}
        onRevert={async (revision, reason) => {
          if (!requireMutationAccess()) return;
          setRevertBusy(true);
          try {
            if (!mutationHttp?.policyConfig) {
              throw new Error("Deployment policy config API unavailable.");
            }
            await mutationHttp.policyConfig.revertDeployment({
              revision,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            });
            await loadAll();
          } catch (error) {
            toast.error("Policy revert failed", { description: formatErrorMessage(error) });
            return false;
          } finally {
            setRevertBusy(false);
          }
        }}
      />
      <PolicyOverridesSection
        overrides={overrides}
        loadBusy={loadBusy}
        loadError={loadError}
        createBusy={createBusy}
        revokeBusy={revokeBusy}
        canMutate={canMutate}
        requestEnter={requestEnter}
        agents={agents}
        tools={tools}
        onRefresh={() => {
          void loadAll();
        }}
        onCreate={async (input) => {
          if (!requireMutationAccess()) return false;
          setCreateBusy(true);
          try {
            if (!mutationHttp) {
              throw new Error("Admin access is required to create policy overrides.");
            }
            await mutationHttp.policy.createOverride(input);
            await loadAll();
            return true;
          } catch (error) {
            toast.error("Override creation failed", { description: formatErrorMessage(error) });
            return false;
          } finally {
            setCreateBusy(false);
          }
        }}
        onRevoke={async (input) => {
          if (!requireMutationAccess()) return;
          setRevokeBusy(true);
          try {
            if (!mutationHttp) {
              throw new Error("Admin access is required to revoke policy overrides.");
            }
            await mutationHttp.policy.revokeOverride(input);
            await loadAll();
          } catch (error) {
            toast.error("Override revocation failed", { description: formatErrorMessage(error) });
            return false;
          } finally {
            setRevokeBusy(false);
          }
        }}
      />
    </div>
  );
}
