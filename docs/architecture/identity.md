# Identity

Identity is how Tyrum names and scopes authority. Several identities exist in the system, each with a different purpose.

## Identity types

- **User identity:** the human operator(s). Single-user is the default, but team/remote deployments support multiple operators with explicit scopes and audited actions.
- **Agent identity:** which agent a session belongs to.
- **Client identity:** which operator device is connected (`role: client`).
- **Node identity:** which capability provider device is connected (`role: node`).
- **Channel identity:** which connector/account a message came from.

## Device identities

Client and node identities are device identities derived from a long-lived signing keypair (Ed25519). The public key is the canonical identity material.

`device_id` is deterministic and validated by the gateway:

`device_id = "dev_" + base32_lower_nopad(sha256(pubkey_der_bytes))`

Where `base32_lower_nopad` uses the RFC 4648 alphabet (`a-z2-7`), rendered lowercase, with no padding, and `pubkey_der_bytes` is the DER SPKI public key decoded from base64url. Treat `device_id` as an opaque stable identifier for pairing, revocation, and audit trails.

## Why identity matters

- Pairing and revocation (nodes and clients)
- Audit trails (who/what performed an action)
- Scoping (which sessions and workspaces an action can touch)
