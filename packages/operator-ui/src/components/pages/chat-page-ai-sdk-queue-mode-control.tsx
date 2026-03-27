import { QueueMode, type QueueMode as QueueModeT } from "@tyrum/contracts";
import { Info } from "lucide-react";
import { Select } from "../ui/select.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";

interface QueueModeOption {
  readonly value: QueueModeT;
  readonly label: string;
  readonly description: string;
}

const QUEUE_MODE_OPTIONS: ReadonlyArray<QueueModeOption> = [
  {
    value: "steer",
    label: "Steer",
    description: "Inject message into the active turn and cancel pending tool calls",
  },
  {
    value: "steer_backlog",
    label: "Steer + backlog",
    description: "Steer the active turn and keep the message queued for the next turn",
  },
  {
    value: "followup",
    label: "Follow-up",
    description: "Queue each message as a separate follow-up turn after the current one finishes",
  },
  {
    value: "collect",
    label: "Collect",
    description: "Batch messages during a debounce window and process them together",
  },
  {
    value: "interrupt",
    label: "Interrupt",
    description:
      "Abort the active turn, discard other queued messages, and process only this message",
  },
];

export interface ChatQueueModeControlProps {
  id: string;
  value: QueueModeT;
  disabled: boolean;
  onChange: (next: QueueModeT) => void;
}

export function ChatQueueModeControl({ id, value, disabled, onChange }: ChatQueueModeControlProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-subtle/40 px-2 py-1">
      <label
        htmlFor={id}
        className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted"
      >
        Queue
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                className="inline h-3 w-3 cursor-help text-fg-muted/70"
                aria-label="Queue mode help"
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs space-y-1 text-xs">
              <p className="font-medium">
                How new messages are handled while the agent is mid-turn:
              </p>
              {QUEUE_MODE_OPTIONS.map((option) => (
                <p key={option.value}>
                  <span className="font-medium">{option.label}</span>
                  {" \u2014 "}
                  {option.description}
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </label>
      <Select
        id={id}
        bare
        className="h-8 min-w-[10rem] border-0 bg-transparent px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
        data-testid="ai-sdk-chat-queue-mode"
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const parsed = QueueMode.safeParse(event.currentTarget.value);
          if (parsed.success) {
            onChange(parsed.data);
          }
        }}
      >
        {QUEUE_MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} title={option.description}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
