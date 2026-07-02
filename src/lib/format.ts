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

/** Match the original `parseFloat((n).toFixed(3))` rounding used on stock qty. */
export function round3(n: number): number {
  return parseFloat(n.toFixed(3));
}
