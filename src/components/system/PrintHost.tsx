"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { Receipt } from "@/components/feature/bill/Receipt";
import { TaxInvoice } from "@/components/feature/bill/TaxInvoice";
import { TaxReceipt } from "@/components/feature/bill/TaxReceipt";

/**
 * Renders the current print target off-screen, then triggers the print dialog.
 * The @media print rules in globals.css hide everything except `.print-area`.
 *
 * TWO PAPERS, one host. The 80mm roll carries either a plain `Receipt` (non-GST)
 * or a `TaxReceipt` (the same GST content, one column wide); A4 carries the
 * `TaxInvoice`. The paper is the caller's choice — a counter with only a thermal
 * printer must still be able to hand over a full tax invoice — and defaults per
 * invoice type via `defaultPrintFormat`.
 *
 * For the A4 case this mirrors ReportPrintHost exactly: set `data-print` on
 * <html> so the print CSS can scope itself, and INJECT the `@page`, because
 * `@page` cannot be scoped by a selector.
 */
export function PrintHost() {
  const target = useUIStore((s) => s.printTarget);
  const clearPrint = useUIStore((s) => s.clearPrint);
  const isInvoice = target?.format === "a4";

  useEffect(() => {
    if (!target) return;

    const root = document.documentElement;
    let style: HTMLStyleElement | null = null;
    if (isInvoice) {
      style = document.createElement("style");
      style.textContent = "@page { size: A4 portrait; margin: 12mm; }";
      root.setAttribute("data-print", "invoice");
      document.head.appendChild(style);
    }

    const t = setTimeout(() => {
      // The browser uses document.title as the suggested filename when the
      // print dialog saves to PDF. Set it to the invoice number, then restore.
      const prevTitle = document.title;
      document.title = target.bill.invoiceNo ?? `Invoice #${target.bill.billNo}`;
      window.print();
      document.title = prevTitle;
      clearPrint();
    }, 100);

    return () => {
      clearTimeout(t);
      // Always unwind, even on the receipt path where neither was set — leaving
      // `data-print="invoice"` behind would put the NEXT receipt on A4.
      root.removeAttribute("data-print");
      style?.remove();
    };
  }, [target, isInvoice, clearPrint]);

  return (
    <div
      className="print-area"
      style={target ? { position: "absolute", left: "-9999px", top: 0 } : { display: "none" }}
    >
      {target &&
        (isInvoice ? (
          <TaxInvoice bill={target.bill} />
        ) : target.bill.invoiceType === "gst" ? (
          <TaxReceipt bill={target.bill} />
        ) : (
          <Receipt bill={target.bill} />
        ))}
    </div>
  );
}
