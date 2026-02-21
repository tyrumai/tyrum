interface NoticeProps {
  message: string;
  tone: "ok" | "error";
}

export function Notice({ message, tone }: NoticeProps) {
  return <p className={`notice ${tone}`}>{message}</p>;
}
