"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { exportReport, REPORT_META, type ReportType } from "@/lib/excel";
import { fetchReportData } from "@/lib/supabase-data";
import { NoAccess } from "@/components/feature/NoAccess";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const ORDER: ReportType[] = ["full", "sales", "bills", "products", "stock", "stockLog", "customers", "analytics"];

export function Reports() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);

  const [type, setType] = useState<ReportType>("full");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);

  if (user && user.role !== "Owner") return <NoAccess />;

  const isSnapshot = REPORT_META[type].snapshot;

  const doExport = async () => {
    if (!isSnapshot && from && to && from > to) {
      toast("From date must be before To date");
      return;
    }
    setExporting(true);
    try {
      const range = isSnapshot
        ? { from: null, to: null }
        : { from: from || null, to: to || null };
      const data = await fetchReportData();
      const r = await exportReport(type, data, range);
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
        Pick a report and an optional date range, then download it as an Excel file.
      </p>

      <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <label className={labelCls} htmlFor="report-type">Report</label>
        <select
          id="report-type"
          className={inputCls}
          value={type}
          onChange={(e) => setType(e.target.value as ReportType)}
        >
          {ORDER.map((t) => (
            <option key={t} value={t}>{REPORT_META[t].name}</option>
          ))}
        </select>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="from-date">From</label>
            <input id="from-date" type="date" className={inputCls} value={from}
              disabled={isSnapshot} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="to-date">To</label>
            <input id="to-date" type="date" className={inputCls} value={to}
              disabled={isSnapshot} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          {isSnapshot
            ? "This report always exports the full current snapshot."
            : "Leave dates empty to export all records."}
        </p>

        <button
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={doExport}
          disabled={exporting}
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{" "}
          {exporting ? "Preparing…" : "Download Excel"}
        </button>
      </div>
    </div>
  );
}
