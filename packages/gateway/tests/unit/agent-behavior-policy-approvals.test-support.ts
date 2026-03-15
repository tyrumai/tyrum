import type { GatewayContainer } from "../../src/container.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";

export function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

export async function seedApprovalPolicy(container: GatewayContainer): Promise<void> {
  await seedDeploymentPolicyBundle(container.db, {
    v: 1,
    tools: {
      allow: ["mcp.memory.write"],
      require_approval: ["bash"],
      deny: [],
    },
    network_egress: {
      default: "allow",
      allow: [],
      require_approval: [],
      deny: [],
    },
    secrets: {
      default: "allow",
      allow: [],
      require_approval: [],
      deny: [],
    },
  });
}
