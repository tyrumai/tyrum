---
slug: /architecture/doc-templates
---

# Architecture Doc Templates

This page defines the standard template set for architecture documentation in Tyrum.

The goal is to help readers move from a high-level understanding of the system to concrete mechanics without losing the thread of why each part exists.

## What a building block should describe

In Tyrum, a building block should describe a stable architectural responsibility and its boundary, not just a named implementation box.

Every meaningful building block should make these questions easy to answer:

- Why does this part exist?
- What capability does it provide?
- What is inside its boundary, and what is outside?
- What can other parts rely on it for?
- What interfaces, inputs, and outputs define the boundary?
- What dependencies and constraints shape its design?

## How to use these templates

- Choose the smallest level that matches the page's purpose.
- Keep one level per page whenever possible.
- Prefer explicit boundaries, interfaces, and constraints over generic labels.
- Link upward to the broader concept and downward to the next drill-down pages.
- Use diagrams only when they remove ambiguity.

## Levels in the current docs

Use these levels as the default classification for architecture docs in [`docs/architecture/`](/architecture).

| Level   | Purpose                                                            | Typical Tyrum pages                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Level 0 | Explain the whole system in a few major building blocks            | [`Architecture`](/architecture)                                                                                                                                                                                                         |
| Level 1 | Explain a major subsystem and its internal building blocks         | [`Gateway`](/architecture/gateway), [`Agent`](/architecture/agent), [`Protocol`](/architecture/protocol), [`Client`](/architecture/client), [`Node`](/architecture/node), [`Scaling and High Availability`](/architecture/scaling-ha)   |
| Level 2 | Explain one concrete subsystem component in behavioral terms       | [`Execution engine`](/architecture/execution-engine), [`Work board and delegated execution`](/architecture/workboard), [`Memory`](/architecture/memory), [`Approvals`](/architecture/approvals), [`Artifacts`](/architecture/artifacts) |
| Level 3 | Explain exact mechanics, schemas, storage, or operational behavior | [`Handshake`](/architecture/protocol/handshake), [`Events`](/architecture/protocol/events), [`StateStore dialects`](/architecture/gateway/statestore-dialects), [`Gateway data model map`](/architecture/data-model-map)                |

## Standard fields across all levels

Every architecture page should answer most of these questions, with the level controlling how much detail is needed:

- What is this page about?
- What does it own?
- What does it explicitly not own?
- What is the boundary and who controls it?
- What interfaces, inputs, outputs, and dependencies define that boundary?
- What invariants and constraints must remain true?
- How does it fail or recover?
- What security or policy boundaries matter?
- Where should the reader go next?

## Traceability rules

The architecture set should read like a guided zoom-in:

- Level 0 pages link only to Level 1 pages.
- Level 1 pages link downward to the Level 2 pages they own.
- Level 2 pages link upward to their Level 1 parent and downward to any Level 3 mechanics pages.
- Level 3 pages link upward to the Level 2 or Level 1 page that gives them context.

Each concept should have one canonical overview home and one canonical mechanics home.

## Level 0 template: system overview

Use this for the architecture landing page or a top-level product area that should be understandable in a few minutes.

```md
# <System or Product Area>

<One-sentence description of what the system is and why it exists.>

## Purpose

<2-4 short paragraphs on the problem the system solves, who uses it, and the qualities that matter most.>

## Core building blocks

- **<Block 1>:** <Stable responsibility and boundary.>
- **<Block 2>:** <Stable responsibility and boundary.>
- **<Block 3>:** <Stable responsibility and boundary.>
- **<Block 4>:** <Stable responsibility and boundary.>

## High-level topology

<Optional mermaid diagram showing the main blocks and their interfaces.>

## Primary runtime flows

### <Flow 1>

1. <Step>
2. <Step>
3. <Step>

### <Flow 2>

1. <Step>
2. <Step>
3. <Step>

## Key decisions and tradeoffs

- **<Decision>:** <Why this boundary or approach exists.>
- **<Decision>:** <Why this boundary or approach exists.>

## Drill-down

- [<Level 1 page 1>](./<path>.md)
- [<Level 1 page 2>](./<path>.md)
- [<Level 1 page 3>](./<path>.md)
```

## Level 1 template: subsystem overview

Use this for a major area such as the gateway, agent runtime, protocol, client, node, or deployment model.

