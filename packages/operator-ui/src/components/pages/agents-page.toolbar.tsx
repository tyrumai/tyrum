import type { TranscriptConversationSummary } from "@tyrum/contracts";
import { Plus, RefreshCw } from "lucide-react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Select } from "../ui/select.js";
import { formatConversationLabel } from "./agents-page.lib.js";

export function AgentsPageToolbarActions(props: {
  selectedAgentRoots: readonly TranscriptConversationSummary[];
  activeRootConversationKey: string | null;
  selectedAgentKey: string;
  renderMode: "markdown" | "text";
  isConnected: boolean;
  isRefreshing: boolean;
  onSelectRoot: (input: { agentKey: string; rootConversationKey: string }) => void;
  onSelectRenderMode: (mode: "markdown" | "text") => void;
  onRefresh: () => void;
  onCreateAgent: () => void;
}) {
  const {
    selectedAgentRoots,
    activeRootConversationKey,
    selectedAgentKey,
    renderMode,
    isConnected,
    isRefreshing,
    onSelectRoot,
    onSelectRenderMode,
    onRefresh,
    onCreateAgent,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedAgentRoots.length > 1 ? (
        <div className="min-w-[15rem] max-w-[22rem]">
          <Select
            bare
            data-testid="agents-root-picker"
            value={activeRootConversationKey ?? ""}
            onChange={(event) => {
              onSelectRoot({
                agentKey: selectedAgentKey,
                rootConversationKey: event.target.value,
              });
            }}
          >
            {selectedAgentRoots.map((root) => (
              <option key={root.conversation_key} value={root.conversation_key}>
                {formatConversationLabel(root)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={renderMode === "markdown" ? "secondary" : "outline"}
        onClick={() => {
          onSelectRenderMode("markdown");
        }}
      >
        Markdown
      </Button>
      <Button
        type="button"
        size="sm"
        variant={renderMode === "text" ? "secondary" : "outline"}
        onClick={() => {
          onSelectRenderMode("text");
        }}
      >
        Plain text
      </Button>
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
