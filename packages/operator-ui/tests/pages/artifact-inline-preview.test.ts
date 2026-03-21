// @vitest-environment jsdom

import type { ArtifactRef } from "@tyrum/contracts";
import type { OperatorCore } from "@tyrum/operator-app";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactInlinePreview } from "../../src/components/artifacts/artifact-inline-preview.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createArtifact(): ArtifactRef {
  return {
    artifact_id: "json-artifact",
    uri: "artifact://json-artifact",
    kind: "result",
    created_at: "2026-01-01T00:00:00.000Z",
    mime_type: "application/json",
    labels: [],
  } as ArtifactRef;
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ArtifactInlinePreview", () => {
  it("keeps structured JSON previews inside a bounded scroll container", async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:artifact-preview-json");
    URL.revokeObjectURL = vi.fn();

    const getBytes = vi.fn(async () => ({
      kind: "bytes" as const,
      bytes: new TextEncoder().encode(JSON.stringify({ status: "ok", items: [1, 2, 3] })),
      contentType: "application/json",
    }));
    const getMetadata = vi.fn(async () => ({ sensitivity: "internal" }));
    const core = {
      httpBaseUrl: "http://example.test",
      admin: {
        artifacts: {
          getBytes,
          getMetadata,
        },
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(ArtifactInlinePreview, {
        core,
        artifact: createArtifact(),
      }),
    );

    await act(async () => {
      await flushMicrotasks();
    });

    const preview = testRoot.container.querySelector(
      "[data-testid='artifact-preview-json-json-artifact']",
    ) as HTMLDivElement | null;
    const scrollContainer = Array.from(preview?.querySelectorAll("div") ?? []).find(
      (div) =>
        typeof div.className === "string" &&
        div.className.includes("max-h-[420px]") &&
        div.className.includes("overflow-auto"),
    );

    expect(preview).not.toBeNull();
    expect(scrollContainer).not.toBeUndefined();
    expect(preview?.querySelector("pre")).toBeNull();
    expect(preview?.textContent).toContain("Status");
    expect(preview?.textContent).toContain("Items");

    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    cleanupTestRoot(testRoot);
  });
});
