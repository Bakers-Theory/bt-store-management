"use client";

import { Croissant, Phone } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import type { Bill } from "@/lib/types";

export function Receipt({ bill }: { bill: Bill }) {
  const b = useBakeryStore((s) => s.bakery);
  const dt = new Date(bill.date);
  const dateStr = dt.toLocaleDateString("en-IN");
  const timeStr = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

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
        {b.gst && <div className="text-[10px]">GST: {b.gst}</div>}
      </div>
      <div className="receipt-divider" />
      <div className="receipt-row"><span>Bill No:</span><span>#{bill.billNo}</span></div>
      <div className="receipt-row"><span>Date:</span><span>{dateStr}</span></div>
      <div className="receipt-row"><span>Time:</span><span>{timeStr}</span></div>
      {bill.billerName && (
        <div className="receipt-row"><span>Invoiced by:</span><span>{bill.billerName}</span></div>
      )}
      {bill.customerName && (
        <div className="receipt-row"><span>Customer:</span><span className="font-bold">{bill.customerName}</span></div>
      )}
      {bill.customerPhone && (
        <div className="receipt-row"><span>Phone:</span><span className="font-bold">{bill.customerPhone}</span></div>
      )}
      <div className="receipt-divider" />
      <div className="receipt-row font-bold">
        <span>Item</span><span>Qty x Price = Amt</span>
      </div>
      <div className="receipt-divider" />
      {bill.items.map((bi, idx) => (
        <div key={idx} className="mb-1 text-[11px]">
          <div>{bi.name}</div>
          <div className="receipt-row">
            <span />
            <span>
              {bi.qty} x {b.currency}
              {bi.price.toFixed(2)} = {b.currency}
              {(bi.qty * bi.price).toFixed(2)}
            </span>
          </div>
        </div>
      ))}
      <div className="receipt-divider" />
      <div className="receipt-row"><span>Subtotal</span><span>{b.currency}{bill.subtotal.toFixed(2)}</span></div>
      {bill.discountPercent > 0 && (
        <div className="receipt-row">
          <span>Discount ({bill.discountPercent}%)</span>
          <span>−{b.currency}{((bill.subtotal * bill.discountPercent) / 100).toFixed(2)}</span>
        </div>
      )}
      {bill.tax > 0 && (
        <div className="receipt-row">
          <span>Tax ({bill.taxRate}%)</span>
          <span>{b.currency}{bill.tax.toFixed(2)}</span>
        </div>
      )}
      <div className="receipt-divider" />
      <div className="receipt-row text-[15px] font-bold">
        <span>TOTAL</span><span>{b.currency}{bill.total.toFixed(2)}</span>
      </div>
      <div className="receipt-divider" />
      <div className="receipt-row"><span>Paid via:</span><span className="font-bold">{bill.paymentMethod}</span></div>
      <div className="receipt-divider" />
      <div className="receipt-center mt-1.5 text-[11px]">
        Thank you for your visit!
        <br />
        Please come again
      </div>
    </div>
  );
}
