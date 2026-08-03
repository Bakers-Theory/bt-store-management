"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import {
  fetchCashCategories,
  fetchExpenseVendors,
  fetchExpensesPage,
} from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { NoAccess } from "@/components/feature/NoAccess";
import { ExpenseList } from "./ExpenseList";
import {
  DEFAULT_EXPENSE_FILTERS,
  ExpenseFilters,
  type ExpenseFilterState,
} from "./ExpenseFilters";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseDetail } from "./ExpenseDetail";
import type { CashCategory, Expense } from "@/lib/types";
// The filter COMPONENT above and the filter TYPE below share a name.
import type { ExpenseFilters as ExpenseQuery } from "@/lib/types";

const PAGE = 30;

/** Drop the empty-string sentinels the selects use before querying. */
const toQuery = (f: ExpenseFilterState): ExpenseQuery => ({
  from: f.range.from ?? undefined,
  to: f.range.to ?? undefined,
  categoryId: f.categoryId || undefined,
  vendor: f.vendor || undefined,
  minAmount: f.minAmount === "" ? undefined : Number(f.minAmount),
  maxAmount: f.maxAmount === "" ? undefined : Number(f.maxAmount),
  paymentMode: f.paymentMode || undefined,
  status: f.status || undefined,
  q: f.q.trim() || undefined,
});

export function Expenses() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const canCreate = hasPermission(user, "expense.create");

  const [filters, setFilters] = useState<ExpenseFilterState>(DEFAULT_EXPENSE_FILTERS);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<CashCategory[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);

  const loadPage = useCallback(
    (offset: number) =>
      fetchExpensesPage(offset, PAGE, toQuery(filters))
        .then((page) => {
          setExpenses((prev) =>
            offset === 0 ? page.expenses : [...prev, ...page.expenses],
          );
          setHasMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the expenses", "error"))
        .finally(() => setLoaded(true)),
    [filters, toast],
  );

  const reloadCategories = useCallback(() => {
    fetchCashCategories()
      .then(setCategories)
      .catch(() => toast("Couldn't load the categories", "error"));
  }, [toast]);

  useEffect(() => {
    reloadCategories();
    // A failed vendor list must not block the register — it only fills a select.
    fetchExpenseVendors()
      .then(setVendors)
      .catch(() => setVendors([]));
  }, [toast]);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const refresh = useCallback(() => {
    void loadPage(0);
    fetchExpenseVendors()
      .then(setVendors)
      .catch(() => setVendors([]));
  }, [loadPage]);

  // cashbook.view reaches this route, but the register itself needs expense.view.
  if (user && !hasPermission(user, "expense.view")) return <NoAccess />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link
            href="/cashbook"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8a6a3c]"
          >
            <ArrowLeft size={13} /> Cashbook
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Expenses</h1>
          <p className="text-xs text-ink-muted">What the store spent, and on what</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-[13px] bg-brown px-3.5 py-2.5 text-xs font-bold text-white"
          >
            <Plus size={14} /> Add expense
          </button>
        )}
      </div>

      <ExpenseFilters
        value={filters}
        categories={categories}
        vendors={vendors}
        onChange={setFilters}
      />

      {!loaded ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[14px]" />
          ))}
        </div>
      ) : (
        <>
          <ExpenseList expenses={expenses} onOpen={setViewing} />
          {hasMore && (
            <button
              onClick={() => void loadPage(expenses.length)}
              className="w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink"
            >
              Load more
            </button>
          )}
        </>
      )}

      {(adding || editing) && (
        <ExpenseForm
          expense={editing}
          categories={categories}
          onCategoriesChanged={reloadCategories}
          vendors={vendors}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            refresh();
          }}
        />
      )}

      {viewing && (
        <ExpenseDetail
          expenseId={viewing.id}
          onClose={() => setViewing(null)}
          onEdit={(e) => {
            setViewing(null);
            setEditing(e);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
