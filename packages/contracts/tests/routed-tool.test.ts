import { describe, expect, it } from "vitest";
import {
  ExplicitDedicatedToolId,
  RoutedToolExecutionMetadata,
  RoutedToolTargeting,
  SecretCopyToNodeClipboardArgs,
  SecretReferenceSelector,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("ExplicitDedicatedToolId", () => {
  it("accepts dedicated routed tool ids", () => {
    expect(ExplicitDedicatedToolId.parse("tool.desktop.screenshot")).toBe(
      "tool.desktop.screenshot",
    );
    expect(ExplicitDedicatedToolId.parse("tool.secret.copy-to-node-clipboard")).toBe(
      "tool.secret.copy-to-node-clipboard",
    );
  });

  it("rejects generic node helper tool ids", () => {
    expectRejects(ExplicitDedicatedToolId, "tool.node.dispatch");
    expectRejects(ExplicitDedicatedToolId, "tool.node.inspect");
    expectRejects(ExplicitDedicatedToolId, "tool.node.list");
  });
});

describe("RoutedToolTargeting", () => {
  it("parses optional node routing metadata", () => {
    expect(
      RoutedToolTargeting.parse({
        node_id: "node_123",
        timeout_ms: 15_000,
      }),
    ).toEqual({
      node_id: "node_123",
      timeout_ms: 15_000,
    });
  });
});

describe("RoutedToolExecutionMetadata", () => {
  it("parses explicit selections with matching requested and selected ids", () => {
    const parsed = RoutedToolExecutionMetadata.parse({
      requested_node_id: "node_123",
      selected_node_id: "node_123",
      selection_mode: "explicit",
      selected_node: {
        label: "Primary desktop",
        platform: "macos",
        trust_level: "local",
      },
    });
    expect(parsed.selection_mode).toBe("explicit");
  });

  it("rejects implicit selections that still carry a requested node id", () => {
    expectRejects(RoutedToolExecutionMetadata, {
      requested_node_id: "node_123",
      selected_node_id: "node_456",
      selection_mode: "sole_eligible_node",
    });
  });
});

describe("SecretReferenceSelector", () => {
  it("accepts exactly one secret selector", () => {
    expect(SecretReferenceSelector.parse({ secret_ref_id: "sec_ref_prod_db" })).toEqual({
      secret_ref_id: "sec_ref_prod_db",
    });
    expect(SecretReferenceSelector.parse({ secret_alias: "prod-db-password" })).toEqual({
      secret_alias: "prod-db-password",
    });
  });

  it("rejects missing or duplicate selectors", () => {
    expectRejects(SecretReferenceSelector, {});
    expectRejects(SecretReferenceSelector, {
      secret_ref_id: "sec_ref_prod_db",
      secret_alias: "prod-db-password",
    });
  });
});

describe("SecretCopyToNodeClipboardArgs", () => {
  it("parses a dedicated secret clipboard request", () => {
    expect(
      SecretCopyToNodeClipboardArgs.parse({
        secret_alias: "prod-db-password",
        node_id: "node_123",
      }),
    ).toEqual({
      secret_alias: "prod-db-password",
      node_id: "node_123",
    });
  });

  it("rejects missing or duplicate secret selectors", () => {
    expectRejects(SecretCopyToNodeClipboardArgs, {});
    expectRejects(SecretCopyToNodeClipboardArgs, {
      secret_ref_id: "sec_ref_prod_db",
      secret_alias: "prod-db-password",
    });
  });

  it("rejects plaintext clipboard payload fields", () => {
    expectRejects(SecretCopyToNodeClipboardArgs, {
      secret_ref_id: "sec_ref_prod_db",
      text: "should-not-be-model-visible",
    });
  });
});
