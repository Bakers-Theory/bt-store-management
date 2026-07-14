"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { exportReports, inRange, REPORT_META, type ReportType } from "@/lib/excel";
import { fetchReportData, type FullStoreData } from "@/lib/supabase-data";
import { NoAccess } from "@/components/feature/NoAccess";
import { DateRangePicker } from "@/components/ui/DateRangePicker";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const ALL_REPORTS: ReportType[] = [
  "sales", "bills", "products", "stock", "stockLog", "customers", "analytics", "expiry",
];

export function Reports() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);

  const [selected, setSelected] = useState<ReportType[]>(["sales"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<FullStoreData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load once so we can preview record counts and reuse the payload on export.
  useEffect(() => {
    let alive = true;
    fetchReportData()
      .then((d) => alive && setData(d))
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (user && user.role !== "Owner") return <NoAccess />;

  const toggle = (t: ReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const allChecked = selected.length === ALL_REPORTS.length;
  const toggleAll = () => setSelected(allChecked ? [] : [...ALL_REPORTS]);

  const range = { from: from || null, to: to || null };
  const billsInRange = data ? data.bills.filter((b) => inRange(b.date, range)).length : null;
  const logsInRange = data ? data.logs.filter((l) => inRange(l.date, range)).length : null;

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
      const types = ALL_REPORTS.filter((t) => selected.includes(t)); // fixed order
      const payload = data ?? (await fetchReportData());
      const r = await exportReports(types, payload, range);
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
        <span className={labelCls}>Reports</span>

        <label
          className={`mb-2 flex cursor-pointer select-none items-center gap-2.5 rounded-[11px] border px-[13px] py-[11px] text-sm transition-colors ${
            selected.length ? "border-brown bg-cream" : "border-line bg-warm-white active:bg-cream/50"
          }`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-brown"
            checked={allChecked}
            ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allChecked; }}
            onChange={toggleAll}
          />
          <span className="font-bold text-ink">Select all</span>
          <span className="ml-auto text-xs font-semibold text-ink-muted">
            {selected.length}/{ALL_REPORTS.length}
          </span>
        </label>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ALL_REPORTS.map((t) => {
            const checked = selected.includes(t);
            return (
              <label
                key={t}
                className={`flex cursor-pointer select-none items-center gap-2.5 rounded-[11px] border px-[13px] py-[11px] text-sm transition-colors ${
                  checked ? "border-brown bg-cream" : "border-line bg-warm-white hover:bg-cream/50 active:bg-cream/50"
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

        <div className="mt-4">
          <DateRangePicker
            value={{ from: from || null, to: to || null }}
            onChange={(r) => { setFrom(r.from ?? ""); setTo(r.to ?? ""); }}
          />
        </div>

        <p className="mt-2.5 text-xs text-ink-muted">
          {loadFailed
            ? "Couldn't load a preview — export will still fetch fresh data."
            : data
              ? `In range: ${billsInRange} bill${billsInRange === 1 ? "" : "s"} · ${logsInRange} stock movement${logsInRange === 1 ? "" : "s"}. Snapshot: ${data.items.length} products · ${data.customers.length} customers.`
              : "Loading record counts…"}
        </p>

        <p className="mt-1.5 text-xs text-ink-muted">
          Dates apply to Sales, Bills, Stock Log and Analytics. Products, Stock, Customers and Expiry
          always export the full current snapshot.
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
