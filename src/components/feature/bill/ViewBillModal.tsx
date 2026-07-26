"use client";

import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { Receipt } from "./Receipt";
import type { Bill } from "@/lib/types";

export function ViewBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const requestPrint = useUIStore((s) => s.requestPrint);
  const user = useCurrentUser();
  return (
    <Modal title={`Bill #${bill.billNo}`} onClose={onClose}>
      <Receipt bill={bill} />
      {hasPermission(user, "bill.print") && (
        <button
          className="btn-primary mt-4 flex w-full items-center justify-center gap-2"
          onClick={() => requestPrint(bill)}
        >
          <Printer size={16} /> Print (3&quot; Thermal)
        </button>
      )}
    </Modal>
  );
}
