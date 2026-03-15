# Gateway

The gateway is Tyrum's long-lived control plane. It owns connectivity, routing, policy enforcement, approvals, execution coordination, and durable state integration for the rest of the system.

Deployments range from a single host to multi-instance clusters. The gateway keeps the same core control-plane role across both shapes and coordinates execution and event delivery through the StateStore and backplane. See [Scaling and High Availability](/architecture/scaling-ha).

## Mission

The gateway exists so Tyrum has one authoritative runtime boundary for interactive control, validation, and durable orchestration. It keeps clients, nodes, tools, models, and execution flows under a single typed and policy-aware control plane.

## Responsibilities

- Maintain long-lived connections to clients, nodes, channels, and model providers.
- Expose typed APIs and route requests to the correct runtime subsystem.
- Enforce contracts, auth/authz, approvals, and policy checks at trusted boundaries.
- Coordinate durable execution, event delivery, and persistence through the StateStore and backplane.
- Host the extension surfaces for tools, plugins, skills, and MCP integrations.

## Non-responsibilities

- The gateway does not perform device-specific automation directly; nodes provide that capability boundary.
- The gateway does not require a specific operator UI; multiple clients can connect concurrently.

## Boundary and ownership

- **Inside the boundary:** transport handling, validation, routing, execution coordination, approvals, policy enforcement, and durable state integration.
- **Outside the boundary:** client UX implementation, node-local execution details, and raw secret storage.

## Internal building blocks

- **Protocol and transport handling:** WebSocket-first connectivity, HTTP resource surfaces, and message validation.
- **Execution and safety controls:** execution engine, approvals, policy, automation, and audit/event emission.
- **Extension surface:** tools, plugins, skills, MCP, and provider integrations.
- **Persistence and coordination:** StateStore integration, artifact references, event backplane, and durable execution state.

## Internal topology

```mermaid
flowchart TB
  WS["WebSocket server"] --> PROTO["Protocol router<br/>(contracts + dispatch)"]
  HTTP["HTTP API"] --> PROTO

  PROTO --> AG["Agent runtime<br/>(loop + lanes)"]
  PROTO --> ENG["Execution engine<br/>(runs + retries + pause/resume)"]
  PROTO --> CAP["Capability router<br/>(node dispatch)"]

  AG --> ENG
  AG --> WORK["WorkBoard subsystem"]
  ENG --> TOOLS["Tool runtime"]
  TOOLS --> BUILTIN["Built-in tools"]
  TOOLS --> MCP["MCP tools"]
  TOOLS --> PLUGTOOLS["Plugin tools"]

  ENG --> POLICY["Policy engine"]
  ENG --> APPR["Approvals"]
  ENG --> WORK
  ENG --> MEM["Memory subsystem"]
  ENG --> AUDIT["Audit/event log"]
  ENG <--> SECRETS["Secret provider"]

  DB[("StateStore (SQLite/Postgres)")] <--> MEM
  DB <--> WORK
  DB <--> AUDIT
  DB <--> AG
  DB <--> ENG

  CAP --> NODES["Connected nodes"]
```

## Interfaces, inputs, outputs, and dependencies

- **Inputs:** client requests, node capability advertisements, automation triggers, model/tool invocations, and external callbacks.
- **Outputs:** typed responses, server-push events, approval requests, durable execution state, and routed capability/tool calls.
- **Dependencies:** protocol/contracts, execution engine, StateStore, artifacts, secret provider, backplane, nodes, and providers.

Key interfaces:

- **Client interface:** WebSocket requests/responses plus server-push events.
- **Node interface:** WebSocket with pairing, capability advertisement, and capability RPC.
- **Extensions:** tool schemas, plugin registration, and optional MCP servers.
- **Execution and approvals:** requests/events for starting runs, streaming progress, pausing for approval, and resuming with resume tokens.

## Invariants and constraints

- All trusted boundaries are validated and deny-by-default.
- Durable state and event coordination must survive restarts and scale changes.
- Operator clients never execute node capability RPC directly; the gateway mediates that dispatch.

## Failure and recovery

- **Failure modes:** connection churn, provider outages, worker failures, transient database errors, and approval pauses.
- **Recovery model:** reconnectable protocol sessions, durable state, resumable execution, and backplane-driven event replay keep the control plane recoverable.

## Security and policy boundaries

- All inbound and outbound behavior is validated against contracts and policy.
- Risky actions pause behind approvals instead of relying on model self-restraint.
- Secrets remain behind a secret provider boundary and are resolved only in trusted execution contexts.

## Key decisions and tradeoffs

- **One long-lived control plane:** Tyrum centralizes validation, policy, and execution coordination instead of spreading them across many ad hoc services.
- **Policy and approvals as first-class architecture:** risky behavior is governed by explicit runtime controls rather than prompt guidance alone.
- **Extensible core with hard boundaries:** tools, plugins, skills, and nodes can extend behavior without weakening the gateway's ownership of validation and routing.

## Implementation map

The current implementation is organized by gateway modules rather than by a separate service per box in the diagrams:

- **Edge and API surface:** `routes`, `ws`, `modules/auth`, `modules/authz`, `modules/ingress`
- **Execution and work coordination:** `modules/execution`, `modules/approval`, `modules/workboard`, `modules/playbook`, `modules/watcher`, `modules/automation`
- **Durability and runtime state:** `modules/statestore`, `modules/artifact`, `modules/backplane`, `modules/presence`, `modules/runtime-state`
- **Agent/runtime support:** `modules/agent`, `modules/memory`, `modules/context`, `modules/planner`, `modules/review`
- **Device and node orchestration:** `modules/node`, `modules/desktop`, `modules/mobile`, `modules/desktop-environments`

## Integration map

External integrations are grouped into gateway modules as well:

- **Models and provider auth:** `modules/models`, `routes/provider-config.ts`, `routes/auth-profiles.ts`, `routes/provider-oauth.ts`
- **Tools, plugins, and extensions:** `modules/plugins`, `modules/extensions`, `routes/tool-registry.ts`, `routes/extensions.ts`
- **Secrets and policy:** `modules/secret`, `modules/policy`, `routes/secret.ts`, `routes/policy.ts`, `routes/policy-bundle.ts`
- **Channels and external ingress:** `modules/channels`, `routes/ingress.ts`, `routes/routing-config.ts`

## Drill-down

- [Architecture](/architecture)
- [API surfaces (WebSocket vs HTTP)](/architecture/api-surfaces)
- [Execution engine](/architecture/execution-engine)
- [Approvals](/architecture/approvals)
- [Policy overrides (approve-always)](/architecture/policy-overrides)
- [Secrets](/architecture/secrets)
- [Provider Auth and Onboarding](/architecture/auth)
- [Artifacts](/architecture/artifacts)
- [Automation](/architecture/automation)
- [Tools](/architecture/tools)
- [Gateway plugins](/architecture/plugins)
- [Sandbox and Policy](/architecture/sandbox-policy)
- [Observability (Context, Usage, and Audit)](/architecture/observability)
