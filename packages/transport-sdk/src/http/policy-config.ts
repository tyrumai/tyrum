import {
  DeploymentPolicyConfigGetResponse,
  DeploymentPolicyConfigListRevisionsResponse,
  DeploymentPolicyConfigRevertRequest,
  DeploymentPolicyConfigRevertResponse,
  DeploymentPolicyConfigUpdateRequest,
  DeploymentPolicyConfigUpdateResponse,
} from "@tyrum/contracts";
import type { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

export type DeploymentPolicyConfigGetResult = z.output<typeof DeploymentPolicyConfigGetResponse>;
export type DeploymentPolicyConfigListRevisionsResult = z.output<
  typeof DeploymentPolicyConfigListRevisionsResponse
>;
export type DeploymentPolicyConfigUpdateInput = z.input<typeof DeploymentPolicyConfigUpdateRequest>;
export type DeploymentPolicyConfigUpdateResult = z.output<
  typeof DeploymentPolicyConfigUpdateResponse
>;
export type DeploymentPolicyConfigRevertInput = z.input<typeof DeploymentPolicyConfigRevertRequest>;
export type DeploymentPolicyConfigRevertResult = z.output<
  typeof DeploymentPolicyConfigRevertResponse
>;

export interface PolicyConfigApi {
  getDeployment(options?: TyrumRequestOptions): Promise<DeploymentPolicyConfigGetResult>;
  listDeploymentRevisions(
    options?: TyrumRequestOptions,
  ): Promise<DeploymentPolicyConfigListRevisionsResult>;
  updateDeployment(
    input: DeploymentPolicyConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<DeploymentPolicyConfigUpdateResult>;
  revertDeployment(
    input: DeploymentPolicyConfigRevertInput,
    options?: TyrumRequestOptions,
  ): Promise<DeploymentPolicyConfigRevertResult>;
}

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
  };
}
