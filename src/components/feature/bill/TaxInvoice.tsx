"use client";

import { useBakeryStore } from "@/lib/store";
import { amountInWords, hsnSummary } from "@/lib/gst";
import type { GstLineResult } from "@/lib/gst";
import type { Bill } from "@/lib/types";

/**
 * A4 tax invoice — the GST-compliant counterpart to the thermal `Receipt`.
 *
 * It renders STORED values only. Every line's tax was computed by
 * `generate_bill` and snapshotted onto `bill_items` at checkout; recomputing it
 * here could print a figure the customer was never charged, which is the one
 * thing an invoice must never do.
 */
export function TaxInvoice({ bill }: { bill: Bill }) {
  const b = useBakeryStore((s) => s.bakery);
  const cur = b.currency;
  const dt = new Date(bill.date);
  const money = (n: number) => `${cur}${n.toFixed(2)}`;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Charged consumables are supplies on the invoice; absorbed ones never
  // reached the customer and must not appear on it.
  const rows: GstLineResult[] = [
    ...bill.items.map((i) => ({
      name: i.name,
      hsn: i.hsn,
      gstRate: i.gstRate,
      qty: i.qty,
      amount: round2(i.qty * i.price),
      discount: 0,
      taxable: i.taxableValue,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      tax: round2(i.cgst + i.sgst + i.igst),
      total: round2(i.taxableValue + i.cgst + i.sgst + i.igst),
    })),
    ...bill.consumables
      .filter((c) => c.charged)
      .map((c) => ({
        name: c.name,
        hsn: c.hsn,
        gstRate: c.gstRate,
        qty: c.qty,
        amount: round2(c.qty * c.unitCost),
        discount: 0,
        taxable: c.taxableValue,
        cgst: c.cgst,
        sgst: c.sgst,
        igst: c.igst,
        tax: round2(c.cgst + c.sgst + c.igst),
        total: round2(c.taxableValue + c.cgst + c.sgst + c.igst),
      })),
  ];
  const summary = hsnSummary(rows);

  return (
    <div className="tax-invoice">
      <style>{`
        /* The brand palette, not a grey facsimile of it — this is the document
           the customer keeps. Tints stay light so an ordinary inkjet is not
           asked to flood a sheet, and every figure still reads in mono. */
        .tax-invoice { width: 190mm; max-width: 100%; font-size: 11px; line-height: 1.45;
                       color: var(--color-ink); background: var(--color-warm-white);
                       border-top: 3px solid var(--color-brown); }
        .tax-invoice table { width: 100%; border-collapse: collapse; }
        .tax-invoice th, .tax-invoice td { border: 1px solid var(--color-line);
                                           padding: 4px 6px;
                                           text-align: left; vertical-align: top; }
        .tax-invoice th { background: var(--color-cream); color: var(--color-brown);
                          font-weight: 700; }
        .tax-invoice tfoot th { background: var(--color-cream-dark);
                                color: var(--color-brown-dark); }
        .tax-invoice .num { text-align: right; font-variant-numeric: tabular-nums; }
        .ti-box { border: 1px solid var(--color-line); }
        .ti-head { display: flex; justify-content: space-between; gap: 16px;
                   border: 1px solid var(--color-line); border-bottom: none;
                   padding: 10px 12px; background: var(--color-cream); }
        .ti-shop { font-size: 16px; font-weight: 800; color: var(--color-brown); }
        .ti-title { font-size: 14px; font-weight: 800; color: var(--color-brown);
                    letter-spacing: .06em; }
        .ti-parties { display: flex; border: 1px solid var(--color-line);
                      border-bottom: none; }
        .ti-party { flex: 1; padding: 8px 12px; }
        .ti-party + .ti-party { border-left: 1px solid var(--color-line); }
        .ti-label { font-size: 9.5px; text-transform: uppercase;
                    letter-spacing: .04em; color: var(--color-ink-light); }
        .ti-foot { display: flex; justify-content: space-between; gap: 24px;
                   border: 1px solid var(--color-line); border-top: none;
                   padding: 8px 12px; background: var(--color-cream); }
        .ti-grand { font-size: 13px; font-weight: 800; color: var(--color-brown-dark); }
        .ti-decl { margin-top: 8px; font-size: 10px; color: var(--color-ink-muted); }
        .ti-sign { margin-top: 34px; border-top: 1px solid var(--color-line-strong);
                   padding-top: 4px; }
        .ti-cancelled { border: 2px solid var(--color-danger); color: var(--color-danger);
                        font-weight: 700; text-align: center; padding: 4px;
                        margin-bottom: 6px; }
        /* No @page here: PrintHost injects it, the way ReportPrintHost does.
           Two competing @page rules would leave the paper size decided by
           stylesheet order rather than by intent. */
        @media print {
          /* Browsers drop background colours when printing unless told
             otherwise — without this the tinted bands vanish and the invoice
             prints as the plain grey sheet it used to be. */
          .tax-invoice { width: auto; font-size: 10pt;
                         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* Keep a table's header with at least some of its body, and never
             split a row down the middle of a page. */
          .tax-invoice tr { break-inside: avoid; }
          .tax-invoice thead { display: table-header-group; }
        }
      `}</style>

      {bill.status === "cancelled" && (
        <div className="ti-cancelled">*** CANCELLED ***</div>
      )}

      <div className="ti-head">
        <div>
          <div className="ti-shop">{b.name}</div>
          {b.address && <div>{b.address}</div>}
          {b.phone && <div>Phone: {b.phone}</div>}
          {b.gst && <div>GSTIN: {b.gst}</div>}
          {b.gstStateCode && <div>State code: {b.gstStateCode}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ti-title">TAX INVOICE</div>
          <div>
            Invoice no: <strong>{bill.invoiceNo ?? `#${bill.billNo}`}</strong>
          </div>
          <div>Date: {dt.toLocaleDateString("en-IN")}</div>
          <div>Place of supply: {bill.placeOfSupply || "—"}</div>
        </div>
      </div>

      <div className="ti-parties">
        <div className="ti-party">
          <div className="ti-label">Billed to</div>
          <div style={{ fontWeight: 700 }}>{bill.customerName || "Walk-in customer"}</div>
          {bill.customerPhone && <div>{bill.customerPhone}</div>}
          {/* "Unregistered" rather than blank: a B2C tax invoice is valid, and
              an empty field reads as a missing detail instead of a fact. */}
          <div>GSTIN: {bill.customerGstin || "Unregistered"}</div>
        </div>
        <div className="ti-party">
          <div className="ti-label">Supply type</div>
          <div>{bill.isInterstate ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}</div>
          <div className="ti-label" style={{ marginTop: "6px" }}>
            Payment
          </div>
          <div>{bill.paymentMethod}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: "22px" }}>#</th>
            <th>Description</th>
            <th style={{ width: "52px" }}>HSN</th>
            <th className="num" style={{ width: "40px" }}>Qty</th>
            <th className="num" style={{ width: "62px" }}>Taxable</th>
            <th className="num" style={{ width: "38px" }}>Rate</th>
            {bill.isInterstate ? (
              <th className="num" style={{ width: "62px" }}>IGST</th>
            ) : (
              <>
                <th className="num" style={{ width: "58px" }}>CGST</th>
                <th className="num" style={{ width: "58px" }}>SGST</th>
              </>
            )}
            <th className="num" style={{ width: "68px" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.hsn || "—"}</td>
              <td className="num">{r.qty}</td>
              <td className="num">{money(r.taxable)}</td>
              <td className="num">{r.gstRate}%</td>
              {bill.isInterstate ? (
                <td className="num">{money(r.igst)}</td>
              ) : (
                <>
                  <td className="num">{money(r.cgst)}</td>
                  <td className="num">{money(r.sgst)}</td>
                </>
              )}
              <td className="num">{money(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={4} className="num">Total</th>
            <th className="num">{money(bill.taxableValue)}</th>
            <th />
            {bill.isInterstate ? (
              <th className="num">{money(bill.igst)}</th>
            ) : (
              <>
                <th className="num">{money(bill.cgst)}</th>
                <th className="num">{money(bill.sgst)}</th>
              </>
            )}
            <th className="num">{money(bill.total)}</th>
          </tr>
        </tfoot>
      </table>

      {bill.discountAmount > 0 && (
        <div
          className="ti-box"
          style={{ borderTop: "none", padding: "6px 12px" }}
        >
          Discount applied before tax: −{money(bill.discountAmount)}
          {bill.discountType === "percent" ? ` (${bill.discountPercent}%)` : ""}
        </div>
      )}

      <div style={{ marginTop: "10px" }}>
        <div className="ti-label" style={{ marginBottom: "4px" }}>
          HSN-wise tax summary
        </div>
        <table>
          <thead>
            <tr>
              <th>HSN</th>
              <th className="num" style={{ width: "44px" }}>Rate</th>
              <th className="num" style={{ width: "50px" }}>Qty</th>
              <th className="num" style={{ width: "72px" }}>Taxable</th>
              {bill.isInterstate ? (
                <th className="num" style={{ width: "72px" }}>IGST</th>
              ) : (
                <>
                  <th className="num" style={{ width: "68px" }}>CGST</th>
                  <th className="num" style={{ width: "68px" }}>SGST</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={`${s.hsn}-${s.gstRate}`}>
                <td>{s.hsn || "—"}</td>
                <td className="num">{s.gstRate}%</td>
                <td className="num">{s.qty}</td>
                <td className="num">{money(s.taxable)}</td>
                {bill.isInterstate ? (
                  <td className="num">{money(s.igst)}</td>
                ) : (
                  <>
                    <td className="num">{money(s.cgst)}</td>
                    <td className="num">{money(s.sgst)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3} className="num">Total</th>
              <th className="num">{money(bill.taxableValue)}</th>
              {bill.isInterstate ? (
                <th className="num">{money(bill.igst)}</th>
              ) : (
                <>
                  <th className="num">{money(bill.cgst)}</th>
                  <th className="num">{money(bill.sgst)}</th>
                </>
              )}
            </tr>
          </tfoot>
        </table>
        {/* The summary totals and the invoice totals are sums of the same
            stored line values, so they cannot disagree. */}
      </div>

      <div className="ti-foot" style={{ borderTop: "1px solid var(--color-line)", marginTop: "10px" }}>
        <div style={{ flex: 1 }}>
          <div className="ti-label">Amount in words</div>
          <div style={{ fontWeight: 700 }}>{amountInWords(bill.total)}</div>
          <div className="ti-decl">
            Declaration: we certify that the particulars given above are true and
            correct, and that the amount indicated represents the price actually
            charged.
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: "150px" }}>
          <div className="ti-grand">Grand total {money(bill.total)}</div>
          <div className="ti-sign">For {b.name}</div>
        </div>
      </div>
    </div>
  );
}
