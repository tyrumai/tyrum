# Tenancy

Tyrum is a multi-tenant system. A **tenant** is the isolation boundary for identity, policy, and durable state.

Every request, event, and durable record is scoped to exactly one `tenant_id`.

## Tenant isolation (hard requirements)

- **No cross-tenant reads or writes:** a principal authorized in `tenant_a` cannot access data in `tenant_b`, even if it can guess identifiers.
- **Deny-by-default routing:** if a request cannot be unambiguously associated with a tenant, the gateway must reject it.
- **Audit by tenant:** audit logs and exported evidence must remain partitioned by tenant.

## Users and membership

Users are human principals. A user may belong to one or more tenants.

Within a tenant, access is granted via a **membership** that binds:

- `tenant_id`
- `user_id`
- `role` (for example `owner`, `admin`, `member`, `viewer`)

Membership is the unit of authorization and auditing for human actions.

## Tenant-scoped resources

The following resources are tenant-scoped (non-exhaustive):

- users, memberships, and device registry
- agents and agent configuration
- sessions, messages, runs, steps, attempts
- approvals and policy overrides
- artifacts (metadata and bytes access)
- secrets (handles, resolution policy, audit)
- node pairings and capability allowlists
- presence/connection directory and event streams

## API surfaces and administration boundaries

Tyrum exposes two tenant-scoped API surfaces:

- **Core product surface:** day-to-day operation (sessions, runs, approvals, artifacts, nodes).
- **Tenant administration surface:** tenant configuration (users, devices, pairing policy, secrets, exports, enforcement defaults).

In multi-tenant deployments, Tyrum also exposes a **platform administration surface** used to create and manage tenants and global configuration. Platform administration is not reachable with tenant-scoped credentials.

See [Gateway authN/authZ](./gateway-authz.md) and [Identity](./identity.md).
