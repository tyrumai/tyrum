# Identity

Identity is how Tyrum attributes authority and scopes access to durable state. Tyrum uses identity at three layers:

- **Tenant** (isolation boundary)
- **User** (human principal)
- **Device** (cryptographic endpoint identity for clients and nodes)

## Identity types

- **Tenant identity (`tenant_id`):** the primary security boundary. All durable records and events are scoped to exactly one tenant.
- **User identity (`user_id`):** a human principal authenticated via a tenant-configured auth provider.
- **Membership:** a durable binding of a user into a tenant, including a role and effective scopes.
- **Agent identity (`agent_id`):** the configured runtime persona that owns sessions, tools/skills, and memory within a tenant.
- **Client device identity (`device_id`, `role: client`):** a specific operator device connected to the gateway.
- **Node device identity (`device_id`, `role: node`):** a capability provider device connected to the gateway.
- **Channel identity (`channel_key`):** which connector/account instance an inbound message or event belongs to.
- **Connection identity (`connection_id`):** an ephemeral identifier for a single live WebSocket connection, bound to a device identity after handshake.

## Device identities

Client and node identities are device identities derived from a long-lived signing keypair (Ed25519). The public key is the canonical identity material.

`device_id` is deterministic and validated by the gateway:

`device_id = "dev_" + base32_lower_nopad(sha256(pubkey_der_bytes))`

Where `base32_lower_nopad` uses the RFC 4648 alphabet (`a-z2-7`), rendered lowercase, with no padding, and `pubkey_der_bytes` is the DER SPKI public key decoded from base64url. Treat `device_id` as an opaque stable identifier for pairing, revocation, and audit trails.

## Why identity matters

- Pairing and revocation (nodes and clients)
- Audit trails (who/what performed an action)
- Scoping (which tenant, agents, and workspaces an action can touch)
