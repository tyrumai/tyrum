import type { GatewayContainer } from "../../../container.js";
import { createGatewayPlanService as createGatewayPlanServiceImpl } from "../../../modules/planner/service.js";
import type { GatewayPlanService } from "../../../modules/planner/service.js";
import { PlanDal } from "../../../modules/planner/plan-dal.js";
import { requirePrimaryAgentId } from "../identity/scope.js";

export type {
  GatewayPlanService,
  GatewayPlanServiceDeps,
  GatewayPlanServiceResult,
} from "../../../modules/planner/service.js";

export function createGatewayPlanService(container: GatewayContainer): GatewayPlanService {
  return createGatewayPlanServiceImpl({
    eventBus: container.eventBus,
    eventLog: container.eventLog,
    identityScopeDal: container.identityScopeDal,
    logger: container.logger,
    planDal: new PlanDal(container.db),
    resolvePrimaryAgentId: async (tenantId) =>
      await requirePrimaryAgentId(container.identityScopeDal, tenantId),
    riskClassifier: container.riskClassifier,
  });
}
