// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useApiAction } from "../src/components/admin-http/admin-http-shared.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("useApiAction", () => {
  it("prevents concurrent run() calls while in-flight", async () => {
    const { container, root } = createTestRoot();

    let api: ReturnType<typeof useApiAction<number>> | null = null;
    const Probe = () => {
      api = useApiAction<number>();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe, null));
      await Promise.resolve();
    });

    expect(api).not.toBeNull();

    const action = vi.fn(async () => new Promise<number>(() => {}));

    await act(async () => {
      void api?.run(action);
      void api?.run(action);
      await Promise.resolve();
    });

    expect(action).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
