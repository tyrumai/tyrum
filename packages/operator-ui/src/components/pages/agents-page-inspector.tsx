import type {
  AgentStatusResponse,
  TranscriptConversationSummary,
  TranscriptTimelineEvent,
} from "@tyrum/contracts";
import type { ReactNode } from "react";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { StructuredValue } from "../ui/structured-value.js";
import {
  eventKindLabel,
  formatConversationTitle,
  type InspectorField,
} from "./transcripts-page.lib.js";

const EMPTY_TOOL_EXPOSURE: AgentStatusResponse["tool_exposure"] = {
  mcp: {},
  tools: {},
};

function hasResolvedToolExposure(
  selection: AgentStatusResponse["tool_exposure"]["mcp"] | undefined,
): boolean {
  return selection?.bundle !== undefined || selection?.tier !== undefined;
}

function ExposureSelectionSummary({
  label,
  selection,
  testId,
}: {
  label: string;
  selection: AgentStatusResponse["tool_exposure"]["mcp"] | undefined;
  testId: string;
}) {
  const resolved = hasResolvedToolExposure(selection);

  return (
    <div
      className="grid gap-2 rounded-md border border-border bg-bg-subtle/30 p-3"
      data-testid={testId}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      {resolved ? (
        <div className="flex flex-wrap gap-2">
          {selection?.bundle ? (
            <Badge variant="outline">{`Bundle: ${selection.bundle}`}</Badge>
          ) : null}
          {selection?.tier ? <Badge variant="outline">{`Tier: ${selection.tier}`}</Badge> : null}
        </div>
      ) : (
        <div className="text-sm text-fg-muted">No canonical bundle/tier resolved.</div>
      )}
    </div>
  );
}

function LegacyToolAccessSummary({
  toolAccess,
}: {
  toolAccess: NonNullable<AgentStatusResponse["tool_access"]>;
}) {
  const renderToolList = (items: readonly string[], emptyText: string): ReactNode => {
    if (items.length === 0) {
      return <div className="text-sm text-fg-muted">{emptyText}</div>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {items.map((toolId) => (
          <Badge key={toolId} variant="outline">
            {toolId}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <div
      className="grid gap-3 rounded-md border border-border bg-bg-subtle/30 p-3"
      data-testid="agents-exposure-legacy-tools"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
        Legacy tool rules
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Default</div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{toolAccess.default_mode}</Badge>
          </div>
        </div>
        <div className="grid gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Allow</div>
          {renderToolList(toolAccess.allow, "No explicit allow rules.")}
        </div>
        <div className="grid gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Deny</div>
          {renderToolList(toolAccess.deny, "No explicit deny rules.")}
        </div>
      </div>
    </div>
  );
}

function AgentExposureCard(props: {
  agentStatus: AgentStatusResponse | null;
  agentStatusError: string | null;
  agentStatusLoading: boolean;
  selectedAgentKey: string;
}) {
  const { agentStatus, agentStatusError, agentStatusLoading, selectedAgentKey } = props;
  const normalizedAgentKey = selectedAgentKey.trim();
  const toolExposure = agentStatus?.tool_exposure ?? EMPTY_TOOL_EXPOSURE;
  const toolsResolved = hasResolvedToolExposure(toolExposure.tools);

  return (
    <Card data-testid="agents-exposure-card">
      <CardHeader className="pb-3">
        <div className="text-sm font-medium text-fg">Agent exposure</div>
        <div className="text-xs text-fg-muted">
          Resolved canonical tool exposure for the selected agent.
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {normalizedAgentKey ? (
          <div className="grid gap-1 text-sm text-fg-muted">
            <div className="font-medium text-fg">
              {agentStatus?.identity.name ?? normalizedAgentKey}
            </div>
            <div>{normalizedAgentKey}</div>
          </div>
        ) : (
          <div className="text-sm text-fg-muted">
            Select an agent to inspect resolved tool exposure.
          </div>
        )}
        {agentStatusError ? (
          <Alert variant="error" title="Agent status unavailable" description={agentStatusError} />
        ) : null}
        {agentStatusLoading ? (
          <div className="text-sm text-fg-muted">Loading agent exposure…</div>
        ) : null}
        {agentStatus ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ExposureSelectionSummary
                label="MCP"
                selection={toolExposure.mcp}
                testId="agents-exposure-mcp"
              />
              <ExposureSelectionSummary
                label="Tools"
                selection={toolExposure.tools}
                testId="agents-exposure-tools"
              />
            </div>
            {!toolsResolved && agentStatus.tool_access ? (
              <LegacyToolAccessSummary toolAccess={agentStatus.tool_access} />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TranscriptInspectorPanel(props: {
  agentStatus: AgentStatusResponse | null;
  agentStatusError: string | null;
  agentStatusLoading: boolean;
  focusConversation: TranscriptConversationSummary | null;
  inspectorFields: InspectorField[];
  selectedAgentKey: string;
  selectedEvent: TranscriptTimelineEvent | null;
}) {
  const {
    agentStatus,
    agentStatusError,
    agentStatusLoading,
    focusConversation,
    inspectorFields,
    selectedAgentKey,
    selectedEvent,
  } = props;
  const inspectorHint = focusConversation
    ? "Select a transcript event to inspect its raw payload."
    : "Select a transcript to inspect its events.";

  return (
    <div className="min-h-0">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4">
          <AgentExposureCard
            agentStatus={agentStatus}
            agentStatusError={agentStatusError}
            agentStatusLoading={agentStatusLoading}
            selectedAgentKey={selectedAgentKey}
          />
          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Inspector</div>
              <div className="text-xs text-fg-muted">
                Raw details for the selected transcript event.
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {focusConversation ? (
                <div className="grid gap-1 text-sm text-fg-muted">
                  <div className="font-medium text-fg">
                    {formatConversationTitle(focusConversation)}
                  </div>
                </div>
              ) : null}
              {inspectorFields.length > 0 ? (
                <div className="grid gap-2">
                  <div className="grid gap-2 rounded-md border border-border bg-bg-subtle/30 p-3">
                    {inspectorFields.map((field) => (
                      <div
                        key={`${field.label}:${field.value}`}
                        className="grid gap-1 text-xs text-fg-muted"
                      >
                        <div className="font-medium uppercase tracking-wide">{field.label}</div>
                        <div className="break-all font-mono text-fg">{field.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedEvent ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{eventKindLabel(selectedEvent.kind)}</Badge>
                    <time
                      className="text-xs text-fg-muted"
                      dateTime={selectedEvent.occurred_at}
                      title={selectedEvent.occurred_at}
                    >
                      {selectedEvent.occurred_at}
                    </time>
                  </div>
                  <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-bg-subtle/30 p-3">
                    <StructuredValue value={selectedEvent} />
                  </div>
                </div>
              ) : focusConversation ? (
                <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-bg-subtle/30 p-3">
                  <StructuredValue value={focusConversation} />
                </div>
              ) : (
                <div className="text-sm text-fg-muted">{inspectorHint}</div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
