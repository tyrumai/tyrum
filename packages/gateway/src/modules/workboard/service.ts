import type { WorkboardService } from "@tyrum/runtime-workboard";
import type { SqlDb } from "../../statestore/types.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { createGatewayWorkboardService as createService } from "./runtime-workboard-adapters.js";

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
}): WorkboardService {
  return createService(opts);
}
