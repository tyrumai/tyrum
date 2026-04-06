import type { GatewayContainer } from "../../container.js";
import { WorkflowRunRunner } from "./runner.js";

export function createWorkflowRunRunner(
  container: Pick<GatewayContainer, "db" | "policyService" | "redactionEngine">,
): WorkflowRunRunner {
  return new WorkflowRunRunner({
    db: container.db,
    policyService: container.policyService,
    redactText: (text) => container.redactionEngine.redactText(text).redacted,
    redactUnknown: <T>(value: T) => container.redactionEngine.redactUnknown(value).redacted as T,
  });
}
