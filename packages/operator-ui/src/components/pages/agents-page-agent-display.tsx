import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { StatusDot } from "../ui/status-dot.js";

export type AgentOption = {
  agentKey: string;
  agentId: string;
  canDelete: boolean;
  displayName: string;
};

function hashAgentKey(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const AVATAR_VARIANT_CLASSES = [
  "border-primary/25 bg-primary-dim text-primary",
  "border-success/25 bg-success/10 text-success",
  "border-warning/25 bg-warning/10 text-warning",
  "border-error/25 bg-error/10 text-error",
  "border-border bg-bg-subtle text-fg-muted",
] as const;

function getAvatarInitial(displayName: string): string {
  const initial = displayName.trim().match(/[A-Za-z0-9]/)?.[0];
  return initial ? initial.toUpperCase() : "?";
}

function getAvatarVariant(agentKey: string): number {
  return hashAgentKey(agentKey) % AVATAR_VARIANT_CLASSES.length;
}

function getAvatarPattern(agentKey: string): string {
  return hashAgentKey(`${agentKey}:pattern`).toString(16).padStart(8, "0");
}

export function AgentAvatar({
  agentKey,
  displayName,
  className,
  testId,
}: {
  agentKey: string;
  displayName: string;
  className?: string;
  testId?: string;
}) {
  const variant = getAvatarVariant(agentKey);
  const pattern = getAvatarPattern(agentKey);
  const patternBits = Array.from(
    { length: 6 },
    (_value, index) => ((Number.parseInt(pattern, 16) >> index) & 1) === 1,
  );

  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      data-avatar-variant={String(variant)}
      data-avatar-pattern={pattern}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold uppercase",
        AVATAR_VARIANT_CLASSES[variant],
        className,
      )}
    >
      <svg
        viewBox="0 0 12 12"
        className="absolute inset-0 h-full w-full opacity-25"
        aria-hidden="true"
      >
        {patternBits.map((enabled, index) => {
          if (!enabled) return null;
          const column = index % 3;
          const row = Math.floor(index / 3);
          return (
            <rect
              key={`${pattern}-${index}`}
              x={1.5 + column * 3}
              y={1.5 + row * 4}
              width="2"
              height="2.5"
              rx="0.5"
              fill="currentColor"
            />
          );
        })}
      </svg>
      <span className="relative">{getAvatarInitial(displayName)}</span>
    </span>
  );
}

export function AgentListRow({
  agent,
  active,
  selected,
  onSelect,
}: {
  agent: AgentOption;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`agents-select-${agent.agentKey}`}
      data-active={selected ? "true" : undefined}
      className={cn(
        "rounded-md px-2.5 py-2 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
        selected
          ? "bg-bg-subtle text-fg"
          : "bg-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg",
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AgentAvatar
          agentKey={agent.agentKey}
          displayName={agent.displayName}
          className="mt-0.5 h-8 w-8 text-sm"
          testId={`agents-avatar-${agent.agentKey}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg" title={agent.displayName}>
            {agent.displayName}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs opacity-80">
            <StatusDot variant={active ? "success" : "neutral"} pulse={active} />
            {active ? "Active" : "Idle"}
          </div>
        </div>
      </div>
    </button>
  );
}

export function AgentMobilePicker({
  agentOptions,
  selectedAgentOption,
  selectedAgentKey,
  disabled,
  onSelect,
}: {
  agentOptions: AgentOption[];
  selectedAgentOption: AgentOption | null;
  selectedAgentKey: string;
  disabled: boolean;
  onSelect: (agentKey: string) => void;
}) {
  const selectedLabel = selectedAgentOption?.displayName ?? "No agent selected";

  if (agentOptions.length === 0) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="agents-select"
        className="h-8 min-w-[11rem] justify-between px-2 text-sm lg:hidden"
        disabled
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="agents-select"
          aria-label="Selected agent"
          className="h-8 min-w-[11rem] justify-between gap-2 px-2 text-sm lg:hidden"
          disabled={disabled}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedAgentOption ? (
              <AgentAvatar
                agentKey={selectedAgentOption.agentKey}
                displayName={selectedAgentOption.displayName}
                className="h-6 w-6 text-[11px]"
                testId="agents-mobile-selected-avatar"
              />
            ) : null}
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-1 lg:hidden">
        {agentOptions.map((agent) => (
          <DropdownMenuItem
            key={agent.agentKey}
            data-testid={`agents-mobile-select-${agent.agentKey}`}
            className={cn(
              "gap-3 px-2 py-2",
              agent.agentKey === selectedAgentKey ? "bg-bg-subtle text-fg" : null,
            )}
            onSelect={() => {
              onSelect(agent.agentKey);
            }}
          >
            <AgentAvatar
              agentKey={agent.agentKey}
              displayName={agent.displayName}
              className="h-7 w-7 text-xs"
              testId={`agents-mobile-avatar-${agent.agentKey}`}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{agent.displayName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
