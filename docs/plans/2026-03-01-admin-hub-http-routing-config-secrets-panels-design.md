# Admin hub (HTTP): Routing config + Secrets panels — Design

## Context

Issue: #915

The Operator UI already has an **Admin** page with an **HTTP** tab, gated behind Admin Mode, but it currently renders a placeholder. The HTTP client surfaces for routing config and secrets already exist in `@tyrum/client` and are available through `OperatorCore.http`.

## Goals

- Provide Admin hub HTTP panels to call:
  - `core.http.routingConfig.get()`
  - `core.http.routingConfig.update()`
  - `core.http.routingConfig.revert()`
  - `core.http.secrets.store()`
  - `core.http.secrets.list()`
  - `core.http.secrets.rotate()`
  - `core.http.secrets.revoke()`
- All **mutations** require explicit confirmation and are Admin Mode gated.
- Secret values are treated as **write-only**:
  - Never rendered back into UI after submission
  - Never included in “request preview”/confirmation text

## Non-goals

- Full YAML editor; JSON input is sufficient.
- Persisting client-side secret material.

## UX / Information Architecture

- Replace the HTTP placeholder in `AdminPage` with:
  - A small “Routing config” section
  - A small “Secrets” section
- Each section uses existing shared UI primitives (`Card`, `JsonTextarea`, `ApiResultCard`, `ConfirmDangerDialog`) to avoid new one-off UI patterns.

## Component design

### Routing config

- **Get**
  - Button triggers `core.http.routingConfig.get()`
  - Response rendered via `ApiResultCard`
- **Update** (mutation)
  - Inputs:
    - `reason` (optional string)
    - `config` (JSON textarea -> parsed to object)
  - “Update” opens `ConfirmDangerDialog`
  - Confirm triggers `core.http.routingConfig.update({ config, reason })`
- **Revert** (mutation)
  - Inputs:
    - `revision` (number)
    - `reason` (optional string)
  - “Revert” opens `ConfirmDangerDialog`
  - Confirm triggers `core.http.routingConfig.revert({ revision, reason })`

### Secrets

- Shared optional `agent_id` input for list/store/rotate/revoke.
- **List**
  - Button triggers `core.http.secrets.list({ agent_id })`
  - Response rendered via `ApiResultCard`
- **Store** (mutation)
  - Inputs:
    - `scope` (string)
    - `provider` (`env` | `file` | `keychain`)
    - `value` (password input)
  - “Store” opens `ConfirmDangerDialog` (must not display `value`)
  - Confirm triggers `core.http.secrets.store({ scope, value, provider }, { agent_id })`
  - On success: clear the value input and only render returned handle.
- **Rotate** (mutation)
  - Inputs:
    - `handle_id` (string)
    - `value` (password input)
  - “Rotate” opens `ConfirmDangerDialog` (must not display `value`)
  - Confirm triggers `core.http.secrets.rotate(handle_id, { value }, { agent_id })`
  - On success: clear the value input.
- **Revoke** (mutation)
  - Inputs:
    - `handle_id` (string)
  - “Revoke” opens `ConfirmDangerDialog`
  - Confirm triggers `core.http.secrets.revoke(handle_id, { agent_id })`

## Error handling

- All API actions store either a `result` or `error` value in local component state and render it via `ApiResultCard`.
- Confirmation dialogs surface action errors inside the dialog (via `ConfirmDangerDialog`) rather than swallowing failures.

## Testing

- Add jsdom tests in `packages/operator-ui/tests/pages/` to cover:
  - Basic render of Admin HTTP panels (with Admin Mode active)
  - Mutation confirmation gating (confirm dialog appears; confirm button disabled until checkbox checked; API called only after confirm)

## Rollout / Risk

- Changes are limited to Operator UI; no gateway behavior changes.
- Risk: accidental secret echo. Mitigation: never render input `value`, clear secret inputs on success, and only show API responses.
