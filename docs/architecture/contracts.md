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

Contracts are exported to JSON Schema artifacts during build and include:

- Individual `*.json` schemas (one per exported contract)
- A `catalog.json` index (format: `tyrum.contracts.jsonschema.catalog.v1`)

The gateway publishes these artifacts for clients/operators to fetch:

- `GET /contracts/jsonschema/catalog.json`
- `GET /contracts/jsonschema/<SchemaName>.json`

Security note: these endpoints require appropriate operator/admin authorization, consistent with other HTTP routes.

## Versioning rules

- Backward-compatible changes (add optional fields, widen enums safely) stay within a major version.
- Breaking changes require a new major version for the affected contract family.

For the WebSocket protocol:

- The protocol major version is negotiated via the WebSocket subprotocol (for example `tyrum-v1`).
- Peers advertise a `protocol_rev` during handshake for feature gating within the major version.

## Contract catalog

Core contract families include:

- **Keys and lanes:** session keys, lanes, and queueing modes.
- **Execution:** jobs/runs/steps/attempts plus status enums.
- **Approvals:** approval records and request/response envelopes.
- **Artifacts and postconditions:** artifact references and postcondition contracts.
- **Secrets:** secret handles and provider request/response contracts.
- **Nodes and pairing:** node identity, pairing, and capability contracts.
- **Policy:** policy bundles and policy decision outputs.
- **Protocol envelopes:** request/response/event base envelopes and typed unions.
- **Protocol operations:** handshake (`connect.init`, `connect.proof`), `ping`, `session.send`, `workflow.run|resume|cancel`, `approval.list|resolve`, `pairing.approve|deny`, `task.execute`
- **Tools:** built-in tool schemas and the ToolRunner invocation envelope
- **Playbooks:** workflow file schema (YAML/JSON) and compilation rules
- **Plugins:** plugin manifests and registration surfaces
