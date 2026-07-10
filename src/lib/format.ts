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
