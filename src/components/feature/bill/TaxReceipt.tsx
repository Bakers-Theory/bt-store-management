"use client";

import { Croissant, Phone } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { amountInWords, hsnSummary } from "@/lib/gst";
import type { Bill } from "@/lib/types";
import { gstRowsForBill } from "./gst-rows";

/**
 * 80mm thermal tax invoice — the same GST-compliant content as the A4
 * `TaxInvoice`, laid out one column wide so it survives a receipt printer.
 *
 * Why it exists: the counter has a thermal printer and no sheet printer, but a
 * GST bill still has to carry both parties' GSTINs, place of supply, per-line
 * HSN and rate, the CGST/SGST (or IGST) split and the HSN-wise summary. So the
 * paper changes; nothing is dropped.
 *
 * It reuses the `.receipt*` classes on purpose — the print CSS in globals.css
 * already sizes those to the roll, so this needs no page rules of its own. Like
 * `TaxInvoice` it renders STORED values only (see `gstRowsForBill`).
 */
export function TaxReceipt({ bill }: { bill: Bill }) {
  const b = useBakeryStore((s) => s.bakery);
  const cur = b.currency;
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const dt = new Date(bill.date);
  const dateStr = dt.toLocaleDateString("en-IN");
  const timeStr = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const rows = gstRowsForBill(bill);
  const summary = hsnSummary(rows);

  return (
    <div className="receipt">
      {bill.status === "cancelled" && (
        <div className="receipt-center mb-2 rounded-md border-2 border-danger p-1 text-[15px] font-bold text-danger">
          *** CANCELLED ***
        </div>
      )}
      <div className="receipt-center">
        {b.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logo} className="receipt-logo" alt="logo" />
        ) : (
          <div className="receipt-logo-placeholder flex items-center justify-center">
            <Croissant size={20} />
          </div>
        )}
        <div className="text-[15px] font-bold">{b.name}</div>
        {b.tagline && <div className="text-[11px]">{b.tagline}</div>}
        {b.address && <div className="text-[10px]">{b.address}</div>}
        {b.phone && (
          <div className="flex items-center justify-center gap-1 text-[10px]">
            <Phone size={10} /> {b.phone}
          </div>
        )}
        {b.gst && <div className="text-[10px]">GSTIN: {b.gst}</div>}
        {b.gstStateCode && <div className="text-[10px]">State code: {b.gstStateCode}</div>}
      </div>
      <div className="receipt-divider" />
      <div className="receipt-center text-[13px] font-bold tracking-wide">TAX INVOICE</div>
      <div className="receipt-divider" />
      <div className="receipt-row">
        <span>Invoice no:</span>
        <span className="font-bold">{bill.invoiceNo ?? `#${bill.billNo}`}</span>
      </div>
      <div className="receipt-row"><span>Date:</span><span>{dateStr}</span></div>
      <div className="receipt-row"><span>Time:</span><span>{timeStr}</span></div>
      {bill.billerName && (
        <div className="receipt-row"><span>Invoiced by:</span><span>{bill.billerName}</span></div>
      )}
      <div className="receipt-divider" />
      <div className="receipt-row">
        <span>Billed to:</span>
        <span className="font-bold">{bill.customerName || "Walk-in customer"}</span>
      </div>
      {bill.customerPhone && (
        <div className="receipt-row"><span>Phone:</span><span className="font-bold">{bill.customerPhone}</span></div>
      )}
      {/* "Unregistered" rather than blank: a B2C tax invoice is valid, and an
          empty field reads as a missing detail instead of a fact. */}
      <div className="receipt-row">
        <span>Customer GSTIN:</span>
        <span>{bill.customerGstin || "Unregistered"}</span>
      </div>
      <div className="receipt-row">
        <span>Place of supply:</span>
        <span>{bill.placeOfSupply || "—"}</span>
      </div>
      <div className="receipt-row">
        <span>Supply:</span>
        <span>{bill.isInterstate ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}</span>
      </div>
      <div className="receipt-divider" />

      {/* One block per line: the roll is too narrow for a nine-column table, so
          each line's HSN, rate and tax split stack under its name instead. */}
      {rows.map((r, i) => (
        <div key={i} className="mb-1.5 text-[11px]">
          <div className="font-bold">
            {i + 1}. {r.name}
          </div>
          <div className="receipt-row">
            <span>HSN {r.hsn || "—"} · GST {r.gstRate}%</span>
            <span>Qty {r.qty}</span>
          </div>
          <div className="receipt-row">
            <span>Taxable</span>
            <span>{money(r.taxable)}</span>
          </div>
          {bill.isInterstate ? (
            <div className="receipt-row">
              <span>IGST</span>
              <span>{money(r.igst)}</span>
            </div>
          ) : (
            <>
              <div className="receipt-row">
                <span>CGST</span>
                <span>{money(r.cgst)}</span>
              </div>
              <div className="receipt-row">
                <span>SGST</span>
                <span>{money(r.sgst)}</span>
              </div>
            </>
          )}
          <div className="receipt-row font-bold">
            <span>Line total</span>
            <span>{money(r.total)}</span>
          </div>
        </div>
      ))}

      <div className="receipt-divider" />
      {bill.discountAmount > 0 && (
        <div className="receipt-row">
          <span>
            Discount before tax
            {bill.discountType === "percent" ? ` (${bill.discountPercent}%)` : ""}
          </span>
          <span>−{money(bill.discountAmount)}</span>
        </div>
      )}
      <div className="receipt-row">
        <span>Taxable value</span>
        <span>{money(bill.taxableValue)}</span>
      </div>
      {bill.isInterstate ? (
        <div className="receipt-row"><span>IGST</span><span>{money(bill.igst)}</span></div>
      ) : (
        <>
          <div className="receipt-row"><span>CGST</span><span>{money(bill.cgst)}</span></div>
          <div className="receipt-row"><span>SGST</span><span>{money(bill.sgst)}</span></div>
        </>
      )}
      <div className="receipt-row"><span>Total tax</span><span>{money(bill.tax)}</span></div>
      <div className="receipt-divider" />
      <div className="receipt-row text-[15px] font-bold">
        <span>TOTAL</span><span>{money(bill.total)}</span>
      </div>
      <div className="receipt-divider" />
      <div className="text-[10px]">
        <span className="font-bold">In words:</span> {amountInWords(bill.total)}
      </div>
      <div className="receipt-divider" />
      <div className="receipt-row"><span>Paid via:</span><span className="font-bold">{bill.paymentMethod}</span></div>
      <div className="receipt-divider" />

      <div className="text-[10px] font-bold">HSN-wise tax summary</div>
      {summary.map((s) => (
        <div key={`${s.hsn}-${s.gstRate}`} className="text-[10px]">
          <div className="receipt-row">
            <span>
              {s.hsn || "—"} @ {s.gstRate}% · qty {s.qty}
            </span>
            <span>{money(s.taxable)}</span>
          </div>
          <div className="receipt-row">
            <span />
            <span>
              {bill.isInterstate
                ? `IGST ${money(s.igst)}`
                : `CGST ${money(s.cgst)} · SGST ${money(s.sgst)}`}
            </span>
          </div>
        </div>
      ))}
      <div className="receipt-divider" />
      <div className="receipt-center text-[9px] leading-snug">
        Declaration: we certify that the particulars given above are true and
        correct, and that the amount indicated represents the price actually
        charged.
      </div>
      <div className="receipt-center mt-1.5 text-[11px]">
        Thank you for your visit!
        <br />
        Please come again
      </div>
    </div>
  );
}
