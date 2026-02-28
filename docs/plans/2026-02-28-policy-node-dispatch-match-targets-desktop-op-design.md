# Policy: Desktop op-aware match targets for `tool.node.dispatch` — Design

## Execution brief (KISS)

- **Goal:** Ensure policy matching and “approve always” overrides can distinguish Desktop read-only ops (`snapshot/query/wait_for`) from state-changing ops (`act`) for `tool.node.dispatch`, without leaking user-typed text.
- **Non-goals:** Per-app allowlists; including selector text/names in match targets; changing default policy decisions.
- **Constraints:** Match targets MUST be canonical/stable and MUST NOT include secrets or user-typed strings; suggested override patterns MUST be conservative (no leading wildcards).
- **Plan:** (1) Make Desktop `op` extraction robust for `tool.node.dispatch` even if Desktop args are wrapped/nested. (2) Add unit tests for canonicalization. (3) Improve suggested override generation for Desktop `act` to offer an `op:act*` prefix pattern. (4) Document match target shape and safe patterns.
- **Risks & rollback:** Match target changes can break existing overrides; keep existing canonical targets stable for valid inputs and only broaden extraction for nested wrappers. Roll back by reverting the match-target/suggestion changes.

## Summary

Issue #773 requests that `tool.node.dispatch` policy match targets include Desktop `op` so policy and operator overrides can safely distinguish:

- Desktop `snapshot/query/wait_for` (lower risk)
- Desktop `act` (higher risk)

This enables safe-by-default policy posture and “approve always” patterns that do not require approvals for every read-only UI query.

## Approaches

### A) Match target only (status quo)

Keep match targets exact-only suggestions and rely on operators to hand-author patterns.

**Pros:** Minimal changes.
**Cons:** “Approve always” for Desktop `act` can become too narrow if additional Desktop scope fields are appended over time.

### B) Robust op extraction + conservative `act` prefix suggestion (Recommended)

- Ensure `canonicalizeToolMatchTarget("tool.node.dispatch", ...)` reliably extracts Desktop `op` even if Desktop args are nested under a wrapper object.
- For Desktop `act`, add a conservative suggested override prefix pattern `capability:tyrum.desktop;action:Desktop;op:act*`.

**Pros:** Keeps match targets stable, avoids leaking user text, and improves operator UX for approvals without broad allow-all patterns.
**Cons:** Slightly more logic in suggested override generation.

### C) Add more Desktop scoping (not in scope for #773)

Add additional fields like selector kind (`a11y/ocr/ref`) or action kind (`click/focus`) to match targets.

**Pros:** Enables more granular policy.
**Cons:** Higher contract surface area; risks accidental leakage of user text; not required by #773 acceptance criteria.

## Chosen design

Approach **B**.

## Match target shape (Desktop)

Canonical match targets include:

- `capability:tyrum.desktop;action:Desktop;op:snapshot`
- `capability:tyrum.desktop;action:Desktop;op:query`
- `capability:tyrum.desktop;action:Desktop;op:wait_for`
- `capability:tyrum.desktop;action:Desktop;op:act`

Legacy Desktop input ops are normalized under `op:act` (optionally with a minimal subtype), and unknown/unparseable ops become `op:unknown`.

Match targets MUST NOT include selector names, OCR search text, or any other user-typed strings.

## Suggested overrides (approve always)

When a Desktop `act` approval is requested, suggested override patterns should include a conservative prefix pattern:

- `capability:tyrum.desktop;action:Desktop;op:act*`

This avoids leading wildcards and captures all Desktop act subtypes without requiring operators to manage multiple “approve always” entries.

## Testing strategy

- Unit tests for match target canonicalization (including nested Desktop args wrappers).
- Agent runtime unit test ensuring Desktop `act` approvals include the `op:act*` suggested override option.
