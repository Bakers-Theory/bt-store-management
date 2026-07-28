"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { tabCls } from "@/components/ui/tabClass";
import { NoAccess } from "@/components/feature/NoAccess";
import { fetchAdvances } from "@/lib/supabase-data";
import { PayrollMonth } from "./PayrollMonth";
import { SalarySetup } from "./SalarySetup";
import { SalaryHistory } from "./SalaryHistory";
import { Advances } from "./Advances";

type Tab = "payroll" | "salaries" | "advances" | "history";

export function Salary() {
  const user = useCurrentUser();

  // Defence in depth on top of RLS, which is the real gate.
  const canSalary = hasPermission(user, "salary.view");
  const canAdvance = hasPermission(user, "advance.view");
  const canEdit = hasPermission(user, "salary.edit");
  const canPay = hasPermission(user, "salary.pay");
  const canRequest = hasPermission(user, "advance.request");
  const canApprove = hasPermission(user, "advance.approve");
  const canDeleteAdvance = hasPermission(user, "advance.delete");

  // Someone may hold advance.view without salary.view, so the default tab is
  // whichever they can actually open.
  const [tab, setTab] = useState<Tab>(canSalary ? "payroll" : "advances");
  const [pendingCount, setPendingCount] = useState(0);

  // The badge: advances awaiting approval. Only fetched by someone who can act
  // on them, so it never nags a viewer who cannot approve.
  useEffect(() => {
    if (!canApprove) return;
    let alive = true;
    fetchAdvances()
      .then((rows) => {
        if (alive) setPendingCount(rows.filter((a) => a.status === "pending").length);
      })
      .catch(() => {
        /* the badge is not worth a toast */
      });
    return () => {
      alive = false;
    };
  }, [canApprove, tab]);

  if (user && !hasAnyPermission(user, ["salary.view", "advance.view"])) {
    return <NoAccess />;
  }

  return (
    <>
      <div className="mb-4 flex w-fit max-w-full gap-1.5 overflow-x-auto rounded-xl bg-[#f4e7d2] p-1">
        {canSalary && (
          <button className={tabCls(tab === "payroll")} onClick={() => setTab("payroll")}>
            Payroll
          </button>
        )}
        {canSalary && (
          <button className={tabCls(tab === "salaries")} onClick={() => setTab("salaries")}>
            Salaries
          </button>
        )}
        {canAdvance && (
          <button className={tabCls(tab === "advances")} onClick={() => setTab("advances")}>
            Advances
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-bold text-warm-white">
                {pendingCount}
              </span>
            )}
          </button>
        )}
        {canSalary && (
          <button className={tabCls(tab === "history")} onClick={() => setTab("history")}>
            History
          </button>
        )}
      </div>

      {tab === "payroll" && canSalary ? (
        <PayrollMonth canEdit={canEdit} canPay={canPay} />
      ) : tab === "salaries" && canSalary ? (
        <SalarySetup canEdit={canEdit} />
      ) : tab === "advances" && canAdvance ? (
        <Advances
          canRequest={canRequest}
          canApprove={canApprove}
          canDelete={canDeleteAdvance}
        />
      ) : canSalary ? (
        <SalaryHistory />
      ) : (
        <Advances
          canRequest={canRequest}
          canApprove={canApprove}
          canDelete={canDeleteAdvance}
        />
      )}
    </>
  );
}
