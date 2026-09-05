export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="badge" data-status={status}>
      {status}
    </span>
  );
}
