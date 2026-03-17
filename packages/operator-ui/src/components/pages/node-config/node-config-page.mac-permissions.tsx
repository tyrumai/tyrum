import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";

export interface MacPermissionsContentProps {
  apiAvailable: boolean;
  summary: string | null;
  checking: boolean;
  requestingPermission: "accessibility" | "screenRecording" | null;
  errorMessage: string | null;
  onCheck: () => void;
  onRequest: (permission: "accessibility" | "screenRecording") => void;
}

export function MacPermissionsContent(props: MacPermissionsContentProps) {
  return (
    <div className="grid gap-4">
      <div className="text-sm font-semibold text-fg">macOS permissions</div>
      <div className="text-sm text-fg-muted">
        Desktop automation may require Accessibility and Screen Recording permissions on macOS.
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!props.apiAvailable || props.checking || props.requestingPermission !== null}
          isLoading={props.checking}
          onClick={props.onCheck}
        >
          {props.checking ? "Checking..." : "Check permissions"}
        </Button>
        <Button
          variant="secondary"
          disabled={!props.apiAvailable || props.requestingPermission !== null}
          isLoading={props.requestingPermission === "accessibility"}
          onClick={() => props.onRequest("accessibility")}
        >
          {props.requestingPermission === "accessibility"
            ? "Requesting..."
            : "Request Accessibility"}
        </Button>
        <Button
          variant="secondary"
          disabled={!props.apiAvailable || props.requestingPermission !== null}
          isLoading={props.requestingPermission === "screenRecording"}
          onClick={() => props.onRequest("screenRecording")}
        >
          {props.requestingPermission === "screenRecording"
            ? "Opening..."
            : "Request Screen Recording"}
        </Button>
      </div>
      {props.summary ? <div className="text-sm text-fg">{props.summary}</div> : null}
      {props.errorMessage ? (
        <Alert variant="error" title="Permission request failed" description={props.errorMessage} />
      ) : null}
    </div>
  );
}
