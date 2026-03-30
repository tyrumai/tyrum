import type { TranscriptConversationSummary } from "@tyrum/contracts";
import { Bot, Square } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { formatSubagentLabel, subagentStatusVariant } from "./agents-page.lib.js";
import { formatConversationTitle } from "./transcripts-page.lib.js";

export function ConversationTreeRow(props: {
  conversation: TranscriptConversationSummary;
  depth: number;
  selected: boolean;
  showStop: boolean;
  stopping: boolean;
  onSelect: () => void;
  onStop: () => void;
}) {
  const { conversation, depth, selected, showStop, stopping, onSelect, onStop } = props;
  const title = conversation.subagent_id
    ? formatSubagentLabel(conversation)
    : formatConversationTitle(conversation);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors",
        selected
          ? "border-primary/60 bg-primary-dim/20"
          : "border-transparent bg-bg hover:border-border hover:bg-bg-subtle/60",
      )}
      style={{ marginLeft: `${depth * 18}px` }}
    >
      <button
        type="button"
        data-testid={`agents-conversation-${conversation.conversation_key}`}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={onSelect}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-subtle text-fg-muted">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg" title={title}>
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>{conversation.channel}</span>
            {conversation.subagent_status ? (
              <Badge variant={subagentStatusVariant(conversation.subagent_status)}>
                {conversation.subagent_status}
              </Badge>
            ) : null}
          </div>
        </div>
      </button>
      {showStop ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={`agents-stop-${conversation.subagent_id ?? conversation.conversation_key}`}
          className="h-8 shrink-0 px-2 text-error hover:text-error"
          disabled={!conversation.subagent_id || stopping}
          isLoading={stopping}
          onClick={(event) => {
            event.stopPropagation();
            onStop();
          }}
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          Stop
        </Button>
      ) : null}
    </div>
  );
}
