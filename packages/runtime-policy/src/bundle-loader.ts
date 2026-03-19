import { PolicyBundle } from "@tyrum/contracts";
import type { PolicyBundle as PolicyBundleT } from "@tyrum/contracts";

export function defaultPolicyBundle(): PolicyBundleT {
  return PolicyBundle.parse({
    v: 1,
    tools: {
      allow: [],
      require_approval: [],
      deny: [],
    },
    network_egress: {
      default: "require_approval",
      allow: [],
      require_approval: [],
      deny: [],
    },
    secrets: {
      default: "require_approval",
      allow: [],
      require_approval: [],
      deny: [],
    },
    connectors: {
      default: "require_approval",
      allow: ["telegram:*"],
      require_approval: [],
      deny: [],
    },
    artifacts: {
      default: "allow",
    },
    provenance: {
      untrusted_shell_requires_approval: true,
    },
  });
}
