"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Plus, Receipt } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import {
  fetchCashCategories,
  fetchCashDaySummary,
  fetchCashEntriesPage,
  fetchCashbookSummary,
  rpcDeleteCashEntry,
} from "@/lib/supabase-data";
import { periodLabel } from "@/lib/cashbook";
import { isoDateLocal } from "@/lib/excel";
import { Skeleton } from "@/components/ui/Skeleton";
import { CashbookTiles } from "./CashbookTiles";
import { CashbookTable } from "./CashbookTable";
import {
  CashbookFilters,
  DEFAULT_CASHBOOK_FILTERS,
  type CashbookFilterState,
} from "./CashbookFilters";
import { CashEntryModal } from "./CashEntryModal";
import { CashTransferModal } from "./CashTransferModal";
import type { CashCategory, CashDaySummary, CashEntry, CashbookSummary } from "@/lib/types";

const PAGE = 40;

/** Drop the empty-string sentinels the selects use before querying. */
const toFilters = (f: CashbookFilterState) => ({
  from: f.range.from ?? undefined,
  to: f.range.to ?? undefined,
  account: f.account || undefined,
  direction: f.direction || undefined,
  categoryId: f.categoryId || undefined,
  paymentMode: f.paymentMode || undefined,
  sourceType: f.sourceType || undefined,
  q: f.q.trim() || undefined,
});

export function Cashbook() {
  const user = useCurrentUser();
  const toast = useUIStore((s) => s.toast);
  const canEdit = hasPermission(user, "cashbook.entry");

  const [filters, setFilters] = useState<CashbookFilterState>(DEFAULT_CASHBOOK_FILTERS);
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [categories, setCategories] = useState<CashCategory[]>([]);
  const [summary, setSummary] = useState<CashbookSummary | null>(null);
  const [daySummary, setDaySummary] = useState<CashDaySummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CashEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // The summary follows the filter range, so the tiles and the list below them
  // always describe the same slice of time. Balances inside it stay live.
  const range = filters.range;
  const loadSummary = useCallback(() => {
    fetchCashbookSummary(range)
      .then(setSummary)
      .catch(() => toast("Couldn't load the balances", "error"));
  }, [range, toast]);

  const loadPage = useCallback(
    (offset: number) => {
      setBusy(true);
      return fetchCashEntriesPage(offset, PAGE, toFilters(filters))
        .then((page) => {
          setEntries((prev) => (offset === 0 ? page.entries : [...prev, ...page.entries]));
          setHasMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the cash book", "error"))
        .finally(() => {
          setBusy(false);
          setLoaded(true);
        });
    },
    [filters, toast],
  );

  const reloadCategories = useCallback(() => {
    fetchCashCategories()
      .then(setCategories)
      .catch(() => toast("Couldn't load the categories", "error"));
  }, [toast]);

  // Categories are bounded and slow-changing: fetched once, not per range.
  useEffect(() => {
    reloadCategories();
  }, [reloadCategories]);

  // Today's reconciliation figures don't depend on the range filter, so fetch
  // once rather than on every range change.
  useEffect(() => {
    fetchCashDaySummary(isoDateLocal(new Date()))
      .then(setDaySummary)
      .catch(() => toast("Couldn't load today's reconciliation", "error"));
  }, [toast]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Refetch from the top whenever the filters change.
  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const refresh = useCallback(() => {
    loadSummary();
    void loadPage(0);
  }, [loadPage, loadSummary]);

  const remove = (e: CashEntry) => {
    if (!confirm(`Remove this entry?\n\n${e.categoryPath} — ${e.note}`)) return;
    rpcDeleteCashEntry(e.id)
      .then(() => {
        toast("Entry removed", "success");
        refresh();
      })
      .catch((err: Error) => toast(err.message, "error"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Cashbook</h1>
          <p className="text-xs text-ink-muted">Every rupee in and out, cash and bank</p>
        </div>
        {/* Day close is reached from the Today card below — one route, not two. */}
        <div className="flex gap-2">
          {hasPermission(user, "expense.view") && (
            <Link
              href="/cashbook/expenses"
              className="inline-flex items-center gap-1.5 rounded-[13px] border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink"
            >
              <Receipt size={14} /> Expenses
            </Link>
          )}
          {canEdit && (
            <>
              <button
                onClick={() => setTransferring(true)}
                className="inline-flex items-center gap-1.5 rounded-[13px] border border-line bg-warm-white px-3.5 py-2.5 text-xs font-bold text-ink"
              >
                <ArrowLeftRight size={14} /> Transfer
              </button>
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-[13px] bg-brown px-3.5 py-2.5 text-xs font-bold text-white"
              >
                <Plus size={14} /> Add entry
              </button>
            </>
          )}
        </div>
      </div>

      <CashbookTiles
        summary={summary}
        daySummary={daySummary}
        periodLabel={periodLabel(range, isoDateLocal(new Date()))}
      />

      <CashbookFilters value={filters} categories={categories} onChange={setFilters} />

      {!loaded ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[14px]" />
          ))}
        </div>
      ) : (
        <>
          <CashbookTable
            entries={entries}
            canEdit={canEdit}
            currentUserId={user?.id ?? ""}
            onEdit={setEditing}
            onDelete={remove}
          />
          {hasMore && (
            <button
              disabled={busy}
              onClick={() => void loadPage(entries.length)}
              className="w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink disabled:opacity-50"
            >
              {busy ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}

      {(adding || editing) && (
        <CashEntryModal
          entry={editing}
          categories={categories}
          onCategoriesChanged={reloadCategories}
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

      {transferring && (
        <CashTransferModal
          onClose={() => setTransferring(false)}
          onSaved={() => {
            setTransferring(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
