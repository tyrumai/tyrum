// GENERATED: pnpm api:generate

import type {
  DesktopEnvironmentHostsApi,
  DesktopEnvironmentsApi,
} from "../desktop-environments.js";
import {
  DesktopEnvironmentCreateRequest,
  DesktopEnvironmentDefaultsResponse,
  DesktopEnvironmentDefaultsUpdateRequest,
  DesktopEnvironmentDeleteResponse,
  DesktopEnvironmentGetResponse,
  DesktopEnvironmentHostListResponse,
  DesktopEnvironmentId,
  DesktopEnvironmentListResponse,
  DesktopEnvironmentLogsResponse,
  DesktopEnvironmentMutateResponse,
  DesktopEnvironmentTakeoverResponse,
  DesktopEnvironmentUpdateRequest,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";

function environmentPath(environmentId: string): string {
  const parsedId = validateOrThrow(DesktopEnvironmentId, environmentId, "desktop environment id");
  return `/desktop-environments/${encodeURIComponent(parsedId)}`;
}
export function createDesktopEnvironmentHostsApi(
  transport: HttpTransport,
): DesktopEnvironmentHostsApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/desktop-environment-hosts",
        response: DesktopEnvironmentHostListResponse,
        signal: options?.signal,
      });
    },
  };
}
export function createDesktopEnvironmentsApi(transport: HttpTransport): DesktopEnvironmentsApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/desktop-environments",
        response: DesktopEnvironmentListResponse,
        signal: options?.signal,
      });
    },
    async get(environmentId, options) {
      return await transport.request({
        method: "GET",
        path: environmentPath(environmentId),
        response: DesktopEnvironmentGetResponse,
        signal: options?.signal,
      });
    },
    async getDefaults(options) {
      return await transport.request({
        method: "GET",
        path: "/config/desktop-environments/defaults",
        response: DesktopEnvironmentDefaultsResponse,
        signal: options?.signal,
      });
    },
    async create(input, options) {
      const parsedInput = validateOrThrow(
        DesktopEnvironmentCreateRequest,
        input,
        "desktop environment create input",
      );
      return await transport.request({
        method: "POST",
        path: "/desktop-environments",
        body: parsedInput,
        response: DesktopEnvironmentMutateResponse,
        signal: options?.signal,
      });
    },
    async updateDefaults(input, options) {
      const parsedInput = validateOrThrow(
        DesktopEnvironmentDefaultsUpdateRequest,
        input,
        "desktop environment defaults update input",
      );
      return await transport.request({
        method: "PUT",
        path: "/config/desktop-environments/defaults",
        body: parsedInput,
        response: DesktopEnvironmentDefaultsResponse,
        signal: options?.signal,
      });
    },
    async update(environmentId, input, options) {
      const parsedInput = validateOrThrow(
        DesktopEnvironmentUpdateRequest,
        input,
        "desktop environment update input",
      );
      return await transport.request({
        method: "PATCH",
        path: environmentPath(environmentId),
        body: parsedInput,
        response: DesktopEnvironmentMutateResponse,
        signal: options?.signal,
      });
    },
    async remove(environmentId, options) {
      return await transport.request({
        method: "DELETE",
        path: environmentPath(environmentId),
        response: DesktopEnvironmentDeleteResponse,
        signal: options?.signal,
      });
    },
    async start(environmentId, options) {
      return await transport.request({
        method: "POST",
        path: `${environmentPath(environmentId)}/start`,
        response: DesktopEnvironmentMutateResponse,
        signal: options?.signal,
      });
    },
    async stop(environmentId, options) {
      return await transport.request({
        method: "POST",
        path: `${environmentPath(environmentId)}/stop`,
        response: DesktopEnvironmentMutateResponse,
        signal: options?.signal,
      });
    },
    async reset(environmentId, options) {
      return await transport.request({
        method: "POST",
        path: `${environmentPath(environmentId)}/reset`,
        response: DesktopEnvironmentMutateResponse,
        signal: options?.signal,
      });
    },
    async logs(environmentId, options) {
      return await transport.request({
        method: "GET",
        path: `${environmentPath(environmentId)}/logs`,
        response: DesktopEnvironmentLogsResponse,
        signal: options?.signal,
      });
    },
    async takeoverUrl(environmentId, options) {
      return await transport.request({
        method: "GET",
        path: `${environmentPath(environmentId)}/takeover-url`,
        response: DesktopEnvironmentTakeoverResponse,
        signal: options?.signal,
      });
    },
  };
}
