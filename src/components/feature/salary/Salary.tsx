"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasPermission } from "@/lib/permissions";
import { tabCls } from "@/components/ui/tabClass";
import { NoAccess } from "@/components/feature/NoAccess";
import { PayrollMonth } from "./PayrollMonth";
import { SalarySetup } from "./SalarySetup";
import { SalaryHistory } from "./SalaryHistory";

export function Salary() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<"payroll" | "salaries" | "history">("payroll");

  // Defence in depth on top of RLS, which is the real gate.
  if (user && !hasPermission(user, "salary.view")) return <NoAccess />;
  const canEdit = hasPermission(user, "salary.edit");
  const canPay = hasPermission(user, "salary.pay");

  return (
    <>
      <div className="mb-4 flex w-fit gap-1.5 rounded-xl bg-[#f4e7d2] p-1">
        <button className={tabCls(tab === "payroll")} onClick={() => setTab("payroll")}>
          Payroll
        </button>
        <button className={tabCls(tab === "salaries")} onClick={() => setTab("salaries")}>
          Salaries
        </button>
        <button className={tabCls(tab === "history")} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {tab === "payroll" ? (
        <PayrollMonth canEdit={canEdit} canPay={canPay} />
      ) : tab === "salaries" ? (
        <SalarySetup canEdit={canEdit} />
      ) : (
        <SalaryHistory />
      )}
    </>
  );
}
