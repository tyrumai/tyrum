---
slug: /architecture/workboard/delegated-execution
---

# WorkBoard delegated execution

## Parent concept

- [Work board and delegated execution](/architecture/workboard)

## Scope

This page describes how the WorkBoard captures long-running work, delegates it into background execution, and routes status and completion back to the operator. It does not redefine the execution engine's step semantics.

## Intake and delegation flow

The interactive agent should be able to notice when work is too large, ambiguous, or long-running for an inline turn and capture it on the WorkBoard directly through built-in tools.

Execution dispatch remains scheduler-owned. The model decides when to externalize work; background services decide when `ready` work is actually assigned and executed.

```mermaid
flowchart TB
  classDef session fill:#f6f8ff,stroke:#4a67d6,stroke-width:1px,color:#111;
  classDef board fill:#f2fff6,stroke:#2f8f4e,stroke-width:1px,color:#111;
  classDef exec fill:#fff7ed,stroke:#b45309,stroke-width:1px,color:#111;
  classDef gate fill:#fff1f2,stroke:#be123c,stroke-width:1px,color:#111;

  subgraph S["Interactive sessions (lane=main)"]
    Desktop["Desktop client session_key"]:::session
    Telegram["Telegram DM session_key"]:::session
  end

  Desktop --> Intake["Interactive agent turn<br/>classify + inspect work state + decide inline vs capture"]:::session
  Telegram --> Intake

  Intake -->|inline| Inline["Reply in-session"]:::session
  Intake -->|workboard.capture| WB["WorkBoard (workspace scope)<br/>WorkItem + drilldown updated"]:::board

  WB -->|auto-start refinement| SA["Planner subagent<br/>(one per WorkItem)"]:::exec
  SA --> ENG["Execution engine<br/>(jobs/runs/steps)"]:::exec
  ENG --> ART["Artifacts + postconditions"]:::exec
  ENG --> APPR["Approvals (pause/resume)"]:::gate

  ART --> WB
  APPR --> WB
  WB --> Notify["Clarification/completion notification<br/>to last active session"]:::session
  Notify --> Desktop
  Notify --> Telegram
```

Standard intake flow:

1. Classify the request as inline, Action WorkItem, or Initiative WorkItem.
2. Write minimal acceptance criteria, budgets, and authoritative current-truth state.
3. Seed the WorkItem with initial work artifacts, risks, or reminders.
4. Let a planner subagent refine, decompose, and prepare the item for automatic dispatch.

## Delegated execution model

A subagent is a delegated execution context that shares the parent agent's identity boundary but has its own runtime context and session key.

Starting semantics:

- Same `agent_id`, same workspace, same policy bundle, and same memory scope.
- Different `session_key`, so it does not serialize behind a channel-facing session.
- Subagent runs normally execute in `lane=subagent`.
- An execution profile chooses model, tool allowlist, and whether the subagent is read-only or write-capable.

The WorkBoard is updated from durable execution outcomes plus explicitly written WorkBoard records, not from chat narrative alone.

## Fan-out and synthesis

"Figure out what to do" can be expressed as explicit fan-out tasks followed by a synthesis task that proposes next steps.

To keep planning inspectable and resilient under interruption:

- fan-out tasks produce WorkArtifacts such as hypotheses, candidate plans, ToolIntent, and verification reports
- synthesis writes a DecisionRecord, updates the WorkItem task graph and state KV, and may create WorkSignals
- when inputs conflict, the planner inserts an explicit read-only "jury" fan-out before side effects proceed

## Status and notification routing

The interactive agent loop should answer progress questions using WorkBoard state:

- `work.status(last_active_work_id)` or `work.list_active()` for current status
- blockers, approvals, recent DecisionRecords, and next-step summaries from durable work state

Completion or blocked-state notifications should route to the last active session or client session, with `created_from_session_key` as a fallback.

## Backlog and WIP control

Multiple long-running WorkItems are expected. The WorkBoard prevents overload and thrash through:

- WIP limits on `Doing` work
- overlap detection on target resources
- explicit dependency links instead of implicit work merging
- budgeted drill-down retention for artifacts, decisions, and signals

## Safety integration

Delegation does not bypass Tyrum's enforcement model:

- side effects still flow through the execution engine
- approvals still pause work safely
- verification and evidence remain required where feasible
- ToolIntent and intent checks pause and escalate instead of allowing "helpful drift"

## Related docs

- [Execution engine](/architecture/execution-engine)
- [Approvals](/architecture/approvals)
- [Sessions and Lanes](/architecture/sessions-lanes)
- [WorkBoard durable work state](/architecture/workboard/durable-work-state)
