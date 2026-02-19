# Workspace

Status:

A workspace is the agent's working directory boundary for tools that read and write files. Workspaces make file operations explicit and containable.

## Properties (target)

- Each agent has a single workspace directory.
- Tools operate relative to that workspace by default.
- The gateway can inject selected workspace files into context to reduce tool calls.

## Safety expectations

- Enforce path boundaries (no arbitrary filesystem traversal).
- Redact secrets and avoid logging sensitive file content.
- Make destructive operations require explicit confirmation where appropriate.
