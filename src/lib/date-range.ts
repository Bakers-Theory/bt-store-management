// Shared date-range primitives used by the dashboard and reports controls.
// Dates are local calendar dates (YYYY-MM-DD); null bound = open-ended.

export type DateRange = { from: string | null; to: string | null };

/** Local-time YYYY-MM-DD for a date input value. */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Named date-range presets, computed relative to today. */
export function presets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const today = ymd(now);
  const yesterday = ymd(new Date(y, m, d - 1));
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: ymd(new Date(y, m, d - 6)), to: today },
    { label: "Last 30 days", from: ymd(new Date(y, m, d - 29)), to: today },
    { label: "This month", from: ymd(new Date(y, m, 1)), to: today },
    { label: "Last month", from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) },
    { label: "This year", from: ymd(new Date(y, 0, 1)), to: today },
  ];
}

/** The default dashboard range. */
export function last7Days(): DateRange {
  const p = presets().find((x) => x.label === "Last 7 days")!;
  return { from: p.from, to: p.to };
}
