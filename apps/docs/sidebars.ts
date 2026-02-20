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
      items: ["install", "getting-started"],
    },
    {
      type: "category",
      label: "Advanced",
      items: ["advanced/remote-gateway", "advanced/multi-node"],
    },
    {
      type: "category",
      label: "Reference",
      items: ["policy_service", "executors/http_executor", "executors/web_executor"],
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
          type: "category",
          label: "Runtime Components",
          items: [
            "architecture/gateway/index",
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
            "architecture/secrets",
            "architecture/artifacts",
          ],
        },
        {
          type: "category",
          label: "Protocol & Contracts",
          items: [
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
            "architecture/sessions-lanes",
            "architecture/context-compaction",
            "architecture/memory",
            "architecture/automation",
            "architecture/agent-loop",
            "architecture/sandbox-policy",
            "architecture/multi-agent-routing",
          ],
        },
        "architecture/glossary",
      ],
    },
  ],
};

export default sidebars;
