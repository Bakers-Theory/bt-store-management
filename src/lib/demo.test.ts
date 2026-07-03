import { describe, it, expect } from "vitest";
import { buildDemoData } from "./demo";
import { isActiveBill } from "./format";

const now = new Date("2026-07-03T12:00:00.000Z");

describe("buildDemoData", () => {
  it("produces items, bills and logs with stable ids", () => {
    const a = buildDemoData(now);
    const b = buildDemoData(now);
    expect(a.items.length).toBe(10);
    expect(a.bills.length).toBeGreaterThan(0);
    expect(a.logs.length).toBeGreaterThan(a.bills.length); // opening + bill logs
    expect(a.nextBillNo).toBe(1001 + a.bills.length);
    // deterministic given the same `now`
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    expect(a.bills.map((x) => x.id)).toEqual(b.bills.map((x) => x.id));
  });

  it("dates all bills within the last ~90 days of `now`", () => {
    const { bills } = buildDemoData(now);
    const earliest = +now - 90 * 86400000;
    for (const bill of bills) {
      expect(+new Date(bill.date)).toBeLessThanOrEqual(+now);
      expect(+new Date(bill.date)).toBeGreaterThanOrEqual(earliest);
    }
  });

  it("includes exactly one cancelled bill and computes 5% tax on active ones", () => {
    const { bills } = buildDemoData(now);
    expect(bills.filter((x) => x.status === "cancelled")).toHaveLength(1);
    const active = bills.filter(isActiveBill);
    for (const bill of active) {
      expect(bill.tax).toBeCloseTo(bill.subtotal * 0.05, 6);
      expect(bill.total).toBeCloseTo(bill.subtotal + bill.tax, 6);
    }
  });

  it("has data in the last 7 days for the weekly chart", () => {
    const { bills } = buildDemoData(now);
    const weekAgo = +now - 7 * 86400000;
    const recent = bills.filter((x) => +new Date(x.date) >= weekAgo && isActiveBill(x));
    expect(recent.length).toBeGreaterThan(0);
  });
});
