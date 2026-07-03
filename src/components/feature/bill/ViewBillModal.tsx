"use client";

import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { Receipt } from "./Receipt";
import type { Bill } from "@/lib/types";

export function ViewBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const requestPrint = useUIStore((s) => s.requestPrint);
  return (
    <Modal title={`Bill #${bill.billNo}`} onClose={onClose}>
      <Receipt bill={bill} />
      <button
        className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
        onClick={() => requestPrint(bill)}
      >
        <Printer size={16} /> Print (3&quot; Thermal)
      </button>
    </Modal>
  );
}
