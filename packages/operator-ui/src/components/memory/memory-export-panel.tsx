import { Download } from "lucide-react";
import { getDesktopApi } from "../../desktop-api.js";
import { MemoryCheckboxField } from "./memory-checkbox-field.js";
import { Button } from "../ui/button.js";

export interface MemoryExportPanelProps {
  httpBaseUrl: string;
  includeTombstones: boolean;
  onIncludeTombstonesChange: (checked: boolean) => void;
  exportRunning: boolean;
  exportArtifactId: string | null;
  exportErrorMessage: string | null;
  downloadBusy: boolean;
  downloadError: string | null;
  onExport: () => void;
  onDownload: (artifactId: string) => void;
}

export function MemoryExportPanel({
  httpBaseUrl,
  includeTombstones,
  onIncludeTombstonesChange,
  exportRunning,
  exportArtifactId,
  exportErrorMessage,
  downloadBusy,
  downloadError,
  onExport,
  onDownload,
}: MemoryExportPanelProps) {
  const api = getDesktopApi();
  const canDownloadDesktop =
    Boolean(api?.gateway.httpFetch) && Boolean(api?.gateway.getOperatorConnection);
  const downloadUrl = exportArtifactId
    ? `${httpBaseUrl.replace(/\/$/, "")}/memory/exports/${exportArtifactId}`
    : null;

  return (
    <div data-testid="memory-export-panel" className="flex flex-wrap items-center gap-3">
      <MemoryCheckboxField
        id="memory-include-tombstones"
        label="Include tombstones"
        checked={includeTombstones}
        onCheckedChange={onIncludeTombstonesChange}
      />
      <Button
        size="sm"
        variant="secondary"
        data-testid="memory-export"
        disabled={exportRunning}
        isLoading={exportRunning}
        onClick={onExport}
      >
        Export
      </Button>
      {exportArtifactId ? (
        canDownloadDesktop ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="memory-export-download"
            disabled={downloadBusy}
            isLoading={downloadBusy}
            onClick={() => {
              onDownload(exportArtifactId);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        ) : (
          <Button size="sm" variant="secondary" asChild>
            <a data-testid="memory-export-download" href={downloadUrl ?? undefined}>
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        )
      ) : null}
      {downloadError ? (
        <span
          className="text-xs text-error"
          role="alert"
          data-testid="memory-export-download-error"
        >
          {downloadError}
        </span>
      ) : null}
      {exportErrorMessage ? (
        <span className="text-xs text-error" role="alert" data-testid="memory-export-error">
          {exportErrorMessage}
        </span>
      ) : null}
    </div>
  );
}
