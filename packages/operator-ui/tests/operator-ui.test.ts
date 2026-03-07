// @vitest-environment jsdom

import { afterEach, describe, vi } from "vitest";
import { registerShellLayoutTests } from "./operator-ui.shell-layout-test-support.js";
import { registerConfigurePanelsTests } from "./operator-ui.configure-panels-test-support.js";
import { registerConfigureActionsTests } from "./operator-ui.configure-actions-test-support.js";
import { registerConnectDesktopTests } from "./operator-ui.connect-desktop-test-support.js";
import { registerLoginTests } from "./operator-ui.login-test-support.js";
import { registerDashboardNavTests } from "./operator-ui.dashboard-nav-test-support.js";
import { registerApprovalsTests } from "./operator-ui.approvals-test-support.js";
import { registerPairingTests } from "./operator-ui.pairing-test-support.js";
import { registerAgentRunsGeneralTests } from "./operator-ui.agent-runs-general-test-support.js";
import { registerElevatedModeTests } from "./operator-ui.elevated-mode-test-support.js";
import { registerElevatedModePersistenceTests } from "./operator-ui.elevated-mode-persistence-test-support.js";
import { registerElevatedModeAuthTests } from "./operator-ui.elevated-mode-auth-test-support.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("operator-ui", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  registerShellLayoutTests();
  registerConfigurePanelsTests();
  registerConfigureActionsTests();
  registerConnectDesktopTests();
  registerLoginTests();
  registerDashboardNavTests();
  registerApprovalsTests();
  registerPairingTests();
  registerAgentRunsGeneralTests();
  registerElevatedModeTests();
  registerElevatedModePersistenceTests();
  registerElevatedModeAuthTests();
});
