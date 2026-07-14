"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { Receipt } from "@/components/feature/bill/Receipt";

/**
 * Renders the receipt for the current print target off-screen, then triggers
 * the browser print dialog. The @media print rules in globals.css hide
 * everything except `.print-area`.
 */
export function PrintHost() {
  const target = useUIStore((s) => s.printTarget);
  const clearPrint = useUIStore((s) => s.clearPrint);

  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => {
      // The browser uses document.title as the suggested filename when the
      // print dialog saves to PDF. Set it to the invoice number, then restore.
      const prevTitle = document.title;
      document.title = `Invoice #${target.billNo}`;
      window.print();
      document.title = prevTitle;
      clearPrint();
    }, 100);
    return () => clearTimeout(t);
  }, [target, clearPrint]);

  return (
    <div
      className="print-area"
      style={target ? { position: "absolute", left: "-9999px", top: 0 } : { display: "none" }}
    >
      {target && <Receipt bill={target} />}
    </div>
  );
}
