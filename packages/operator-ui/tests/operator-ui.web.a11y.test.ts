// @vitest-environment jsdom

import { runOperatorUiA11ySuite } from "./operator-ui.a11y.shared.js";

runOperatorUiA11ySuite([
  { mode: "web", route: "connect" },
  { mode: "web", route: "dashboard" },
  { mode: "web", route: "chat" },
  { mode: "web", route: "approvals" },
  { mode: "web", route: "agents" },
  { mode: "web", route: "pairing" },
  { mode: "web", route: "configure" },
  { mode: "web", route: "browser" },
]);
