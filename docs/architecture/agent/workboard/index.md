---
slug: /architecture/workboard
---

# Work board and delegated execution

The WorkBoard is Tyrum's durable work-management surface. It keeps long-running work visible, queryable, and resumable without forcing interactive sessions to carry the full planning and execution state in transcript history.

## Purpose

The WorkBoard exists so Tyrum can separate interactive responsiveness from background execution. It gives the agent a durable backlog, typed working set, and operator-visible status model while the execution engine handles the actual run and step lifecycle.

## Responsibilities

- Represent operator-visible work as durable WorkItems with explicit status, acceptance criteria, and blockers.
- Keep background work queryable from any operator surface without replaying transcripts.
- Hold durable work-state records such as decisions, reminders, verification summaries, and work artifacts.
- Coordinate delegated execution by capturing work, tracking readiness, and reflecting progress back into the agent runtime.

## Non-goals

- The WorkBoard is not a replacement for the execution engine; it sits above jobs, runs, steps, and approvals.
- The WorkBoard is not a generic team project-management suite; the starting assumption is one operator per agent.
- The WorkBoard is not a transcript store or memory store; transcripts and long-term memory remain separate architectural surfaces.

## Boundary and ownership

- **Inside the boundary:** WorkItems, task-level work state, DecisionRecords, WorkSignals, durable work artifacts, and operator-visible progress state.
- **Outside the boundary:** transport/session handling, step execution, raw artifact bytes, and long-term memory consolidation.

## Inputs, outputs, and dependencies

- **Inputs:** interactive work capture, planner updates, execution outcomes, approvals, artifacts, and operator actions.
- **Outputs:** durable work-state records, operator-visible status, background dispatch intent, notifications, and drill-down context for the agent runtime.
- **Dependencies:** agent runtime, execution engine, approvals, artifacts, workspace, sessions, and durable StateStore records.

## Key building blocks

- **WorkItem:** the operator-visible unit of work with acceptance criteria and lifecycle state.
- **Task graph:** the internal dependency graph that breaks a WorkItem into runnable tasks.
- **WorkArtifact:** typed durable context for planning, verification, risks, and summaries.
- **DecisionRecord:** the durable explanation of what was chosen and why.
- **WorkSignal:** a durable reminder or trigger that externalizes "remember to do this later".
- **Focus digest and state KV:** the compact working set and authoritative current-truth state that keep the agent coherent under interruptions.

## Control flow

1. An interactive session or automation path captures work into the WorkBoard.
2. Planning/refinement writes durable work-state records and marks tasks ready for background execution.
3. The execution engine runs the delegated work and writes outcomes, approvals, artifacts, and verification back into the WorkBoard.
4. Clients and channels answer status and completion questions from WorkBoard state rather than from transcript recall.

## Invariants and constraints

- WorkBoard state is durable and survives disconnects, compaction, and restarts.
- Interactive turns must remain responsive even while the WorkBoard tracks larger background initiatives.
- Work state is supportive context, not a bypass around policy, approvals, or execution guarantees.

## Failure behavior

- **Expected failures:** blocked work due to approvals or dependencies, stale plans, conflicting delegated branches, and abandoned background work.
- **Recovery path:** durable state, explicit blockers, leases/reconciliation, and operator-visible status allow work to pause and resume safely.

## Security and policy considerations

- Side effects still run through the execution engine with approvals, idempotency, and evidence rules.
- WorkArtifacts and DecisionRecords improve explainability, but they are not a policy override.
- Notifications and completion messages remain outbound side effects and stay policy-gated.

## Key decisions and tradeoffs

- **Durable work state over transcript memory:** status and commitments live in the WorkBoard so they survive compaction and channel switching.
- **Kanban summary plus typed drill-down:** the top-level operator view stays lightweight while deeper planning and verification state remains available.
- **Delegation with explicit state:** background work is externalized into durable records instead of relying on an in-flight agent turn to stay alive forever.

## Related docs

- [Agent](/architecture/agent)
- [Execution engine](/architecture/execution-engine)
- [Workspace](/architecture/workspace)
- [Messages and Sessions](/architecture/messages-sessions)
- [WorkBoard delegated execution](/architecture/workboard/delegated-execution)
- [WorkBoard durable work state](/architecture/workboard/durable-work-state)
