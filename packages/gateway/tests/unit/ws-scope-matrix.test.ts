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

  it("maps workflow + chat session operations to operator.write", () => {
    expect(resolveWsRequestRequiredScopes("chat.session.send")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("chat.session.create")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("chat.session.delete")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.run")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.resume")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.cancel")).toEqual(["operator.write"]);
  });

  it("maps chat session list/get operations to operator.read", () => {
    expect(resolveWsRequestRequiredScopes("chat.session.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("chat.session.get")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("chat.session.reconnect")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("run.list")).toEqual(["operator.read"]);
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
