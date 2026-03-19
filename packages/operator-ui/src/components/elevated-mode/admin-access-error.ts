import { ElevatedModeRequiredError } from "@tyrum/operator-app";
import { isRecord } from "../../utils/is-record.js";

export function isAdminAccessRequiredError(error: unknown): boolean {
  if (error instanceof ElevatedModeRequiredError) {
    return true;
  }
  if (!isRecord(error)) {
    return false;
  }
  return error["code"] === "elevated_mode_required";
}
