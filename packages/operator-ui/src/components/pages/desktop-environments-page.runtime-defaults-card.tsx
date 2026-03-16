import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";

export function RuntimeDefaultsCard({
  isSupported,
  currentDefaultImageRef,
  draftDefaultImageRef,
  draftReason,
  isLoading,
  isRefreshing,
  loadError,
  saveError,
  onDefaultImageRefChange,
  onReasonChange,
  onSave,
}: {
  isSupported: boolean;
  currentDefaultImageRef: string;
  draftDefaultImageRef: string;
  draftReason: string;
  isLoading: boolean;
  isRefreshing: boolean;
  loadError: string | null;
  saveError: string | null;
  onDefaultImageRefChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="text-sm font-medium text-fg">Runtime defaults</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!isSupported ? (
          <Alert
            variant="info"
            title="Runtime defaults are not available on this gateway"
            description="New environments will use the built-in desktop sandbox image fallback until the gateway is upgraded."
          />
        ) : null}
        {loadError ? (
          <Alert variant="error" title="Failed to load runtime defaults" description={loadError} />
        ) : null}
        {saveError ? (
          <Alert variant="error" title="Failed to save runtime defaults" description={saveError} />
        ) : null}
        <Input
          label="Default image ref"
          value={draftDefaultImageRef}
          onChange={(event) => {
            onDefaultImageRefChange(event.target.value);
          }}
          helperText={`Current default: ${currentDefaultImageRef}`}
          disabled={!isSupported || isLoading || isRefreshing}
          data-testid="desktop-environments-default-image-input"
        />
        <Input
          label="Reason"
          value={draftReason}
          onChange={(event) => {
            onReasonChange(event.target.value);
          }}
          placeholder="Explain why the default changed"
          disabled={!isSupported || isLoading || isRefreshing}
          data-testid="desktop-environments-default-image-reason-input"
        />
        <Button
          variant="outline"
          disabled={
            !isSupported || isLoading || isRefreshing || draftDefaultImageRef.trim().length === 0
          }
          isLoading={isLoading}
          onClick={onSave}
          data-testid="desktop-environments-default-image-save-button"
        >
          Save default
        </Button>
      </CardContent>
    </Card>
  );
}
