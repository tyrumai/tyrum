import { TyrumHttpClientError } from "@tyrum/client/browser";
import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import type { AdminHttpClient } from "./admin-http-shared.js";
import { useAdminHttpClient } from "./admin-http-shared.js";
import {
  PolicyConfigSection,
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
  getDeployment: () => Promise<PolicyConfigRevision & { bundle: unknown }>;
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

export function AdminHttpPolicyCard({
  core,
  canMutate,
  requestEnter,
}: {
  core: OperatorCore;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const http = (useAdminHttpClient() ?? core.http) as PolicyHttpClient;
  const [effective, setEffective] = React.useState<PolicyEffectiveBundle | null>(null);
  const [currentRevision, setCurrentRevision] = React.useState<PolicyConfigRevision | null>(null);
  const [revisions, setRevisions] = React.useState<PolicyConfigRevision[]>([]);
  const [overrides, setOverrides] = React.useState<PolicyOverrideRecord[]>([]);
  const [agents, setAgents] = React.useState<PolicyAgentOption[]>([]);
  const [tools, setTools] = React.useState<PolicyToolOption[]>([]);
  const [loadBusy, setLoadBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [revertBusy, setRevertBusy] = React.useState(false);
  const [revertError, setRevertError] = React.useState<unknown>(null);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState<unknown>(null);
  const [revokeBusy, setRevokeBusy] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<unknown>(null);

  const loadAll = async (): Promise<void> => {
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
        http.policyConfig.getDeployment().catch((error) => {
          if (isNotFoundError(error)) return null;
          throw error;
        }),
        http.policyConfig.listDeploymentRevisions(),
        http.policy.listOverrides({ limit: 500 }),
        http.agents?.list?.() ?? Promise.resolve({ agents: [] }),
        http.toolRegistry?.list?.() ?? Promise.resolve({ status: "ok" as const, tools: [] }),
      ]);
      setEffective(effectiveResult.effective);
      setCurrentRevision(revisionResult);
      setRevisions(revisionsResult.revisions);
      setOverrides(overridesResult.overrides);
      setAgents(normalizeAgentOptions(agentResult.agents));
      setTools(normalizeToolOptions(toolResult.tools));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoadBusy(false);
    }
  };

  React.useEffect(() => {
    void loadAll();
    // The admin HTTP client instance is stable for the lifetime of the active elevated-mode session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-6" data-testid="admin-http-policy">
      <PolicyConfigSection
        effective={effective}
        currentRevision={currentRevision}
        revisions={revisions}
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
          setSaveBusy(true);
          setSaveError(null);
          try {
            if (!http.policyConfig) throw new Error("Deployment policy config API unavailable.");
            await http.policyConfig.updateDeployment({
              bundle,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            });
            await loadAll();
          } catch (error) {
            setSaveError(error);
            throw error;
          } finally {
            setSaveBusy(false);
          }
        }}
        onRevert={async (revision, reason) => {
          setRevertBusy(true);
          setRevertError(null);
          try {
            if (!http.policyConfig) throw new Error("Deployment policy config API unavailable.");
            await http.policyConfig.revertDeployment({
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
          setCreateBusy(true);
          setCreateError(null);
          try {
            await http.policy.createOverride(input);
            await loadAll();
          } catch (error) {
            setCreateError(error);
            throw error;
          } finally {
            setCreateBusy(false);
          }
        }}
        onRevoke={async (input) => {
          setRevokeBusy(true);
          setRevokeError(null);
          try {
            await http.policy.revokeOverride(input);
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
