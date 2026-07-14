import { describe, it, expect } from "vitest";
import { ymd, presets, last7Days } from "./date-range";

describe("ymd", () => {
  it("formats local date as YYYY-MM-DD with zero-padding", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("presets", () => {
  it("includes the expected labels", () => {
    const labels = presets().map((p) => p.label);
    expect(labels).toEqual([
      "Today", "Yesterday", "Last 7 days", "Last 30 days",
      "This month", "Last month", "This year",
    ]);
  });

  it("Last 7 days spans 7 inclusive days ending today", () => {
    const p = presets().find((x) => x.label === "Last 7 days")!;
    const from = new Date(`${p.from}T00:00:00`);
    const to = new Date(`${p.to}T00:00:00`);
    const days = Math.round((+to - +from) / 86400000) + 1;
    expect(days).toBe(7);
  });
});

describe("last7Days", () => {
  it("matches the Last 7 days preset bounds", () => {
    const p = presets().find((x) => x.label === "Last 7 days")!;
    expect(last7Days()).toEqual({ from: p.from, to: p.to });
  });
});
