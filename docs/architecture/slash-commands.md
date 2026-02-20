# Slash Commands

Slash commands are a client-facing command surface for common actions. Clients translate commands into typed requests to the gateway.

## Example commands

- `/new` — start a new session or reset context (depending on configuration)
- `/status` — show agent/runtime status
- `/context list` — list available context sources
- `/context detail` — show details for a specific context source
- `/usage tokens` — show token usage and cost telemetry (when available)
- `/compact` — request context compaction

## Design guidelines

- Prefer unambiguous names (`/context list` over `/ctx`).
- Commands should have typed request/response contracts.
- Commands that can cause side effects should require explicit confirmation when risk is non-trivial.
