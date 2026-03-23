import type { Approval, OperatorCore, ResolveApprovalInput } from "@tyrum/operator-app";
import {
  getToolName,
  isDataUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtifactInlinePreview } from "../artifacts/artifact-inline-preview.js";
import { Badge } from "../ui/badge.js";
import { StructuredJsonDisplay } from "../ui/structured-json-display.js";
import { StructuredJsonSchemaDisplay } from "../ui/structured-json-schema-display.js";
import { ApprovalActions } from "./approval-actions.js";
import { ApprovalDataPartCard } from "./chat-page-ai-sdk-approval-data-part-card.js";
import { useArtifactAwareMarkdownComponents } from "./chat-page-ai-sdk-artifact-markdown.js";
import { DisclosureCard, useAutoDisclosure } from "./chat-page-ai-sdk-disclosure-card.js";
import { renderMetaMessagePart } from "./chat-page-ai-sdk-meta-part-card.js";
import { cn } from "../../lib/cn.js";
import { isRecord } from "../../utils/is-record.js";
import {
  collectArtifactRefs,
  formatToolState,
  normalizeToolOutputForDisplay,
  stringifyPart,
} from "./chat-page-ai-sdk-message-card-helpers.js";

type ApprovalDataPart = {
  approval_id: string;
  approved?: boolean;
  state: "approved" | "cancelled" | "denied" | "expired" | "pending";
  tool_call_id: string;
  tool_name: string;
};

const MARKDOWN_PROSE_CLASS_NAME = [
  "prose prose-sm min-w-0 max-w-none break-words text-fg [overflow-wrap:anywhere]",
  "prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-fg",
  "prose-p:my-2 prose-p:break-words prose-p:text-fg",
  "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
  "prose-ul:my-2 prose-ul:list-disc prose-ul:pl-5",
  "prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-5",
  "prose-li:my-1 prose-li:text-fg",
  "prose-bullets:text-fg-muted prose-counters:text-fg-muted",
  "prose-strong:text-fg prose-code:break-words prose-code:text-fg prose-code:[overflow-wrap:anywhere]",
  "prose-blockquote:border-border prose-blockquote:text-fg",
  "prose-hr:border-border prose-th:text-fg prose-td:text-fg",
  "prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:bg-bg-subtle prose-pre:text-fg prose-pre:[overflow-wrap:anywhere]",
].join(" ");
function isReasoningActive(
  part: Extract<UIMessage["parts"][number], { type: "reasoning" }>,
): boolean {
  return part.state === "streaming";
}

function isToolActive(part: Extract<UIMessage["parts"][number], { type: string }>): boolean {
  if (!isToolUIPart(part)) {
    return false;
  }
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  );
}

function toolBadgeVariant(state: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (state) {
    case "output-available":
      return "success";
    case "output-error":
    case "output-denied":
      return "danger";
    case "approval-requested":
      return "warning";
    default:
      return "outline";
  }
}

function approvalStatusVariant(
  approval: { approved?: boolean } | undefined,
): React.ComponentProps<typeof Badge>["variant"] {
  if (!approval) {
    return "warning";
  }
  return approval.approved === false ? "danger" : "success";
}

function readApprovalDataPart(part: UIMessage["parts"][number]): ApprovalDataPart | null {
  if (!isDataUIPart(part) || part.type !== "data-approval-state" || !isRecord(part.data)) {
    return null;
  }

  const approvalId =
    typeof part.data["approval_id"] === "string" ? part.data["approval_id"].trim() : "";
  const toolCallId =
    typeof part.data["tool_call_id"] === "string" ? part.data["tool_call_id"].trim() : "";
  const toolName = typeof part.data["tool_name"] === "string" ? part.data["tool_name"].trim() : "";
  const state = part.data["state"];
  if (
    !approvalId ||
    !toolCallId ||
    !toolName ||
    (state !== "approved" &&
      state !== "cancelled" &&
      state !== "denied" &&
      state !== "expired" &&
      state !== "pending")
  ) {
    return null;
  }

  const approved = typeof part.data["approved"] === "boolean" ? part.data["approved"] : undefined;
  return {
    approval_id: approvalId,
    ...(approved === undefined ? {} : { approved }),
    state,
    tool_call_id: toolCallId,
    tool_name: toolName,
  };
}

function readToolApprovalId(
  part: Extract<UIMessage["parts"][number], { type: string }>,
): string | null {
  if (!isToolUIPart(part)) {
    return null;
  }
  const approval = "approval" in part ? part.approval : undefined;
  return approval?.id?.trim() ? approval.id : null;
}

