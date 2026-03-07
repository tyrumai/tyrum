import { isPostgresDbUri } from "../../statestore/db-uri.js";
import { isSharedStateMode } from "./mode.js";

export function assertSharedStateModeGuardrails(params: {
  dbPath: string;
  deploymentConfig: unknown;
}): void {
  if (!isSharedStateMode(params.deploymentConfig)) {
    return;
  }

  const deploymentConfig = params.deploymentConfig as {
    artifacts?: { store?: string };
    server?: { tlsSelfSigned?: boolean };
    policy?: { bundlePath?: string };
  };
  const failures: string[] = [];
  if (!isPostgresDbUri(params.dbPath)) {
    failures.push("shared mode requires Postgres (set --db to a postgres:// URI)");
  }
  if ((deploymentConfig.artifacts?.store ?? "fs") === "fs") {
    failures.push("shared mode requires non-filesystem artifact storage");
  }
  if (deploymentConfig.server?.tlsSelfSigned) {
    failures.push("shared mode does not support server.tlsSelfSigned");
  }
  if (deploymentConfig.policy?.bundlePath) {
    failures.push("shared mode does not support policy.bundlePath");
  }

  if (failures.length === 0) {
    return;
  }

  throw new Error(`invalid shared deployment configuration:\n- ${failures.join("\n- ")}`);
}
