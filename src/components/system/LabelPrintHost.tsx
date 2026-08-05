"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/ui-store";
import { encodeCode39 } from "@/lib/barcode";

/**
 * Prints an asset's barcode label, mirroring ReportPrintHost exactly: set
 * `data-print` on <html>, inject an `@page` (which cannot be scoped by
 * selector), open the dialog, then undo both on `afterprint` AND on a timer —
 * Safari never fires `afterprint` on a cancelled dialog, which would otherwise
 * leave the page stuck in label mode.
 *
 * The label is a small page rather than A4: a 62mm × 29mm stock is what these
 * printers take, and one asset per page keeps the barcode at a size a handheld
 * scanner reads first time.
 */
const LABEL_HEIGHT_UNITS = 40;

export function LabelPrintHost() {
  const label = useUIStore((s) => s.labelTarget);
  const clearLabel = useUIStore((s) => s.clearLabel);

  useEffect(() => {
    if (!label) return;

    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = "@page { size: 62mm 29mm; margin: 1.5mm; }";

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      root.removeAttribute("data-print");
      style.remove();
      window.removeEventListener("afterprint", cleanup);
      clearLabel();
    };

    root.setAttribute("data-print", "label");
    document.head.appendChild(style);
    window.addEventListener("afterprint", cleanup);

    const t = setTimeout(() => {
      const prevTitle = document.title;
      document.title = `${label.code} label`;
      window.print();
      document.title = prevTitle;
      setTimeout(cleanup, 800);
    }, 100);

    return () => {
      clearTimeout(t);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  if (!label) return null;

  // A code that cannot be encoded must not silently print a blank label; the
  // caller checks first, so reaching here with one is a bug worth surfacing.
  let bars;
  try {
    bars = encodeCode39(label.code);
  } catch {
    return null;
  }

  // Bars carry their own x offset, accumulated up front rather than mutated
  // during render.
  const placed = bars.elements.reduce<{ x: number; bars: { x: number; units: number }[] }>(
    (acc, el) => ({
      x: acc.x + el.units,
      bars: el.bar ? [...acc.bars, { x: acc.x, units: el.units }] : acc.bars,
    }),
    { x: 0, bars: [] },
  ).bars;

  const rects = placed.map((b) => (
    <rect key={b.x} x={b.x} y={0} width={b.units} height={LABEL_HEIGHT_UNITS} fill="#000" />
  ));

  return (
    <div className="label-area" style={{ position: "absolute", left: "-9999px", top: 0 }}>
      {Array.from({ length: Math.max(1, label.copies) }, (_, copy) => (
        <div className="asset-label" key={copy}>
          <svg
            className="l-bars"
            viewBox={`0 0 ${bars.units} ${LABEL_HEIGHT_UNITS}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Barcode for ${label.code}`}
          >
            {rects}
          </svg>
          <div className="l-code">{bars.text}</div>
          <div className="l-name">{label.name}</div>
          <div className="l-meta">
            {label.category}
            {label.location ? ` · ${label.location}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