```md
# <Subsystem Name>

<One-sentence description of the subsystem's role in the broader architecture.>

## Mission

<Short explanation of why this subsystem exists.>

## Responsibilities

- <Responsibility>
- <Responsibility>
- <Responsibility>

## Non-responsibilities

- <What this subsystem must not do>
- <What another subsystem owns instead>

## Boundary and ownership

- **Inside the boundary:** <What this subsystem directly controls>
- **Outside the boundary:** <What adjacent subsystems own>

## Internal building blocks

- **<Component 1>:** <What it does inside this subsystem.>
- **<Component 2>:** <What it does inside this subsystem.>
- **<Component 3>:** <What it does inside this subsystem.>

## Interfaces, inputs, outputs, and dependencies

- **Inputs:** <Requests, events, jobs, files, or operator actions received>
- **Outputs:** <Responses, events, artifacts, state changes, side effects>
- **Dependencies:** <StateStore, backplane, providers, nodes, clients, plugins, etc.>

## Invariants and constraints

- <Rule that must always remain true>
- <Constraint that materially shapes the design>

## Failure and recovery

- **Failure modes:** <What commonly fails here>
- **Recovery model:** <Retry, pause/resume, reconnect, replay, manual intervention>

## Security and policy boundaries

- <Auth/authz expectations>
- <Approval or policy boundaries>
- <Secret or sensitive data boundaries>

## Key decisions and tradeoffs

- **<Decision>:** <Why this subsystem boundary or behavior exists.>
- **<Decision>:** <Why this subsystem boundary or behavior exists.>

## Drill-down

- [<Parent overview>](./<parent>.md)
- [<Level 2 page 1>](./<child>.md)
- [<Level 2 page 2>](./<child>.md)
- [<Level 2 page 3>](./<child>.md)
```

## Level 2 template: component detail

Use this for one concrete component where readers need behavioral understanding rather than a full operational spec.

```md
# <Component Name>

<One-sentence description of the component and the boundary it sits on.>

## Purpose

<Why this component exists and what problem it solves inside the subsystem.>

## Responsibilities

- <Responsibility>
- <Responsibility>
- <Responsibility>

## Non-goals

- <What this component intentionally does not handle>
- <What adjacent components own>

## Boundary and ownership

- **Inside the boundary:** <What this component directly controls>
- **Outside the boundary:** <What adjacent components or operators own>

## Inputs, outputs, and dependencies

- **Inputs:** <Commands, events, API calls, jobs, records, files>
- **Outputs:** <Events, state changes, responses, artifacts, side effects>
- **Dependencies:** <Parent subsystem, stores, providers, services>

## State and data

- <What durable state, transient state, or records this component owns or depends on>

## Control flow

1. <Step>
2. <Step>
3. <Step>

## Invariants and constraints

- <Invariant>
- <Constraint that shapes the implementation>

## Failure behavior

- **Expected failures:** <Validation errors, timeouts, conflicts, disconnects, etc.>
- **Recovery path:** <Retry, replay, reconnect, pause/resume, compensation>

## Security and policy considerations

- <Auth/authz, policy checks, approval gates, tenant scoping, or secret handling>

## Key decisions and tradeoffs

- **<Optional when useful>:** <Why this design exists.>

## Observability

- <Important logs, metrics, traces, events, or evidence objects>

## Related docs

- [<Parent subsystem>](./<parent>.md)
- [<Related component>](./<related>.md)
- [<Lower-level detail>](./<detail>.md)
```

## Level 3 template: deep mechanics or operational detail

Use this for detailed protocol pages, storage design pages, operational maintenance pages, or any page that needs exact mechanics and edge-case guidance.

```md
# <Mechanic or Operational Topic>

<One-sentence summary of the exact detail this page specifies.>

## Parent concept

- [<Parent component or subsystem>](./<parent>.md)

## Scope

<What this page covers and what it deliberately leaves to other pages.>

## Preconditions and assumptions

- <Assumption>
- <Assumption>

## Detailed mechanics

### <Section or phase 1>

1. <Step>
2. <Step>
3. <Step>

### <Section or phase 2>

1. <Step>
2. <Step>
3. <Step>

## Data model or message shapes

<Optional TypeScript, JSON, SQL, or table example for the exact shape being described.>

## Constraints and edge cases

- <Constraint>
- <Edge case>
- <Recovery expectation>

## Security considerations

- <Sensitive inputs, validation, approval, authz, tenancy, or exposure constraints>

## Operational guidance

- <How operators diagnose or maintain this area>
- <When manual intervention is required>

## Related docs

- [<Sibling detail page>](./<sibling>.md)
- [<Wider overview>](./<overview>.md)
```

## Writing rules for this repo

When authoring or revising architecture docs in this repository:

- Prefer stable responsibilities and boundaries over implementation labels.
- Make constraints explicit when they drive the design.
- Put exact mechanics behind headings rather than front-loading them.
- Keep the first paragraph readable by someone new to the codebase.
- Do not mix aspirational design with shipped behavior without calling that out clearly.

## Recommended next step

Use this page as the standard when revising [`Architecture`](/architecture) and when deciding whether a new topic belongs as a Level 1 subsystem page, a Level 2 component page, or a Level 3 mechanics page.
