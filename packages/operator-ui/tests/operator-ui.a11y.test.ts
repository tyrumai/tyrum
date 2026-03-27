// @vitest-environment jsdom

import { runOperatorUiA11ySuite } from "./operator-ui.a11y.shared.js";

runOperatorUiA11ySuite([
  { mode: "desktop", route: "connect" },
  { mode: "desktop", route: "dashboard" },
  { mode: "desktop", route: "chat" },
  { mode: "desktop", route: "approvals" },
  { mode: "desktop", route: "agents" },
  { mode: "desktop", route: "pairing" },
  { mode: "desktop", route: "desktop" },
  { mode: "desktop", route: "configure" },
]);
