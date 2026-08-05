"use client";

import { AlertTriangle, ShoppingCart } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { alertLabel } from "@/lib/consumable";
import { qtyLabel } from "./ConsumableList";
import type { Consumable, ConsumableAlert } from "@/lib/types";

/**
 * §3.4's alerts panel and §3.5's purchase recommendations, side by side because
 * they answer the same question ("what needs doing?") from two directions.
 *
 * Neither is stored: the alerts come from `consumable_alert_v` and the suggested
 * quantities from `consumable_v`, both derived on read — so nothing here can be
 * a leftover from a condition that has since been fixed.
 */
export function StockAlerts({
  alerts,
  recommendations,
  onOpen,
}: {
  alerts: ConsumableAlert[];
  recommendations: Consumable[];
  onOpen: (id: string) => void;
}) {
  const currency = useBakeryStore((s) => s.bakery.currency);

  const suggestedCost = recommendations.reduce(
    (sum, r) => sum + r.recommendedQty * (r.lastPurchaseCost ?? r.costPerUnit ?? 0),
    0,
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-[18px] border border-line bg-warm-white p-3 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-ink">
          <AlertTriangle size={14} className="text-amber-600" /> Stock alerts
          <span className="font-normal text-ink-muted">({alerts.length})</span>
        </h3>
        {alerts.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-muted">
            Nothing needs attention.
          </p>
        ) : (
          <div className="space-y-1">
            {alerts.map((a) => (
              <button
                key={`${a.consumableId}-${a.alert}`}
                onClick={() => onOpen(a.consumableId)}
                className="flex w-full items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-left hover:bg-[#faf4ea]"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    a.severity >= 2
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {alertLabel(a.alert)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-ink">
                    {a.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {a.message}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-bold tabular-nums text-ink">
                  {qtyLabel(a.currentStock)} {a.unit}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-[18px] border border-line bg-warm-white p-3 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-ink">
          <ShoppingCart size={14} className="text-[#8a6a3c]" /> What to buy
          <span className="font-normal text-ink-muted">({recommendations.length})</span>
        </h3>
        {recommendations.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-muted">
            Nothing needs ordering.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {recommendations.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  className="flex w-full items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-left hover:bg-[#faf4ea]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-ink">
                      {r.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {qtyLabel(r.currentStock)} of {qtyLabel(r.minStock)} {r.unit}
                      {r.vendorName && ` · ${r.vendorName}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[12.5px] font-bold tabular-nums text-ink">
                      {qtyLabel(r.recommendedQty)} {r.unit}
                    </span>
                    {(r.lastPurchaseCost ?? r.costPerUnit) !== null && (
                      <span className="block text-[10.5px] text-ink-muted">
                        ≈ {currency}
                        {(
                          r.recommendedQty * (r.lastPurchaseCost ?? r.costPerUnit ?? 0)
                        ).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            {suggestedCost > 0 && (
              <p className="mt-2 text-[11px] text-ink-muted">
                About {currency}
                {suggestedCost.toLocaleString("en-IN", { maximumFractionDigits: 2 })} at
                the last price paid. A suggestion only — nothing is ordered from here.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
