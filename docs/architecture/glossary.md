# Glossary

Status:

## Agent

A configured runtime identity that owns sessions, a workspace, enabled tools/skills, and memory.

## Agent loop

The end-to-end path from an inbound message to model inference, tool execution, streaming output, and persistence.

## Capability

A named interface a node can provide (for example `camera.capture`) with typed operations and evidence.

## Channel

An external messaging surface (WhatsApp, Telegram, Discord, etc.) integrated via a connector.

## Client

An operator interface connected to the gateway (`role: client`) that sends requests, receives events, and performs approvals.

## Contract

A versioned schema that defines the shape/semantics of messages and extension interfaces.

## Event

A gateway-emitted server-push message that notifies clients of lifecycle, progress, and state changes.

## Gateway

The single long-lived daemon that owns connectivity, routing, validation, policy, and persistence.

## Lane

An execution stream within a session (for example `main`, `cron`, `subagent`) used to separate concerns.

## Node

A capability provider connected to the gateway (`role: node`) that executes device-specific operations.

## Request/Response

A typed client-initiated operation and the gateway's typed reply, correlated by `request_id`.

## Session

A durable conversation container with transcript history and queued inbound messages.

## Skill

An instruction bundle loaded on demand to guide the agent in specialized workflows.

## Tool

An invocable operation available to the agent runtime (built-in, plugin-provided, or MCP).
