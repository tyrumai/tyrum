# Protocol

The Tyrum protocol is the typed interaction contract between the gateway, clients, and nodes. It defines how long-lived control, event delivery, and durable interaction semantics cross the runtime boundary.

For wire-level behavior, the exported schemas in `packages/schemas` are the source of truth. The architecture docs explain intent and usage, but schema-backed request, response, and event definitions win when they disagree with prose examples.

## Mission

The protocol exists so connectivity, control, and event delivery have one explicit, validated shape instead of many ad hoc transport conventions. It keeps the control plane understandable and safe under reconnects, retries, and multi-instance deployment.

## Responsibilities

- Define the message classes used by clients and nodes to interact with the gateway.
- Provide the handshake, request/response, and server-push event semantics for long-lived connections.
- Carry explicit protocol revisioning and compatibility rules.
- Keep typed contracts aligned with runtime validation and observable behavior.

## Primary uses

The protocol is the primary interface for:

- interactive chat sessions
- workflow execution progress (runs, steps, and attempts)
- approvals and resume control
- node pairing and capability RPC

## Non-responsibilities

- The protocol does not define product policy, approval rules, or business logic; those belong to runtime subsystems behind the gateway.
- The protocol is not the same thing as the transport; HTTP resource surfaces and WebSocket transport are delivery choices around the same typed control model.

## Boundary and ownership

- **Inside the boundary:** message classes, connection lifecycle rules, compatibility, and wire-level validation expectations.
- **Outside the boundary:** client UX, node-local execution, and durable subsystem behavior that the protocol merely carries.

## Internal building blocks

- **Handshake:** establishes identity, role, capabilities, and revision compatibility.
- **Requests and responses:** represent peer-initiated actions with typed outcomes.
- **Events:** represent server-push lifecycle, progress, and state notifications.
- **Contracts:** versioned schemas that keep protocol validation and runtime behavior aligned.

## Interfaces, inputs, outputs, and dependencies

- **Inputs:** client and node messages sent over long-lived connections or related HTTP bootstrap flows.
- **Outputs:** typed responses, lifecycle events, error codes, and capability/control-plane messages.
- **Dependencies:** gateway routing, contracts, auth scopes, durable state, and backplane/event delivery behavior.

## Transport

- Primary transport is WebSocket for low-latency, long-lived connectivity.
- Heartbeats detect dead connections and enable safe eviction and reconnect behavior.
- The gateway also exposes an HTTP API for bootstrap and resource surfaces such as auth/session, artifacts, and callbacks. See [API surfaces (WebSocket vs HTTP)](/architecture/api-surfaces).

## Invariants and constraints

- Protocol behavior must remain safe under reconnects, retries, and at-least-once event delivery.
- Revision compatibility is explicit and must fail closed on unsupported combinations.
- Transport choice does not relax authz, audit, or policy rules.

## Deployment notes

The protocol works across gateway restarts and multi-instance deployments:

- **Reconnect is normal:** clients and nodes should tolerate disconnects and reconnect without violating safety invariants.
- **Reconnect backoff should spread retries:** the canonical client SDK uses exponential backoff with jitter and stops retrying on terminal close codes.
- **Events are at-least-once:** events may be delivered more than once, especially across reconnect. Deduplicate using stable `event_id` values.
- **Requests can be retried:** when a peer does not observe a response, it may retry the request with the same `request_id`, subject to the request type's idempotency contract.
- **Durable state is the source of truth:** important state transitions must be backed by the StateStore and re-derivable after reconnect.

## Protocol revisions

The handshake includes a `protocol_rev` integer. A connection is accepted only when the peer and gateway agree on a supported revision.

Revisions allow evolving request types and fields without a major-version bump. The gateway may support multiple revisions concurrently, but it selects a single revision per connection and rejects unsupported revisions.

The protocol uses run-scoped identifiers such as `run_id`, `step_id`, and `attempt_id` and avoids ambiguous plan identifiers.

## Failure and recovery

- **Failure modes:** disconnects, mismatched revisions, duplicate event delivery, and lost request/response visibility.
- **Recovery model:** reconnect, dedupe by stable identifiers, retry by idempotent request ids, and re-derive state from durable storage.

## Security and policy boundaries

- Requests and events are validated against typed contracts.
- Scope enforcement and related policy checks apply regardless of transport.
- Connection identity and capability claims are verified during handshake before trusted routing occurs.

## Key decisions and tradeoffs

- **Interactive control plane over WebSocket:** Tyrum optimizes for long-lived interactive state and event streaming rather than a request-only API model.
- **Typed protocol over implicit conventions:** compatibility, retries, and reconnect behavior are explicit so the runtime stays understandable under failure.
- **HTTP as a complementary surface:** HTTP handles bootstrap, resources, and callbacks, but does not replace the typed control model.

## Drill-down

- [Architecture](/architecture)
- [API surfaces (WebSocket vs HTTP)](/architecture/api-surfaces)
- [Contracts](/architecture/contracts)
- [Handshake](./handshake.md)
- [Requests and Responses](./requests-responses.md)
- [Events](./events.md)
