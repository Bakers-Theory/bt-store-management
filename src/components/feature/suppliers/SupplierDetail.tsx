"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { tabCls } from "@/components/ui/tabClass";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { SupplierProfileTab } from "./SupplierProfileTab";
import { SupplierProductsTab } from "./SupplierProductsTab";
import { SupplierSummaryTab } from "./SupplierSummaryTab";
import { SupplierTransactionsTab } from "./SupplierTransactionsTab";
import type { Supplier } from "@/lib/types";

type Tab = "profile" | "products" | "transactions" | "summary";

export function SupplierDetail({
  supplier,
  onClose,
  onChanged,
}: {
  supplier: Supplier;
  onClose: () => void;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  // Defence in depth on top of RLS, which is the real gate.
  const canFinancial = hasPermission(user, "suppliers.financial");
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <Modal title={`${supplier.name} · ${supplier.code}`} onClose={onClose}>
      <div className="mb-4 flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-xl bg-[#f4e7d2] p-1">
        <button className={tabCls(tab === "profile")} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button className={tabCls(tab === "products")} onClick={() => setTab("products")}>
          Products
        </button>
        <button className={tabCls(tab === "transactions")} onClick={() => setTab("transactions")}>
          Transactions
        </button>
        {canFinancial && (
          <button className={tabCls(tab === "summary")} onClick={() => setTab("summary")}>
            Account summary
          </button>
        )}
      </div>

      {tab === "profile" ? (
        <SupplierProfileTab supplier={supplier} onChanged={onChanged} />
      ) : tab === "products" ? (
        <SupplierProductsTab supplier={supplier} />
      ) : tab === "transactions" ? (
        <SupplierTransactionsTab supplier={supplier} />
      ) : canFinancial ? (
        <SupplierSummaryTab supplier={supplier} />
      ) : (
        <SupplierProfileTab supplier={supplier} onChanged={onChanged} />
      )}
    </Modal>
  );
}
