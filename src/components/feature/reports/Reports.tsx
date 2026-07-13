"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { exportReports, REPORT_META, type ReportType } from "@/lib/excel";
import { fetchReportData } from "@/lib/supabase-data";
import { NoAccess } from "@/components/feature/NoAccess";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const ALL_REPORTS: ReportType[] = ["sales", "bills", "products", "stock", "stockLog", "customers", "analytics"];

export function Reports() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);

  const [selected, setSelected] = useState<ReportType[]>(["sales"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);

  if (user && user.role !== "Owner") return <NoAccess />;

  const toggle = (t: ReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const allChecked = selected.length === ALL_REPORTS.length;
  const toggleAll = () => setSelected(allChecked ? [] : [...ALL_REPORTS]);

  const doExport = async () => {
    if (selected.length === 0) {
      toast("Select at least one report");
      return;
    }
    if (from && to && from > to) {
      toast("From date must be before To date");
      return;
    }
    setExporting(true);
    try {
      const range = { from: from || null, to: to || null };
      // Export in the fixed report order regardless of click order.
      const types = ALL_REPORTS.filter((t) => selected.includes(t));
      const data = await fetchReportData();
      const r = await exportReports(types, data, range);
      toast(r.ok ? "Report downloaded" : r.error ?? "Export failed");
    } catch {
      toast("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="mb-1 text-xl font-extrabold text-ink">Reports</h2>
      <p className="mb-5 text-sm text-ink-muted">
        Choose the reports you want and an optional date range, then download them as one Excel file.
      </p>

      <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <div className="mb-2 flex items-center justify-between">
          <span className={labelCls + " mb-0"}>Reports</span>
          <button type="button" onClick={toggleAll} className="text-xs font-bold text-brown">
            {allChecked ? "Clear all" : "Select all"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ALL_REPORTS.map((t) => {
            const checked = selected.includes(t);
            return (
              <label
                key={t}
                className={`flex cursor-pointer items-center gap-2.5 rounded-[11px] border px-[13px] py-[11px] text-sm transition-colors ${
                  checked ? "border-brown bg-cream" : "border-line bg-warm-white hover:bg-cream/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brown"
                  checked={checked}
                  onChange={() => toggle(t)}
                />
                <span className="font-semibold text-ink">{REPORT_META[t].name}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="from-date">From</label>
            <input id="from-date" type="date" className={inputCls} value={from}
              onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="to-date">To</label>
            <input id="to-date" type="date" className={inputCls} value={to}
              onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          Dates apply to Sales, Bills, Stock Log and Analytics. Products, Stock and Customers always
          export the full current snapshot. Leave dates empty to include all records.
        </p>

        <button
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={doExport}
          disabled={exporting || selected.length === 0}
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{" "}
          {exporting ? "Preparing…" : `Download Excel${selected.length ? ` (${selected.length})` : ""}`}
        </button>
      </div>
    </div>
  );
}
