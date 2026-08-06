"use client";

import { MessageCircle, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { shareBillOnWhatsApp } from "@/lib/whatsapp";
import { Receipt } from "./Receipt";
import { TaxInvoice } from "./TaxInvoice";
import type { Bill } from "@/lib/types";

export function ViewBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const requestPrint = useUIStore((s) => s.requestPrint);
  const bakery = useBakeryStore((s) => s.bakery);
  const user = useCurrentUser();
  return (
    <Modal title={bill.invoiceNo ?? `Bill #${bill.billNo}`} onClose={onClose}>
      {/* The invoice type decides the document, so a reprint is always the
          same paper the customer was originally handed. */}
      {bill.invoiceType === "gst" ? <TaxInvoice bill={bill} /> : <Receipt bill={bill} />}
      {bill.shortfall > 0 && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2.5 text-[13px]">
          <div className="flex justify-between font-semibold text-ink">
            <span>Received</span>
            <span className="num">
              {bakery.currency}
              {(bill.total - bill.shortfall).toFixed(2)}
            </span>
          </div>
          <div className="mt-1 flex justify-between font-bold text-danger">
            <span>Shortfall (loss)</span>
            <span className="num">
              {bakery.currency}
              {bill.shortfall.toFixed(2)}
            </span>
          </div>
          {bill.shortfallNote !== "" && (
            <p className="mt-1.5 text-[12px] text-ink-muted">{bill.shortfallNote}</p>
          )}
        </div>
      )}
      {hasPermission(user, "bill.print") && (
        <div className="mt-4 flex gap-2.5">
          <button
            className="btn-primary flex flex-1 items-center justify-center gap-2"
            onClick={() => requestPrint(bill)}
          >
            <Printer size={16} /> Print
          </button>
          <button
            className="btn-secondary flex flex-1 items-center justify-center gap-2"
            onClick={() => shareBillOnWhatsApp(bill, bakery)}
          >
            <MessageCircle size={16} /> Share
          </button>
        </div>
      )}
    </Modal>
  );
}
