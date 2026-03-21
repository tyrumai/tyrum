import { useState } from "react";
import { toast } from "sonner";
import { isRecord } from "../../../utils/is-record.js";
import { Button } from "../../ui/button.js";
import { StructuredValue } from "../../ui/structured-value.js";
import type { CapabilityTestAction } from "./node-config-page.types.js";

// ─── Base64 truncation (matches browser-capabilities-page pattern) ──────────

function summarizeResult(result: unknown): unknown {
  if (!isRecord(result)) return result;

  const rec = { ...result };

  // Truncate top-level base64 fields.
  const bytesBase64 = rec["bytesBase64"];
  if (typeof bytesBase64 === "string") {
    rec["bytesBase64"] = `[omitted ${String(bytesBase64.length)} chars]`;
    rec["bytes_omitted"] = true;
  }

  // Also check nested evidence object.
  const evidence = rec["evidence"];
  if (isRecord(evidence)) {
    const evidenceCopy = { ...evidence };
    const nestedBase64 = evidenceCopy["bytesBase64"];
    if (typeof nestedBase64 === "string") {
      evidenceCopy["bytesBase64"] = `[omitted ${String(nestedBase64.length)} chars]`;
      evidenceCopy["bytes_omitted"] = true;
    }
    rec["evidence"] = evidenceCopy;
  }

  return rec;
}

// ─── TestActionsPanel ───────────────────────────────────────────────────────

export interface TestActionsPanelProps {
  testActions: CapabilityTestAction[];
}

export function TestActionsPanel({ testActions }: TestActionsPanelProps) {
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const runTest = async (action: CapabilityTestAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setActiveAction(action.actionName);

    try {
      const rawResult = await action.onRun();
      setResult(rawResult ?? null);

      if (isRecord(rawResult) && rawResult["success"] === true) {
        toast.success("Test action succeeded");
      } else if (isRecord(rawResult) && rawResult["success"] === false) {
        const errorMsg =
          typeof rawResult["error"] === "string" ? rawResult["error"] : "Test action failed";
        toast.error(errorMsg);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Test action failed";
      toast.error(message);
      setResult({ error: message });
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  };

  const summarized = result !== null ? summarizeResult(result) : null;

  return (
    <div className="grid gap-3">
      <div className="text-sm font-semibold text-fg">Test actions</div>
      <div className="flex flex-wrap gap-2">
        {testActions.map((action) => {
          const isActive = activeAction === action.actionName;
          return (
            <Button
              key={action.actionName}
              variant="outline"
              size="sm"
              isLoading={isActive}
              disabled={!action.available || busy}
              onClick={() => {
                void runTest(action);
              }}
            >
              {action.label}
            </Button>
          );
        })}
      </div>

      {summarized !== null ? <StructuredValue value={summarized} /> : null}
    </div>
  );
}
