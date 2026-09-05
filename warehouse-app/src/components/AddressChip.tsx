import { useState } from "react";

/**
 * Every Stellar address/contract ID in this app is 56 characters — shown
 * raw, they either wrap into an unreadable wall of text
 * (`word-break: break-all`, mid-string line breaks wherever the
 * container edge falls) or silently overflow a flex row (CSS
 * `text-overflow: ellipsis` doesn't actually trigger on a flex child
 * without `min-width: 0`, which nothing here was setting). Always
 * truncate for display, always keep the full value in a `title` tooltip
 * so it's never actually lost, just not forced on every reader.
 *
 * `copyable` defaults to true but must be explicitly turned off inside
 * anything that's already a `<button>` (e.g. `CommitmentList`'s row) —
 * a `<button>` nested inside another `<button>` is invalid HTML, not
 * just a style nit.
 */
export function AddressChip({
  address,
  copyable = true,
  className,
}: {
  address: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation(); // some callers render this inside a clickable row
    navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access can be denied (permissions) or unavailable
        // (non-HTTPS, older browser) -- the tooltip still has the full
        // address either way, so this is a missed convenience, not a
        // broken feature.
      });
  }

  return (
    <span className={`address-chip${className ? ` ${className}` : ""}`} title={address}>
      <span className="address-chip-text">
        {address.slice(0, 4)}…{address.slice(-4)}
      </span>
      {copyable && (
        <button type="button" className="address-chip-copy" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </span>
  );
}
