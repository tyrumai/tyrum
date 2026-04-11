# API Reference

<!-- GENERATED: pnpm api:generate -->

This document is generated from the canonical gateway API manifest.

Download machine-readable specs:

- `/specs/openapi.json`
- `/specs/asyncapi.json`

## Table of Contents

- [HTTP API](#http-api)
- [WebSocket API](#websocket-api)

## HTTP API

#### ALL /desktop-takeover/s/\*

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### ALL /plugins/\{id\}/rpc

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### ALL /plugins/\{id\}/rpc/\*

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### DELETE /agents/\{key\}

- SDK operation: `agents.delete`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `ManagedAgentDeleteResponse`

#### DELETE /automation/schedules/\{id\}

- SDK operation: `schedules.remove`
- Auth: Required
- Device scope: operator.write
- Path params: `id` -> `scheduleIdSchema`
- Response schema: `ScheduleDeleteResponse`

#### DELETE /automation/triggers/\{id\}

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### DELETE /config/channels/accounts/\{channel\}/\{accountKey\}

- SDK operation: `channelConfig.deleteAccount`
- Auth: Required
- Device scope: operator.admin
- Path params: `channel` -> `ChannelPathKey`, `accountKey` -> `ChannelPathKey`
- Response schema: `ChannelAccountDeleteResponse`

#### DELETE /config/models/presets/\{key\}

- SDK operation: `modelConfig.deletePreset`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ModelConfigDeleteRequest`
- Path params: `key` -> `PresetPathKey`
- Response schema: `raw-response`

#### DELETE /config/providers/\{provider\}

- SDK operation: `providerConfig.deleteProvider`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ModelConfigDeleteRequest`
- Path params: `provider` -> `ProviderPathKey`
- Response schema: `raw-response`

#### DELETE /config/providers/accounts/\{key\}

- SDK operation: `providerConfig.deleteAccount`
- Auth: Required
- Device scope: operator.admin
- Path params: `key` -> `ProviderPathKey`
- Response schema: `ModelConfigDeleteResponse`

#### DELETE /desktop-environments/\{environmentId\}

- SDK operation: `desktopEnvironments.remove`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentDeleteResponse`

#### DELETE /location/places/\{id\}

- SDK operation: `location.deletePlace`
- Auth: Required
- Device scope: operator.write
- Path params: `id` -> `PlaceId`
- Response schema: `LocationPlaceDeleteResponse`

#### DELETE /memory/items/\{id\}

- SDK operation: `memory.delete`
- Auth: Required
- Device scope: operator.write
- Request body schema: `MemoryDeleteBody`
- Path params: `id` -> `NonEmptyString`
- Response schema: `MemoryDeleteResponse`

#### DELETE /models/overrides/providers/\{id\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### DELETE /models/overrides/providers/\{id\}/models/\{model\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### DELETE /routing/channels/configs/\{channel\}/\{accountKey\}

- SDK operation: `routingConfig.deleteChannelConfig`
- Auth: Required
- Device scope: operator.admin
- Path params: `channel`, `accountKey`
- Response schema: `ChannelConfigDeleteResponse`

#### DELETE /secrets/\{id\}

- SDK operation: `secrets.revoke`
- Auth: Required
- Device scope: operator.admin
- Path params: `id` -> `SecretPathId`
- Query schema: `SecretListQuery`
- Response schema: `SecretRevokeResponse`

#### DELETE /watchers/\{id\}

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### GET /a/\{id\}

- SDK operation: `artifacts.getBytes`
- Auth: Required
- Device scope: n/a
- Path params: `id` -> `ArtifactId`
- Response schema: `raw-response`

#### GET /agent/list

- SDK operation: `agentList.get`
- Auth: Required
- Device scope: operator.read
- Query schema: `AgentListQuery`
- Response schema: `AgentListResponse`

#### GET /agent/status

- SDK operation: `agentStatus.get`
- Auth: Required
- Device scope: operator.read
- Query schema: `AgentStatusQuery`
- Response schema: `AgentStatusResponse`

#### GET /agents

- SDK operation: `agents.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ManagedAgentListResponse`

#### GET /agents/\{key\}

- SDK operation: `agents.get`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `ManagedAgentGetResponse`

#### GET /agents/\{key\}/capabilities

- SDK operation: `agents.capabilities`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `AgentCapabilitiesResponse`

#### GET /approvals

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /approvals/\{id\}

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /approvals/\{id\}/preview

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /artifacts/\{id\}/metadata

- SDK operation: `artifacts.getMetadata`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `ArtifactId`
- Response schema: `ArtifactMetadataResponse`

#### GET /audit/export/\{planKey\}

- SDK operation: `audit.exportReceiptBundle`
- Auth: Required
- Device scope: operator.admin
- Path params: `planKey` -> `NonEmptyString`
- Response schema: `ReceiptBundle`

#### GET /audit/plans

- SDK operation: `audit.listPlans`
- Auth: Required
- Device scope: operator.admin
- Query schema: `AuditPlansListQuery`
- Response schema: `AuditPlansListResponse`

#### GET /auth/pins

- SDK operation: `authPins.list`
- Auth: Required
- Device scope: operator.admin
- Query schema: `AuthPinListQuery`
- Response schema: `ConversationProviderPinListResponse`

#### GET /auth/profiles

- SDK operation: `authProfiles.list`
- Auth: Required
- Device scope: operator.admin
- Query schema: `AuthProfileListQuery`
- Response schema: `AuthProfileListResponse`

#### GET /auth/tokens

- SDK operation: `authTokens.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `AuthTokenListResponse`

#### GET /automation/schedules

- SDK operation: `schedules.list`
- Auth: Required
- Device scope: operator.read
- Query schema: `listQuerySchema`
- Response schema: `ScheduleListResponse`

#### GET /automation/schedules/\{id\}

- SDK operation: `schedules.get`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `scheduleIdSchema`
- Response schema: `ScheduleSingleResponse`

#### GET /automation/triggers

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /benchmarks/merchant

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### GET /benchmarks/public-base-url

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### GET /canvas/\{id\}

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /canvas/\{id\}/meta

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /config/agents

- SDK operation: `agentConfig.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `AgentConfigListResponse`

#### GET /config/agents/\{key\}

- SDK operation: `agentConfig.get`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `AgentConfigGetResponse`

#### GET /config/agents/\{key\}/identity

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/agents/\{key\}/identity/revisions

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/agents/\{key\}/revisions

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/channels

- SDK operation: `channelConfig.listChannels`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ConfiguredChannelListResponse`

#### GET /config/channels/registry

- SDK operation: `channelConfig.listRegistry`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ChannelRegistryResponse`

#### GET /config/desktop-environments/defaults

- SDK operation: `desktopEnvironments.getDefaults`
- Auth: Required
- Device scope: operator.admin
- Response schema: `DesktopEnvironmentDefaultsResponse`

#### GET /config/extensions/\{kind\}

- SDK operation: `extensions.list`
- Auth: Required
- Device scope: operator.read
- Path params: `kind` -> `extensionKindSchema`
- Response schema: `ExtensionsListResponse`

#### GET /config/extensions/\{kind\}/\{key\}

- SDK operation: `extensions.get`
- Auth: Required
- Device scope: operator.read
- Path params: `kind` -> `extensionKindSchema`, `key` -> `extensionKeySchema`
- Response schema: `ExtensionsDetailResponse`

#### GET /config/hooks

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/hooks/revisions

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/models/assignments

- SDK operation: `modelConfig.listAssignments`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ExecutionProfileModelAssignmentListResponse`

#### GET /config/models/presets

- SDK operation: `modelConfig.listPresets`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ConfiguredModelPresetListResponse`

#### GET /config/models/presets/available

- SDK operation: `modelConfig.listAvailable`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ConfiguredAvailableModelListResponse`

#### GET /config/policy/agents/\{key\}

- SDK operation: `policyConfig.getAgent`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `DeploymentPolicyConfigGetResponse`

#### GET /config/policy/agents/\{key\}/revisions

- SDK operation: `policyConfig.listAgentRevisions`
- Auth: Required
- Device scope: operator.admin
- Path params: `key`
- Response schema: `DeploymentPolicyConfigListRevisionsResponse`

#### GET /config/policy/deployment

- SDK operation: `policyConfig.getDeployment`
- Auth: Required
- Device scope: operator.admin
- Response schema: `DeploymentPolicyConfigGetResponse`

#### GET /config/policy/deployment/revisions

- SDK operation: `policyConfig.listDeploymentRevisions`
- Auth: Required
- Device scope: operator.admin
- Response schema: `DeploymentPolicyConfigListRevisionsResponse`

#### GET /config/providers

- SDK operation: `providerConfig.listProviders`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ConfiguredProviderListResponse`

#### GET /config/providers/registry

- SDK operation: `providerConfig.listRegistry`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ProviderRegistryResponse`

#### GET /config/runtime-packages

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/runtime-packages/\{kind\}/\{key\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/runtime-packages/\{kind\}/\{key\}/revisions

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /config/tools

- SDK operation: `toolRegistry.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ToolRegistryListResponse`

#### GET /connections

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /context

- SDK operation: `context.get`
- Auth: Required
- Device scope: operator.read
- Query schema: `ContextGetQuery`
- Response schema: `ContextGetResponse`

#### GET /context/detail/\{id\}

- SDK operation: `context.detail`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `UuidSchema`
- Response schema: `ContextDetailResponse`

#### GET /context/list

- SDK operation: `context.list`
- Auth: Required
- Device scope: operator.read
- Query schema: `ContextListQuery`
- Response schema: `ContextListResponse`

#### GET /context/tools

- SDK operation: `context.tools`
- Auth: Required
- Device scope: operator.read
- Query schema: `ToolRegistryQuery`
- Response schema: `ToolRegistryResponse`

#### GET /contracts/jsonschema/\{file\}

- SDK operation: `contracts.getSchema`
- Auth: Required
- Device scope: operator.read
- Path params: `file` -> `ContractSchemaFilename`
- Response schema: `JsonObjectSchema`

#### GET /contracts/jsonschema/catalog.json

- SDK operation: `contracts.getCatalog`
- Auth: Required
- Device scope: operator.read
- Response schema: `ContractCatalogSchema`

#### GET /desktop-environment-hosts

- SDK operation: `desktopEnvironmentHosts.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `DesktopEnvironmentHostListResponse`

#### GET /desktop-environments

- SDK operation: `desktopEnvironments.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `DesktopEnvironmentListResponse`

#### GET /desktop-environments/\{environmentId\}

- SDK operation: `desktopEnvironments.get`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentGetResponse`

#### GET /desktop-environments/\{environmentId\}/logs

- SDK operation: `desktopEnvironments.logs`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentLogsResponse`

#### GET /healthz

- SDK operation: `health.get`
- Auth: Public
- Device scope: n/a
- Response schema: `HealthResponse`

#### GET /location/events

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /location/places

- SDK operation: `location.listPlaces`
- Auth: Required
- Device scope: operator.read
- Response schema: `LocationPlaceListResponse`

#### GET /location/profile

- SDK operation: `location.getProfile`
- Auth: Required
- Device scope: operator.read
- Response schema: `LocationProfileResponse`

#### GET /memory/items

- SDK operation: `memory.list`
- Auth: Required
- Device scope: operator.read
- Query schema: `MemoryListQuery`
- Response schema: `MemoryItemListResponse`

#### GET /memory/items/\{id\}

- SDK operation: `memory.getById`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `NonEmptyString`
- Response schema: `MemoryItemGetResponse`

#### GET /memory/search

- SDK operation: `memory.search`
- Auth: Required
- Device scope: operator.read
- Query schema: `MemorySearchQuery`
- Response schema: `MemorySearchResponse`

#### GET /memory/tombstones

- SDK operation: `memory.listTombstones`
- Auth: Required
- Device scope: operator.read
- Query schema: `MemoryTombstoneListQuery`
- Response schema: `MemoryTombstoneListResponse`

#### GET /metrics

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /models/overrides/providers

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /models/overrides/providers/\{id\}/models

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /models/providers

- SDK operation: `models.listProviders`
- Auth: Required
- Device scope: operator.read
- Response schema: `ModelsHttpProviderListResponse`

#### GET /models/providers/\{id\}

- SDK operation: `models.getProvider`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `ProviderIdPath`
- Response schema: `ModelsHttpProviderDetailResponse`

#### GET /models/providers/\{id\}/models

- SDK operation: `models.listProviderModels`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `ProviderIdPath`
- Response schema: `ModelsHttpProviderModelsResponse`

#### GET /models/status

- SDK operation: `models.status`
- Auth: Required
- Device scope: operator.read
- Response schema: `ModelsHttpStatusResponse`

#### GET /nodes

- SDK operation: `nodes.list`
- Auth: Required
- Device scope: n/a
- Query schema: `NodesListQuery`
- Response schema: `NodeInventoryResponseSchema`

#### GET /nodes/\{nodeId\}/capabilities/\{capabilityId\}

- SDK operation: `nodes.inspect`
- Auth: Required
- Device scope: n/a
- Path params: `nodeId`, `capabilityId`
- Query schema: `NodesInspectQuery`
- Response schema: `NodeCapabilityInspectionResponseSchema`

#### GET /pairings

- SDK operation: `pairings.list`
- Auth: Required
- Device scope: operator.read
- Query schema: `PairingsListQuery`
- Response schema: `PairingListResponse`

#### GET /pairings/\{id\}

- SDK operation: `pairings.get`
- Auth: Required
- Device scope: operator.read
- Path params: `id` -> `PairingIdParam`
- Response schema: `PairingGetResponse`

#### GET /playbooks

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /playbooks/\{id\}

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /plugins

- SDK operation: `plugins.list`
- Auth: Required
- Device scope: operator.admin
- Response schema: `PluginListResponse`

#### GET /plugins/\{id\}

- SDK operation: `plugins.get`
- Auth: Required
- Device scope: operator.admin
- Path params: `id` -> `PluginIdPath`
- Response schema: `PluginGetResponse`

#### GET /policy/bundle

- SDK operation: `policy.getBundle`
- Auth: Required
- Device scope: operator.admin
- Response schema: `PolicyBundleResponse`

#### GET /policy/overrides

- SDK operation: `policy.listOverrides`
- Auth: Required
- Device scope: operator.admin
- Query schema: `PolicyOverrideListRequest`
- Response schema: `PolicyOverrideListResponse`

#### GET /presence

- SDK operation: `presence.list`
- Auth: Required
- Device scope: operator.read
- Response schema: `PresenceResponse`

#### GET /providers/\{provider\}/oauth/callback

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /routing/channels/configs

- SDK operation: `routingConfig.listChannelConfigs`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ChannelConfigListResponse`

#### GET /routing/channels/telegram/threads

- SDK operation: `routingConfig.listObservedTelegramThreads`
- Auth: Required
- Device scope: operator.admin
- Query schema: `RoutingConfigListQuery`
- Response schema: `ObservedTelegramThreadListResponse`

#### GET /routing/config

- SDK operation: `routingConfig.get`
- Auth: Required
- Device scope: operator.admin
- Response schema: `RoutingConfigGetResponse`

#### GET /routing/config/revisions

- SDK operation: `routingConfig.listRevisions`
- Auth: Required
- Device scope: operator.admin
- Query schema: `RoutingConfigListQuery`
- Response schema: `RoutingConfigRevisionListResponse`

#### GET /secrets

- SDK operation: `secrets.list`
- Auth: Required
- Device scope: operator.admin
- Query schema: `SecretListQuery`
- Response schema: `SecretListResponse`

#### GET /snapshot/export

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### GET /specs/asyncapi.json

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /specs/openapi.json

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### GET /status

- SDK operation: `status.get`
- Auth: Required
- Device scope: operator.read
- Response schema: `StatusResponse`

#### GET /system/deployment-config

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### GET /system/tenants

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### GET /ui

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### GET /ui/\*

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### GET /usage

- SDK operation: `usage.get`
- Auth: Required
- Device scope: operator.read
- Query schema: `UsageQuery`
- Response schema: `UsageResponse`

#### GET /watchers

- Auth: Required
- Device scope: operator.read
- Response schema: `unknown`

#### PATCH /auth/profiles/\{key\}

- SDK operation: `authProfiles.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthProfileUpdateRequest`
- Path params: `key` -> `AuthProfilePathId`
- Response schema: `AuthProfileMutateResponse`

#### PATCH /auth/tokens/\{tokenId\}

- SDK operation: `authTokens.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthTokenUpdateRequest`
- Path params: `tokenId`
- Response schema: `AuthTokenUpdateResponse`

#### PATCH /automation/schedules/\{id\}

- SDK operation: `schedules.update`
- Auth: Required
- Device scope: operator.write
- Request body schema: `updateInputSchema`
- Path params: `id` -> `scheduleIdSchema`
- Response schema: `ScheduleSingleResponse`

#### PATCH /automation/triggers/\{id\}

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### PATCH /config/channels/accounts/\{channel\}/\{accountKey\}

- SDK operation: `channelConfig.updateAccount`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ChannelAccountUpdateRequest`
- Path params: `channel` -> `ChannelPathKey`, `accountKey` -> `ChannelPathKey`
- Response schema: `ChannelAccountMutateResponse`

#### PATCH /config/models/presets/\{key\}

- SDK operation: `modelConfig.updatePreset`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ConfiguredModelPresetUpdateRequest`
- Path params: `key` -> `PresetPathKey`
- Response schema: `ConfiguredModelPresetMutateResponse`

#### PATCH /config/providers/accounts/\{key\}

- SDK operation: `providerConfig.updateAccount`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ProviderAccountUpdateRequest`
- Path params: `key` -> `ProviderPathKey`
- Response schema: `ProviderAccountMutateResponse`

#### PATCH /desktop-environments/\{environmentId\}

- SDK operation: `desktopEnvironments.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DesktopEnvironmentUpdateRequest`
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentMutateResponse`

#### PATCH /location/places/\{id\}

- SDK operation: `location.updatePlace`
- Auth: Required
- Device scope: operator.write
- Request body schema: `LocationPlaceUpdateRequest`
- Path params: `id` -> `PlaceId`
- Response schema: `LocationPlaceMutateResponse`

#### PATCH /location/profile

- SDK operation: `location.updateProfile`
- Auth: Required
- Device scope: operator.write
- Request body schema: `LocationProfileUpdateRequest`
- Response schema: `LocationProfileResponse`

#### PATCH /routing/channels/configs/\{channel\}/\{accountKey\}

- SDK operation: `routingConfig.updateChannelConfig`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `TelegramChannelConfigUpdateRequest`
- Path params: `channel`, `accountKey`
- Response schema: `ChannelConfigUpdateResponse`

#### PATCH /watchers/\{id\}

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /agent/turn

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /agents

- SDK operation: `agents.create`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ManagedAgentCreateRequest`
- Response schema: `ManagedAgentGetResponse`

#### POST /agents/\{key\}/rename

- SDK operation: `agents.rename`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ManagedAgentRenameRequest`
- Path params: `key`
- Response schema: `ManagedAgentRenameResponse`

#### POST /approvals/\{id\}/respond

- Auth: Required
- Device scope: operator.approvals
- Response schema: `unknown`

#### POST /audit/forget

- SDK operation: `audit.forget`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuditForgetRequest`
- Response schema: `AuditForgetResponse`

#### POST /audit/verify

- SDK operation: `audit.verify`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuditVerifyRequest`
- Response schema: `ChainVerification`

#### POST /auth/cookie

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### POST /auth/device-tokens/issue

- SDK operation: `deviceTokens.issue`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeviceTokenIssueRequest`
- Response schema: `DeviceTokenIssueResponse`

#### POST /auth/device-tokens/revoke

- SDK operation: `deviceTokens.revoke`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeviceTokenRevokeRequest`
- Response schema: `DeviceTokenRevokeResponse`

#### POST /auth/logout

- Auth: Public
- Device scope: n/a
- Response schema: `unknown`

#### POST /auth/pins

- SDK operation: `authPins.set`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ConversationProviderPinSetRequest`
- Response schemas: `200 -> ConversationProviderPinClearResponse`, `201 -> ConversationProviderPinSetResponse`

#### POST /auth/profiles

- SDK operation: `authProfiles.create`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthProfileCreateRequest`
- Response schema: `AuthProfileCreateResponse`

#### POST /auth/profiles/\{key\}/disable

- SDK operation: `authProfiles.disable`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthProfileDisableRequest`
- Path params: `key` -> `AuthProfilePathId`
- Response schema: `AuthProfileMutateResponse`

#### POST /auth/profiles/\{key\}/enable

- SDK operation: `authProfiles.enable`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthProfileEnableRequest`
- Path params: `key` -> `AuthProfilePathId`
- Response schema: `AuthProfileMutateResponse`

#### POST /auth/tokens/issue

- SDK operation: `authTokens.issue`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `TenantAuthTokenIssueRequest`
- Response schema: `AuthTokenIssueResponse`

#### POST /auth/tokens/revoke

- SDK operation: `authTokens.revoke`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AuthTokenRevokeRequest`
- Response schema: `AuthTokenRevokeResponse`

#### POST /automation/schedules

- SDK operation: `schedules.create`
- Auth: Required
- Device scope: operator.write
- Request body schema: `createInputSchema`
- Response schema: `ScheduleSingleResponse`

#### POST /automation/schedules/\{id\}/pause

- SDK operation: `schedules.pause`
- Auth: Required
- Device scope: operator.write
- Path params: `id` -> `scheduleIdSchema`
- Response schema: `ScheduleSingleResponse`

#### POST /automation/schedules/\{id\}/resume

- SDK operation: `schedules.resume`
- Auth: Required
- Device scope: operator.write
- Path params: `id` -> `scheduleIdSchema`
- Response schema: `ScheduleSingleResponse`

#### POST /automation/triggers

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /canvas/publish

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /config/agents/\{key\}/identity/revert

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /config/agents/\{key\}/revert

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /config/channels/accounts

- SDK operation: `channelConfig.createAccount`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ChannelAccountCreateRequest`
- Response schema: `ChannelAccountMutateResponse`

#### POST /config/extensions/\{kind\}/\{key\}/refresh

- SDK operation: `extensions.refresh`
- Auth: Required
- Device scope: operator.admin
- Path params: `kind` -> `extensionKindSchema`, `key` -> `extensionKeySchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/\{kind\}/\{key\}/revert

- SDK operation: `extensions.revert`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `revertInputSchema`
- Path params: `kind` -> `extensionKindSchema`, `key` -> `extensionKeySchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/\{kind\}/\{key\}/toggle

- SDK operation: `extensions.toggle`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `toggleInputSchema`
- Path params: `kind` -> `extensionKindSchema`, `key` -> `extensionKeySchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/mcp/import

- SDK operation: `extensions.importMcp`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `mcpImportInputSchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/mcp/parse-settings

- SDK operation: `extensions.parseMcpSettings`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `parseMcpSettingsInputSchema`
- Response schema: `parseMcpSettingsResponseSchema`

#### POST /config/extensions/mcp/upload

- SDK operation: `extensions.uploadMcp`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `uploadInputSchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/skill/import

- SDK operation: `extensions.importSkill`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `skillImportInputSchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/extensions/skill/upload

- SDK operation: `extensions.uploadSkill`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `uploadInputSchema`
- Response schema: `ExtensionsMutateResponse`

#### POST /config/hooks/revert

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /config/models/presets

- SDK operation: `modelConfig.createPreset`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ConfiguredModelPresetCreateRequest`
- Response schema: `ConfiguredModelPresetMutateResponse`

#### POST /config/policy/agents/\{key\}/revert

- SDK operation: `policyConfig.revertAgent`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeploymentPolicyConfigRevertRequest`
- Path params: `key`
- Response schema: `DeploymentPolicyConfigRevertResponse`

#### POST /config/policy/deployment/revert

- SDK operation: `policyConfig.revertDeployment`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeploymentPolicyConfigRevertRequest`
- Response schema: `DeploymentPolicyConfigRevertResponse`

#### POST /config/providers/accounts

- SDK operation: `providerConfig.createAccount`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ProviderAccountCreateRequest`
- Response schema: `ProviderAccountMutateResponse`

#### POST /config/runtime-packages/\{kind\}/\{key\}/revert

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /desktop-environments

- SDK operation: `desktopEnvironments.create`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DesktopEnvironmentCreateRequest`
- Response schema: `DesktopEnvironmentMutateResponse`

#### POST /desktop-environments/\{environmentId\}/reset

- SDK operation: `desktopEnvironments.reset`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentMutateResponse`

#### POST /desktop-environments/\{environmentId\}/start

- SDK operation: `desktopEnvironments.start`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentMutateResponse`

#### POST /desktop-environments/\{environmentId\}/stop

- SDK operation: `desktopEnvironments.stop`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentMutateResponse`

#### POST /desktop-environments/\{environmentId\}/takeover-token

- SDK operation: `desktopEnvironments.createTakeoverConversation`
- Auth: Required
- Device scope: operator.admin
- Path params: `environmentId`
- Response schema: `DesktopEnvironmentTakeoverTokenResponse`

#### POST /ingress/googlechat

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /ingress/telegram

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /location/places

- SDK operation: `location.createPlace`
- Auth: Required
- Device scope: operator.write
- Request body schema: `LocationPlaceCreateRequest`
- Response schema: `LocationPlaceMutateResponse`

#### POST /models/refresh

- SDK operation: `models.refresh`
- Auth: Required
- Device scope: operator.admin
- Response schema: `ModelsHttpStatusResponse`

#### POST /nodes/\{nodeId\}/capabilities/\{capabilityId\}/actions/\{actionName\}/dispatch

- SDK operation: `nodes.dispatch`
- Auth: Required
- Device scope: n/a
- Request body schema: `NodeActionDispatchRequestSchema`
- Path params: `nodeId`, `capabilityId`, `actionName`
- Response schema: `NodeActionDispatchResponseSchema`

#### POST /pairings/\{id\}/approve

- SDK operation: `pairings.approve`
- Auth: Required
- Device scope: operator.pairing
- Request body schema: `PairingApproveRequest`
- Path params: `id`
- Response schema: `PairingMutateResponse`

#### POST /pairings/\{id\}/deny

- SDK operation: `pairings.deny`
- Auth: Required
- Device scope: operator.pairing
- Request body schema: `PairingDenyOrRevokeRequest`
- Path params: `id`
- Response schema: `PairingMutateResponse`

#### POST /pairings/\{id\}/revoke

- SDK operation: `pairings.revoke`
- Auth: Required
- Device scope: operator.pairing
- Request body schema: `PairingDenyOrRevokeRequest`
- Path params: `id`
- Response schema: `PairingMutateResponse`

#### POST /plan

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /playbooks/\{id\}/execute

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /playbooks/\{id\}/run

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /playbooks/runtime

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /policy/check

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /policy/overrides

- SDK operation: `policy.createOverride`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `PolicyOverrideCreateRequest`
- Response schema: `PolicyOverrideCreateResponse`

#### POST /policy/overrides/revoke

- SDK operation: `policy.revokeOverride`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `PolicyOverrideRevokeRequest`
- Response schema: `PolicyOverrideRevokeResponse`

#### POST /providers/\{provider\}/oauth/authorize

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /routing/channels/configs

- SDK operation: `routingConfig.createChannelConfig`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ChannelConfigCreateRequest`
- Response schema: `ChannelConfigCreateResponse`

#### POST /routing/config/revert

- SDK operation: `routingConfig.revert`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `RoutingConfigRevertRequest`
- Response schema: `RoutingConfigRevertResponse`

#### POST /secrets

- SDK operation: `secrets.store`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `SecretStoreRequest`
- Query schema: `SecretListQuery`
- Response schema: `SecretStoreResponse`

#### POST /secrets/\{id\}/rotate

- SDK operation: `secrets.rotate`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `SecretRotateRequest`
- Path params: `id` -> `SecretPathId`
- Query schema: `SecretListQuery`
- Response schema: `SecretRotateResponse`

#### POST /snapshot/import

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### POST /system/deployment-config/revert

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### POST /system/tenants

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### POST /system/tokens/issue

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### POST /system/tokens/revoke

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

#### POST /watchers

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /watchers/\{id\}/trigger/webhook

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /workflow/cancel

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /workflow/resume

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### POST /workflow/start

- Auth: Required
- Device scope: operator.write
- Response schema: `unknown`

#### PUT /agents/\{key\}

- SDK operation: `agents.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ManagedAgentUpdateRequest`
- Path params: `key`
- Response schema: `ManagedAgentGetResponse`

#### PUT /config/agents/\{key\}

- SDK operation: `agentConfig.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `AgentConfigUpdateRequest`
- Path params: `key`
- Response schema: `AgentConfigUpdateResponse`

#### PUT /config/agents/\{key\}/identity

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### PUT /config/desktop-environments/defaults

- SDK operation: `desktopEnvironments.updateDefaults`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DesktopEnvironmentDefaultsUpdateRequest`
- Response schema: `DesktopEnvironmentDefaultsResponse`

#### PUT /config/extensions/\{kind\}/\{key\}/defaults

- SDK operation: `extensions.updateDefaults`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `defaultsUpdateInputSchema`
- Path params: `kind` -> `extensionKindSchema`, `key` -> `extensionKeySchema`
- Response schema: `ExtensionsMutateResponse`

#### PUT /config/hooks

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### PUT /config/models/assignments

- SDK operation: `modelConfig.updateAssignments`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `ExecutionProfileModelAssignmentUpdateRequest`
- Response schema: `ExecutionProfileModelAssignmentUpdateResponse`

#### PUT /config/policy/agents/\{key\}

- SDK operation: `policyConfig.updateAgent`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeploymentPolicyConfigUpdateRequest`
- Path params: `key`
- Response schema: `DeploymentPolicyConfigUpdateResponse`

#### PUT /config/policy/deployment

- SDK operation: `policyConfig.updateDeployment`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `DeploymentPolicyConfigUpdateRequest`
- Response schema: `DeploymentPolicyConfigUpdateResponse`

#### PUT /config/runtime-packages/\{kind\}/\{key\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### PUT /models/overrides/providers/\{id\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### PUT /models/overrides/providers/\{id\}/models/\{model\}

- Auth: Required
- Device scope: operator.admin
- Response schema: `unknown`

#### PUT /routing/config

- SDK operation: `routingConfig.update`
- Auth: Required
- Device scope: operator.admin
- Request body schema: `RoutingConfigUpdateRequest`
- Response schema: `RoutingConfigUpdateResponse`

#### PUT /system/deployment-config

- Auth: Required
- Device scope: n/a
- Response schema: `unknown`

## WebSocket API

#### `approval.list`

- Direction: `client_to_server`
- Request schema: `WsApprovalListRequest`
- Device scope: operator.read
- Response schemas: `WsApprovalListResponseErrEnvelope`, `WsApprovalListResponseOkEnvelope`

#### `approval.resolve`

- Direction: `client_to_server`
- Request schema: `WsApprovalResolveRequest`
- Device scope: operator.approvals
- Response schemas: `WsApprovalResolveResponseErrEnvelope`, `WsApprovalResolveResponseOkEnvelope`

#### `attempt.evidence`

- Direction: `client_to_server`
- Request schema: `WsAttemptEvidenceRequest`
- Device scope: n/a
- Response schemas: `WsAttemptEvidenceResponseErrEnvelope`, `WsAttemptEvidenceResponseOkEnvelope`

#### `capability.ready`

- Direction: `client_to_server`
- Request schema: `WsCapabilityReadyRequest`
- Device scope: n/a
- Response schemas: `WsCapabilityReadyResponseErrEnvelope`, `WsCapabilityReadyResponseOkEnvelope`

#### `command.execute`

- Direction: `client_to_server`
- Request schema: `WsCommandExecuteRequest`
- Device scope: operator.admin
- Response schemas: none

#### `connect.init`

- Direction: `client_to_server`
- Request schema: `WsConnectInitRequest`
- Device scope: n/a
- Response schemas: `WsConnectInitResponseErrEnvelope`, `WsConnectInitResponseOkEnvelope`

#### `connect.proof`

- Direction: `client_to_server`
- Request schema: `WsConnectProofRequest`
- Device scope: n/a
- Response schemas: `WsConnectProofResponseErrEnvelope`, `WsConnectProofResponseOkEnvelope`

#### `conversation.archive`

- Direction: `client_to_server`
- Request schema: `WsConversationArchiveRequest`
- Device scope: operator.write
- Response schemas: `WsConversationArchiveResponseErrEnvelope`, `WsConversationArchiveResponseOkEnvelope`

#### `conversation.create`

- Direction: `client_to_server`
- Request schema: `WsConversationCreateRequest`
- Device scope: operator.write
- Response schemas: `WsConversationCreateResponseErrEnvelope`, `WsConversationCreateResponseOkEnvelope`

#### `conversation.delete`

- Direction: `client_to_server`
- Request schema: `WsConversationDeleteRequest`
- Device scope: operator.write
- Response schemas: `WsConversationDeleteResponseErrEnvelope`, `WsConversationDeleteResponseOkEnvelope`

#### `conversation.get`

- Direction: `client_to_server`
- Request schema: `WsConversationGetRequest`
- Device scope: operator.read
- Response schemas: `WsConversationGetResponseErrEnvelope`, `WsConversationGetResponseOkEnvelope`

#### `conversation.list`

- Direction: `client_to_server`
- Request schema: `WsConversationListRequest`
- Device scope: operator.read
- Response schemas: `WsConversationListResponseErrEnvelope`, `WsConversationListResponseOkEnvelope`

#### `conversation.queue_mode.set`

- Direction: `client_to_server`
- Request schema: `WsConversationQueueModeSetRequest`
- Device scope: operator.write
- Response schemas: `WsConversationQueueModeSetResponseErrEnvelope`, `WsConversationQueueModeSetResponseOkEnvelope`

#### `conversation.reconnect`

- Direction: `client_to_server`
- Request schema: `WsConversationReconnectRequest`
- Device scope: operator.read
- Response schemas: `WsConversationReconnectResponseErrEnvelope`, `WsConversationReconnectResponseOkEnvelope`

#### `conversation.send`

- Direction: `client_to_server`
- Request schema: `WsConversationSendRequest`
- Device scope: operator.write
- Response schemas: `WsConversationSendResponseErrEnvelope`, `WsConversationSendResponseOkEnvelope`

#### `location.beacon`

- Direction: `client_to_server`
- Request schema: `WsLocationBeaconRequest`
- Device scope: none
- Response schemas: `WsLocationBeaconResponseErrEnvelope`, `WsLocationBeaconResponseOkEnvelope`

#### `pairing.approve`

- Direction: `client_to_server`
- Request schema: `WsPairingApproveRequest`
- Device scope: operator.pairing
- Response schemas: `WsPairingApproveResponseErrEnvelope`, `WsPairingApproveResponseOkEnvelope`

#### `pairing.deny`

- Direction: `client_to_server`
- Request schema: `WsPairingDenyRequest`
- Device scope: operator.pairing
- Response schemas: `WsPairingDenyResponseErrEnvelope`, `WsPairingDenyResponseOkEnvelope`

#### `pairing.revoke`

- Direction: `client_to_server`
- Request schema: `WsPairingRevokeRequest`
- Device scope: operator.pairing
- Response schemas: `WsPairingRevokeResponseErrEnvelope`, `WsPairingRevokeResponseOkEnvelope`

#### `ping`

- Direction: `client_to_server`
- Request schema: `WsPingRequest`
- Device scope: none
- Response schemas: `WsPingResponseErrEnvelope`, `WsPingResponseOkEnvelope`

#### `presence.beacon`

- Direction: `client_to_server`
- Request schema: `WsPresenceBeaconRequest`
- Device scope: none
- Response schemas: `WsPresenceBeaconResponseErrEnvelope`, `WsPresenceBeaconResponseOkEnvelope`

#### `subagent.close`

- Direction: `client_to_server`
- Request schema: `WsSubagentCloseRequest`
- Device scope: operator.write
- Response schemas: `WsSubagentCloseResponseErrEnvelope`, `WsSubagentCloseResponseOkEnvelope`

#### `subagent.get`

- Direction: `client_to_server`
- Request schema: `WsSubagentGetRequest`
- Device scope: operator.read
- Response schemas: `WsSubagentGetResponseErrEnvelope`, `WsSubagentGetResponseOkEnvelope`

#### `subagent.list`

- Direction: `client_to_server`
- Request schema: `WsSubagentListRequest`
- Device scope: operator.read
- Response schemas: `WsSubagentListResponseErrEnvelope`, `WsSubagentListResponseOkEnvelope`

#### `subagent.send`

- Direction: `client_to_server`
- Request schema: `WsSubagentSendRequest`
- Device scope: operator.write
- Response schemas: `WsSubagentSendResponseErrEnvelope`, `WsSubagentSendResponseOkEnvelope`

#### `subagent.spawn`

- Direction: `client_to_server`
- Request schema: `WsSubagentSpawnRequest`
- Device scope: operator.write
- Response schemas: `WsSubagentSpawnResponseErrEnvelope`, `WsSubagentSpawnResponseOkEnvelope`

#### `task.execute`

- Direction: `server_to_client`
- Request schema: `WsTaskExecuteRequest`
- Device scope: n/a
- Response schemas: `WsTaskExecuteResponseErrEnvelope`, `WsTaskExecuteResponseOkEnvelope`

#### `transcript.get`

- Direction: `client_to_server`
- Request schema: `WsTranscriptGetRequest`
- Device scope: operator.read
- Response schemas: `WsTranscriptGetResponseErrEnvelope`, `WsTranscriptGetResponseOkEnvelope`

#### `transcript.list`

- Direction: `client_to_server`
- Request schema: `WsTranscriptListRequest`
- Device scope: operator.read
- Response schemas: `WsTranscriptListResponseErrEnvelope`, `WsTranscriptListResponseOkEnvelope`

#### `turn.list`

- Direction: `client_to_server`
- Request schema: `WsTurnListRequest`
- Device scope: operator.read
- Response schemas: `WsTurnListResponseErrEnvelope`, `WsTurnListResponseOkEnvelope`

#### `work.artifact.create`

- Direction: `client_to_server`
- Request schema: `WsWorkArtifactCreateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkArtifactCreateResponseErrEnvelope`, `WsWorkArtifactCreateResponseOkEnvelope`

#### `work.artifact.get`

- Direction: `client_to_server`
- Request schema: `WsWorkArtifactGetRequest`
- Device scope: operator.read
- Response schemas: `WsWorkArtifactGetResponseErrEnvelope`, `WsWorkArtifactGetResponseOkEnvelope`

#### `work.artifact.list`

- Direction: `client_to_server`
- Request schema: `WsWorkArtifactListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkArtifactListResponseErrEnvelope`, `WsWorkArtifactListResponseOkEnvelope`

#### `work.create`

- Direction: `client_to_server`
- Request schema: `WsWorkCreateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkCreateResponseErrEnvelope`, `WsWorkCreateResponseOkEnvelope`

#### `work.decision.create`

- Direction: `client_to_server`
- Request schema: `WsWorkDecisionCreateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkDecisionCreateResponseErrEnvelope`, `WsWorkDecisionCreateResponseOkEnvelope`

#### `work.decision.get`

- Direction: `client_to_server`
- Request schema: `WsWorkDecisionGetRequest`
- Device scope: operator.read
- Response schemas: `WsWorkDecisionGetResponseErrEnvelope`, `WsWorkDecisionGetResponseOkEnvelope`

#### `work.decision.list`

- Direction: `client_to_server`
- Request schema: `WsWorkDecisionListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkDecisionListResponseErrEnvelope`, `WsWorkDecisionListResponseOkEnvelope`

#### `work.delete`

- Direction: `client_to_server`
- Request schema: `WsWorkDeleteRequest`
- Device scope: operator.write
- Response schemas: `WsWorkDeleteResponseErrEnvelope`, `WsWorkDeleteResponseOkEnvelope`

#### `work.get`

- Direction: `client_to_server`
- Request schema: `WsWorkGetRequest`
- Device scope: operator.read
- Response schemas: `WsWorkGetResponseErrEnvelope`, `WsWorkGetResponseOkEnvelope`

#### `work.link.create`

- Direction: `client_to_server`
- Request schema: `WsWorkLinkCreateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkLinkCreateResponseErrEnvelope`, `WsWorkLinkCreateResponseOkEnvelope`

#### `work.link.list`

- Direction: `client_to_server`
- Request schema: `WsWorkLinkListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkLinkListResponseErrEnvelope`, `WsWorkLinkListResponseOkEnvelope`

#### `work.list`

- Direction: `client_to_server`
- Request schema: `WsWorkListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkListResponseErrEnvelope`, `WsWorkListResponseOkEnvelope`

#### `work.pause`

- Direction: `client_to_server`
- Request schema: `WsWorkPauseRequest`
- Device scope: operator.write
- Response schemas: `WsWorkPauseResponseErrEnvelope`, `WsWorkPauseResponseOkEnvelope`

#### `work.resume`

- Direction: `client_to_server`
- Request schema: `WsWorkResumeRequest`
- Device scope: operator.write
- Response schemas: `WsWorkResumeResponseErrEnvelope`, `WsWorkResumeResponseOkEnvelope`

#### `work.signal.create`

- Direction: `client_to_server`
- Request schema: `WsWorkSignalCreateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkSignalCreateResponseErrEnvelope`, `WsWorkSignalCreateResponseOkEnvelope`

#### `work.signal.get`

- Direction: `client_to_server`
- Request schema: `WsWorkSignalGetRequest`
- Device scope: operator.read
- Response schemas: `WsWorkSignalGetResponseErrEnvelope`, `WsWorkSignalGetResponseOkEnvelope`

#### `work.signal.list`

- Direction: `client_to_server`
- Request schema: `WsWorkSignalListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkSignalListResponseErrEnvelope`, `WsWorkSignalListResponseOkEnvelope`

#### `work.signal.update`

- Direction: `client_to_server`
- Request schema: `WsWorkSignalUpdateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkSignalUpdateResponseErrEnvelope`, `WsWorkSignalUpdateResponseOkEnvelope`

#### `work.state_kv.get`

- Direction: `client_to_server`
- Request schema: `WsWorkStateKvGetRequest`
- Device scope: operator.read
- Response schemas: `WsWorkStateKvGetResponseErrEnvelope`, `WsWorkStateKvGetResponseOkEnvelope`

#### `work.state_kv.list`

- Direction: `client_to_server`
- Request schema: `WsWorkStateKvListRequest`
- Device scope: operator.read
- Response schemas: `WsWorkStateKvListResponseErrEnvelope`, `WsWorkStateKvListResponseOkEnvelope`

#### `work.state_kv.set`

- Direction: `client_to_server`
- Request schema: `WsWorkStateKvSetRequest`
- Device scope: operator.write
- Response schemas: `WsWorkStateKvSetResponseErrEnvelope`, `WsWorkStateKvSetResponseOkEnvelope`

#### `work.transition`

- Direction: `client_to_server`
- Request schema: `WsWorkTransitionRequest`
- Device scope: operator.write
- Response schemas: `WsWorkTransitionResponseErrEnvelope`, `WsWorkTransitionResponseOkEnvelope`

#### `work.update`

- Direction: `client_to_server`
- Request schema: `WsWorkUpdateRequest`
- Device scope: operator.write
- Response schemas: `WsWorkUpdateResponseErrEnvelope`, `WsWorkUpdateResponseOkEnvelope`

#### `workflow.cancel`

- Direction: `client_to_server`
- Request schema: `WsWorkflowCancelRequest`
- Device scope: operator.write
- Response schemas: `WsWorkflowCancelResponseErrEnvelope`, `WsWorkflowCancelResponseOkEnvelope`

#### `workflow.resume`

- Direction: `client_to_server`
- Request schema: `WsWorkflowResumeRequest`
- Device scope: operator.write
- Response schemas: `WsWorkflowResumeResponseErrEnvelope`, `WsWorkflowResumeResponseOkEnvelope`

#### `workflow.start`

- Direction: `client_to_server`
- Request schema: `WsWorkflowStartRequest`
- Device scope: operator.write
- Response schemas: `WsWorkflowStartResponseErrEnvelope`, `WsWorkflowStartResponseOkEnvelope`
