/**
 * WebSocket per-request scope authorization matrix.
 *
 * Mirrors the HTTP deny-by-default posture for scoped (device) tokens.
 * Admin tokens are treated as break-glass and bypass scope enforcement.
 */

export function resolveWsRequestRequiredScopes(type: string): string[] | null {
  switch (type) {
    case "approval.list":
    case "approval.resolve": {
      return ["operator.approvals"];
    }
    case "pairing.approve":
    case "pairing.deny":
    case "pairing.revoke": {
      return ["operator.pairing"];
    }
    case "command.execute": {
      return ["operator.admin"];
    }
    case "session.send":
    case "workflow.run":
    case "workflow.resume":
    case "workflow.cancel": {
      return ["operator.write"];
    }
    case "presence.beacon": {
      return [];
    }
    case "ping": {
      return [];
    }
    default: {
      return null;
    }
  }
}
