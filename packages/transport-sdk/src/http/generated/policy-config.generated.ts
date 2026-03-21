// GENERATED: pnpm api:generate

import type { PolicyConfigApi } from "../policy-config.js";
import {
  DeploymentPolicyConfigGetResponse,
  DeploymentPolicyConfigListRevisionsResponse,
  DeploymentPolicyConfigRevertRequest,
  DeploymentPolicyConfigRevertResponse,
  DeploymentPolicyConfigUpdateRequest,
  DeploymentPolicyConfigUpdateResponse,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";

export function createPolicyConfigApi(transport: HttpTransport): PolicyConfigApi {
  return {
    async getDeployment(options) {
      return await transport.request({
        method: "GET",
        path: "/config/policy/deployment",
        response: DeploymentPolicyConfigGetResponse,
        signal: options?.signal,
      });
    },

    async listDeploymentRevisions(options) {
      return await transport.request({
        method: "GET",
        path: "/config/policy/deployment/revisions",
        response: DeploymentPolicyConfigListRevisionsResponse,
        signal: options?.signal,
      });
    },

    async updateDeployment(input, options) {
      const body = validateOrThrow(
        DeploymentPolicyConfigUpdateRequest,
        input,
        "deployment policy config update request",
      );
      return await transport.request({
        method: "PUT",
        path: "/config/policy/deployment",
        body,
        response: DeploymentPolicyConfigUpdateResponse,
        signal: options?.signal,
      });
    },

    async revertDeployment(input, options) {
      const body = validateOrThrow(
        DeploymentPolicyConfigRevertRequest,
        input,
        "deployment policy config revert request",
      );
      return await transport.request({
        method: "POST",
        path: "/config/policy/deployment/revert",
        body,
        response: DeploymentPolicyConfigRevertResponse,
        signal: options?.signal,
      });
    },

    async getAgent(agentKey, options) {
      return await transport.request({
        method: "GET",
        path: `/config/policy/agents/${encodeURIComponent(agentKey)}`,
        response: DeploymentPolicyConfigGetResponse,
        signal: options?.signal,
      });
    },

    async listAgentRevisions(agentKey, options) {
      return await transport.request({
        method: "GET",
        path: `/config/policy/agents/${encodeURIComponent(agentKey)}/revisions`,
        response: DeploymentPolicyConfigListRevisionsResponse,
        signal: options?.signal,
      });
    },

    async updateAgent(agentKey, input, options) {
      const body = validateOrThrow(
        DeploymentPolicyConfigUpdateRequest,
        input,
        "agent policy config update request",
      );
      return await transport.request({
        method: "PUT",
        path: `/config/policy/agents/${encodeURIComponent(agentKey)}`,
        body,
        response: DeploymentPolicyConfigUpdateResponse,
        signal: options?.signal,
      });
    },

    async revertAgent(agentKey, input, options) {
      const body = validateOrThrow(
        DeploymentPolicyConfigRevertRequest,
        input,
        "agent policy config revert request",
      );
      return await transport.request({
        method: "POST",
        path: `/config/policy/agents/${encodeURIComponent(agentKey)}/revert`,
        body,
        response: DeploymentPolicyConfigRevertResponse,
        signal: options?.signal,
      });
    },
  };
}
