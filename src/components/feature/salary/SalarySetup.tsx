"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { initials } from "@/lib/format";
import { calendarDays, round2 } from "@/lib/salary";
import {
  fetchAdvanceBalances,
  fetchEmployeeSalaries,
  rpcSetEmployeeSalary,
} from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import type { EmployeeSalary } from "@/lib/types";

export function SalarySetup({ canEdit }: { canEdit: boolean }) {
  const currency = useBakeryStore((s) => s.bakery.currency);
  const toast = useUIStore((s) => s.toast);

  const [rows, setRows] = useState<EmployeeSalary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Keyed by profile id so two rows can be edited without clobbering each other.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(false);
    fetchEmployeeSalaries()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [retry]);

  const [balances, setBalances] = useState<Record<string, number>>({});

  // Advance balances are a separate permission, so a failure here must not
  // break the salary list — the line simply doesn't appear.
  useEffect(() => {
    let alive = true;
    fetchAdvanceBalances()
      .then((rows) => {
        if (!alive) return;
        setBalances(Object.fromEntries(rows.map((r) => [r.profileId, r.balance])));
      })
      .catch(() => {
        /* no advance.view — the line is simply omitted */
      });
    return () => {
      alive = false;
    };
  }, [retry]);

  const save = async (r: EmployeeSalary) => {
    const raw = draft[r.profileId];
    const amount = round2(parseFloat(raw ?? "") || 0);
    if (amount < 0) {
      toast("Salary cannot be negative", "error");
      return;
    }
    setBusy(r.profileId);
    try {
      await rpcSetEmployeeSalary(r.profileId, amount);
      setRows((prev) =>
        prev.map((x) =>
          x.profileId === r.profileId
            ? { ...x, monthlySalary: amount, updatedAt: new Date().toISOString() }
            : x,
        ),
      );
      setDraft((d) => {
        const next = { ...d };
        delete next[r.profileId];
        return next;
      });
      toast(`Salary saved for ${r.employeeName}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save salary", "error");
    } finally {
      setBusy(null);
    }
  };

  // Shown per row so the calendar-day divisor isn't a hidden rule.
  const now = new Date();
  const daysThisMonth = calendarDays(now.getFullYear(), now.getMonth() + 1);

  if (!loaded) {
    return (
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-[14px]" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center text-sm text-ink-muted">
        <p className="mb-3">Couldn&apos;t load salaries.</p>
        <button
          type="button"
          onClick={() => setRetry((t) => t + 1)}
          className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
        >
          Retry
        </button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No staff yet — add people under Settings → Staff first.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const value = draft[r.profileId] ?? String(r.monthlySalary || "");
          const dirty =
            draft[r.profileId] !== undefined &&
            round2(parseFloat(value) || 0) !== r.monthlySalary;
          const perDay = r.monthlySalary > 0 ? r.monthlySalary / daysThisMonth : 0;
          return (
            <div
              key={r.profileId}
              className="rounded-[14px] border border-line bg-warm-white p-3.5 shadow-[0_2px_12px_rgba(100,60,20,0.04)]"
            >
              <div className="flex items-center gap-[11px]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-cream-dark text-sm font-bold text-brown">
                  {initials(r.employeeName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{r.employeeName}</div>
                  <div className="text-[11.5px] text-ink-light">
                    {r.monthlySalary > 0
                      ? `${currency}${perDay.toFixed(2)} per day this month (${daysThisMonth} days)`
                      : "No salary set — not on the payroll"}
                  </div>
                  {(balances[r.profileId] ?? 0) > 0 && (
                    <div className="mt-0.5 text-[11.5px] font-semibold text-warn">
                      {currency}
                      {(balances[r.profileId] ?? 0).toFixed(2)} advance outstanding
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-ink-light">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    disabled={!canEdit || busy === r.profileId}
                    value={value}
                    placeholder="0.00"
                    aria-label={`Monthly salary for ${r.employeeName}`}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [r.profileId]: e.target.value }))
                    }
                    className="w-full rounded-[11px] border border-line bg-cream py-[11px] pl-8 pr-3 text-sm outline-none focus:border-brown disabled:opacity-60"
                  />
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => save(r)}
                    disabled={!dirty || busy === r.profileId}
                    className="inline-flex items-center gap-1.5 rounded-[11px] bg-brown px-4 py-[11px] text-[13px] font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === r.profileId ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    Save
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[12px] text-ink-light">
        Monthly salary. The per-day rate is the salary divided by the number of
        calendar days in that month, so it changes between a 28- and a 31-day
        month.
      </p>
      {!canEdit && (
        <p className="mt-2 rounded-xl bg-cream p-3 text-center text-[12.5px] font-semibold text-ink-muted">
          You can view salaries but not change them.
        </p>
      )}
    </>
  );
}
