import type { AppRouteContext } from "./app-route-registrars.js";
import { createArtifactRoutes } from "./routes/artifact.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createExtensionsRoutes } from "./routes/extensions.js";
import { createOperatorUiRoutes } from "./routes/operator-ui.js";
import { createSnapshotRoutes } from "./routes/snapshot.js";

export function registerArtifactsAuditAndUiRoutes(context: AppRouteContext): void {
  context.app.route(
    "/",
    createExtensionsRoutes({
      db: context.container.db,
      container: context.container,
    }),
  );

  context.app.route(
    "/",
    createAuditRoutes({
      db: context.container.db,
      eventLog: context.container.eventLog,
      identityScopeDal: context.container.identityScopeDal,
    }),
  );

  context.app.route(
    "/",
    createSnapshotRoutes({
      db: context.container.db,
      version: context.runtime.version,
      importEnabled: context.container.deploymentConfig.snapshots.importEnabled,
    }),
  );

  context.app.route(
    "/",
    createArtifactRoutes({
      db: context.container.db,
      artifactStore: context.container.artifactStore,
      publicBaseUrl: context.container.deploymentConfig.server.publicBaseUrl,
      logger: context.container.logger,
      policySnapshotDal: context.container.policySnapshotDal,
      policyService: context.container.policyService,
    }),
  );

  context.app.route("/", createOperatorUiRoutes({ assetsDir: context.opts.operatorUiAssetsDir }));
}
