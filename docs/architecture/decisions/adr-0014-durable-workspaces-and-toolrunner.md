# ADR-0014: Durable workspaces and ToolRunner boundary

Status:

Accepted (2026-02-20)

## Context

Tyrum must support a smooth progression from:

- **Desktop-embedded, single-click** deployments (local `TYRUM_HOME` + SQLite), to
- **Split/HA** deployments (replicated edges + workers + leased schedulers backed by HA Postgres).

In all tiers, `TYRUM_HOME` is the agent’s **durable workspace filesystem**: tools can read/write files and expect them to persist across restarts and future runs.

In Kubernetes, durable workspaces are typically implemented with persistent volumes. However:

- `ReadWriteOnce` (RWO) volumes can only be mounted read/write by **one node at a time**.
- If multiple long-lived deployments mount the same RWO PVC (for example `edge`, `worker`, and `scheduler`), multi-node scheduling can wedge on volume attachment (“PVC attach wedge”).
- Running split services against a shared **SQLite file** on a shared volume is also unsafe (`SQLITE_BUSY` and weaker concurrency semantics).

We need an HA-compatible model that:

- Keeps `TYRUM_HOME` durable (not stateless),
- Avoids RWX network filesystem requirements,
- Keeps “single-host behaves like the cluster with 1 replica” semantics,
- Preserves the existing tool boundary and execution semantics as deployment shape changes.

## Decision

1. **`TYRUM_HOME` is the workspace root**

   `TYRUM_HOME` refers to the durable workspace filesystem used by filesystem/CLI tools and other workspace-scoped agent data. Workspaces are identified by a `WorkspaceId` (initially a single `default` workspace; later per-agent or per-session as needed).

2. **Only ToolRunner mounts workspace volumes in split/HA deployments**

   In split/HA topologies, long-lived `gateway-edge`, `worker`, and `scheduler` processes must not rely on mounting a shared workspace volume. Instead, the workspace filesystem is mounted only inside an explicit execution context.

3. **Introduce ToolRunner as a first-class execution boundary (parity across tiers)**

   ToolRunner is the execution context responsible for running workspace-backed tools (filesystem access, CLI execution, evidence capture) and persisting results to the StateStore.

   - **Single-host/desktop:** ToolRunner runs as a **local subprocess** (or equivalently co-located execution) operating on the local persistent `TYRUM_HOME`.
   - **Kubernetes/split:** ToolRunner runs as a **sandboxed job/pod** created on demand. It mounts the workspace PVC at `TYRUM_HOME`, performs the work, persists outcomes/artifacts to the StateStore, and exits.

4. **RWO single-writer semantics are enforced per workspace**

   Workspaces in Kubernetes are backed by **RWO PVCs**, and Tyrum enforces a “single-writer per workspace” rule:

   - A ToolRunner obtains a StateStore-backed lease/claim for the workspace.
   - Only the lease holder runs workspace-backed tools for that workspace.
   - On failure or expiry, another ToolRunner may take over.

5. **Split roles require Postgres (fail fast on SQLite)**

   Any split deployment (`edge|worker|scheduler`) must use a Postgres StateStore. Running split services against a shared SQLite database file is explicitly forbidden; runtime/compose/helm configuration must fail fast unless `GATEWAY_DB_PATH` is a `postgres://…` URI.

6. **Secrets/tokens are distributed via cluster-safe mechanisms**

   In clustered deployments, shared auth and secrets must not depend on shared workspace files:

   - Use a shared admin token via `GATEWAY_TOKEN` (for example from a Kubernetes Secret).
   - Prefer non-file secret providers for HA.

## Options considered

- **Require RWX volumes for `TYRUM_HOME`** (EFS/NFS/CephFS): operationally heavier and more expensive; pushes infra complexity onto every HA user.
- **Mount a shared RWO PVC into edge/worker/scheduler**: fails under multi-node scheduling (attach wedge risk).
- **Make `TYRUM_HOME` stateless in HA**: violates the durable workspace contract.
- **Keep only workers mounting the workspace**: still couples long-lived replicas to RWO attachment and complicates reschedules; does not give a clear “workspace mount boundary”.
- **Externalize the workspace to object storage**: overkill for early HA and does not preserve POSIX semantics without significant additional machinery.

## Consequences

- **Pros**:
  - Preserves the durable workspace contract (`TYRUM_HOME`) across tiers.
  - Avoids RWX requirements while remaining compatible with multi-node Kubernetes clusters.
  - Establishes a clear execution boundary that improves isolation and policy enforcement.
  - Keeps “single-host behaves like the cluster with 1 replica” semantics via a shared ToolRunner concept.

- **Cons**:
  - Introduces additional moving parts (ToolRunner role; sandbox launcher in clusters).
  - Adds overhead for sandbox job/pod creation in Kubernetes.
  - Single-writer per workspace limits concurrency unless more workspaces are introduced.

## Related ADRs and docs

- [ADR-0001: Deployment topology and component roles](./adr-0001-deployment-topology.md)
- [ADR-0002: StateStore backends and migration strategy](./adr-0002-statestore-backends.md)
- [ADR-0004: Execution engine persistence and coordination](./adr-0004-execution-engine-coordination.md)
- [ADR-0008: Artifact storage, retention, and export](./adr-0008-artifacts.md)
- [Scaling and high availability](../scaling-ha.md)
- [Workspace](../workspace.md)

