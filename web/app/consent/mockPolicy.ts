export type PolicyDecisionStatus = "approved" | "denied" | "escalated";

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  reason: string;
  evidence: string;
}

/**
 * requestConsentApproval simulates a policy decision by returning
 * a mocked approval payload. The promise timing matches a network
 * round-trip so the UX can show progress states without waiting
 * on real services yet.
 */
export async function requestConsentApproval(): Promise<PolicyDecision> {
  await new Promise((resolve) => setTimeout(resolve, 120));

  return {
    status: "approved",
    reason: "Planned spend sits within budget guardrails and vendor scope.",
    evidence: "policy-mock-001",
  };
}
