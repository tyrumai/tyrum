import { useEffect, useState } from "react";

interface ConsentRequest {
  requestId: string;
  context: string;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  padding: 24,
  maxWidth: 480,
  width: "90%",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 12,
  color: "#1a1a2e",
};

const contextStyle: React.CSSProperties = {
  background: "#f5f5f7",
  borderRadius: 6,
  padding: 12,
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  marginBottom: 16,
  maxHeight: 200,
  overflowY: "auto",
  border: "1px solid #e0e0e5",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 60,
  borderRadius: 6,
  border: "1px solid #d0d0d5",
  padding: 8,
  fontSize: 13,
  fontFamily: "inherit",
  resize: "vertical",
  marginBottom: 16,
  boxSizing: "border-box",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
};

function buttonStyle(variant: "approve" | "deny"): React.CSSProperties {
  return {
    padding: "8px 20px",
    borderRadius: 6,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    background: variant === "approve" ? "#22c55e" : "#ef4444",
    color: "#ffffff",
  };
}

export function ConsentModal() {
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    const unsubscribe = api.onConsentRequest((req) => {
      const r = req as {
        request_id?: unknown;
        payload?: { prompt?: unknown; context?: unknown; plan_id?: unknown; step_index?: unknown };
      };

      const requestId = typeof r.request_id === "string" ? r.request_id : null;
      if (!requestId) return;

      const prompt = typeof r.payload?.prompt === "string" ? r.payload.prompt : "Approval requested";
      const planId = typeof r.payload?.plan_id === "string" ? r.payload.plan_id : undefined;
      const stepIndex = typeof r.payload?.step_index === "number" ? r.payload.step_index : undefined;
      const contextValue = r.payload?.context;
      const contextText =
        typeof contextValue === "string"
          ? contextValue
          : contextValue === undefined
            ? ""
            : JSON.stringify(contextValue, null, 2);

      const headerParts = [
        prompt,
        planId ? `plan: ${planId}` : null,
        typeof stepIndex === "number" ? `step: ${stepIndex}` : null,
      ].filter(Boolean);

      setRequest({
        requestId,
        context: `${headerParts.join(" · ")}\n\n${contextText}`.trim(),
      });
      setReason("");
    });
    return unsubscribe;
  }, []);

  if (!request) return null;

  const respond = (approved: boolean) => {
    const api = window.tyrumDesktop;
    if (!api) return;
    void api.consentRespond(
      request.requestId,
      approved,
      reason || undefined,
    );
    setRequest(null);
    setReason("");
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={titleStyle}>Action Requires Approval</div>
        <div style={contextStyle}>{request.context}</div>
        <textarea
          style={textareaStyle}
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div style={buttonRowStyle}>
          <button style={buttonStyle("deny")} onClick={() => respond(false)}>
            Deny
          </button>
          <button
            style={buttonStyle("approve")}
            onClick={() => respond(true)}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
