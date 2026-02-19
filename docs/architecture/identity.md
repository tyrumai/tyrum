# Identity

Status:

Identity is how Tyrum names and scopes authority. Several identities exist in the system, each with a different purpose.

## Identity types (target)

- **User identity:** the human operator(s) (single-user by default).
- **Agent identity:** which agent a session belongs to.
- **Client identity:** which operator device is connected (`role: client`).
- **Node identity:** which capability provider device is connected (`role: node`).
- **Channel identity:** which connector/account a message came from.

## Why identity matters

- Pairing and revocation (nodes and clients)
- Audit trails (who/what performed an action)
- Scoping (which sessions and workspaces an action can touch)
