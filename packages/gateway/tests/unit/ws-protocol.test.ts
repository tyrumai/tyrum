/**
 * WebSocket protocol handler tests — verifies message parsing, dispatch
 * routing, task result handling, and human response handling.
 */

import { describe } from "vitest";
import { registerHandleMessageBasicTests } from "./ws-protocol.handle-msg-basic-test-support.js";
import { registerHandleMessageEvidenceTests } from "./ws-protocol.handle-msg-evidence-test-support.js";
import { registerHandleMessageApprovalTests } from "./ws-protocol.handle-msg-approval-test-support.js";
import { registerHandleMessageResolveTests } from "./ws-protocol.handle-msg-resolve-test-support.js";
import { registerHandleMessageScopeTests } from "./ws-protocol.handle-msg-scope-test-support.js";
import { registerDispatchBasicTests } from "./ws-protocol.dispatch-basic-test-support.js";
import { registerDispatchPolicyTests } from "./ws-protocol.dispatch-policy-test-support.js";
import {
  registerDispatchTenantBoundaryTests,
  registerHandleMessageTenantBoundaryTests,
} from "./ws-protocol.tenant-boundary-test-support.js";
import { registerApprovalPlanTests } from "./ws-protocol.approval-plan-test-support.js";

describe("handleClientMessage", () => {
  registerHandleMessageBasicTests();
  registerHandleMessageEvidenceTests();
  registerHandleMessageApprovalTests();
  registerHandleMessageResolveTests();
  registerHandleMessageScopeTests();
  registerHandleMessageTenantBoundaryTests();
});

describe("dispatchTask", () => {
  registerDispatchBasicTests();
  registerDispatchPolicyTests();
  registerDispatchTenantBoundaryTests();
});

registerApprovalPlanTests();
