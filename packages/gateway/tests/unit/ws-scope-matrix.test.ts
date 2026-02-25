import { describe, expect, it } from "vitest";
import { resolveWsRequestRequiredScopes } from "../../src/modules/authz/ws-scope-matrix.js";

describe("WS scope authorization matrix", () => {
  it("maps approval control-plane operations to operator.approvals", () => {
    expect(resolveWsRequestRequiredScopes("approval.list")).toEqual(["operator.approvals"]);
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

  it("maps workflow + session operations to operator.write", () => {
    expect(resolveWsRequestRequiredScopes("session.send")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.run")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.resume")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.cancel")).toEqual(["operator.write"]);
  });

  it("allows presence.beacon without additional scopes", () => {
    expect(resolveWsRequestRequiredScopes("presence.beacon")).toEqual([]);
  });

  it("denies unknown request types by default", () => {
    expect(resolveWsRequestRequiredScopes("unknown.type")).toBeNull();
  });
});
