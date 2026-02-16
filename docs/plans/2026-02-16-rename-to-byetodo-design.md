# Rename: Tyrum -> Byetodo

**Date:** 2026-02-16
**Status:** Approved

## Decision

Rename the project from **Tyrum** to **Byetodo**.

- **Domain:** byetodo.ai (registered)
- **Pronunciation:** bye-to-do
- **Tagline:** "The end of to-do. No lists. Just outcomes."

## Rationale

- "Tyrum" was too abstract, hard to remember/spell, and tonally flat
- "Byetodo" is clever & playful, suggestive of the product's purpose (eliminating to-do lists), and directly ties to the existing marketing tagline
- Easy to say, easy to spell, immediately communicates the value proposition

## Scope of rename

All references to "tyrum" (case-insensitive) across the codebase need updating:

- Rust service crate names (`tyrum-*` -> `byetodo-*`)
- Cargo.toml package names and internal dependencies
- Dockerfiles and image names
- Helm charts and Kubernetes manifests
- GitHub Actions workflows
- Web (package.json, Next.js config, UI copy)
- Documentation (README, product docs)
- Environment variables and config templates
- Code references (module paths, imports, struct names)
