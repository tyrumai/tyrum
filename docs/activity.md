# Activity

The Activity page gives operators a room-based view of what each agent is doing right now. It is designed to answer three practical questions quickly:

- Which workstreams need attention first
- What room or phase each workstream is currently in
- Which persona is driving the selected agent's behavior

## What The Activity Page Shows

The Activity route combines three surfaces:

- A scene that groups active workstreams into fixed rooms such as the strategy desk, terminal lab, mail room, archive, and approval desk
- An inspector that shows the selected workstream's agent, lane, run status, queue depth, recent events, and editable persona details
- A timeline that summarizes the latest activity when a workstream is selected, or the newest cross-workstream events when the selection is cleared

Operators can clear the selection to view all workstreams at once, or select a specific workstream to focus the inspector and timeline on that unit of work.

## Workstreams Use Key + Lane Identity

Activity workstreams are identified by `key + lane`, not by agent alone.

That distinction matters because one agent can own multiple concurrent workstreams at the same time. Common examples include:

- a primary `main` lane handling the core task
- a `review` lane waiting on approval
- an additional subagent or direct-message lane for parallel work

The Activity store groups those workstreams under one agent for display, but it keeps each `key + lane` pair distinct for ordering, selection, queue metadata, room assignment, and recent events. This prevents same-agent work from collapsing into one ambiguous card.

## Persona Semantics

The persona shown in Activity describes how the selected agent should behave, not which workstream is currently selected.

Each agent has one effective persona at a time. Activity reuses that persona across every workstream owned by the same agent so operators can:

- understand the current identity context before reviewing output
- preview randomized persona edits safely in the inspector
- persist persona updates back to managed agent config with an audit reason

Persona fields are intended to be semantic, not decorative:

- `name` is the operator-facing identity shown in the Activity scene and inspector
- `description` explains the working style or role in plain language
- `tone`, `palette`, and `character` provide structured inputs that the rest of the system can persist, validate, and reuse consistently

If managed agent config is unavailable, Activity falls back to read-only persona details from the current state instead of pretending edits can be saved.

## Operating Notes

- Attention priority is ordered so approvals and failures surface before lower-risk running work.
- Reduced-motion and hidden-document states pause scene animation without changing workstream selection.
- Recent events are retained per workstream so the scene, inspector, and timeline stay aligned around the same `key + lane` identity.

## Contributor Notes

When changing the Activity experience, keep tests and docs aligned across these layers:

- `packages/operator-core/tests/activity-store.test.ts` for workstream derivation and fallback behavior
- `packages/operator-ui/tests/pages/activity-page.test.ts` and `packages/operator-ui/tests/operator-ui.a11y.test.ts` for UI and accessibility behavior
- `packages/schemas/tests/` plus client and gateway tests for persona contracts and enriched profile responses

If Activity behavior changes, update this document in the same change so operators and contributors keep one shared model of the feature.
