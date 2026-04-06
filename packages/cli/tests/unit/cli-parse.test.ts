import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/parse/index.js";

describe("parseCliArgs", () => {
  it("returns help and version sentinel commands", () => {
    expect(parseCliArgs([])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("normalizes default subcommands for config, identity, and approvals", () => {
    expect(parseCliArgs(["config"])).toEqual({ kind: "config_show" });
    expect(parseCliArgs(["identity"])).toEqual({ kind: "identity_show" });
    expect(parseCliArgs(["approvals"])).toEqual({ kind: "approvals_list", limit: 100 });
  });

  it("parses config set with TLS options", () => {
    expect(
      parseCliArgs([
        "config",
        "set",
        "--gateway-url",
        "http://127.0.0.1:8788",
        "--token",
        "secret",
        "--tls-fingerprint256",
        "aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa:aa",
        "--tls-allow-self-signed",
      ]),
    ).toEqual({
      kind: "config_set",
      gateway_url: "http://127.0.0.1:8788",
      auth_token: "secret",
      tls_cert_fingerprint256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tls_allow_self_signed: true,
    });
  });

  it("rejects invalid config set TLS arguments", () => {
    expect(() =>
      parseCliArgs([
        "config",
        "set",
        "--gateway-url",
        "http://127.0.0.1:8788",
        "--token",
        "secret",
        "--tls-fingerprint256",
        "nope",
      ]),
    ).toThrow("--tls-fingerprint256 must be a SHA-256 hex fingerprint");

    expect(() =>
      parseCliArgs([
        "config",
        "set",
        "--gateway-url",
        "http://127.0.0.1:8788",
        "--token",
        "secret",
        "--tls-allow-self-signed",
      ]),
    ).toThrow("--tls-allow-self-signed requires --tls-fingerprint256");
  });

  it("parses identity and elevated-mode commands", () => {
    expect(parseCliArgs(["identity", "init"])).toEqual({ kind: "identity_init" });
    expect(parseCliArgs(["identity", "show"])).toEqual({ kind: "identity_show" });
    expect(parseCliArgs(["elevated-mode", "status"])).toEqual({ kind: "elevated_mode_status" });
    expect(parseCliArgs(["elevated-mode", "exit"])).toEqual({ kind: "elevated_mode_exit" });
    expect(parseCliArgs(["elevated-mode", "enter", "--ttl-seconds", "42"])).toEqual({
      kind: "elevated_mode_enter",
      ttl_seconds: 42,
    });
  });

  it("rejects invalid elevated-mode ttl values", () => {
    expect(() => parseCliArgs(["elevated-mode", "enter", "--ttl-seconds", "0"])).toThrow(
      "--ttl-seconds must be a positive integer",
    );
  });

  it("parses approvals commands", () => {
    expect(parseCliArgs(["approvals", "list", "--limit", "5"])).toEqual({
      kind: "approvals_list",
      limit: 5,
    });

    expect(
      parseCliArgs([
        "approvals",
        "resolve",
        "--approval-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--decision",
        "approved",
        "--reason",
        "looks good",
      ]),
    ).toEqual({
      kind: "approvals_resolve",
      approval_id: "123e4567-e89b-12d3-a456-426614174000",
      decision: "approved",
      reason: "looks good",
    });
  });

  it("rejects invalid approvals arguments", () => {
    expect(() =>
      parseCliArgs([
        "approvals",
        "resolve",
        "--approval-id",
        "not-a-uuid",
        "--decision",
        "approved",
      ]),
    ).toThrow("--approval-id must be a UUID");

    expect(() =>
      parseCliArgs([
        "approvals",
        "resolve",
        "--approval-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--decision",
        "maybe",
      ]),
    ).toThrow("--decision must be 'approved' or 'denied'");
  });

  it("parses workflow commands", () => {
    expect(
      parseCliArgs([
        "workflow",
        "start",
        "--conversation-key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message","args":{"text":"hi"},"postcondition":{"ok":true},"idempotency_key":"step-1"}]',
      ]),
    ).toEqual({
      kind: "workflow_start",
      conversation_key: "agent:default:main",
      steps: [
        {
          type: "Message",
          args: { text: "hi" },
          postcondition: { ok: true },
          idempotency_key: "step-1",
        },
      ],
    });

    expect(
      parseCliArgs([
        "workflow",
        "start",
        "--conversation-key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message"}]',
      ]),
    ).toEqual({
      kind: "workflow_start",
      conversation_key: "agent:default:main",
      steps: [{ type: "Message", args: {} }],
    });

    expect(parseCliArgs(["workflow", "resume", "--token", "resume-token"])).toEqual({
      kind: "workflow_resume",
      token: "resume-token",
    });

    expect(
      parseCliArgs(["workflow", "cancel", "--workflow-run-id", "run-1", "--reason", "stop"]),
    ).toEqual({
      kind: "workflow_cancel",
      workflow_run_id: "run-1",
      reason: "stop",
    });
  });

  it.each([
    ['{"bad":true}', "--steps must be a JSON array"],
    ["not-json", "--steps must be valid JSON"],
    ["[]", "--steps must be a non-empty JSON array"],
    ["[1]", "--steps[0] must be an object"],
    ["[{}]", "--steps[0].type must be a string"],
    ['[{"type":" "}]', "--steps[0].type must be a non-empty string"],
    ['[{"type":"Message","args":1}]', "--steps[0].args must be an object"],
    ['[{"type":"Message","idempotency_key":1}]', "--steps[0].idempotency_key must be a string"],
    [
      '[{"type":"Message","idempotency_key":" "}]',
      "--steps[0].idempotency_key must be a non-empty string",
    ],
  ])("rejects invalid workflow steps payload %s", (steps, message) => {
    expect(() =>
      parseCliArgs([
        "workflow",
        "start",
        "--conversation-key",
        "agent:default:main",
        "--steps",
        steps,
      ]),
    ).toThrow(message);
  });

  it("parses pairing commands", () => {
    expect(
      parseCliArgs([
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "remote",
        "--capability",
        "tyrum.cli@2.0.0",
        "--capability",
        "tyrum.http",
        "--reason",
        "approved",
      ]),
    ).toEqual({
      kind: "pairing_approve",
      pairing_id: 42,
      trust_level: "remote",
      capability_allowlist: [
        { id: "tyrum.cli", version: "2.0.0" },
        { id: "tyrum.http", version: "1.0.0" },
      ],
      reason: "approved",
    });

    expect(parseCliArgs(["pairing", "deny", "--pairing-id", "7", "--reason", "no"])).toEqual({
      kind: "pairing_deny",
      pairing_id: 7,
      reason: "no",
    });

    expect(parseCliArgs(["pairing", "revoke", "--pairing-id", "8"])).toEqual({
      kind: "pairing_revoke",
      pairing_id: 8,
      reason: undefined,
    });
  });

  it("rejects invalid pairing arguments", () => {
    expect(() =>
      parseCliArgs(["pairing", "approve", "--pairing-id", "42", "--trust-level", "bad"]),
    ).toThrow("--trust-level must be 'local' or 'remote'");

    expect(() =>
      parseCliArgs(["pairing", "approve", "--pairing-id", "42", "--trust-level", "local"]),
    ).toThrow("pairing approve requires at least one --capability <id[@version]>");

    expect(() =>
      parseCliArgs([
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
        " ",
      ]),
    ).toThrow("--capability requires a non-empty value");

    expect(() =>
      parseCliArgs([
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
        "@1.0.0",
      ]),
    ).toThrow("--capability requires a non-empty id");
  });

  it("parses secrets commands", () => {
    expect(parseCliArgs(["secrets", "list"])).toEqual({
      kind: "secrets_list",
      elevated_token: undefined,
    });
    expect(
      parseCliArgs([
        "secrets",
        "store",
        "--elevated-token",
        "admin-token",
        "--secret-key",
        "OPENAI_API_KEY",
        "--value",
        "secret",
      ]),
    ).toEqual({
      kind: "secrets_store",
      elevated_token: "admin-token",
      secret_key: "OPENAI_API_KEY",
      value: "secret",
    });

    expect(
      parseCliArgs([
        "secrets",
        "revoke",
        "--elevated-token",
        "admin-token",
        "--handle-id",
        "handle-1",
      ]),
    ).toEqual({
      kind: "secrets_revoke",
      elevated_token: "admin-token",
      handle_id: "handle-1",
    });

    expect(
      parseCliArgs([
        "secrets",
        "rotate",
        "--elevated-token",
        "admin-token",
        "--handle-id",
        "handle-2",
        "--value",
        "next-secret",
      ]),
    ).toEqual({
      kind: "secrets_rotate",
      elevated_token: "admin-token",
      handle_id: "handle-2",
      value: "next-secret",
    });
  });

  it("rejects invalid secrets arguments", () => {
    expect(() => parseCliArgs(["secrets", "list", "--elevated-token", " "])).toThrow(
      "--elevated-token requires a non-empty value",
    );

    expect(() => parseCliArgs(["secrets", "store", "--secret-key", "OPENAI_API_KEY"])).toThrow(
      "--value requires a value",
    );

    expect(() =>
      parseCliArgs(["secrets", "revoke", "--handle-id", "handle-1", "--unknown"]),
    ).toThrow("unknown argument '--unknown'");
  });

  it("parses policy commands", () => {
    expect(parseCliArgs(["policy", "bundle", "--elevated-token", "admin-token"])).toEqual({
      kind: "policy_bundle",
      elevated_token: "admin-token",
    });

    expect(
      parseCliArgs(["policy", "overrides", "list", "--elevated-token", "admin-token"]),
    ).toEqual({
      kind: "policy_overrides_list",
      elevated_token: "admin-token",
    });

    expect(
      parseCliArgs([
        "policy",
        "overrides",
        "create",
        "--elevated-token",
        "admin-token",
        "--agent-id",
        "agent-1",
        "--tool-id",
        "tool-1",
        "--pattern",
        "workspace/**",
        "--workspace-id",
        "workspace-1",
      ]),
    ).toEqual({
      kind: "policy_overrides_create",
      elevated_token: "admin-token",
      agent_id: "agent-1",
      tool_id: "tool-1",
      pattern: "workspace/**",
      workspace_id: "workspace-1",
    });

    expect(
      parseCliArgs([
        "policy",
        "overrides",
        "revoke",
        "--elevated-token",
        "admin-token",
        "--policy-override-id",
        "override-1",
        "--reason",
        "cleanup",
      ]),
    ).toEqual({
      kind: "policy_overrides_revoke",
      elevated_token: "admin-token",
      policy_override_id: "override-1",
      reason: "cleanup",
    });
  });

  it("rejects unsupported and unknown commands/options", () => {
    expect(() => parseCliArgs(["config", "set", "--gateway-url"])).toThrow(
      "--gateway-url requires a value",
    );
    expect(() => parseCliArgs(["config", "set", "--unknown"])).toThrow(
      "unknown argument '--unknown'",
    );
    expect(() => parseCliArgs(["nope"])).toThrow("unknown command 'nope'");
  });
});
