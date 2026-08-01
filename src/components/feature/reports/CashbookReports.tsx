"use client";

import { useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { fetchCashbookReportData } from "@/lib/supabase-data";
import { exportCashbookReports } from "@/lib/excel";
import {
  CASHBOOK_REPORT_META,
  CASHBOOK_REPORT_TYPES,
  cashbookReport,
  cashbookReportCsv,
  categoryBreakdownTable,
  type CashbookReportType,
} from "@/lib/cashbook-report";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { NoAccess } from "@/components/feature/NoAccess";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

export function CashbookReports() {
  const user = useCurrentUser();
  const bakery = useBakeryStore((s) => s.bakery);
  const toast = useUIStore((s) => s.toast);
  const requestReport = useUIStore((s) => s.requestReport);

  const [selected, setSelected] = useState<CashbookReportType[]>(["dayBook"]);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [busy, setBusy] = useState<"print" | "excel" | "csv" | "chart" | null>(null);
  const [chart, setChart] = useState<{ label: string; amount: number }[]>([]);

  if (user && !hasPermission(user, "cashbook.reports")) return <NoAccess />;

  const shop = {
    name: bakery.name,
    address: bakery.address,
    phone: bakery.phone,
    currency: bakery.currency,
  };

  const toggle = (t: CashbookReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const load = () => fetchCashbookReportData(shop, range);

  const doPrint = async () => {
    // The print dialog renders one A4 document, so printing is deliberately
    // single-report; Excel is the route for several at once — same rule as
    // SupplierReports.
    if (selected.length !== 1) {
      toast("Pick exactly one report to print", "error");
      return;
    }
    setBusy("print");
    try {
      requestReport(cashbookReport(selected[0], await load(), range));
    } catch {
      toast("Couldn't build that report", "error");
    } finally {
      setBusy(null);
    }
  };

  const doExcel = async () => {
    if (selected.length === 0) {
      toast("Select at least one report", "error");
      return;
    }
    setBusy("excel");
    try {
      const types = CASHBOOK_REPORT_TYPES.filter((t) => selected.includes(t)); // fixed order
      const r = await exportCashbookReports(types, await load(), range);
      toast(r.ok ? "Report downloaded" : r.error ?? "Export failed", r.ok ? "success" : "error");
    } catch {
      toast("Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const doCsv = async () => {
    // A CSV file holds one report — concatenating several produces a file no
    // spreadsheet imports cleanly.
    if (selected.length !== 1) {
      toast("Pick exactly one report for CSV", "error");
      return;
    }
    setBusy("csv");
    try {
      const data = await load();
      const meta = CASHBOOK_REPORT_META[selected[0]];
      const csv = cashbookReportCsv(selected[0], data, range);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meta.slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Couldn't build that CSV", "error");
    } finally {
      setBusy(null);
    }
  };

  const showChart = async () => {
    setBusy("chart");
    try {
      const data = await load();
      const t = categoryBreakdownTable(data, range);
      setChart(t.rows.map((r) => ({ label: String(r[0]), amount: Number(r[2]) })));
    } catch {
      toast("Couldn't build the breakdown", "error");
    } finally {
      setBusy(null);
    }
  };

  const max = Math.max(1, ...chart.map((c) => c.amount));

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <span className={labelCls}>Reports</span>
      <div className="space-y-1.5">
        {CASHBOOK_REPORT_TYPES.map((t) => {
          const meta = CASHBOOK_REPORT_META[t];
          const checked = selected.includes(t);
          return (
            <label
              key={t}
              className={`flex cursor-pointer select-none items-start gap-2.5 rounded-[11px] border px-[13px] py-[11px] text-sm transition-colors ${
                checked ? "border-brown bg-cream" : "border-line bg-warm-white hover:bg-cream/50"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brown"
                checked={checked}
                onChange={() => toggle(t)}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{meta.name}</span>
                <span className="block text-[11px] text-ink-muted">{meta.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={doPrint}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brown px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy === "print" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Printer size={14} />
          )}
          Print / PDF
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={doExcel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy === "excel" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Excel{selected.length ? ` (${selected.length})` : ""}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={doCsv}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy === "csv" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileText size={14} />
          )}
          CSV
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={showChart}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy === "chart" && <Loader2 size={14} className="animate-spin" />}
          Show expense breakdown
        </button>
      </div>

      {/* On screen only. The print stylesheet targets tabular A4 documents and
          xlsx has no chart API in use here, so exports carry the same figures as
          a table. */}
      {chart.length > 0 && (
        <div className="mt-5 rounded-[18px] border border-line bg-cream p-4">
          <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-[#8a6a3c]">
            Expenses by category
          </h3>
          <div className="space-y-1.5">
            {chart.map((c) => (
              <div key={c.label} className="flex items-center gap-2.5">
                <span className="w-40 shrink-0 truncate text-[11px] text-ink">{c.label}</span>
                <span
                  className="h-3.5 rounded bg-brown"
                  style={{ width: `${(c.amount / max) * 100}%`, minWidth: 2 }}
                />
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-ink-muted">
                  {bakery.currency}
                  {c.amount.toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
