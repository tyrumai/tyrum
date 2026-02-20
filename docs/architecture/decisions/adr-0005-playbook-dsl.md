# ADR-0005: Playbook (workflow) DSL and compilation model

Status:

Accepted (2026-02-19)

## Context

Playbooks are deterministic workflow artifacts executed by the runtime (see [`docs/architecture/playbooks.md`](../playbooks.md)).

Today, the codebase contains an implemented `PlaybookManifest` schema (`packages/schemas/src/playbook.ts`) that models steps as `ActionPrimitiveKind + args`, while the architecture docs describe a richer `command`-centric pipeline DSL.

We need a single canonical DSL for:

- reviewability and versioning
- strong safety defaults (no implicit shell; policy/approvals apply)
- compilation to typed execution steps

## Decision

1. **Canonical authoring** uses a **command pipeline DSL** (workflow files), where each step defines a `command` string plus metadata (id, approvals, output contract, conditions).

2. **Inline pipeline strings** may be accepted as UI input, but they are **compiled to a normalized workflow representation** before execution and persistence.

3. `steps[].command` is interpreted via **explicit command namespaces/prefixes** (for example `http …`, `cli …`, `web …`, `mcp …`, `node …`) and compiled into typed `ActionPrimitive` + routing targets.

4. Steps use a **declared output contract** (`text|json` with optional schema). If `json` is declared, non-JSON output is a hard error.

5. Pause/resume uses **StateStore-backed opaque resume tokens**.

6. Playbooks may include **LLM steps with tools**, but they must be budgeted and fully subject to policy/approvals/sandbox constraints.
## Options considered

- Keep `action + args` as canonical: simpler but diverges from documented workflow expectations.
- Support both DSLs long-term: high maintenance and confusion.
- `command` DSL with implicit shell default: powerful but unsafe.
## Consequences

- We must implement a robust compiler from `command` steps to typed primitives.
- Safety policy must treat `command` parsing as an **edge boundary** (strict validation, allowlists, approvals).

