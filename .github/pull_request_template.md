## Summary

- Describe the change.

## Issue

Closes #<issue>

## Validation

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`

## Architecture

- [ ] I reviewed the target-state architecture in `docs/architecture/target-state.md`.
- [ ] This change belongs to target package/layer: `<fill in>`
- [ ] I did not add new legacy package usage in `@tyrum/schemas`, `@tyrum/client`, or `@tyrum/operator-core` unless the linked migration issue requires temporary coexistence.
- [ ] If temporary coexistence was necessary, I explained the linked migration step and removal path in this PR.
