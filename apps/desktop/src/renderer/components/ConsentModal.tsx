import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@tyrum/operator-ui";

interface ConsentRequest {
  requestId: string;
  context: string;
}

export function ConsentModal() {
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

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

      const prompt =
        typeof r.payload?.prompt === "string" ? r.payload.prompt : "Approval requested";
      const planId = typeof r.payload?.plan_id === "string" ? r.payload.plan_id : undefined;
      const stepIndex =
        typeof r.payload?.step_index === "number" ? r.payload.step_index : undefined;
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
      if (reasonRef.current) {
        reasonRef.current.value = "";
      }
    });
    return unsubscribe;
  }, []);

  if (!request) return null;

  const respond = (approved: boolean) => {
    const api = window.tyrumDesktop;
    if (!api) return;
    const reason = reasonRef.current?.value ?? "";
    void api.consentRespond(request.requestId, approved, reason.length > 0 ? reason : undefined);
    setRequest(null);
    if (reasonRef.current) {
      reasonRef.current.value = "";
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="[&_[aria-label='Close']]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Action Requires Approval</DialogTitle>
          <DialogDescription>Review the request and choose Approve or Deny.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 max-h-56 overflow-y-auto rounded-md border border-border bg-bg-subtle p-3">
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">
            {request.context}
          </pre>
        </div>

        <div className="mt-4">
          <Textarea ref={reasonRef} placeholder="Reason (optional)" />
        </div>

        <DialogFooter>
          <Button variant="danger" onClick={() => respond(false)}>
            Deny
          </Button>
          <Button variant="success" onClick={() => respond(true)}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
