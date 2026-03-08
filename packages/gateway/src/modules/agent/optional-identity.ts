import type { IdentityPack as IdentityPackT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { AgentIdentityDal } from "./identity-dal.js";

export async function loadOptionalIdentity(params: {
  db: SqlDb;
  tenantId: string;
  agentId: string;
}): Promise<IdentityPackT | undefined> {
  try {
    const revision = await new AgentIdentityDal(params.db).getLatest({
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    return revision?.identity;
  } catch {
    // Intentional: callers use this helper when identity metadata is optional.
    return undefined;
  }
}
