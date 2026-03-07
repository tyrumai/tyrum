import { expect, it, vi } from "vitest";
import {
  FakeWsClient,
  clickElement,
  expectElement,
  flushMemoryInspector,
  mountMemoryInspector,
  openFilters,
  sampleNote,
  setFieldValue,
} from "./memory-inspector.test-helpers.js";

type DesktopConnection = {
  httpBaseUrl: string;
  mode: "embedded";
  tlsAllowSelfSigned: boolean;
  tlsCertFingerprint256: string;
  token: string;
  wsUrl: string;
};

type DesktopGateway = {
  getOperatorConnection: () => Promise<DesktopConnection>;
  httpFetch: (...args: never[]) => Promise<unknown>;
};

function withDesktopGateway(gateway: DesktopGateway): () => void {
  const previousDesktop = (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
    gateway,
  } as unknown;
  return () => {
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = previousDesktop;
  };
}

export function registerMemoryInspectorExportAndSearchTests(): void {
  it("exports memory and shows a download link", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174226", "Export me");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-999" }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    const exportButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-export"]',
    );
    await clickElement(exportButton);

    expect(ws.memoryExport).toHaveBeenCalledWith({
      v: 1,
      filter: undefined,
      include_tombstones: false,
    });

    const link = expectElement<HTMLAnchorElement>(
      testRoot.container,
      '[data-testid="memory-export-download"]',
    );
    expect(link.getAttribute("href")).toBe("http://example.test/memory/exports/artifact-999");

    cleanup();
  });

  it("downloads exported memory in desktop mode via desktop httpFetch", async () => {
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-999" }) as unknown);

    const httpFetch = vi.fn(async () => ({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": 'attachment; filename="tyrum-memory-export-artifact-999.json"',
      },
      bodyText: "{}",
    }));
    const restoreDesktop = withDesktopGateway({
      httpFetch,
      getOperatorConnection: vi.fn(async () => ({
        mode: "embedded",
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test/",
        token: "desktop-token",
        tlsCertFingerprint256: "",
        tlsAllowSelfSigned: false,
      })),
    });

    const createObjectUrl = vi.fn(() => "blob:memory-export");
    const revokeObjectUrl = vi.fn();
    const previousCreateObjectUrl = URL.createObjectURL;
    const previousRevokeObjectUrl = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = createObjectUrl as unknown;
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = revokeObjectUrl as unknown;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      const { cleanup, testRoot } = await mountMemoryInspector({ ws });

      const exportButton = expectElement<HTMLButtonElement>(
        testRoot.container,
        '[data-testid="memory-export"]',
      );
      await clickElement(exportButton);

      const downloadButton = expectElement<HTMLElement>(
        testRoot.container,
        '[data-testid="memory-export-download"]',
      );
      expect(downloadButton.tagName.toLowerCase()).toBe("button");

      await clickElement(downloadButton);

      expect(httpFetch).toHaveBeenCalledWith({
        url: "http://example.test/memory/exports/artifact-999",
        init: {
          method: "GET",
          headers: { authorization: "Bearer desktop-token" },
        },
      });
      expect(createObjectUrl).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();

      cleanup();
    } finally {
      clickSpy.mockRestore();
      restoreDesktop();
      (URL as unknown as { createObjectURL?: unknown }).createObjectURL = previousCreateObjectUrl;
      (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = previousRevokeObjectUrl;
    }
  });

  it("clears stale download errors when starting a new export", async () => {
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-999" }) as unknown);

    const restoreDesktop = withDesktopGateway({
      httpFetch: vi.fn(async () => ({
        status: 200,
        headers: { "content-type": "application/json", "content-disposition": "" },
        bodyText: "{}",
      })),
      getOperatorConnection: vi.fn(async () => ({
        mode: "embedded",
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test/",
        token: "",
        tlsCertFingerprint256: "",
        tlsAllowSelfSigned: false,
      })),
    });

    try {
      const { cleanup, testRoot } = await mountMemoryInspector({ ws });

      const exportButton = expectElement<HTMLButtonElement>(
        testRoot.container,
        '[data-testid="memory-export"]',
      );
      await clickElement(exportButton);
      await flushMemoryInspector();

      const downloadButton = expectElement<HTMLButtonElement>(
        testRoot.container,
        '[data-testid="memory-export-download"]',
      );
      await clickElement(downloadButton);
      await flushMemoryInspector();

      const downloadError = expectElement<HTMLDivElement>(
        testRoot.container,
        '[data-testid="memory-export-download-error"]',
      );
      expect(downloadError.textContent).toContain("Missing gateway token");

      await clickElement(exportButton);
      await flushMemoryInspector();

      expect(
        testRoot.container.querySelector('[data-testid="memory-export-download-error"]'),
      ).toBeNull();

      cleanup();
    } finally {
      restoreDesktop();
    }
  });

  it("shows memory export errors", async () => {
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => {
      throw new Error("export failed");
    });

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    const exportButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-export"]',
    );
    await clickElement(exportButton);

    const error = expectElement<HTMLDivElement>(
      testRoot.container,
      '[data-testid="memory-export-error"]',
    );
    expect(error.textContent).toContain("export failed");

    cleanup();
  });

  it("searches memory using query + filters", async () => {
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    const searchMode = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-mode-search"]',
    );
    await clickElement(searchMode);

    const queryField = expectElement<HTMLInputElement>(
      testRoot.container,
      '[data-testid="memory-query"]',
    );
    await setFieldValue(queryField, "hello");

    await openFilters(testRoot.container);

    const kindNote = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-filter-kind-note"]',
    );
    await clickElement(kindNote);

    const tagsField = expectElement<HTMLInputElement>(
      testRoot.container,
      '[data-testid="memory-filter-tags"]',
    );
    await setFieldValue(tagsField, "demo");

    const sourceOperator = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-filter-provenance-source-operator"]',
    );
    await clickElement(sourceOperator);

    const channelField = expectElement<HTMLInputElement>(
      testRoot.container,
      '[data-testid="memory-filter-provenance-channels"]',
    );
    await setFieldValue(channelField, "cli");

    const runButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-run"]',
    );
    await clickElement(runButton);

    expect(ws.memorySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        query: "hello",
        filter: expect.objectContaining({
          kinds: ["note"],
          tags: ["demo"],
          provenance: expect.objectContaining({ source_kinds: ["operator"], channels: ["cli"] }),
        }),
      }),
    );

    cleanup();
  });
}
