interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message = "No items found." }: EmptyStateProps) {
  return (
    <div className="card">
      <p className="muted">{message}</p>
    </div>
  );
}
