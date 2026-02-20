# Architecture

Tyrum is a WebSocket-first autonomous worker agent platform built around a long-lived gateway that coordinates durable execution, approvals, and audit evidence.

## High-level topology

```mermaid
flowchart LR
  subgraph Operator["Operator surfaces"]
    C["Client<br/>(Desktop • Mobile • CLI/TUI • Web UI)"]
  end

  subgraph Runtime["Tyrum runtime"]
    G["Gateway<br/>(long-lived service)"]
    DB[("State + logs<br/>StateStore (SQLite/Postgres)")]
    AS[("Artifact store<br/>(FS/S3-compatible)")]
    EV["Event backplane"]
    ENG["Execution engine"]
    APPR["Approvals"]
    PB["Playbook runtime"]
    SEC["Secret provider"]
  end

  subgraph Devices["Companion devices"]
    N["Node<br/>(capability provider)"]
  end

  subgraph Integrations["Integrations"]
    M["Model providers<br/>(provider/model)"]
    CH["Channels<br/>(WhatsApp • Telegram • …)"]
    EXT["External systems<br/>(tools / MCP)"]
  end

  C <--> |"WebSocket<br/>requests/responses + events"| G
  N <--> |"WebSocket<br/>capability RPC + events"| G
  G <--> DB
  ENG <--> AS
  G --> EV
  EV --> C
  G --> ENG
  ENG --> APPR
  ENG --> PB
  G <--> SEC
  G <--> M
  G <--> CH
  G <--> EXT
```

## Building blocks

- **Gateway:** the long-lived service that owns edge connectivity (WebSocket), routing, and contract validation. See [Gateway](./gateway/index.md).
- **StateStore:** durable state and logs (SQLite local; Postgres for HA/scale). See [Scaling and high availability](./scaling-ha.md).
- **Event backplane:** cross-component event delivery (in-process for replica count = 1; shared for clusters). See [Scaling and high availability](./scaling-ha.md) and [Events](./protocol/events.md).
- **Execution engine:** the durable orchestration runtime (retries, idempotency, pause/resume, evidence). See [Execution engine](./execution-engine.md).
- **Workers:** step executors that claim work (leases), perform side effects, and publish results/events. See [Execution engine](./execution-engine.md).
- **ToolRunner:** a workspace-mounted execution context that runs filesystem/CLI tools. In single-host deployments it can be a local subprocess; in clusters it is typically a sandboxed job/pod. See [Scaling and high availability](./scaling-ha.md).
- **Scheduler:** cron/watchers/heartbeat enqueuers coordinated by DB-leases. See [Automation](./automation.md).
- **Playbooks:** deterministic workflow specs executed by the runtime (approval gates + resume tokens).
- **Approvals:** durable operator confirmation requests that gate risky actions and pause/resume workflows.
- **Secrets:** a first-class boundary; raw secrets stay behind a secret provider and are referenced via handles.
- **Auth profiles:** provider credentials (API keys/OAuth) expressed as metadata + secret handles for deterministic selection and rotation. See [Provider Auth and Onboarding](./auth.md).
- **Artifacts:** evidence objects stored outside the StateStore with policy-gated access. See [Artifacts](./artifacts.md).
- **Client:** an operator interface connected to the gateway (desktop/mobile/CLI/web).
- **Node:** a capability provider connected to the gateway (desktop/mobile/headless).
- **Protocol:** typed WebSocket messages (requests/responses and server-push events).
- **Contracts:** versioned schemas used to validate protocol messages and extension boundaries.

## Design principles

- **Local-first by default:** safe defaults assume localhost binding and explicit access control.
- **Typed boundaries:** inputs/outputs are validated at the edges (protocol, tools, plugins).
- **Least privilege:** capabilities and tools are scoped; high-risk actions require explicit policy/approvals.
- **Evidence over confidence:** state changes require postconditions and artifacts when feasible; unverifiable outcomes must not be reported as “done”.
- **Resumable execution:** long-running work can pause for approvals/takeover and resume later without repeating completed steps.
- **Secrets by handle:** the model never sees raw credentials; executors use secret handles with policy-gated resolution.
- **Auditability:** important actions emit events and can be persisted for troubleshooting and compliance.
- **Extensible core:** gateway plugins, tools, skills, nodes, and MCP servers extend behavior without changing the gateway core.

## Where to start

- [Scaling and high availability](./scaling-ha.md)
- [Gateway](./gateway/index.md)
- [Execution engine](./execution-engine.md)
- [Messages and Sessions](./messages-sessions.md)
- [Playbooks](./playbooks.md)
- [Approvals](./approvals.md)
- [Policy overrides (approve-always)](./policy-overrides.md)
- [Secrets](./secrets.md)
- [Provider Auth and Onboarding](./auth.md)
- [Artifacts](./artifacts.md)
- [Sandbox and policy](./sandbox-policy.md)
- [Observability](./observability.md)
- [Presence](./presence.md)
- [Client](./client.md)
- [Node](./node.md)
- [Protocol](./protocol/index.md)
- [Workspace](./workspace.md)
- [Sessions and lanes](./sessions-lanes.md)
- [Glossary](./glossary.md)
