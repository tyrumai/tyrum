# Gateway

Status:

The gateway is Tyrum's single long-lived daemon. It is the system's authority for connectivity, policy, validation, routing, orchestration, and persistence.

## Responsibilities

- Maintain long-lived connections to clients, nodes, channels, and model providers.
- Expose typed APIs (WebSocket-first; HTTP where appropriate).
- Validate inbound/outbound messages against contracts.
- Route requests to internal modules or to capable nodes.
- Emit events for lifecycle, actions, and state changes.
- Persist essential state (sessions, transcripts, memory, audit logs).
- Host automation triggers (hooks, cron, heartbeat) in a controlled way.
- Provide a stable extension surface (tools, plugins, skills, MCP).

## Non-responsibilities

- The gateway should not perform device-specific automation directly. Device and UI automation live behind node capabilities.
- The gateway should not require a specific client UI; multiple clients can exist concurrently.

## Internal topology (conceptual)

```mermaid
flowchart TB
  WS["WebSocket server"] --> PROTO["Protocol router<br/>(contracts + dispatch)"]
  HTTP["HTTP API"] --> PROTO

  PROTO --> AG["Agent runtime<br/>(loop + lanes)"]
  PROTO --> CAP["Capability router<br/>(node dispatch)"]

  AG --> TOOLS["Tool runtime"]
  TOOLS --> BUILTIN["Built-in tools"]
  TOOLS --> MCP["MCP tools"]
  TOOLS --> PLUGTOOLS["Plugin tools"]

  AG --> POLICY["Policy + approvals"]
  AG --> MEM["Memory subsystem"]
  AG --> AUDIT["Audit/event log"]

  DB[("SQLite state")] <--> MEM
  DB <--> AUDIT
  DB <--> AG

  CAP --> NODES["Connected nodes"]
```

## Key interfaces

- **Client interface:** WebSocket requests/responses + server-push events.
- **Node interface:** WebSocket with pairing, capability advertisement, and capability RPC.
- **Extensions:** tool schemas, plugin registration, and (optionally) MCP servers.
