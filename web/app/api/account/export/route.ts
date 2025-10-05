import { buildAuditTaskResponse } from "../shared";

export async function POST() {
  return buildAuditTaskResponse("export");
}
