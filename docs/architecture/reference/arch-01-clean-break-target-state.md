---
slug: /architecture/arch-01-clean-break-target-state
---

# ARCH-01 clean-break target-state decision

This is a reference decision record for issue `#1533` and epic `#1532`.

## Quick orientation

- **Read this if:** you need the long-lived decision behind the target package graph and the migration guardrails.
- **Skip this if:** you only need the canonical package layout and contributor rules; use [Target-state package graph](/architecture/target-state).
- **Go deeper:** use [Architecture overview](/architecture) for the current system map and [Gateway](/architecture/gateway) for runtime mechanics.

## Decision snapshot

Tyrum will move from the current mixed gateway, client, and operator package graph to a clean-break target package graph built around contracts, transport, node, operator-app, focused runtime packages, and a reduced gateway composition root.

```mermaid
flowchart LR
  Schemas["@tyrum/schemas"]
  Client["@tyrum/client"]
  OperatorCore["@tyrum/operator-core"]
  GatewayNow["@tyrum/gateway<br/>mixed runtime + transport"]
  Contracts["@tyrum/contracts"]
  Transport["@tyrum/transport-sdk"]
  OperatorApp["@tyrum/operator-app"]
  RuntimeSplit["@tyrum/runtime-*"]
  GatewayTarget["@tyrum/gateway<br/>composition root"]

  Schemas --> Contracts
  Client --> Transport
  Client --> OperatorApp
  OperatorCore --> OperatorApp
  GatewayNow --> RuntimeSplit
  RuntimeSplit --> GatewayTarget
```

## Decision

- Adopt `@tyrum/contracts` as the only shared contract package.
- Split typed transport into `@tyrum/transport-sdk` and generic node lifecycle into `@tyrum/node-sdk`.
- Replace `@tyrum/operator-core` with `@tyrum/operator-app`, and keep `@tyrum/operator-ui` presentation-only on top of it.
- Extract runtime and business logic into `@tyrum/runtime-policy`, `@tyrum/runtime-node-control`, `@tyrum/runtime-execution`, `@tyrum/runtime-agent`, and `@tyrum/runtime-workboard`.
- Reduce `@tyrum/gateway` to composition root, transport adapters, bootstrap, and bundled operator asset serving.

## Why this decision

- The current package graph lets transport and runtime concerns leak upward into operator and client code.
- A backwards-compatible dual surface would keep that leakage alive longer and raise the maintenance cost of every follow-on migration step.
- The clean-break target package graph makes dependency directions explicit enough for CI checks and contributor review.

## Non-negotiable rules

- No backwards-compatibility shims.
- No new code against legacy packages once the replacement migration issue is open.
- Temporary coexistence is allowed only for the migration window needed to land the linked issue safely.
- When one runtime package needs another, the dependency goes through explicit ports and interfaces rather than gateway internals.

## Consequences

- Some migration PRs will touch both target and legacy packages temporarily, but only to unblock the next safe step.
- Contributor entry points and PR templates need to point to the target package graph so new work stops reinforcing the old shape.
- The package-boundary CI gate in `#1534` should encode this decision rather than invent a second architecture source of truth.

## Related docs

- [Target-state package graph](/architecture/target-state)
- [Architecture overview](/architecture)
- [Gateway](/architecture/gateway)
