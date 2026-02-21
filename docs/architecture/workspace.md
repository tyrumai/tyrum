# Workspace

A workspace is the agent's working directory boundary for tools that read and write files. Workspaces make file operations explicit, containable, and **durable across runs**.

## Properties

- Each agent has a single workspace directory (identified by a `WorkspaceId`).
- Tools operate relative to that workspace by default.
- The gateway can inject selected workspace files into context to reduce tool calls.

## Durability (hard requirement)

- A workspace filesystem is **persistent**: files written during one run are available in later runs.
- In single-host deployments, `TYRUM_HOME` is a durable local directory on disk.
- In clustered deployments, a workspace is backed by durable storage (for example a PVC) and must remain available across pod reschedules.

## HA semantics (RWO without RWX)

Kubernetes `ReadWriteOnce` volumes are compatible with durable workspaces **if we enforce single-writer semantics**:

- Only one running execution context mounts a given workspace volume read/write at a time.
- The system enforces this with StateStore-backed leases/claims and a ToolRunner boundary (see [Scaling and high availability](./scaling-ha.md)).

This avoids requiring RWX network filesystems while still supporting multi-node scheduling.

## Safety expectations

- Enforce path boundaries (no arbitrary filesystem traversal). Workspace path boundary enforcement in `tool-executor.ts` is the application-layer first line of defense and is always active regardless of deployment target. OS-level sandboxing is layered on top as a deployment concern (see [Sandbox and policy](./sandbox-policy.md)).
- Redact secrets and avoid logging sensitive file content.
- Make destructive operations require explicit confirmation where appropriate.
