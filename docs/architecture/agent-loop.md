# Agent Loop

Status:

An agent loop is the end-to-end path from an inbound message to a final reply and/or actions. The gateway is responsible for keeping loop execution consistent and auditable.

## Loop stages (target)

```mermaid
flowchart TB
  IN["Inbound message"] --> ASM["Assemble context<br/>(system + history + tools + injected files)"]
  ASM --> INF["Model inference<br/>(planning)"]
  INF --> WF["Workflow/plan selection<br/>(playbook or ad-hoc workflow)"]
  WF --> ENG["Execution engine<br/>(steps + retries + pause/resume)"]
  ENG --> OUT["Stream progress + evidence"]
  OUT --> PERSIST["Persist state<br/>(transcripts, events, memory)"]
```

## Serialization guarantee (target)

- Runs are serialized per session key (and lane) to prevent tool and transcript races.
- This keeps session history consistent and makes replay/audit more reliable.

## Entry points (conceptual)

- Gateway RPC: `agent` and `agent.wait` (or equivalent HTTP endpoints)
- Channel ingress: a message mapped into a session enqueue
