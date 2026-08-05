"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Plus, Upload, X } from "lucide-react";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import {
  fetchAssetHolders,
  fetchAssetStats,
  fetchAssetsPage,
} from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { AssetTiles } from "./AssetTiles";
import {
  AssetFilters,
  DEFAULT_ASSET_FILTERS,
  type AssetFilterState,
} from "./AssetFilters";
import { AssetList } from "./AssetList";
import { AssetForm } from "./AssetForm";
import { AssetDetail } from "./AssetDetail";
import { BulkImportModal } from "@/components/feature/BulkImportModal";
import { BulkAssignModal } from "./BulkAssignModal";
import type { Asset, AssetStats, Employee } from "@/lib/types";
// The filter COMPONENT above and the filter TYPE below share a name.
import type { AssetFilters as AssetQuery } from "@/lib/types";

const PAGE = 30;

/** Drop the empty-string sentinels the selects use before querying. */
const toQuery = (f: AssetFilterState): AssetQuery => ({
  q: f.q.trim() || undefined,
  category: f.category || undefined,
  status: f.status || undefined,
  employeeId: f.employeeId || undefined,
  warranty: f.warranty || undefined,
  serviceDue: f.serviceDue || undefined,
  includeArchived: f.includeArchived || undefined,
});

export function Assets() {
  const user = useCurrentUser();
  const lists = useBakeryStore((s) => s.lists);
  const toast = useUIStore((s) => s.toast);
  const canCreate = hasPermission(user, "assets.create");
  const canAssign = hasPermission(user, "assets.assign");

  const [filters, setFilters] = useState<AssetFilterState>(DEFAULT_ASSET_FILTERS);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [holders, setHolders] = useState<Employee[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Selection mode for bulk assignment. Null = off, so the plain list is the
  // default and nothing about the normal flow changes.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const loadPage = useCallback(
    (offset: number) =>
      fetchAssetsPage(offset, PAGE, toQuery(filters))
        .then((page) => {
          setAssets((prev) => (offset === 0 ? page.assets : [...prev, ...page.assets]));
          setHasMore(page.hasMore);
        })
        .catch(() => toast("Couldn't load the assets", "error"))
        .finally(() => setLoaded(true)),
    [filters, toast],
  );

  const loadStats = useCallback(() => {
    // The tiles are a summary, not the page: a failed stats call must not stop
    // the register from rendering.
    fetchAssetStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    loadStats();
    fetchAssetHolders()
      .then(setHolders)
      .catch(() => setHolders([]));
  }, [loadStats]);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const refresh = useCallback(() => {
    void loadPage(0);
    loadStats();
  }, [loadPage, loadStats]);

  // The tiles double as filters — tapping one is how you get to the list behind
  // the number.
  const pickTile = (tile: Parameters<Parameters<typeof AssetTiles>[0]["onPick"]>[0]) => {
    switch (tile) {
      case "all":
        return setFilters(DEFAULT_ASSET_FILTERS);
      case "assigned":
        return setFilters({ ...DEFAULT_ASSET_FILTERS, status: "assigned" });
      case "available":
        return setFilters({ ...DEFAULT_ASSET_FILTERS, status: "available" });
      case "repair":
        return setFilters({ ...DEFAULT_ASSET_FILTERS, status: "under_repair" });
      case "service":
        return setFilters({ ...DEFAULT_ASSET_FILTERS, serviceDue: true });
      case "warranty":
        return setFilters({ ...DEFAULT_ASSET_FILTERS, warranty: "expiring" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Assets</h1>
          <p className="text-xs text-ink-muted">
            What the store owns, who has it, and what it needs
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <button
              onClick={() => setImporting(true)}
              className="inline-flex items-center gap-1.5 rounded-[13px] border border-line bg-warm-white px-3 py-2.5 text-xs font-bold text-ink"
            >
              <Upload size={14} /> Import
            </button>
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-[13px] bg-brown px-3.5 py-2.5 text-xs font-bold text-white"
            >
              <Plus size={14} /> Add asset
            </button>
          </div>
        )}
      </div>

      <AssetTiles stats={stats} onPick={pickTile} />

      <AssetFilters
        value={filters}
        categories={lists.assetCategories}
        holders={holders}
        onChange={setFilters}
      />

      {canAssign && (
        <div className="flex flex-wrap items-center gap-2">
          {picked === null ? (
            <button
              onClick={() => setPicked(new Set())}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-[12.5px] font-bold text-ink"
            >
              <CheckSquare size={13} /> Issue several
            </button>
          ) : (
            <>
              <span className="text-[12.5px] font-bold text-ink">
                {picked.size} selected
              </span>
              <button
                disabled={picked.size === 0}
                onClick={() => setBulkAssigning(true)}
                className="inline-flex items-center gap-1.5 rounded-[11px] bg-brown px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
              >
                Issue to…
              </button>
              <button
                onClick={() => setPicked(null)}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-cream px-2.5 py-2 text-[12.5px] font-bold text-[#8a6a3c]"
              >
                <X size={13} /> Cancel
              </button>
              <span className="text-[11px] text-ink-muted">
                Only available assets can be picked.
              </span>
            </>
          )}
        </div>
      )}

      {!loaded ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[14px]" />
          ))}
        </div>
      ) : (
        <>
          <AssetList
            assets={assets}
            onOpen={(a) => setViewingId(a.id)}
            selected={picked ?? undefined}
            onToggleSelect={
              picked
                ? (id) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                : undefined
            }
          />
          {hasMore && (
            <button
              onClick={() => void loadPage(assets.length)}
              className="w-full rounded-[13px] border border-line bg-warm-white py-2.5 text-xs font-bold text-ink"
            >
              Load more
            </button>
          )}
        </>
      )}

      {(adding || editing) && (
        <AssetForm
          asset={editing}
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

      {importing && (
        <BulkImportModal
          mode="assets"
          context={{ categories: lists.assetCategories }}
          onClose={() => setImporting(false)}
          onDone={refresh}
        />
      )}

      {bulkAssigning && picked && (
        <BulkAssignModal
          assets={assets.filter((a) => picked.has(a.id))}
          holders={holders}
          // The modal closes itself only when every asset was issued; on a
          // partial failure it stays open to show which ones, so `onDone` must
          // refresh WITHOUT unmounting it.
          onClose={() => {
            setBulkAssigning(false);
            setPicked(null);
          }}
          onDone={refresh}
        />
      )}

      {viewingId && (
        <AssetDetail
          assetId={viewingId}
          holders={holders}
          onClose={() => setViewingId(null)}
          onEdit={(a) => {
            setViewingId(null);
            setEditing(a);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
