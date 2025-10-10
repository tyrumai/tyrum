import { computePortalSessionTokenFromSecret } from "../../../lib/portal-auth";

const TEST_SESSION_SECRET = "integration-portal-session-secret";
const SUCCESS_TOKEN =
  computePortalSessionTokenFromSecret(TEST_SESSION_SECRET);

export const VERIFICATION_TOKEN_FIXTURES = {
  secret: TEST_SESSION_SECRET,
  success: SUCCESS_TOKEN,
  invalid: `${SUCCESS_TOKEN}-invalid`,
} as const;
