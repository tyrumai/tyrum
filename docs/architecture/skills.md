# Skills

Status:

A skill is an instruction bundle that teaches the agent how to perform a specialized workflow. Skills are loaded on demand and are meant to be readable by humans.

## Load order (target)

Skills can be loaded from multiple locations. When the same skill id exists in more than one place, the more specific location wins:

1. Bundled skills (shipped with Tyrum)
2. User skills directory (for example under a home directory)
3. Workspace skills directory (wins on conflicts)

## Marketplace (concept)

Tyrum can support discovering and installing skills from a curated catalog.

## Safety expectations

- Skills are guidance, not enforcement.
- Hard enforcement comes from tool policy, approvals, and sandboxing.
