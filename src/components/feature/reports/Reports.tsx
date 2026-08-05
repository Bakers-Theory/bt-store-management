"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { exportReports, REPORT_META, type ReportType } from "@/lib/excel";
import { fetchReportCounts, fetchReportData, type ReportCounts } from "@/lib/supabase-data";
import { NoAccess } from "@/components/feature/NoAccess";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { hasPermission } from "@/lib/permissions";
import { tabCls } from "@/components/ui/tabClass";
import { SupplierReports } from "./SupplierReports";
import { CashbookReports } from "./CashbookReports";
import { AssetReports } from "./AssetReports";
import { ConsumableReports } from "./ConsumableReports";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

const ALL_REPORTS: ReportType[] = [
  "sales", "bills", "products", "stock", "stockLog", "customers", "analytics", "expiry",
];

export function Reports() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  // Declared above the hooks below so the pane's initial state can read them —
  // a hook must not sit under a conditional return.
  const canStore = hasPermission(user, "reports.view");
  const canSuppliers = hasPermission(user, "suppliers.reports");
  const canCashbook = hasPermission(user, "cashbook.reports");
  const canAssets = hasPermission(user, "assets.reports");
  const canConsumables = hasPermission(user, "consumables.reports");

  type Pane = "store" | "suppliers" | "cashbook" | "assets" | "consumables";
  const [pane, setPane] = useState<Pane>(
    canStore
      ? "store"
      : canSuppliers
        ? "suppliers"
        : canCashbook
          ? "cashbook"
          : canAssets
            ? "assets"
            : "consumables",
  );
  const [selected, setSelected] = useState<ReportType[]>(["sales"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [counts, setCounts] = useState<ReportCounts | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Cheap HEAD count queries for the preview — refreshed when the range changes.
  // The heavy full-store fetch is deferred to the Download click.
  useEffect(() => {
    let alive = true;
    setCounts(null);
    setLoadFailed(false);
    fetchReportCounts({ from: from || null, to: to || null })
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [from, to]);

  if (user && !canStore && !canSuppliers && !canCashbook && !canAssets && !canConsumables)
    return <NoAccess />;
  const canExport = hasPermission(user, "reports.export");

  const toggle = (t: ReportType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const allChecked = selected.length === ALL_REPORTS.length;
  const toggleAll = () => setSelected(allChecked ? [] : [...ALL_REPORTS]);

  const range = { from: from || null, to: to || null };

  const doExport = async () => {
    if (selected.length === 0) {
      toast("Select at least one report", "error");
      return;
    }
    if (from && to && from > to) {
      toast("From date must be before To date", "error");
      return;
    }
    setExporting(true);
    try {
      const types = ALL_REPORTS.filter((t) => selected.includes(t)); // fixed order
      const payload = await fetchReportData();
      const r = await exportReports(types, payload, range);
      toast(r.ok ? "Report downloaded" : r.error ?? "Export failed", r.ok ? "success" : "error");
    } catch {
      toast("Export failed", "error");
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

      {[canStore, canSuppliers, canCashbook, canAssets, canConsumables].filter(Boolean)
        .length > 1 && (
        <div className="mb-4 flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-xl bg-[#f4e7d2] p-1">
          {canStore && (
            <button className={tabCls(pane === "store")} onClick={() => setPane("store")}>
              Store
            </button>
          )}
          {canSuppliers && (
            <button className={tabCls(pane === "suppliers")} onClick={() => setPane("suppliers")}>
              Suppliers
            </button>
          )}
          {canCashbook && (
            <button className={tabCls(pane === "cashbook")} onClick={() => setPane("cashbook")}>
              Cashbook
            </button>
          )}
          {canAssets && (
            <button className={tabCls(pane === "assets")} onClick={() => setPane("assets")}>
              Assets
            </button>
          )}
          {canConsumables && (
            <button
              className={tabCls(pane === "consumables")}
              onClick={() => setPane("consumables")}
            >
              Consumables
            </button>
          )}
        </div>
      )}

      {pane === "cashbook" && canCashbook ? (
        <CashbookReports />
      ) : pane === "assets" && canAssets ? (
        <AssetReports />
      ) : pane === "consumables" && canConsumables ? (
        <ConsumableReports />
      ) : pane === "suppliers" && canSuppliers ? (
        <SupplierReports />
      ) : !canStore ? (
        // Someone holding only a module's report key lands on the first pane
        // they can actually open, rather than on the store reports they cannot.
        canSuppliers ? (
          <SupplierReports />
        ) : canAssets ? (
          <AssetReports />
        ) : (
          <ConsumableReports />
        )
      ) : (
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
            : counts
              ? `In range: ${counts.billsInRange} bill${counts.billsInRange === 1 ? "" : "s"} · ${counts.logsInRange} stock movement${counts.logsInRange === 1 ? "" : "s"}. Snapshot: ${counts.items} products · ${counts.customers} customers.`
              : "Loading record counts…"}
        </p>

        <p className="mt-1.5 text-xs text-ink-muted">
          Dates apply to Sales, Bills, Stock Log and Analytics. Products, Stock, Customers and Expiry
          always export the full current snapshot.
        </p>

        {canExport ? (
          <button
            className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-success p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={doExport}
            disabled={exporting || selected.length === 0}
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{" "}
            {exporting ? "Preparing…" : `Download Excel${selected.length ? ` (${selected.length})` : ""}`}
          </button>
        ) : (
          <p className="mt-5 rounded-xl bg-cream p-3 text-center text-[12.5px] font-semibold text-ink-muted">
            You don&apos;t have permission to export reports.
          </p>
        )}
      </div>
      )}
    </div>
  );
}
