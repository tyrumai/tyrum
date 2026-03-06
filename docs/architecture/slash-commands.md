# Slash Commands

Slash commands are a client-facing command surface for common actions. Clients translate commands into typed requests to the gateway.

Commands are handled by the gateway (not by the model). This keeps control-plane actions deterministic, policy-enforced, and auditable.

## Command classes

- **Standalone commands:** a message that is only `/...` runs as a command.
- **Directives:** certain commands persist per-session settings and are stripped before model inference.
- **Side-effecting commands:** commands that change state or send messages are subject to policy and may require approvals.

## Common commands (examples)

### Session and execution

- `/new` — start a new session (fresh context and new session id).
- `/reset` — reset the current session state (policy-defined).
- `/stop` — cancel the active run and clear queued followups for the current session.
- `/compact` — request compaction of older history into a summary.
- `/repair [max_turns]` — rebuild session context from retained channel transport logs.

### Context and usage

- `/status` — show runtime + session status (model, lane, queue, policy mode).
- `/context list` — show a context breakdown summary for the last run.
- `/context detail` — show a detailed breakdown including tool schema overhead.
- `/usage` — show current session usage summary (tokens/time/cost).
- `/usage provider` — show provider-reported usage/quota when available.
- `/presence` — show connected gateway/client/node presence entries.

### Models and auth

- `/model` — show the current session model preset and available options.
- `/model <preset_key>` — set the configured model preset for the current session.
- `/model <provider/model>` — set the model when exactly one configured preset targets that underlying model.
- `/model <provider/model>@<profile>` — advanced compatibility form that pins a specific provider account for the session.

### Messaging behavior

- `/queue <collect|followup|steer|steer_backlog|interrupt>` — set the inbound queue mode for the session.
- `/send <on|off|inherit>` — set or clear a per-session send policy override (operator-scoped).

### Policy overrides

- `/policy overrides list` — list active and historical policy overrides (filterable by agent/tool/status).
- `/policy overrides describe <policy_override_id>` — show override scope, pattern, and audit linkage.
- `/policy overrides revoke <policy_override_id>` — revoke an override (audited, optionally with a reason).

## Design guidelines

- Prefer unambiguous names (`/context list` over `/ctx`).
- Commands should have typed request/response contracts.
- Commands that can cause side effects should require explicit confirmation when risk is non-trivial.
