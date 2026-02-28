// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestRoot,
  createTestRoot,
  type TestRoot,
} from "../../../packages/operator-ui/tests/test-utils.js";
import {
  getControlByLabelText,
  getSwitchForRowLabelText,
  press,
  setTextareaValue,
} from "./test-utils/dom.js";

describe("Permissions page", () => {
  let testRoot: TestRoot;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("can switch profiles, toggle capabilities, and edit allowlists", async () => {
    const { Permissions } = await import("../src/renderer/pages/Permissions.js");

    await act(async () => {
      testRoot.root.render(createElement(Permissions));
    });

    await act(async () => {
      press(getControlByLabelText("Safe"));
    });
    await act(async () => {
      press(getControlByLabelText("Balanced"));
    });

    expect(document.body.textContent).toContain("active (default deny)");

    const httpSwitch = getSwitchForRowLabelText("HTTP (network requests)");
    await act(async () => {
      press(httpSwitch);
    });

    const allowedCommands = getControlByLabelText(
      "Allowed Commands (one per line)",
    ) as HTMLTextAreaElement;
    expect(allowedCommands.disabled).toBe(false);
    await act(async () => {
      setTextareaValue(allowedCommands, "git status\n\nnode --version");
    });
    expect(allowedCommands.value).toBe("git status\nnode --version");

    const allowedWorkingDirs = getControlByLabelText(
      "Allowed Working Directories (one per line)",
    ) as HTMLTextAreaElement;
    expect(allowedWorkingDirs.disabled).toBe(false);
    await act(async () => {
      setTextareaValue(allowedWorkingDirs, "/tmp\n\n*");
    });
    expect(allowedWorkingDirs.value).toBe("/tmp\n*");

    const allowedDomains = getControlByLabelText(
      "Allowed Domains (one per line)",
    ) as HTMLTextAreaElement;
    expect(allowedDomains.disabled).toBe(false);
    await act(async () => {
      setTextareaValue(allowedDomains, "example.com\n\n*");
    });
    expect(allowedDomains.value).toBe("example.com\n*");

    const headlessSwitch = getSwitchForRowLabelText("Headless mode");
    await act(async () => {
      press(headlessSwitch);
    });
  });
});
