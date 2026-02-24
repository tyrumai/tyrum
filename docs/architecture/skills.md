# Skills

A skill is an instruction bundle that teaches the agent how to perform a specialized workflow. Skills are loaded on demand and are meant to be readable by humans.

## Load order

Skills can be loaded from multiple locations. When the same skill id exists in more than one place, the more specific location wins:

1. Bundled skills (shipped with Tyrum)
2. User skills directory (for example under a home directory)
3. Workspace skills directory (wins on conflicts **when trusted**)

Workspace skills are only considered when workspace trust is explicitly enabled (see below).

## Marketplace

Skills are discoverable and installable from a curated catalog.

## Safety expectations

- Skills are guidance, not enforcement.
- Hard enforcement comes from tool policy, approvals, and sandboxing.
- Skills can still be a social-engineering and supply-chain risk (especially marketplace and workspace-provided skills). Operator clients should surface skill origin (bundled vs user vs workspace) and encourage review before enabling.
- Workspace skills are supplied by the current workspace contents; treat them as untrusted by default and load them only in trusted workspaces under explicit policy.
- Skills must not contain raw secret values; use secret handles via the secret provider.

## Workspace trust controls

Workspace skill loading is gated by agent configuration:

- Set `skills.workspace_trusted: true` in `agent.yml` (under `TYRUM_HOME`) to allow loading skills from the workspace skills directory.
- Operator clients can display provenance via `GET /agent/status` (`skills_detailed[].source`) and show whether workspace skills are trusted (`workspace_skills_trusted`).
