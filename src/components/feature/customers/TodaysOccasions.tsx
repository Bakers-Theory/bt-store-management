"use client";

import { Cake, Send } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { occasionForToday, storeToday } from "@/lib/loyalty";
import { shareOfferOnWhatsApp } from "@/lib/whatsapp";
import type { Customer, OccasionKind } from "@/lib/types";

/**
 * Whose birthday or anniversary is today. Rendered only when the programme is
 * on and at least one customer matches, so the page is unchanged on any
 * ordinary day.
 */
export function TodaysOccasions({ customers }: { customers: Customer[] }) {
  const bakery = useBakeryStore((s) => s.bakery);
  const loyalty = bakery.loyalty;

  if (!loyalty.enabled) return null;

  const today = storeToday(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const matches: { customer: Customer; kind: OccasionKind }[] = [];
  for (const c of customers) {
    const kind = occasionForToday(c, today);
    if (kind) matches.push({ customer: c, kind });
  }

  if (matches.length === 0) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-[18px] border border-line bg-warm-white shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <div className="flex items-center gap-2 border-b border-line-soft px-5 py-3">
        <Cake size={16} className="text-brown" />
        <h3 className="text-[13px] font-extrabold tracking-[.04em] text-ink">
          TODAY&rsquo;S OCCASIONS
        </h3>
      </div>
      {matches.map(({ customer, kind }) => (
        <div
          key={customer.id}
          className="flex items-center gap-3 border-t border-line-soft px-5 py-3 first:border-t-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-ink">
              {customer.name || customer.phone}
            </div>
            <div className="text-[11.5px] text-ink-light">
              {kind === "birthday" ? "🎂 Birthday" : "💍 Anniversary"}
              {customer.pointsBalance > 0 && ` · ${customer.pointsBalance} points`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shareOfferOnWhatsApp(customer, bakery, kind, loyalty)}
            className="btn-sm btn-secondary inline-flex shrink-0 items-center gap-1.5"
          >
            <Send size={14} /> Send offer
          </button>
        </div>
      ))}
    </div>
  );
}
