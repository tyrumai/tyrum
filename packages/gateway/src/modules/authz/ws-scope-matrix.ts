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
    case "work.list":
    case "work.get":
    case "work.artifact.list":
    case "work.artifact.get":
    case "work.decision.list":
    case "work.decision.get":
    case "work.signal.list":
    case "work.signal.get":
    case "work.state_kv.get":
    case "work.state_kv.list": {
      return ["operator.read"];
    }
    case "work.create":
    case "work.update":
    case "work.transition":
    case "work.artifact.create":
    case "work.decision.create":
    case "work.signal.create":
    case "work.signal.update":
    case "work.state_kv.set": {
    case "memory.search":
    case "memory.list":
    case "memory.get": {
      return ["operator.read"];
    }
    case "memory.create":
    case "memory.update":
    case "memory.delete":
    case "memory.forget":
    case "memory.export": {
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
