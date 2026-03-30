import { Plus, RefreshCw } from "lucide-react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";

export function AgentsPageToolbarActions(props: {
  isConnected: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreateAgent: () => void;
}) {
  const { isConnected, isRefreshing, onRefresh, onCreateAgent } = props;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="agents-refresh"
        disabled={!isConnected || isRefreshing}
        isLoading={isRefreshing}
        onClick={onRefresh}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </Button>
      <Button
        type="button"
        size="sm"
        data-testid="agents-new"
        disabled={!isConnected}
        onClick={onCreateAgent}
      >
        <Plus className="h-3.5 w-3.5" />
        New agent
      </Button>
    </div>
  );
}

export function StopSubagentErrorBanner(props: { error: unknown }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <Alert
        variant="error"
        title="Unable to stop subagent"
        description={formatErrorMessage(props.error)}
      />
    </div>
  );
}
