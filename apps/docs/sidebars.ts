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
        {
          type: "category",
          label: "Decisions (ADRs)",
          items: [
            "architecture/decisions/index",
            "architecture/decisions/adr-0001-deployment-topology",
            "architecture/decisions/adr-0002-statestore-backends",
            "architecture/decisions/adr-0003-backplane-and-ws-routing",
            "architecture/decisions/adr-0004-execution-engine-coordination",
            "architecture/decisions/adr-0005-playbook-dsl",
            "architecture/decisions/adr-0006-approvals",
            "architecture/decisions/adr-0007-secrets",
            "architecture/decisions/adr-0008-artifacts",
            "architecture/decisions/adr-0009-security-model",
            "architecture/decisions/adr-0010-observability-and-cost",
            "architecture/decisions/adr-0011-control-panel-ux",
            "architecture/decisions/adr-0012-multi-agent-routing",
            "architecture/decisions/adr-0013-ha-failover-testing",
          ],
        },
        "architecture/gaps",
        "architecture/glossary",
      ],
    },
  ],
};

export default sidebars;
