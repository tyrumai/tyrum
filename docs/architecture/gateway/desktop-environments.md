---
slug: /architecture/gateway/desktop-environments
---

# Desktop environments

Desktop environments are gateway-managed sandbox desktops that boot a paired desktop node under explicit control-plane management.

## Purpose

This component exists so operators can provision disposable desktop automation targets without pre-installing and manually pairing a separate desktop node.

The gateway owns the control plane for these environments. The sandboxed desktop still executes automation as a normal node with a bounded capability allowlist.

## Responsibilities

- Maintain a durable inventory of desktop-environment hosts and environment records.
- Expose admin APIs to create, start, stop, reset, inspect, and delete managed environments.
- Bootstrap sandbox node identity and gateway credentials for each environment.
- Keep environment status, logs, and takeover URLs in sync with runtime state.

## Non-goals

- This component does not replace general-purpose VM or container orchestration for arbitrary workloads.
- This component does not bypass node pairing, capability routing, or approval policy.

## Boundary and ownership

- **Inside the boundary:** host health, desired-running reconciliation, token issuance, container lifecycle, takeover/log exposure, and managed-pairing policy.
- **Outside the boundary:** desktop automation semantics inside the sandboxed node, operator UI rendering, and non-managed remote desktops.

## Inputs, outputs, and dependencies

- **Inputs:** admin HTTP requests, environment host heartbeats, desired-running updates, and container runtime state.
- **Outputs:** environment status changes, sandbox node startup/shutdown, managed pairing resolution, logs, and trusted takeover redirects.
- **Dependencies:** [Gateway](/architecture/gateway), [Node](/architecture/node), desktop-runtime hosts, Docker-backed lifecycle helpers, auth token issuance, and desktop capability routing.

## State and data

- `desktop_environment_hosts` describe which runtime hosts are healthy enough to reconcile environments.
- `desktop_environments` store the desired state, current status, node identity, takeover URL, and last observed error for each managed environment.
- Host-local runtime directories hold the sandbox node identity and the mounted gateway token material needed for startup.
- The sandbox node is approved with a bounded desktop allowlist rather than full device capability access.

## Control flow

1. An operator creates a desktop environment on a selected host and chooses whether it should be running.
2. A `desktop-runtime` host reconciles that environment, creates or loads node identity material, issues a node token, and starts the sandbox container.
3. The sandbox connects back to the gateway as `role: node` and advertises desktop capability descriptors.
4. The runtime manager applies the managed-pairing policy, approves the node with the bounded desktop allowlist, and updates the environment record with node id, status, logs, and takeover URL.
5. Operators can later start, stop, reset, inspect logs, open takeover, or delete the environment through the admin API.

## Invariants and constraints

- Managed desktop environments still become ordinary paired nodes before capability dispatch is allowed.
- The desktop-runtime host reconciles desired state; operators should not rely on ad hoc container mutation outside that control loop.
- Takeover only redirects to trusted local noVNC endpoints surfaced by the runtime host.

## Failure behavior

- **Expected failures:** Docker unavailable on the host, container image mismatch, sandbox startup errors, and runtime-host outages.
- **Recovery path:** reconciliation records `error` state plus logs, operators can reset or restart the environment, and the desktop-runtime host can recreate the container with fresh bootstrap material when the desired state remains `running`.

## Security and policy considerations

- Desktop-environment routes are admin-only control-plane APIs.
- Gateway-issued node tokens are mounted read-only into the sandbox and can be rotated by restarting the managed runtime.
- Managed pairing deliberately narrows the allowlist to desktop descriptors so the sandbox does not inherit unrelated device access.

## Key decisions and tradeoffs

- **Provision nodes through the gateway:** operators get a first-class control-plane workflow instead of manual sandbox/node setup.
- **Keep the node boundary intact:** even gateway-managed desktops execute as nodes, which preserves routing, audit, and approval semantics.

## Observability

- Host health and environment status are durable admin surfaces.
- Logs are retained with the environment record for operator debugging.
- Pairing and presence continue to expose the sandbox node as a normal node peer.

## Related docs

- [Gateway](/architecture/gateway)
- [Node](/architecture/node)
- [Capabilities](/architecture/capabilities)
- [Scaling and High Availability](/architecture/scaling-ha)
- [Gateway data model map](/architecture/data-model-map)
- [Data lifecycle and retention](/architecture/data-lifecycle)
