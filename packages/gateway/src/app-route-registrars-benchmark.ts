import { createBenchmarkFixtureRoutes } from "./routes/benchmark-fixtures.js";
import type { AppRouteContext } from "./app-route-support.js";

export function registerBenchmarkFixtureRoutes(context: AppRouteContext): void {
  context.app.route(
    "/",
    createBenchmarkFixtureRoutes({
      publicBaseUrl: context.container.deploymentConfig.server.publicBaseUrl,
    }),
  );
}
