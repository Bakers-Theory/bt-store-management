"use client";

import { MessageCircle, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { useBakeryStore } from "@/lib/store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { shareBillOnWhatsApp } from "@/lib/whatsapp";
import { Receipt } from "./Receipt";
import type { Bill } from "@/lib/types";

export function ViewBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const requestPrint = useUIStore((s) => s.requestPrint);
  const bakery = useBakeryStore((s) => s.bakery);
  const user = useCurrentUser();
  return (
    <Modal title={`Bill #${bill.billNo}`} onClose={onClose}>
      <Receipt bill={bill} />
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
