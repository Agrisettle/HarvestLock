import { hasTranslationKey, useI18n, type Translate } from "../i18n";

function statusLabel(status: string, t: Translate): string {
  const key = `status.${status}`;
  return hasTranslationKey(key) ? t(key) : status;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className="badge" data-status={status}>
      {statusLabel(status, t)}
    </span>
  );
}
