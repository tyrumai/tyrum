# Gateway

The gateway is Tyrum's control plane. It is the trusted boundary that keeps interactive control, durable orchestration, policy enforcement, and extension routing in one place.

## Read this page

- **Read this if:** you need the top-level gateway boundary and flow model.
- **Skip this if:** you are implementing one subsystem and already know the control-plane shape.
- **Go deeper:** use the linked component pages for execution mechanics, approvals, policy details, and integration-specific behavior.

## Control-plane topology

```mermaid
flowchart TB
  WS["WebSocket + HTTP ingress"] --> ROUTER["Contracts + routing"]

  ROUTER --> AGENT["Agent runtime boundary"]
  ROUTER --> ENGINE["Execution engine"]
  ROUTER --> NODE["Node capability routing"]
  ROUTER --> ADMIN["Admin/config APIs"]

  ENGINE --> TOOLS["Tool runtime<br/>(Built-in / Plugin / MCP)"]
  ENGINE --> POLICY["Policy + approvals + reviews"]
  ENGINE --> ART["Artifacts + audit events"]
  ENGINE --> SECRETS["Secret provider"]

  ADMIN --> DESK["Managed desktop + location control"]
  DESK --> NODE

  DB[("StateStore + backplane")] <--> AGENT
  DB <--> ENGINE
  DB <--> ART
  DB <--> ADMIN

  NODE <--> PEERS["Connected nodes"]
  WS <--> CLIENTS["Clients"]
```

## Gateway boundary

### What the gateway owns

- Long-lived client and node connectivity over typed request/response/event surfaces.
- Contract validation, auth/authz enforcement, policy checks, and approval/review gates.
- Runtime routing across agent turns, execution runs, node dispatch, and extension calls.
- Durable coordination through StateStore records and backplane delivery.
- Control-plane administration for managed runtime features such as desktop environments and location automation.

### What the gateway does not own

- Client UX rendering and host-specific presentation logic.
- Node-local device execution internals.
- Secret storage plaintext handling outside trusted providers.

## Primary flows

### Interactive control flow

1. A client request enters through typed transport and is validated at the gateway boundary.
2. The gateway routes into the agent or execution path and applies policy/approval controls before risky side effects.
3. State transitions and evidence are persisted, then streamed back as server-push events.

### Durable execution flow

1. Work is captured and handed to execution coordination.
2. The gateway coordinates tools, nodes, approvals, retries, and evidence with durable state behind each transition.
3. Outcomes are recorded and made observable through events, audit surfaces, and operator state.

## Invariants for this boundary

- Trusted inputs are validated and deny-by-default.
- Policy and approvals remain runtime controls, not prompt-only conventions.
- Node capability execution is always gateway-mediated.
- Durable state is authoritative for recovery across reconnects and scale changes.

## Go deeper

- [Architecture](/architecture)
- [API surfaces (WebSocket vs HTTP)](/architecture/api-surfaces)
- [Execution engine](/architecture/execution-engine)
- [Approvals](/architecture/approvals)
- [Reviews](/architecture/gateway/reviews)
- [Policy overrides (approve-always)](/architecture/policy-overrides)
- [Sandbox and Policy](/architecture/sandbox-policy)
- [Secrets](/architecture/secrets)
- [Artifacts](/architecture/artifacts)
- [Tools](/architecture/tools)
- [Gateway plugins](/architecture/plugins)
- [Automation](/architecture/automation)
- [Desktop Environments](/architecture/gateway/desktop-environments)
- [Location Automation](/architecture/gateway/location-automation)
- [Observability (Context, Usage, and Audit)](/architecture/observability)
