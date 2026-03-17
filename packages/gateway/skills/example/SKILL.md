---
id: example
name: Example Skill
version: 0.1.0
description: Bundled example skill shipped with Tyrum.
tags:
  - bundled
requires:
  tools: []
---

This bundled skill is documentation-only.

It exists to demonstrate skill provenance and load order. If it is enabled, it should not change runtime behavior beyond showing that the skill was loaded.

The load order is:

1. Bundled skills (shipped with Tyrum)
2. User skills directory (global)
3. Workspace skills directory (wins on conflicts)
