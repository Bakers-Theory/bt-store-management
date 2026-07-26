"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { ReportDocument } from "./ReportDocument";

/**
 * Renders the requested report off-screen and opens the print dialog, mirroring
 * PrintHost. Two things it must do that the receipt host doesn't:
 *
 *  - set `data-print="report"` on <html>, which the print CSS uses to pick the
 *    report document over the receipt;
 *  - inject an A4 `@page`, because `@page` cannot be scoped by a selector.
 *
 * Both are undone afterwards, on a timer as well as `afterprint` — Safari never
 * fires `afterprint` when the dialog is cancelled, which would otherwise leave
 * the page stuck in report mode.
 */
export function ReportPrintHost() {
  const report = useUIStore((s) => s.reportTarget);
  const clearReport = useUIStore((s) => s.clearReport);

  useEffect(() => {
    if (!report) return;

    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = "@page { size: A4 portrait; margin: 14mm 12mm; }";

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      root.removeAttribute("data-print");
      style.remove();
      window.removeEventListener("afterprint", cleanup);
      clearReport();
    };

    root.setAttribute("data-print", "report");
    document.head.appendChild(style);
    window.addEventListener("afterprint", cleanup);

    // Let the document paint before the dialog samples it (same 100ms the
    // receipt host uses). The title becomes the suggested PDF filename.
    const t = setTimeout(() => {
      const prevTitle = document.title;
      document.title = report.fileName;
      window.print();
      document.title = prevTitle;
      setTimeout(cleanup, 800);
    }, 100);

    return () => {
      clearTimeout(t);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  if (!report) return null;

  return (
    <div className="report-area" style={{ position: "absolute", left: "-9999px", top: 0 }}>
      <ReportDocument
        report={report}
        // Stamped when the print is requested, not during render, so it can't
        // differ between the server and the client.
        generatedAt={report.generatedAt}
      />
    </div>
  );
}
