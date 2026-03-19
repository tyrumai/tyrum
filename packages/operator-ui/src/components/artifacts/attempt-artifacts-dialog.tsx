import type { ExecutionAttempt } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import { useState } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { ArtifactInlinePreview } from "./artifact-inline-preview.js";

type ArtifactRef = ExecutionAttempt["artifacts"][number];

export function AttemptArtifactsDialog({
  core,
  attemptId,
  artifacts,
}: {
  core: OperatorCore;
  attemptId: string;
  artifacts: ArtifactRef[];
}) {
  const [open, setOpen] = useState(false);

  if (artifacts.length === 0) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid={`attempt-artifacts-${attemptId}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Artifacts ({artifacts.length})
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid={`attempt-artifacts-dialog-${attemptId}`} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Artifacts</DialogTitle>
            <DialogDescription>Desktop evidence captured during this attempt.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            {artifacts.map((artifact) => (
              <div
                key={artifact.artifact_id}
                className="grid gap-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{artifact.kind}</Badge>
                    {artifact.labels?.slice(0, 4).map((label) => (
                      <Badge key={label} variant="outline">
                        {label}
                      </Badge>
                    ))}
                  </div>
                  <code className="text-xs text-fg-muted">{artifact.artifact_id}</code>
                </div>
                <ArtifactInlinePreview core={core} artifact={artifact} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
