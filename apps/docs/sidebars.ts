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
      items: [
        "api-reference",
        "policy_service",
        "executors/http_executor",
        "executors/web_executor",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: [
        {
          type: "doc",
          id: "architecture/index",
          label: "Overview",
        },
        {
          type: "category",
          label: "Gateway",
          items: [
            {
              type: "doc",
              id: "architecture/gateway/index",
              label: "Overview",
            },
            {
              type: "category",
              label: "Execution Engine",
              items: [
                "architecture/gateway/execution-engine/index",
                "architecture/gateway/execution-engine/runtime-mechanics",
              ],
            },
            "architecture/gateway/playbooks",
            "architecture/gateway/approvals",
            "architecture/gateway/policy-overrides",
            "architecture/gateway/secrets",
            "architecture/gateway/auth",
            "architecture/gateway/artifacts",
            "architecture/gateway/tools",
            "architecture/gateway/plugins",
            "architecture/gateway/skills",
            "architecture/gateway/slash-commands",
            {
              type: "category",
              label: "Sandbox & Policy",
              items: [
                "architecture/gateway/sandbox-policy/index",
                "architecture/gateway/sandbox-policy/enforcement-model",
                "architecture/gateway/sandbox-policy/sandbox-profiles",
              ],
            },
            "architecture/gateway/observability",
            "architecture/gateway/automation",
          ],
        },
        {
          type: "category",
          label: "Agent",
          items: [
            {
              type: "doc",
              id: "architecture/agent/index",
              label: "Overview",
            },
            "architecture/agent/workspace",
            "architecture/agent/models",
            "architecture/agent/channels",
            {
              type: "category",
              label: "Messages & Sessions",
              items: [
                "architecture/agent/messages/index",
                "architecture/agent/messages/flow-control-delivery",
                "architecture/agent/messages/sessions-lanes",
                "architecture/agent/messages/markdown-formatting",
              ],
            },
            {
              type: "category",
              label: "Memory",
              items: [
                "architecture/agent/memory/index",
                "architecture/agent/memory/consolidation-retention",
                "architecture/agent/memory/context-compaction",
              ],
            },
            {
              type: "category",
              label: "Work Board",
              items: [
                "architecture/agent/workboard/index",
                "architecture/agent/workboard/delegated-execution",
                "architecture/agent/workboard/durable-work-state",
              ],
            },
            "architecture/agent/system-prompt",
            "architecture/agent/multi-agent-routing",
            "architecture/agent/agent-loop",
          ],
        },
        {
          type: "category",
          label: "Protocol",
          items: [
            {
              type: "doc",
              id: "architecture/protocol/index",
              label: "Overview",
            },
            "architecture/protocol/api-surfaces",
            "architecture/protocol/contracts",
            "architecture/protocol/handshake",
            "architecture/protocol/requests-responses",
            "architecture/protocol/events",
          ],
        },
        {
          type: "category",
          label: "Client",
          items: [
            {
              type: "doc",
              id: "architecture/client/index",
              label: "Overview",
            },
            "architecture/client/identity",
            "architecture/client/presence",
          ],
        },
        {
          type: "category",
          label: "Node",
          items: [
            {
              type: "doc",
              id: "architecture/node/index",
              label: "Overview",
            },
            "architecture/node/capabilities",
          ],
        },
        {
          type: "category",
          label: "Scaling & HA",
          items: [
            {
              type: "doc",
              id: "architecture/scaling-ha/index",
              label: "Overview",
            },
            "architecture/scaling-ha/backplane",
            "architecture/scaling-ha/data-lifecycle",
            "architecture/scaling-ha/statestore-dialects",
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
        {
          type: "category",
          label: "Supporting References",
          items: ["architecture/reference/doc-templates", "architecture/reference/glossary"],
        },
      ],
    },
  ],
};

export default sidebars;
