interface TruncateOptions {
  ellipsis?: string;
  reserveEllipsisWidth?: boolean;
  normalizeWhitespace?: boolean;
}

// Word-safe truncation: cuts at the last space within budget rather than
// mid-word. `reserveEllipsisWidth` subtracts the ellipsis's own length from
// maxLength first (for callers with a hard character budget, e.g. SEO meta
// titles); leave it off when a little overage from the ellipsis is fine
// (e.g. a card excerpt).
export function truncate(text: string, maxLength: number, options: TruncateOptions = {}): string {
  const { ellipsis = '…', reserveEllipsisWidth = false, normalizeWhitespace = false } = options;
  const normalized = normalizeWhitespace ? text.trim().replace(/\s+/g, ' ') : text;
  if (normalized.length <= maxLength) return normalized;

  const budget = reserveEllipsisWidth ? maxLength - ellipsis.length : maxLength;
  const clipped = normalized.slice(0, budget);
  const lastSpace = clipped.lastIndexOf(' ');
  const wordSafe = (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
  return `${wordSafe || clipped.trimEnd()}${ellipsis}`;
}
