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
          type: "doc",
          id: "architecture/scaling-ha",
          label: "Scaling & HA",
        },
        {
          type: "doc",
          id: "architecture/backplane",
          label: "Backplane",
        },
        {
          type: "category",
          label: "Runtime Components",
          items: [
            "architecture/gateway/index",
            "architecture/gateway/statestore-dialects",
            "architecture/gateway/postgres-json-fields",
            "architecture/data-model-map",
            "architecture/data-model-fk-audit",
            "architecture/db-naming-conventions",
            "architecture/db-enum-constraints",
            "architecture/db-json-hygiene",
            "architecture/client",
            "architecture/node",
          ],
        },
        {
          type: "category",
          label: "Execution & Guardrails",
          items: [
            "architecture/execution-engine",
            "architecture/playbooks",
            "architecture/approvals",
            "architecture/policy-overrides",
            "architecture/secrets",
            "architecture/auth",
            "architecture/artifacts",
            "architecture/data-lifecycle",
          ],
        },
        {
          type: "category",
          label: "Protocol & Contracts",
          items: [
            "architecture/api-surfaces",
            "architecture/protocol/index",
            "architecture/protocol/handshake",
            "architecture/protocol/requests-responses",
            "architecture/protocol/events",
            "architecture/contracts",
          ],
        },
        {
          type: "category",
          label: "Extensibility",
          items: [
            "architecture/capabilities",
            "architecture/tools",
            "architecture/plugins",
            "architecture/skills",
            "architecture/slash-commands",
          ],
        },
        {
          type: "category",
          label: "Agent Runtime Concepts",
          items: [
            "architecture/agent",
            "architecture/identity",
            "architecture/workspace",
            "architecture/system-prompt",
            "architecture/models",
            "architecture/channels",
            "architecture/messages-sessions",
            "architecture/markdown-formatting",
            "architecture/sessions-lanes",
            "architecture/context-compaction",
            "architecture/memory",
            "architecture/workboard",
            "architecture/automation",
            "architecture/agent-loop",
            "architecture/sandbox-policy",
            "architecture/multi-agent-routing",
          ],
        },
        {
          type: "category",
          label: "Operations & Observability",
          items: [
            "architecture/operational-maintenance",
            "architecture/observability",
            "architecture/index-tuning",
            "architecture/presence",
          ],
        },
        "architecture/glossary",
      ],
    },
  ],
};

export default sidebars;