function TextBlock({
  core,
  renderMode,
  value,
}: {
  core?: OperatorCore;
  renderMode: "markdown" | "text";
  value: string;
}) {
  const components = useArtifactAwareMarkdownComponents(core);

  if (renderMode === "markdown") {
    return (
      <div className={MARKDOWN_PROSE_CLASS_NAME}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {value}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-[13px] leading-5 text-fg [overflow-wrap:anywhere]">
      {value}
    </pre>
  );
}

function FilePartCard({
  index,
  messageId,
  part,
}: {
  index: number;
  messageId: string;
  part: Extract<UIMessage["parts"][number], { type: "file" }>;
}) {
  const isImage = part.mediaType.startsWith("image/");
  const downloadName = part.filename?.trim() || "attachment";

  return (
    <div className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">File</div>
      <div className="grid gap-1">
        {part.filename ? <div className="font-medium text-sm text-fg">{part.filename}</div> : null}
        <div className="text-xs text-fg-muted">{part.mediaType}</div>
        {isImage ? (
          <img
            alt={part.filename?.trim() || "Uploaded image"}
            className="max-h-[320px] w-full rounded-md border border-border object-contain"
            data-testid={`message-file-preview-${messageId}-${index}`}
            src={part.url}
          />
        ) : null}
        <a
          className="break-all text-sm text-primary-700 underline underline-offset-2 [overflow-wrap:anywhere]"
          data-testid={`message-file-download-${messageId}-${index}`}
          download={downloadName}
          href={part.url}
          rel="noreferrer noopener"
          target="_blank"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function ReasoningPartCard({
  part,
}: {
  part: Extract<UIMessage["parts"][number], { type: "reasoning" }>;
}) {
  const { open, toggleOpen } = useAutoDisclosure(isReasoningActive(part));

  return (
    <DisclosureCard header="Thinking" open={open} onToggle={toggleOpen}>
      <TextBlock value={part.text} renderMode="text" />
    </DisclosureCard>
  );
}

function ToolPartCard({
  approval,
  core,
  interactiveApprovals,
  onResolveApproval,
  part,
  resolvingApproval,
  showApprovalDetails,
  toolSchemasById,
}: {
  approval: Approval | null;
  core?: OperatorCore;
  interactiveApprovals: boolean;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  part: Extract<UIMessage["parts"][number], { type: string }>;
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  showApprovalDetails: boolean;
  toolSchemasById: Record<string, Record<string, unknown>>;
}) {
  if (!isToolUIPart(part)) {
    return null;
  }

  const approvalId = readToolApprovalId(part);
  const toolName = getToolName(part);
  const toolSchema = toolSchemasById[toolName];
  const inputState =
    "input" in part
      ? normalizeToolOutputForDisplay(part.input)
      : { displayValue: undefined, isStructured: false };
  const outputState =
    "output" in part
      ? normalizeToolOutputForDisplay(part.output)
      : { displayValue: undefined, isStructured: false };
  const artifactRefs =
    "output" in part && part.output !== undefined
      ? collectArtifactRefs(outputState.displayValue)
      : [];
  const { open, toggleOpen } = useAutoDisclosure(isToolActive(part));
  const isPendingApproval = part.state === "approval-requested" && approvalId;

  return (
    <DisclosureCard header={toolName} open={open} onToggle={toggleOpen}>
      <div className="grid gap-2">
        {"input" in part && part.input !== undefined ? (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Input</div>
            {inputState.isStructured ? (
              toolSchema ? (
                <StructuredJsonSchemaDisplay schema={toolSchema} value={inputState.displayValue} />
              ) : (
                <StructuredJsonDisplay value={inputState.displayValue} />
              )
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg px-2 py-1.5 text-xs text-fg [overflow-wrap:anywhere]">
                {stringifyPart(part.input)}
              </pre>
            )}
          </div>
        ) : null}

        {"output" in part && part.output !== undefined ? (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Output</div>
            {outputState.isStructured ? (
              <StructuredJsonDisplay value={outputState.displayValue} />
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-bg px-2 py-1.5 text-xs text-fg [overflow-wrap:anywhere]">
                {stringifyPart(part.output)}
              </pre>
            )}
            {core && artifactRefs.length > 0 ? (
              <div className="mt-2 grid gap-3">
                {artifactRefs.map((artifact) => (
                  <ArtifactInlinePreview
                    key={artifact.artifact_id}
                    core={core}
                    artifact={artifact}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {"errorText" in part && typeof part.errorText === "string" ? (
          <div className="break-words text-sm text-danger-700 [overflow-wrap:anywhere]">
            {part.errorText}
          </div>
        ) : null}

        {showApprovalDetails && "approval" in part && part.approval ? (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Approval {part.approval.id}</span>
            <Badge variant={approvalStatusVariant(part.approval)}>
              {part.approval.approved === false
                ? "denied"
                : part.approval.approved === true
                  ? "approved"
                  : "pending"}
            </Badge>
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge variant={toolBadgeVariant(part.state)}>{formatToolState(part.state)}</Badge>
        </div>

        {interactiveApprovals && showApprovalDetails && isPendingApproval && approvalId ? (
          <div className="rounded-md border border-warning-300/70 bg-warning-50/70 px-2 py-1.5">
            <div className="text-xs text-warning-900">
              User approval is required before this tool can continue.
            </div>
            <ApprovalActions
              approvalId={approvalId}
              approval={approval}
              resolvingState={
                resolvingApproval?.approvalId === approvalId ? resolvingApproval.state : undefined
              }
              onResolve={onResolveApproval}
              className="mt-2"
            />
          </div>
        ) : null}
      </div>
    </DisclosureCard>
  );
}

export function MessageParts({
  approvalsById,
  core,
  interactiveApprovals = true,
  message,
  onResolveApproval,
  renderMode,
  resolvingApproval,
  toolSchemasById = {},
}: {
  approvalsById: Record<string, Approval>;
  core?: OperatorCore;
  interactiveApprovals?: boolean;
  message: UIMessage;
  onResolveApproval: (input: ResolveApprovalInput) => void;
  renderMode: "markdown" | "text";
  resolvingApproval: { approvalId: string; state: "always" | "approved" | "denied" } | null;
  toolSchemasById?: Record<string, Record<string, unknown>>;
}) {
  const approvalIdsWithDataPart = new Set(
    message.parts
      .map((part) => readApprovalDataPart(part)?.approval_id ?? null)
      .filter((approvalId): approvalId is string => approvalId !== null),
  );

  return (
    <div className="grid gap-2">
      {message.parts.map((part: UIMessage["parts"][number], index: number) => {
        if (isTextUIPart(part)) {
          return (
            <TextBlock
              key={`${message.id}:text:${index}`}
              value={part.text}
              renderMode={renderMode}
              core={core}
            />
          );
        }
        if (isFileUIPart(part)) {
          return (
            <FilePartCard
              key={`${message.id}:file:${index}`}
              index={index}
              messageId={message.id}
              part={part}
            />
          );
        }
        if (isReasoningUIPart(part)) {
          return <ReasoningPartCard key={`${message.id}:reasoning:${index}`} part={part} />;
        }
        if (isToolUIPart(part)) {
          const approvalId = readToolApprovalId(part);
          const approval = approvalId ? (approvalsById[approvalId] ?? null) : null;
          return (
            <ToolPartCard
              key={`${message.id}:tool:${index}`}
              approval={approval}
              core={core}
              interactiveApprovals={interactiveApprovals}
              onResolveApproval={onResolveApproval}
              part={part}
              resolvingApproval={resolvingApproval}
              showApprovalDetails={!approvalId || !approvalIdsWithDataPart.has(approvalId)}
              toolSchemasById={toolSchemasById}
            />
          );
        }
        if (isDataUIPart(part)) {
          const approvalPart = readApprovalDataPart(part);
          if (approvalPart) {
            return (
              <ApprovalDataPartCard
                key={`${message.id}:approval:${index}`}
                approval={approvalsById[approvalPart.approval_id] ?? null}
                interactiveApprovals={interactiveApprovals}
                onResolveApproval={onResolveApproval}
                part={approvalPart}
                resolvingApproval={resolvingApproval}
              />
            );
          }
          const dataState = normalizeToolOutputForDisplay(part.data);
          return (
            <div
              key={`${message.id}:data:${index}`}
              className={cn("rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5")}
            >
              <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">
                {part.type}
              </div>
              {dataState.isStructured ? (
                <StructuredJsonDisplay
                  className="border-border/70 bg-bg-subtle/20"
                  value={dataState.displayValue}
                />
              ) : (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-fg [overflow-wrap:anywhere]">
                  {stringifyPart(part.data)}
                </pre>
              )}
            </div>
          );
        }
        if (part.type === "step-start") {
          return null;
        }
        const metaPart = renderMetaMessagePart({ index, messageId: message.id, part });
        if (metaPart) {
          return metaPart;
        }
        return (
          <div
            key={`${message.id}:part:${index}`}
            className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5 text-xs text-fg-muted"
          >
            Unsupported part <code>{part.type}</code>
          </div>
        );
      })}
    </div>
  );
}
