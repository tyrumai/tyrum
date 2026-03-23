import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { createGatewayWorkboardService as createRuntimeWorkboardService } from "./runtime-workboard-adapters.js";

export type GatewayWorkboardService = ReturnType<typeof createRuntimeWorkboardService>;

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): GatewayWorkboardService {
  return createRuntimeWorkboardService(opts);
}
