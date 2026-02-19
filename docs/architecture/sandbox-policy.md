# Sandbox and Policy

Status:

Tyrum is designed so that safety does not depend on prompt text alone. The system should enforce safety through layered controls.

## Enforcement layers (target)

- **Contracts:** schema validation at trust boundaries.
- **Tool policy:** allowlists/denylists and per-tool parameter validation.
- **Approvals:** explicit human confirmation for risky actions.
- **Sandboxing:** runtime constraints that limit filesystem/network/process access.
- **Channel/connector policy:** explicit enabling and scoping of external connectors.

## Advisory vs enforcement

- Prompts and skills can guide behavior.
- Policies, approvals, and sandboxing must enforce behavior.

## Secure defaults

- Prefer local-first binding by default.
- Require explicit authorization for remote access and sensitive capabilities.
