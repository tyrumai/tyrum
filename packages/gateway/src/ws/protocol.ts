export type { ProtocolDeps } from "./protocol/types.js";
export { NoCapableClientError } from "./protocol/errors.js";
export { handleClientMessage } from "./protocol/handler.js";
export { dispatchTask } from "./protocol/dispatch.js";
export { requestApproval } from "./protocol/approvals.js";
export { sendPlanUpdate } from "./protocol/plan-updates.js";
