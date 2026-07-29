"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { tabCls } from "@/components/ui/tabClass";
import { NoAccess } from "@/components/feature/NoAccess";
import { useUIStore } from "@/lib/ui-store";
import { fetchSuppliers } from "@/lib/supabase-data";
import { PurchaseInvoiceForm } from "./PurchaseInvoiceForm";
import { PurchaseReturnForm } from "./PurchaseReturnForm";
import { SupplierPaymentForm } from "./SupplierPaymentForm";
import type { Supplier } from "@/lib/types";

type Tab = "invoice" | "payment" | "return";

export function Purchases() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const canCreate = hasPermission(user, "purchases.create");
  const canPay = hasPermission(user, "purchases.pay");
  const canReturn = hasPermission(user, "purchases.return");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [token, setToken] = useState(0);
  // Default to whichever tab this user can actually open.
  const [tab, setTab] = useState<Tab>(canCreate ? "invoice" : canPay ? "payment" : "return");

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    fetchSuppliers()
      .then((rows) => alive && setSuppliers(rows))
      .catch(() => alive && toast("Couldn't load suppliers", "error"));
    return () => {
      alive = false;
    };
  }, [token, toast]);

  if (!canCreate && !canPay && !canReturn) return <NoAccess />;

  return (
    <>
      <h2 className="mb-1 text-xl font-extrabold text-ink">Purchases</h2>
      <p className="mb-4 text-sm text-ink-muted">
        Record what arrived, what you paid, and what went back.
      </p>

      <div className="mb-4 flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-xl bg-[#f4e7d2] p-1">
        {canCreate && (
          <button className={tabCls(tab === "invoice")} onClick={() => setTab("invoice")}>
            New purchase
          </button>
        )}
        {canPay && (
          <button className={tabCls(tab === "payment")} onClick={() => setTab("payment")}>
            Payment
          </button>
        )}
        {canReturn && (
          <button className={tabCls(tab === "return")} onClick={() => setTab("return")}>
            Return
          </button>
        )}
      </div>

      {tab === "invoice" && canCreate ? (
        <PurchaseInvoiceForm suppliers={suppliers} onPosted={reload} />
      ) : tab === "payment" && canPay ? (
        <SupplierPaymentForm suppliers={suppliers} onDone={reload} />
      ) : tab === "return" && canReturn ? (
        <PurchaseReturnForm suppliers={suppliers} onDone={reload} />
      ) : (
        <NoAccess />
      )}
    </>
  );
}
