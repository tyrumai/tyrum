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

- Protocol: envelopes (`WsRequestEnvelope`, `WsResponseEnvelope`, `WsEventEnvelope`)
- Protocol: connect handshake (`WsConnectRequest` + connect response result)
- Protocol: heartbeat (`WsPingRequest` + response)
- Protocol: capability execution (`WsTaskExecuteRequest` + response result)
- Protocol: approvals (`WsApprovalRequest` + response decision)
- Protocol: plan updates (`WsPlanUpdateEvent`)
- Protocol: error event (`WsErrorEvent`)
- Protocol (target): workflow run/resume/cancel requests + responses
- Protocol: execution engine run/step lifecycle events
- Tools: built-in tool schemas
- Tools: workflow/playbook runtime tool schema (run/resume envelope)
- Playbooks: workflow file schema (YAML/JSON) + validation rules
- Evidence: artifact reference schema
- Evidence: postcondition schema
- Secrets: secret handle schema
- Secrets: secret provider contract (request/resolve/revoke)
- Plugins: plugin manifest schema
