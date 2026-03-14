import { isFileUIPart, type UIMessage } from "ai";

function MetaPartCard({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">{title}</div>
      <div className="min-w-0 space-y-1 text-sm text-fg">{children}</div>
    </div>
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
    return (
      <MetaPartCard key={`${messageId}:file:${index}`} title="File">
        {part.filename ? <div className="font-medium">{part.filename}</div> : null}
        <div className="text-xs text-fg-muted">{part.mediaType}</div>
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
  return null;
}
