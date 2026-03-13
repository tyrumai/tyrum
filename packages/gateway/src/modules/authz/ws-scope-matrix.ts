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
    case "session.list":
    case "session.get": {
      return ["operator.read"];
    }
    case "run.list": {
      return ["operator.read"];
    }
    case "session.create":
    case "session.compact":
    case "session.delete": {
      return ["operator.write"];
    }
    case "work.list":
    case "work.get":
    case "subagent.list":
    case "subagent.get":
    case "work.artifact.list":
    case "work.artifact.get":
    case "work.link.list":
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
    case "work.link.create":
    case "subagent.spawn":
    case "subagent.send":
    case "subagent.close":
    case "work.artifact.create":
    case "work.decision.create":
    case "work.signal.create":
    case "work.signal.update":
    case "work.state_kv.set": {
      return ["operator.write"];
    }
    case "presence.beacon": {
      return [];
    }
    case "location.beacon": {
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
