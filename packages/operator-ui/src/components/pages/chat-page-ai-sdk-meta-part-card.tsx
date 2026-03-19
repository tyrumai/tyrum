import { isFileUIPart, type UIMessage } from "ai";

function MetaPartCard({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">{title}</div>
      <div className="min-w-0 space-y-1 text-sm text-fg">{children}</div>
    </div>
  );
}

function FilePreviewCard({
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
    <MetaPartCard key={`${messageId}:file:${index}`} title="File">
      {part.filename ? <div className="font-medium">{part.filename}</div> : null}
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
    </MetaPartCard>
  );
}

export function renderMetaMessagePart(input: {
  index: number;
  messageId: string;
  part: UIMessage["parts"][number];
}): React.ReactNode {
  const { index, messageId, part } = input;
  if (part.type === "source-url") {
    return (
      <MetaPartCard key={`${messageId}:source-url:${index}`} title="Source">
        {part.title ? <div className="font-medium">{part.title}</div> : null}
        <a
          className="break-all text-sm text-primary-700 underline underline-offset-2 [overflow-wrap:anywhere]"
          href={part.url}
          rel="noreferrer"
          target="_blank"
        >
          {part.url}
        </a>
      </MetaPartCard>
    );
  }
  if (part.type === "source-document") {
    return (
      <MetaPartCard key={`${messageId}:source-document:${index}`} title="Source Document">
        <div className="font-medium">{part.title}</div>
        <div className="text-xs text-fg-muted">{part.mediaType}</div>
        {part.filename ? <div className="text-xs text-fg-muted">{part.filename}</div> : null}
      </MetaPartCard>
    );
  }
  if (isFileUIPart(part)) {
    return <FilePreviewCard index={index} messageId={messageId} part={part} />;
  }
  return null;
}
