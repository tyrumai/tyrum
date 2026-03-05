import { describe, expect, it } from "vitest";

import { parsePairingCommand } from "../../src/parse/pairing.js";
import { parseWorkflowCommand } from "../../src/parse/workflow.js";

describe("parseWorkflowCommand", () => {
  it("returns help for workflow help flags", () => {
    expect(parseWorkflowCommand(["workflow", "--help"])).toEqual({ kind: "help" });
    expect(parseWorkflowCommand(["workflow", "run", "--help"])).toEqual({ kind: "help" });
    expect(parseWorkflowCommand(["workflow", "resume", "--help"])).toEqual({ kind: "help" });
    expect(parseWorkflowCommand(["workflow", "cancel", "--help"])).toEqual({ kind: "help" });
  });

  it("parses workflow run steps with optional fields", () => {
    expect(
      parseWorkflowCommand([
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--lane",
        "main",
        "--steps",
        '[{"type":"Message","postcondition":{"status":"ok"},"idempotency_key":"step-1"}]',
      ]),
    ).toEqual({
      kind: "workflow_run",
      key: "agent:default:main",
      lane: "main",
      steps: [
        {
          type: "Message",
          args: {},
          postcondition: { status: "ok" },
          idempotency_key: "step-1",
        },
      ],
    });
  });

  it.each([
    {
      argv: ["workflow"] as const,
      message: "workflow requires a subcommand (run|resume|cancel)",
    },
    {
      argv: ["workflow", "unknown"] as const,
      message: "unknown workflow subcommand 'unknown'",
    },
    {
      argv: ["workflow", "run", "--steps", "[]"] as const,
      message: "workflow run requires --key <key>",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main"] as const,
      message: "workflow run requires --steps <json>",
    },
    {
      argv: ["workflow", "run", "--unknown"] as const,
      message: "unsupported workflow.run argument '--unknown'",
    },
    {
      argv: ["workflow", "run", "oops"] as const,
      message: "unexpected workflow.run argument 'oops'",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main", "--steps", "not-json"] as const,
      message: "--steps must be valid JSON",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main", "--steps", "{}"] as const,
      message: "--steps must be a JSON array",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main", "--steps", "[]"] as const,
      message: "--steps must be a non-empty JSON array",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main", "--steps", "[1]"] as const,
      message: "--steps[0] must be an object",
    },
    {
      argv: ["workflow", "run", "--key", "agent:default:main", "--steps", "[{}]"] as const,
      message: "--steps[0].type must be a string",
    },
    {
      argv: [
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":" "}]',
      ] as const,
      message: "--steps[0].type must be a non-empty string",
    },
    {
      argv: [
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message","args":1}]',
      ] as const,
      message: "--steps[0].args must be an object",
    },
    {
      argv: [
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message","idempotency_key":1}]',
      ] as const,
      message: "--steps[0].idempotency_key must be a string",
    },
    {
      argv: [
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message","idempotency_key":" "}]',
      ] as const,
      message: "--steps[0].idempotency_key must be a non-empty string",
    },
    {
      argv: ["workflow", "resume"] as const,
      message: "workflow resume requires --token <resume-token>",
    },
    {
      argv: ["workflow", "resume", "--unknown"] as const,
      message: "unsupported workflow.resume argument '--unknown'",
    },
    {
      argv: ["workflow", "resume", "oops"] as const,
      message: "unexpected workflow.resume argument 'oops'",
    },
    {
      argv: ["workflow", "cancel"] as const,
      message: "workflow cancel requires --run-id <run-id>",
    },
    {
      argv: ["workflow", "cancel", "--unknown"] as const,
      message: "unsupported workflow.cancel argument '--unknown'",
    },
    {
      argv: ["workflow", "cancel", "oops"] as const,
      message: "unexpected workflow.cancel argument 'oops'",
    },
  ])("rejects invalid workflow argv: $message", ({ argv, message }) => {
    expect(() => parseWorkflowCommand(argv)).toThrowError(message);
  });
});

describe("parsePairingCommand", () => {
  it("returns help for pairing help flags", () => {
    expect(parsePairingCommand(["pairing", "--help"])).toEqual({ kind: "help" });
    expect(parsePairingCommand(["pairing", "approve", "--help"])).toEqual({ kind: "help" });
    expect(parsePairingCommand(["pairing", "deny", "--help"])).toEqual({ kind: "help" });
    expect(parsePairingCommand(["pairing", "revoke", "--help"])).toEqual({ kind: "help" });
  });

  it("parses pairing approve with an explicit capability version", () => {
    expect(
      parsePairingCommand([
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "remote",
        "--capability",
        "tyrum.cli@2.0.0",
      ]),
    ).toEqual({
      kind: "pairing_approve",
      pairing_id: 42,
      trust_level: "remote",
      capability_allowlist: [{ id: "tyrum.cli", version: "2.0.0" }],
      reason: undefined,
    });
  });

  it.each([
    {
      argv: ["pairing"] as const,
      message: "pairing requires a subcommand (approve|deny|revoke)",
    },
    {
      argv: ["pairing", "unknown"] as const,
      message: "unknown pairing subcommand 'unknown'",
    },
    {
      argv: ["pairing", "approve"] as const,
      message: "pairing approve requires --pairing-id <id>",
    },
    {
      argv: ["pairing", "approve", "--pairing-id", "42"] as const,
      message: "pairing approve requires --trust-level <local|remote>",
    },
    {
      argv: ["pairing", "approve", "--pairing-id", "42", "--trust-level", "bad"] as const,
      message: "--trust-level must be 'local' or 'remote'",
    },
    {
      argv: ["pairing", "approve", "--pairing-id", "42", "--trust-level", "local"] as const,
      message: "pairing approve requires at least one --capability <id[@version]>",
    },
    {
      argv: [
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
      ] as const,
      message: "--capability requires a value",
    },
    {
      argv: [
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
        " ",
      ] as const,
      message: "--capability requires a non-empty value",
    },
    {
      argv: [
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
        "@1.0.0",
      ] as const,
      message: "--capability requires a non-empty id",
    },
    {
      argv: ["pairing", "approve", "--unknown"] as const,
      message: "unsupported pairing.approve argument '--unknown'",
    },
    {
      argv: ["pairing", "approve", "oops"] as const,
      message: "unexpected pairing.approve argument 'oops'",
    },
    {
      argv: ["pairing", "deny"] as const,
      message: "pairing deny requires --pairing-id <id>",
    },
    {
      argv: ["pairing", "deny", "--unknown"] as const,
      message: "unsupported pairing.deny argument '--unknown'",
    },
    {
      argv: ["pairing", "deny", "oops"] as const,
      message: "unexpected pairing.deny argument 'oops'",
    },
    {
      argv: ["pairing", "revoke"] as const,
      message: "pairing revoke requires --pairing-id <id>",
    },
    {
      argv: ["pairing", "revoke", "--unknown"] as const,
      message: "unsupported pairing.revoke argument '--unknown'",
    },
    {
      argv: ["pairing", "revoke", "oops"] as const,
      message: "unexpected pairing.revoke argument 'oops'",
    },
  ])("rejects invalid pairing argv: $message", ({ argv, message }) => {
    expect(() => parsePairingCommand(argv)).toThrowError(message);
  });
});
