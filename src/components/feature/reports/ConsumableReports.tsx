"use client";

import { useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchConsumableReportData } from "@/lib/supabase-data";
import { exportConsumableReports } from "@/lib/excel";
import {
  CONSUMABLE_REPORT_META,
  CONSUMABLE_REPORT_TYPES,
  consumableReport,
  consumableReportCsv,
  type ConsumableReportType,
} from "@/lib/consumable-report";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { NoAccess } from "@/components/feature/NoAccess";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

export function ConsumableReports() {
  const user = useCurrentUser();
  const bakery = useBakeryStore((s) => s.bakery);
  const toast = useUIStore((s) => s.toast);
  const requestReport = useUIStore((s) => s.requestReport);

  const [selected, setSelected] = useState<ConsumableReportType[]>(["inventory"]);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [busy, setBusy] = useState<"print" | "excel" | "csv" | null>(null);

  if (user && !hasPermission(user, "consumables.reports")) return <NoAccess />;

  const shop = {
    name: bakery.name,
    address: bakery.address,
    phone: bakery.phone,
    currency: bakery.currency,
  };

  const toggle = (t: ConsumableReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const load = async () => ({ shop, ...(await fetchConsumableReportData(range)) });

  const doPrint = async () => {
    // The print dialog renders one A4 document, so printing is deliberately
    // single-report; Excel is the route for several at once.
    if (selected.length !== 1) {
      toast("Pick exactly one report to print", "error");
      return;
    }
    setBusy("print");
    try {
      requestReport(consumableReport(selected[0], await load(), range));
    } catch {
      toast("Couldn't build the report", "error");
    } finally {
      setBusy(null);
    }
  };

  const doExport = async () => {
    if (selected.length === 0) {
      toast("Select at least one report", "error");
      return;
    }
    setBusy("excel");
    try {
      const types = CONSUMABLE_REPORT_TYPES.filter((t) => selected.includes(t)); // fixed order
      const r = await exportConsumableReports(types, await load(), range);
      toast(r.ok ? "Report downloaded" : r.error ?? "Export failed", r.ok ? "success" : "error");
    } catch {
      toast("Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const doCsv = async () => {
    // A CSV file holds one report — concatenating several produces a file no
    // spreadsheet can make sense of.
    if (selected.length !== 1) {
      toast("Pick exactly one report for CSV", "error");
      return;
    }
    setBusy("csv");
    try {
      const csv = consumableReportCsv(selected[0], await load(), range);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${CONSUMABLE_REPORT_META[selected[0]].slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Couldn't build that CSV", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <span className={labelCls}>Reports</span>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {CONSUMABLE_REPORT_TYPES.map((t) => {
          const checked = selected.includes(t);
          return (
            <label
              key={t}
              className={`flex cursor-pointer select-none items-center gap-2.5 rounded-[11px] border px-[13px] py-[11px] text-sm transition-colors ${
                checked ? "border-brown bg-cream" : "border-line bg-warm-white hover:bg-cream/50"
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-brown"
                checked={checked}
                onChange={() => toggle(t)}
              />
              <span className="font-semibold text-ink">{CONSUMABLE_REPORT_META[t].name}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-4">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <p className="mt-2.5 text-xs text-ink-muted">
        Dates apply to the Stock Movement, Consumption, Purchase and Wastage
        reports. Inventory and Expiry are always a position as it stands today.
        Stock figures are the sum of the movement ledger, and outward value is
        estimated at the latest purchase price — each report states which.
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-warm-white p-3 text-sm font-bold text-ink disabled:opacity-60"
          onClick={doPrint}
          disabled={busy !== null || selected.length !== 1}
        >
          {busy === "print" ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          Print / PDF
        </button>
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-warm-white p-3 text-sm font-bold text-ink disabled:opacity-60"
          onClick={doCsv}
          disabled={busy !== null || selected.length !== 1}
        >
          {busy === "csv" ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
          CSV
        </button>
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white disabled:opacity-60"
          onClick={doExport}
          disabled={busy !== null || selected.length === 0}
        >
          {busy === "excel" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Excel{selected.length ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}
