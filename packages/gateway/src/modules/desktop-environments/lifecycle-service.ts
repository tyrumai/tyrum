import type { DesktopEnvironmentDal } from "./dal.js";
import { removeEnvironmentContainer } from "./docker-cli.js";

export interface DesktopEnvironmentLifecycle {
  deleteEnvironment(input: { tenantId: string; environmentId: string }): Promise<boolean>;
}

export class DesktopEnvironmentLifecycleService implements DesktopEnvironmentLifecycle {
  constructor(
    private readonly environmentDal: Pick<DesktopEnvironmentDal, "get" | "delete">,
    private readonly removeRuntimeResources: (
      environmentId: string,
    ) => Promise<void> = removeEnvironmentContainer,
  ) {}

  async deleteEnvironment(input: { tenantId: string; environmentId: string }): Promise<boolean> {
    const environment = await this.environmentDal.get(input);
    if (!environment) return false;
    await this.removeRuntimeResources(environment.environment_id);
    return await this.environmentDal.delete(input);
  }
}
