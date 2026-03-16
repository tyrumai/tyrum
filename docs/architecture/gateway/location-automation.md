---
slug: /architecture/gateway/location-automation
---

# Location automation

Location automation turns node-reported location beacons into durable saved-place or POI-category events and dispatches those events into the execution engine.

## Purpose

This component exists so Tyrum can react to where a paired device is, not just to time-based schedules or external webhooks.

It keeps raw sensor collection on nodes while the gateway owns configuration, event evaluation, retention, and automation dispatch.

## Responsibilities

- Manage location profiles, saved places, event history, and automation triggers.
- Accept paired-node location beacons and decide whether each sample is usable.
- Evaluate saved-place and POI-category enter/exit/dwell transitions durably.
- Dispatch matching triggers as agent turns, explicit steps, or playbook runs.

## Non-goals

- This component does not collect background location by itself; nodes provide the sensor boundary.
- This component does not replace generic cron, heartbeat, or webhook automation.

## Boundary and ownership

- **Inside the boundary:** profile/place configuration, sample acceptance, event/state persistence, and trigger dispatch into the execution engine.
- **Outside the boundary:** device sensor permissions, mobile/browser collection UX, and external POI provider implementation details.

## Inputs, outputs, and dependencies

- **Inputs:** `/location/*` configuration requests, `/automation/triggers` requests, location beacons from paired nodes, and optional POI lookups.
- **Outputs:** accepted or rejected samples, durable location events, memory episodes, and execution jobs for `agent_turn`, `steps`, or `playbook` triggers.
- **Dependencies:** [Gateway](/architecture/gateway), [Automation](/architecture/automation), [Node](/architecture/node), the execution engine, policy checks, and location storage tables.

## State and data

- `location_profiles` store per-agent stream settings such as primary node, accuracy filters, and POI provider choice.
- `location_places` store named saved places with coordinates, radius, and metadata.
- `location_samples` keep accepted or rejected beacon history.
- `location_subject_states` store the current enter/exit/dwell state per subject and node.
- `location_events` are the durable trigger source for saved places and POI categories.
- `automation_triggers` store enabled location-trigger rules and their execution mode.

## Control flow

1. An operator configures a location profile, saved places, and one or more location automation triggers.
2. A paired node sends a location beacon to the gateway with coordinates, timing, and source metadata.
3. The gateway validates the sample against the profile, persists it, and evaluates saved-place and optional POI-category transitions.
4. When a new event is detected, the gateway stores the event, updates subject state, records a memory episode, and matches enabled triggers.
5. Matching triggers dispatch into the execution engine as an `agent_turn`, explicit `steps`, or a `playbook`, using the normal policy and approval path.

## Invariants and constraints

- Location automation is driven by durable events, not by ephemeral in-memory geofence state.
- Samples can be retained as `accepted=false` without triggering any automation.
- Trigger definitions are scoped to an agent/workspace and can be enabled or paused independently of the underlying location profile.

## Failure behavior

- **Expected failures:** invalid beacon payloads, samples that fail accuracy/background filters, POI provider errors, and trigger-dispatch failures.
- **Recovery path:** rejected samples remain non-triggering history, saved-place evaluation continues even if POI evaluation fails, and durable events remain recorded even when downstream trigger dispatch needs retry or operator inspection.

## Security and policy considerations

- Location data is sensitive and should be treated more like sensor history than ordinary scheduling metadata.
- Only paired nodes for the tenant can submit location beacons.
- Trigger execution still goes through the ordinary gateway policy, approval, and audit boundaries.

## Key decisions and tradeoffs

- **Split sensing from orchestration:** nodes collect coordinates; the gateway decides what those coordinates mean for automation.
- **Trigger from durable events:** saved-place and POI transitions can be replayed, audited, and deduped without trusting socket liveness.

## Observability

- Operators can inspect location profiles, saved places, recent events, and trigger definitions through the gateway APIs.
- Location-trigger dispatch failures are logged without discarding the underlying durable event.
- Event history is available for debugging why a location-aware automation did or did not fire.

## Related docs

- [Gateway](/architecture/gateway)
- [Automation](/architecture/automation)
- [Events](/architecture/protocol/events)
- [Gateway data model map](/architecture/data-model-map)
- [Data lifecycle and retention](/architecture/data-lifecycle)
