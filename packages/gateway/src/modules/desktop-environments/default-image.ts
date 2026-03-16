import type { DeploymentConfig as DeploymentConfigT } from "@tyrum/schemas";
import {
  DeploymentConfigDal,
  type DeploymentConfigRevision,
} from "../config/deployment-config-dal.js";

async function ensureDeploymentConfigRevision(params: {
  deploymentConfigDal: DeploymentConfigDal;
  defaultConfig: DeploymentConfigT;
}): Promise<DeploymentConfigRevision> {
  return await params.deploymentConfigDal.ensureSeeded({
    defaultConfig: params.defaultConfig,
    createdBy: { kind: "bootstrap" },
    reason: "seed",
  });
}

export async function readDesktopEnvironmentDefaultImageRef(params: {
  deploymentConfigDal: DeploymentConfigDal;
  defaultConfig: DeploymentConfigT;
}): Promise<{ defaultImageRef: string; revision: DeploymentConfigRevision }> {
  const revision = await ensureDeploymentConfigRevision(params);
  return {
    defaultImageRef: revision.config.desktopEnvironments.defaultImageRef,
    revision,
  };
}
