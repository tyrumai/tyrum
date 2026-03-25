import { describe, expect, it } from "vitest";
import { resolveWsRequestRequiredScopes } from "../../src/modules/authz/ws-scope-matrix.js";

describe("WS scope authorization matrix", () => {
  it("maps approval reads to operator.read and approval resolution to operator.approvals", () => {
    expect(resolveWsRequestRequiredScopes("approval.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("approval.resolve")).toEqual(["operator.approvals"]);
  });

  it("maps pairing resolution operations to operator.pairing", () => {
    expect(resolveWsRequestRequiredScopes("pairing.approve")).toEqual(["operator.pairing"]);
    expect(resolveWsRequestRequiredScopes("pairing.deny")).toEqual(["operator.pairing"]);
    expect(resolveWsRequestRequiredScopes("pairing.revoke")).toEqual(["operator.pairing"]);
  });

  it("maps command execution to operator.admin", () => {
    expect(resolveWsRequestRequiredScopes("command.execute")).toEqual(["operator.admin"]);
  });

  it("maps workflow + conversation operations to operator.write", () => {
    expect(resolveWsRequestRequiredScopes("conversation.send")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("conversation.create")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("conversation.delete")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("conversation.queue_mode.set")).toEqual([
      "operator.write",
    ]);
    expect(resolveWsRequestRequiredScopes("workflow.start")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.resume")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.cancel")).toEqual(["operator.write"]);
  });

  it("maps conversation list/get operations to operator.read", () => {
    expect(resolveWsRequestRequiredScopes("conversation.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("conversation.get")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("conversation.reconnect")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("turn.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("transcript.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("transcript.get")).toEqual(["operator.read"]);
  });

  it("allows presence.beacon without additional scopes", () => {
    expect(resolveWsRequestRequiredScopes("presence.beacon")).toEqual([]);
  });

  it("allows ping without additional scopes", () => {
    expect(resolveWsRequestRequiredScopes("ping")).toEqual([]);
  });

  it("denies unknown request types by default", () => {
    expect(resolveWsRequestRequiredScopes("unknown.type")).toBeNull();
  });
});
