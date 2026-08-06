"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { Receipt } from "@/components/feature/bill/Receipt";
import { TaxInvoice } from "@/components/feature/bill/TaxInvoice";

/**
 * Renders the current print target off-screen, then triggers the print dialog.
 * The @media print rules in globals.css hide everything except `.print-area`.
 *
 * TWO PAPERS, one host. A non-GST bill is a thermal receipt on an 80mm roll; a
 * GST tax invoice is an A4 sheet in an ordinary printer, because it has to
 * carry both parties' details, per-line HSN and a tax summary. Which one is
 * printing is decided by the bill, not by a setting — the invoice type already
 * says what the document is.
 *
 * For the A4 case this mirrors ReportPrintHost exactly: set `data-print` on
 * <html> so the print CSS can scope itself, and INJECT the `@page`, because
 * `@page` cannot be scoped by a selector.
 */
export function PrintHost() {
  const target = useUIStore((s) => s.printTarget);
  const clearPrint = useUIStore((s) => s.clearPrint);
  const isInvoice = target?.invoiceType === "gst";

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
      document.title = target.invoiceNo ?? `Invoice #${target.billNo}`;
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
      {target && (isInvoice ? <TaxInvoice bill={target} /> : <Receipt bill={target} />)}
    </div>
  );
}
