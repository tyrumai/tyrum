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
    expect(resolveWsRequestRequiredScopes("session.create")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("session.compact")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("session.delete")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.run")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.resume")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("workflow.cancel")).toEqual(["operator.write"]);
  });

  it("maps session list/get operations to operator.read", () => {
    expect(resolveWsRequestRequiredScopes("session.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("session.get")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("run.list")).toEqual(["operator.read"]);
  });

  it("maps memory v1 operations to operator.read/operator.write", () => {
    expect(resolveWsRequestRequiredScopes("memory.search")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("memory.list")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("memory.get")).toEqual(["operator.read"]);
    expect(resolveWsRequestRequiredScopes("memory.create")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("memory.update")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("memory.delete")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("memory.forget")).toEqual(["operator.write"]);
    expect(resolveWsRequestRequiredScopes("memory.export")).toEqual(["operator.write"]);
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
