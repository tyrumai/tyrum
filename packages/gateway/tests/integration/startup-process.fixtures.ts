import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/contracts";

export type ApprovalRunSeed = {
  jobId: string;
  runId: string;
  stepId: string;
  approvalId: string;
  approvalKey: string;
  key: string;
  lane: string;
  resumeToken?: string;
};

export const deniedApprovalFixture: ApprovalRunSeed = {
  jobId: "a8c8b7d6-e3f5-4b3c-a1c8-1c4c5c2f0a01",
  runId: "c8b7d6e3-f54b-4b3c-a1c8-1c4c5c2f0a02",
  stepId: "d6e3f54b-4b3c-4b3c-a1c8-1c4c5c2f0a03",
  approvalId: "e3f54b4b-3c4b-4b3c-a1c8-1c4c5c2f0a04",
  approvalKey: "approval-ws-approval-test",
  key: "test:ws-approval",
  lane: "main",
  resumeToken: "resume-ws-approval-test",
};

export const missingResumeTokenApprovalFixture: ApprovalRunSeed = {
  jobId: "c78e8356-6c13-4f74-92d8-3386da3fbf01",
  runId: "6c13c78e-8356-4f74-92d8-3386da3fbf02",
  stepId: "83566c13-c78e-4f74-92d8-3386da3fbf03",
  approvalId: "8e83566c-13c7-4f74-92d8-3386da3fbf04",
  approvalKey: "approval-ws-approval-missing-token",
  key: "test:ws-approval-missing-token",
  lane: "main",
};

export const shutdownHookKey = "hook:550e8400-e29b-41d4-a716-446655440000";
export const busyStartHookKey = "hook:550e8400-e29b-41d4-a716-446655440001";
export const busyShutdownHookKey = "hook:550e8400-e29b-41d4-a716-446655440002";

export const busyShutdownPolicyConfig =
  `v: 1\n` +
  `tools:\n` +
  `  default: require_approval\n` +
  `  allow: ["bash"]\n` +
  `  require_approval: []\n` +
  `  deny: []\n`;

export const busyShutdownPolicyBundle: PolicyBundleT = {
  v: 1,
  tools: {
    default: "require_approval",
    allow: ["bash"],
    require_approval: [],
    deny: [],
  },
};

export function shutdownHookDefinition(hookKey: string): LifecycleHookDefinitionT {
  return {
    hook_key: hookKey,
    event: "gateway.shutdown",
    conversation_key: hookKey,
    steps: [{ type: "CLI", args: { cmd: "echo", args: ["shutdown hook"] } }],
  };
}

export function busyShutdownHookDefinitions(
  nodeExecPath: string,
  startHookKey: string,
  shutdownHookKeyValue: string,
): LifecycleHookDefinitionT[] {
  return [
    {
      hook_key: startHookKey,
      event: "gateway.start",
      conversation_key: startHookKey,
      steps: [
        { type: "CLI", args: { cmd: nodeExecPath, args: ["-e", "setTimeout(() => {}, 3000)"] } },
      ],
    },
    {
      hook_key: shutdownHookKeyValue,
      event: "gateway.shutdown",
      conversation_key: shutdownHookKeyValue,
      steps: [{ type: "CLI", args: { cmd: nodeExecPath, args: ["-e", "process.exit(0)"] } }],
    },
  ];
}

export function shutdownHookConfig(hookKey: string): string {
  return (
    `v: 1\n` +
    `hooks:\n` +
    `  - hook_key: ${hookKey}\n` +
    `    event: gateway.shutdown\n` +
    `    conversation_key: ${hookKey}\n` +
    `    steps:\n` +
    `      - type: CLI\n` +
    `        args:\n` +
    `          cmd: echo\n` +
    `          args: ["shutdown hook"]\n`
  );
}

export function busyShutdownHooksConfig(
  nodeExecPath: string,
  startHookKey: string,
  shutdownHookKeyValue: string,
): string {
  return (
    `v: 1\n` +
    `hooks:\n` +
    `  - hook_key: ${startHookKey}\n` +
    `    event: gateway.start\n` +
    `    conversation_key: ${startHookKey}\n` +
    `    steps:\n` +
    `      - type: CLI\n` +
    `        args:\n` +
    `          cmd: ${nodeExecPath}\n` +
    `          args: ["-e", "setTimeout(() => {}, 3000)"]\n` +
    `  - hook_key: ${shutdownHookKeyValue}\n` +
    `    event: gateway.shutdown\n` +
    `    conversation_key: ${shutdownHookKeyValue}\n` +
    `    steps:\n` +
    `      - type: CLI\n` +
    `        args:\n` +
    `          cmd: ${nodeExecPath}\n` +
    `          args: ["-e", "process.exit(0)"]\n`
  );
}
