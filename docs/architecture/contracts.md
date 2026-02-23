# Contracts

Contracts define the shapes and semantics of Tyrum interfaces. They are used to validate:

- WebSocket protocol messages
- Tool inputs/outputs
- Plugin registration surfaces
- Stored event payloads (so persisted data stays interpretable over time)

## Contract formats

Tyrum contracts are:

- **Language-agnostic:** usable by clients in different languages.
- **Versioned:** change-managed with compatibility rules.
- **Machine-validated:** enforced at runtime at trust boundaries.

JSON Schema is the default interchange format for contracts. Internally, contracts may also be represented in code (for example as typed schemas) and exported to JSON Schema for distribution.

## JSON Schema artifacts

The canonical JSON Schema artifacts are generated from `@tyrum/schemas` during build and include:

- Individual `*.json` schemas (one per exported contract)
- A `catalog.json` index (format: `tyrum.contracts.jsonschema.catalog.v1`)

In a workspace checkout, run `pnpm --filter @tyrum/schemas build` to (re)generate artifacts under `packages/schemas/dist/jsonschema/`.

The gateway publishes these artifacts for clients/operators to fetch:

- `GET /contracts/jsonschema/catalog.json`
- `GET /contracts/jsonschema/<SchemaName>.json`

Operational note: when the gateway auth middleware is enabled, these endpoints require an admin token (`Authorization: Bearer <token>`), consistent with other HTTP routes.

## Versioning rules

- Backward-compatible changes (add optional fields, widen enums safely) stay within a major version.
- Breaking changes require a new major version for the affected contract family.

For the WebSocket protocol:

- The protocol major version is negotiated via the WebSocket subprotocol (for example `tyrum-v1`).
- Peers advertise a `protocol_rev` during handshake for feature gating within the major version.

## Contract catalog

Core contract families include:

- **Keys and lanes:** `TyrumKey`, `Lane`, `QueueMode` (`packages/schemas/src/keys.ts`)
- **Execution:** `ExecutionJob`, `ExecutionRun`, `ExecutionStep`, `ExecutionAttempt` + status enums (`packages/schemas/src/execution.ts`)
- **Approvals:** `Approval` + request/response envelopes (`packages/schemas/src/approval.ts`)
- **Artifacts and postconditions:** `ArtifactRef` + postcondition contracts (`packages/schemas/src/artifact.ts`, `packages/schemas/src/postcondition.ts`)
- **Secrets:** `SecretHandle` + provider request/response contracts (`packages/schemas/src/secret.ts`)
- **Nodes and pairing:** node identity and pairing contracts (`packages/schemas/src/node.ts`)
- **Policy:** `PolicyBundle` and policy decision outputs (`@tyrum/schemas`)
- **Protocol envelopes:** request/response/event base envelopes and typed unions (`packages/schemas/src/protocol.ts`)
- **Protocol operations:** handshake (`connect.init`, `connect.proof`), `ping`, `session.send`, `workflow.run|resume|cancel`, `approval.list|resolve`, `pairing.approve|deny`, `task.execute`
- **Tools:** built-in tool schemas and the ToolRunner invocation envelope
- **Playbooks:** workflow file schema (YAML/JSON) and compilation rules
- **Plugins:** plugin manifests and registration surfaces
