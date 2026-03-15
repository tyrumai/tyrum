import { TyrumHttpClientError } from "@tyrum/client/browser";
import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
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
        risk: "low" | "medium" | "high";
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
    risk: "low" | "medium" | "high";
  }>,
): PolicyToolOption[] {
  return tools
    .map((tool) => ({
      toolId: tool.canonical_id.trim(),
      description: tool.description,
      risk: tool.risk,
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
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [revertBusy, setRevertBusy] = React.useState(false);
  const [revertError, setRevertError] = React.useState<unknown>(null);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState<unknown>(null);
  const [revokeBusy, setRevokeBusy] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<unknown>(null);

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
        saveError={saveError}
        revertBusy={revertBusy}
        revertError={revertError}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onRefresh={() => {
          void loadAll();
        }}
        onSave={async (bundle, reason) => {
          setSaveError(null);
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
            setSaveError(error);
            throw error;
          } finally {
            setSaveBusy(false);
          }
        }}
        onRevert={async (revision, reason) => {
          setRevertError(null);
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
            setRevertError(error);
            throw error;
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
        createError={createError}
        revokeBusy={revokeBusy}
        revokeError={revokeError}
        canMutate={canMutate}
        requestEnter={requestEnter}
        agents={agents}
        tools={tools}
        onRefresh={() => {
          void loadAll();
        }}
        onCreate={async (input) => {
          setCreateError(null);
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
            setCreateError(error);
            throw error;
          } finally {
            setCreateBusy(false);
          }
        }}
        onRevoke={async (input) => {
          setRevokeError(null);
          if (!requireMutationAccess()) return;
          setRevokeBusy(true);
          try {
            if (!mutationHttp) {
              throw new Error("Admin access is required to revoke policy overrides.");
            }
            await mutationHttp.policy.revokeOverride(input);
            await loadAll();
          } catch (error) {
            setRevokeError(error);
            throw error;
          } finally {
            setRevokeBusy(false);
          }
        }}
      />
    </div>
  );
}
