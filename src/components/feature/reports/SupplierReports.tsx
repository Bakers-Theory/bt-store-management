"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchSupplierReportData } from "@/lib/supabase-data";
import { exportSupplierReports } from "@/lib/excel";
import {
  SUPPLIER_REPORT_META,
  SUPPLIER_REPORT_TYPES,
  supplierReport,
  type SupplierReportType,
} from "@/lib/supplier-report";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { NoAccess } from "@/components/feature/NoAccess";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

export function SupplierReports() {
  const user = useCurrentUser();
  const bakery = useBakeryStore((s) => s.bakery);
  const toast = useUIStore((s) => s.toast);
  const requestReport = useUIStore((s) => s.requestReport);

  const [selected, setSelected] = useState<SupplierReportType[]>(["supplierPurchases"]);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [busy, setBusy] = useState<"print" | "excel" | null>(null);

  if (user && !hasPermission(user, "suppliers.reports")) return <NoAccess />;

  const shop = {
    name: bakery.name,
    address: bakery.address,
    phone: bakery.phone,
    currency: bakery.currency,
  };

  const toggle = (t: SupplierReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const load = async () => {
    const data = await fetchSupplierReportData(range);
    return { shop, ...data };
  };

  const doPrint = async () => {
    if (selected.length !== 1) {
      toast("Pick exactly one report to print", "error");
      return;
    }
    setBusy("print");
    try {
      // The print dialog renders one A4 document, so printing is deliberately
      // single-report; Excel is the route for several at once.
      requestReport(supplierReport(selected[0], await load(), range));
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
      const types = SUPPLIER_REPORT_TYPES.filter((t) => selected.includes(t)); // fixed order
      const r = await exportSupplierReports(types, await load(), range);
      toast(r.ok ? "Report downloaded" : r.error ?? "Export failed", r.ok ? "success" : "error");
    } catch {
      toast("Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <span className={labelCls}>Reports</span>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {SUPPLIER_REPORT_TYPES.map((t) => {
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
                className="h-4 w-4 accent-brown"
                checked={checked}
                onChange={() => toggle(t)}
              />
              <span className="font-semibold text-ink">{SUPPLIER_REPORT_META[t].name}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-4">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <p className="mt-2.5 text-xs text-ink-muted">
        Dates apply to all reports except Outstanding Payments, which is always a
        position as it stands today. In-house production is reported separately in
        Supplier-wise Purchases and excluded from Outstanding Payments, GST Purchases
        and Payment History.
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-warm-white p-3 text-sm font-bold text-ink disabled:opacity-60"
          onClick={doPrint}
          disabled={busy !== null || selected.length !== 1}
        >
          {busy === "print" ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          Print / Save as PDF
        </button>
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white disabled:opacity-60"
          onClick={doExport}
          disabled={busy !== null || selected.length === 0}
        >
          {busy === "excel" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Download Excel{selected.length ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}
