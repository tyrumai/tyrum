# Deprecated: Legacy Executor Module

The legacy job queue (`job-queue.ts`) and runner (`runner.ts`) are **deprecated** in favor of the execution engine at `modules/execution/engine.ts`, which provides its own internal queue and step execution.

## Why

The execution engine provides:

- **Durable runs** with persistent state and crash recovery
- **Budget tracking** integrated into the execution lifecycle
- **Approval integration** for human-in-the-loop workflows
- **Event emission** for observability and audit

## Migration path

Replace calls to the plan routes (`POST /plan`) with the workflow routes (`POST /workflow/run`). See `routes/workflow.ts` for the new API surface.

## Removal timeline

The legacy executor code will be removed after the execution engine has been validated in production.

## Reference

- ADR-005 (execution API design)
