# Contracts

Status:

Contracts define the shapes and semantics of Tyrum interfaces. They are used to validate:

- WebSocket protocol messages
- Tool inputs/outputs
- Plugin registration surfaces
- Stored event payloads (so persisted data stays interpretable over time)

## Contract formats

Tyrum contracts are intended to be:

- **Language-agnostic:** usable by clients in different languages.
- **Versioned:** change-managed with compatibility rules.
- **Machine-validated:** enforced at runtime at trust boundaries.

JSON Schema is the default interchange format for contracts. Internally, contracts may also be represented in code (for example as typed schemas) and exported to JSON Schema for distribution.

## Versioning rules (target)

- Backward-compatible changes (add optional fields, widen enums safely) stay within a major version.
- While the protocol is still stabilizing, Tyrum may make in-place breaking changes within `tyrum-v1`.
- Once the protocol is considered stable, breaking changes require a protocol major bump (for example `tyrum-v2`) and a clear migration path.

## Contract catalog

This list will be filled as contracts stabilize:

- Keys/lanes: `TyrumKey`, `Lane`, `QueueMode` (`packages/schemas/src/keys.ts`)
- Evidence: `ArtifactRef` (`packages/schemas/src/artifact.ts`)
- Evidence: postconditions (`packages/schemas/src/postcondition.ts`)
- Secrets: `SecretHandle`, `SecretStoreRequest`, `SecretResolveRequest/Response`, `SecretListResponse`, `SecretRevokeRequest/Response` (`packages/schemas/src/secret.ts`)
- Approvals (domain): `Approval`, `ApprovalListRequest/Response`, `ApprovalResolveRequest/Response` (`packages/schemas/src/approval.ts`)
- Execution engine (domain): `ExecutionJob`, `ExecutionRun`, `ExecutionStep`, `ExecutionAttempt` + status enums (`packages/schemas/src/execution.ts`)
- Nodes/pairing (domain): `NodeIdentity`, `NodePairingRequest` (`packages/schemas/src/node.ts`)
- Routing: `EventScope` (`packages/schemas/src/scope.ts`)
- Protocol: base envelopes (`WsRequestEnvelope`, `WsResponseEnvelope`, `WsEventEnvelope`) (`packages/schemas/src/protocol.ts`)
- Protocol: canonical typed union (`WsRequest`, `WsResponse`, `WsEvent`, `WsMessage`) (`packages/schemas/src/protocol.ts`)
- Protocol: connect handshake (`WsConnectRequest` + typed connect response envelopes)
- Protocol: heartbeat (`WsPingRequest` + typed ping response envelopes)
- Protocol: capability execution (`WsTaskExecuteRequest` + typed task.execute response envelopes)
- Protocol: approvals (`WsApprovalRequest`, `WsApprovalListRequest`, `WsApprovalResolveRequest` + typed response envelopes)
- Protocol: plan updates (`WsPlanUpdateEvent`)
- Protocol: error event (`WsErrorEvent`)
- Protocol (target): workflow run/resume/cancel requests + responses
- Tools: built-in tool schemas
- Tools: workflow/playbook runtime tool schema (run/resume envelope)
- Playbooks: workflow file schema (YAML/JSON) + validation rules
- Plugins: plugin manifest schema
