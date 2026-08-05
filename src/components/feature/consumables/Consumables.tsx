"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import {
  fetchConsumableAlerts,
  fetchConsumableStats,
  fetchConsumablesPage,
  fetchPurchaseRecommendations,
  fetchStockMovementsPage,
} from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { movementTypeLabel } from "@/lib/consumable";
import { ConsumableTiles } from "./ConsumableTiles";
import {
  ConsumableFilters,
  DEFAULT_CONSUMABLE_FILTERS,
  type ConsumableFilterState,
} from "./ConsumableFilters";
import { ConsumableList, qtyLabel } from "./ConsumableList";
import { ConsumableForm } from "./ConsumableForm";
import { ConsumableDetail } from "./ConsumableDetail";
import { StockAlerts } from "./StockAlerts";
import type {
  Consumable,
  ConsumableAlert,
  ConsumableStats,
  StockMovement,
} from "@/lib/types";
// The filter COMPONENT above and the filter TYPE below share a name.
import type { ConsumableFilters as ConsumableQuery } from "@/lib/types";

const PAGE = 30;
const LEDGER_PAGE = 40;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const day = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

const toQuery = (f: ConsumableFilterState): ConsumableQuery => ({
  q: f.q.trim() || undefined,
  category: f.category || undefined,
  stockStatus: f.stockStatus || undefined,
  expiry: f.expiry || undefined,
});

type Tab = "inventory" | "alerts" | "movements";

export function Consumables() {
  const user = useCurrentUser();
  const lists = useBakeryStore((s) => s.lists);
  const toast = useUIStore((s) => s.toast);
  const canCreate = hasPermission(user, "consumables.create");

  const [tab, setTab] = useState<Tab>("inventory");
  const [filters, setFilters] = useState<ConsumableFilterState>(
    DEFAULT_CONSUMABLE_FILTERS,
  );
  const [items, setItems] = useState<Consumable[]>([]);
  const [stats, setStats] = useState<ConsumableStats | null>(null);
  const [alerts, setAlerts] = useState<ConsumableAlert[]>([]);
  const [recommendations, setRecommendations] = useState<Consumable[]>([]);
  const [ledger, setLedger] = useState<StockMovement[]>([]);
  const [ledgerMore, setLedgerMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Consumable | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const loadPage = useCallback(
    (offset: number) =>
      fetchConsumablesPage(offset, PAGE, toQuery(filters))
        .then((page) => {
          setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setHasMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the items", "error"))
        .finally(() => setLoaded(true)),
    [filters, toast],
  );

  const loadSummary = useCallback(() => {
    // Each of these is a summary panel, not the page — a failure leaves the
    // inventory list usable.
    fetchConsumableStats()
      .then(setStats)
      .catch(() => setStats(null));
    fetchConsumableAlerts()
      .then(setAlerts)
      .catch(() => setAlerts([]));
    fetchPurchaseRecommendations()
      .then(setRecommendations)
      .catch(() => setRecommendations([]));
  }, []);

  const loadLedger = useCallback(
    (offset: number) =>
      fetchStockMovementsPage(offset, LEDGER_PAGE, {})
        .then((page) => {
          setLedger((prev) =>
            offset === 0 ? page.movements : [...prev, ...page.movements],
          );
          setLedgerMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the stock movements", "error")),
    [toast],
  );

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  // The whole-store ledger is only fetched when its tab is actually opened.
  useEffect(() => {
    if (tab === "movements" && ledger.length === 0) void loadLedger(0);
  }, [tab, ledger.length, loadLedger]);

  const refresh = useCallback(() => {
    void loadPage(0);
    loadSummary();
    if (tab === "movements") void loadLedger(0);
  }, [loadPage, loadSummary, loadLedger, tab]);

  const pickTile = (tile: "all" | "low" | "out" | "expiring") => {
    setTab("inventory");
    switch (tile) {
      case "all":
        return setFilters(DEFAULT_CONSUMABLE_FILTERS);
      case "low":
        return setFilters({ ...DEFAULT_CONSUMABLE_FILTERS, stockStatus: "low" });
      case "out":
        return setFilters({ ...DEFAULT_CONSUMABLE_FILTERS, stockStatus: "out" });
      case "expiring":
        return setFilters({ ...DEFAULT_CONSUMABLE_FILTERS, expiry: "expiring" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Consumables</h1>
          <p className="text-xs text-ink-muted">
            What gets used up, what is left, and what to buy
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-[13px] bg-brown px-3.5 py-2.5 text-xs font-bold text-white"
          >
            <Plus size={14} /> Add item
          </button>
        )}
      </div>

      <ConsumableTiles stats={stats} onPick={pickTile} />

      <div className="flex gap-1.5 border-b border-line">
        {(
          [
            ["inventory", "Inventory"],
            ["alerts", `Alerts${alerts.length ? ` (${alerts.length})` : ""}`],
            ["movements", "Movements"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-bold ${
              tab === key ? "border-brown text-ink" : "border-transparent text-ink-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "inventory" && (
        <>
          <ConsumableFilters
            value={filters}
            categories={lists.consumableCategories}
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
              <ConsumableList items={items} onOpen={(c) => setViewingId(c.id)} />
              {hasMore && (
                <button
                  onClick={() => void loadPage(items.length)}
                  className="w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </>
      )}

      {tab === "alerts" && (
        <StockAlerts
          alerts={alerts}
          recommendations={recommendations}
          onOpen={setViewingId}
        />
      )}

      {tab === "movements" && (
        <div className="overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
          {ledger.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-ink-muted">
              No stock movements recorded yet.
            </p>
          ) : (
            <>
              {ledger.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setViewingId(m.consumableId)}
                  className="flex w-full items-center gap-3 border-t border-line-soft px-5 py-3 text-left first:border-t-0 hover:bg-[#faf4ea]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">
                      {m.itemName}
                      <span className="ml-1.5 font-normal text-ink-muted">
                        {movementTypeLabel(m.movementType)}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-ink-muted">
                      {day(m.onDate)}
                      {m.createdByName && ` · ${m.createdByName}`}
                      {m.reason && ` · ${m.reason}`}
                      {m.issuedToName && ` · to ${m.issuedToName}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[13px] font-bold tabular-nums ${
                      m.qtySigned > 0 ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {m.qtySigned > 0 ? "+" : "−"}
                    {qtyLabel(Math.abs(m.qtySigned))} {m.unit}
                  </span>
                </button>
              ))}
              {ledgerMore && (
                <button
                  onClick={() => void loadLedger(ledger.length)}
                  className="w-full border-t border-line-soft py-2.5 text-xs font-bold text-ink"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </div>
      )}

      {(adding || editing) && (
        <ConsumableForm
          item={editing}
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

      {viewingId && (
        <ConsumableDetail
          itemId={viewingId}
          onClose={() => setViewingId(null)}
          onEdit={(c) => {
            setViewingId(null);
            setEditing(c);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
