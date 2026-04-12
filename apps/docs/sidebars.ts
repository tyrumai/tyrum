import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "doc",
      id: "index",
      label: "Home",
    },
    {
      type: "category",
      label: "Getting Started",
      items: ["install", "getting-started", "desktop"],
    },
    {
      type: "category",
      label: "Advanced",
      items: [
        "advanced/remote-gateway",
        "advanced/multi-node",
        "advanced/deployment-profiles",
        "advanced/desktop-sandbox",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: ["api-reference", "policy_service"],
    },
    {
      type: "category",
      label: "Architecture",
      items: [
        {
          type: "category",
          label: "Overview",
          items: [
            "architecture/index",
            "architecture/target-state",
            "architecture/runtime-extraction-parity",
            "architecture/reference/arch-20-conversation-turn-clean-break",
          ],
        },
        {
          type: "category",
          label: "Gateway",
          items: [
            {
              type: "category",
              label: "Overview",
              items: ["architecture/gateway/index"],
            },
            {
              type: "category",
              label: "Core Concepts",
              items: [
                "architecture/gateway/turn-processing",
                "architecture/gateway/approvals",
                "architecture/gateway/tools",
                "architecture/gateway/automation",
                "architecture/gateway/artifacts",
              ],
            },
            {
              type: "category",
              label: "Safety & Governance",
              items: [
                "architecture/gateway/reviews",
                "architecture/gateway/policy-overrides",
                "architecture/gateway/secrets",
                "architecture/gateway/auth",
                "architecture/gateway/sandbox-policy/index",
              ],
            },
            {
              type: "category",
              label: "Extensibility & Operators",
              items: [
                "architecture/gateway/playbooks",
                "architecture/gateway/plugins",
                "architecture/gateway/skills",
                "architecture/gateway/slash-commands",
                "architecture/gateway/desktop-environments",
                "architecture/gateway/location-automation",
                "architecture/gateway/observability",
              ],
            },
            {
              type: "category",
              label: "Mechanics & Reference",
              items: [
                "architecture/gateway/sandbox-policy/enforcement-model",
                "architecture/gateway/sandbox-policy/sandbox-profiles",
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Agent",
          items: [
            {
              type: "category",
              label: "Overview",
              items: ["architecture/agent/index"],
            },
            {
              type: "category",
              label: "Core Concepts",
              items: [
                "architecture/agent/workspace",
                "architecture/agent/models",
                "architecture/agent/channels",
                "architecture/agent/messages/index",
                "architecture/agent/messages/conversations-turns",
                "architecture/agent/messages/transcript-conversation-state",
                "architecture/agent/memory/index",
                "architecture/agent/workboard/index",
                "architecture/agent/system-prompt",
                "architecture/agent/multi-agent-routing",
                "architecture/agent/agent-loop",
              ],
            },
            {
              type: "category",
              label: "Mechanics & Reference",
              items: [
                "architecture/agent/messages/flow-control-delivery",
                "architecture/agent/messages/markdown-formatting",
                "architecture/agent/memory/consolidation-retention",
                "architecture/agent/memory/context-compaction",
                "architecture/agent/workboard/delegated-execution",
                "architecture/agent/workboard/durable-work-state",
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Protocol",
          items: [
            {
              type: "category",
              label: "Overview",
              items: ["architecture/protocol/index"],
            },
            {
              type: "category",
              label: "Core Concepts",
              items: ["architecture/protocol/api-surfaces", "architecture/protocol/contracts"],
            },
            {
              type: "category",
              label: "Mechanics & Reference",
              items: [
                "architecture/protocol/handshake",
                "architecture/protocol/requests-responses",
                "architecture/protocol/events",
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Client & Node",
          items: [
            {
              type: "category",
              label: "Client Overview",
              items: ["architecture/client/index"],
            },
            {
              type: "category",
              label: "Client Concepts",
              items: [
                "architecture/client/embedded-local-nodes",
                "architecture/client/identity",
                "architecture/client/presence",
              ],
            },
            {
              type: "category",
              label: "Node Overview",
              items: ["architecture/node/index"],
            },
            {
              type: "category",
              label: "Node Concepts",
              items: ["architecture/node/capabilities"],
            },
          ],
        },
        {
          type: "category",
          label: "Deployment & Data",
          items: [
            {
              type: "category",
              label: "Overview",
              items: ["architecture/scaling-ha/index"],
            },
            {
              type: "category",
              label: "Core Concepts",
              items: [
                "architecture/scaling-ha/backplane",
                "architecture/scaling-ha/data-lifecycle",
                "architecture/scaling-ha/statestore-dialects",
              ],
            },
            {
              type: "category",
              label: "Mechanics & Reference",
              items: [
                "architecture/scaling-ha/postgres-json-fields",
                "architecture/scaling-ha/data-model-map",
                "architecture/scaling-ha/data-model-fk-audit",
                "architecture/scaling-ha/db-naming-conventions",
                "architecture/scaling-ha/db-enum-constraints",
                "architecture/scaling-ha/db-json-hygiene",
                "architecture/scaling-ha/operational-maintenance",
                "architecture/scaling-ha/index-tuning",
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Reference",
          items: [
            "architecture/reference/doc-templates",
            "architecture/reference/arch-01-clean-break-target-state",
            "architecture/reference/arch-19-dedicated-node-backed-tools",
            "architecture/reference/arch-21-public-tool-taxonomy-and-exposure-model",
            "architecture/reference/glossary",
          ],
        },
      ],
    },
  ],
};

export default sidebars;
