import type { MemoryItem } from "@tyrum/client";
import { Trash2 } from "lucide-react";
import {
  MEMORY_SENSITIVITIES,
  type MemorySensitivity,
  stringifyJson,
} from "./memory-inspector.shared.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { Textarea } from "../ui/textarea.js";

export interface MemoryDetailPanelProps {
  item: MemoryItem | null;
  loading: boolean;
  errorMessage: string | null;
  tagsDraft: string;
  onTagsDraftChange: (value: string) => void;
  sensitivityDraft: MemorySensitivity;
  onSensitivityDraftChange: (value: MemorySensitivity) => void;
  bodyMdDraft: string;
  onBodyMdDraftChange: (value: string) => void;
  summaryMdDraft: string;
  onSummaryMdDraftChange: (value: string) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onForget: () => void;
}

export function MemoryDetailPanel({
  item,
  loading,
  errorMessage,
  tagsDraft,
  onTagsDraftChange,
  sensitivityDraft,
  onSensitivityDraftChange,
  bodyMdDraft,
  onBodyMdDraftChange,
  summaryMdDraft,
  onSummaryMdDraftChange,
  saving,
  saveError,
  onSave,
  onForget,
}: MemoryDetailPanelProps) {
  return (
    <div data-testid="memory-detail">
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5" />
          </CardContent>
        </Card>
      ) : null}
      {errorMessage ? (
        <Alert
          variant="error"
          title="Error loading item"
          description={errorMessage}
          data-testid="memory-inspect-error"
        />
      ) : null}
      {item ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{item.kind}</Badge>
              <span className="font-mono text-xs text-fg-muted break-all">
                {item.memory_item_id}
              </span>
            </div>

            {item.kind === "fact" ? (
              <div className="grid gap-1">
                <div className="text-xs font-medium text-fg-muted">Key</div>
                <div
                  data-testid="memory-detail-fact-key"
                  className="break-words text-sm font-medium text-fg [overflow-wrap:anywhere]"
                >
                  {item.key}
                </div>
                <pre
                  data-testid="memory-detail-fact-value"
                  className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-bg-subtle p-3 text-xs text-fg [overflow-wrap:anywhere]"
                >
                  {stringifyJson(item.value)}
                </pre>
              </div>
            ) : null}

            <Input
              data-testid="memory-edit-tags"
              label="Tags"
              value={tagsDraft}
              onChange={(event) => {
                onTagsDraftChange(event.currentTarget.value);
              }}
              placeholder="comma-separated"
            />

            <div className="grid gap-2">
              <Label htmlFor="memory-edit-sensitivity">Sensitivity</Label>
              <select
                id="memory-edit-sensitivity"
                data-testid="memory-edit-sensitivity"
                value={sensitivityDraft}
                onChange={(event) => {
                  onSensitivityDraftChange(event.currentTarget.value as MemorySensitivity);
                }}
                className="flex h-9 w-full rounded-lg border border-border bg-bg px-3 py-1 text-sm text-fg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
              >
                {MEMORY_SENSITIVITIES.map((sensitivity) => (
                  <option key={sensitivity} value={sensitivity}>
                    {sensitivity}
                  </option>
                ))}
              </select>
            </div>

            {item.kind === "note" || item.kind === "procedure" ? (
              <Textarea
                data-testid="memory-edit-body"
                label="Body"
                value={bodyMdDraft}
                disabled={saving}
                onChange={(event) => {
                  onBodyMdDraftChange(event.currentTarget.value);
                }}
              />
            ) : null}

            {item.kind === "episode" ? (
              <Textarea
                data-testid="memory-edit-summary"
                label="Summary"
                value={summaryMdDraft}
                disabled={saving}
                onChange={(event) => {
                  onSummaryMdDraftChange(event.currentTarget.value);
                }}
              />
            ) : null}

            {saveError ? (
              <Alert
                variant="error"
                title="Save failed"
                description={saveError}
                data-testid="memory-save-error"
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                data-testid="memory-save"
                disabled={saving}
                isLoading={saving}
                onClick={onSave}
              >
                Save
              </Button>
              <Button size="sm" variant="danger" data-testid="memory-forget" onClick={onForget}>
                <Trash2 className="h-3.5 w-3.5" />
                Forget
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        !loading &&
        !errorMessage && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-fg-muted">
              Select a memory item to view details.
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
