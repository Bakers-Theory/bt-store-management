import type { Bill } from "./types";

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function isActiveBill(b: Bill): boolean {
  return b.status !== "cancelled";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function formatDateFull(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    }) +
    " " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Compact recency label for a past ISO date: "Today", "Yesterday", "3d ago",
 *  "2w ago", then a "dd Mon" date for anything older. */
export function relativeDay(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startNow.getTime() - startThen.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(iso);
}

/** First letter of each of the first two words in `name`, uppercased. Returns
 *  `fallback` verbatim for a blank name (e.g. an avatar placeholder glyph). */
export function initials(name: string, fallback = "?"): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return fallback;
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
