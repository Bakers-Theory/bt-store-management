"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { exportReports, inRange, REPORT_META, type ReportType } from "@/lib/excel";
import { fetchReportData, type FullStoreData } from "@/lib/supabase-data";
import { NoAccess } from "@/components/feature/NoAccess";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const ALL_REPORTS: ReportType[] = [
  "sales", "bills", "products", "stock", "stockLog", "customers", "analytics", "expiry",
];

/** Local-time YYYY-MM-DD for a date input value. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Named date-range presets, computed relative to today. */
function presets(): { label: string; from: string; to: string }[] {
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

        <div className="mt-4">
          <span className={labelCls}>Date range</span>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {presets().map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className="rounded-full border border-line bg-cream px-2.5 py-1 text-xs font-semibold text-ink-muted hover:border-brown hover:text-brown"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setFrom(""); setTo(""); }}
              className="rounded-full border border-line bg-cream px-2.5 py-1 text-xs font-semibold text-ink-muted hover:border-brown hover:text-brown"
            >
              All time
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
