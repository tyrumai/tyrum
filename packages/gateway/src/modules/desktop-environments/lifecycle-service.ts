import type { DesktopEnvironmentDal } from "./dal.js";
import { removeEnvironmentContainer } from "./docker-cli.js";

export interface DesktopEnvironmentLifecycle {
  deleteEnvironment(input: { tenantId: string; environmentId: string }): Promise<boolean>;
}

export class DesktopEnvironmentLifecycleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopEnvironmentLifecycleUnavailableError";
  }
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

export class UnsupportedDesktopEnvironmentLifecycleService implements DesktopEnvironmentLifecycle {
  async deleteEnvironment(): Promise<boolean> {
    throw new DesktopEnvironmentLifecycleUnavailableError(
      "desktop environment deletion requires a gateway instance running role=all or role=desktop-runtime, or a custom desktop environment lifecycle service",
    );
  }
}
