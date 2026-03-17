---
slug: /architecture/skills
---

# Skills

Read this if: you need the architecture boundary for reusable instruction bundles.

Skip this if: you are looking for runtime-enforced workflows or in-process extension code.

Go deeper: [Playbooks](/architecture/playbooks), [Gateway plugins](/architecture/plugins), [Sandbox and policy](/architecture/sandbox-policy).

## Skill boundary at a glance

| Surface  | What it provides                            | Enforced by runtime?     | Best use                                  |
| -------- | ------------------------------------------- | ------------------------ | ----------------------------------------- |
| Skill    | Reusable instructions and workflow guidance | No                       | Teaching the agent how to approach a task |
| Playbook | Deterministic workflow spec                 | Yes                      | Multi-step controlled execution           |
| Plugin   | In-process gateway extension                | Yes, at gateway boundary | New routes/tools/commands                 |

## Purpose

Skills are instruction bundles the agent can load on demand to perform specialized workflows consistently. They are guidance, not enforcement. The safety boundary remains in tool policy, approvals, and sandboxing.

## Load sources and trust posture

Skills can come from several locations, with more specific locations winning on conflicts:

1. bundled skills
2. user skills directory
3. workspace skills directory, but only when workspace trust is explicitly enabled

Workspace skills are the main risk boundary. They come from the current checkout and must be treated as untrusted until the workspace is deliberately marked trusted.

## Key rules

- Skills must never be treated as a bypass around tool policy or approvals.
- Operator surfaces should show skill provenance so users can distinguish bundled, user, and workspace sources.
- Marketplace discovery is acceptable only with reviewable provenance and explicit enablement.
- Skills must reference secret handles rather than embedding raw secret values.

## Related docs

- [Playbooks](/architecture/playbooks)
- [Gateway plugins](/architecture/plugins)
- [Sandbox and policy](/architecture/sandbox-policy)
