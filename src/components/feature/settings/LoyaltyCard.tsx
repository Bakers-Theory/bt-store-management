"use client";

import { useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { pointsEarned, redeemValue } from "@/lib/loyalty";
import type { LoyaltySettings } from "@/lib/types";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown disabled:opacity-50";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

/** The worked example uses a representative bill so the numbers feel real. */
const EXAMPLE_BILL = 850;

export function LoyaltyCard() {
  const stored = useBakeryStore((s) => s.bakery.loyalty);
  const saveSettings = useBakeryStore((s) => s.saveSettings);
  const bakery = useBakeryStore((s) => s.bakery);
  const toast = useUIStore((s) => s.toast);

  const [form, setForm] = useState<LoyaltySettings>(stored);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof LoyaltySettings>(key: K, value: LoyaltySettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Compared field by field: LoyaltySettings is flat, so this is exact.
  const dirty = (Object.keys(form) as (keyof LoyaltySettings)[]).some(
    (k) => form[k] !== stored[k],
  );

  // The example is computed with the programme forced on, so it still reads
  // sensibly while the owner is deciding whether to switch it on at all.
  const preview = { ...form, enabled: true };
  const earned = pointsEarned(EXAMPLE_BILL, preview);
  const worth = redeemValue(500, preview);

  const save = async () => {
    if (form.pointsAmountUnit <= 0 || form.pointsPerRupee <= 0) {
      toast("The rupee block and the redemption rate must both be more than zero", "error");
      return;
    }
    setSaving(true);
    try {
      await saveSettings({
        name: bakery.name,
        tagline: bakery.tagline,
        address: bakery.address,
        phone: bakery.phone,
        gst: bakery.gst,
        currency: bakery.currency,
        gstStateCode: bakery.gstStateCode,
        pricesIncludeGst: bakery.pricesIncludeGst,
        lowStockAlert: bakery.lowStockAlert,
        expiringSoonDays: bakery.expiringSoonDays,
        loyaltyEnabled: form.enabled,
        pointsPerAmount: form.pointsPerAmount,
        pointsAmountUnit: form.pointsAmountUnit,
        pointsPerRupee: form.pointsPerRupee,
        minRedeemPoints: form.minRedeemPoints,
        occasionDiscountPercent: form.occasionDiscountPercent,
        occasionDiscountCap: form.occasionDiscountCap,
      });
      toast("Loyalty settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save loyalty settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
  const off = !form.enabled;

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-5 shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift size={18} className="text-brown" />
          <h3 className="text-[15px] font-extrabold text-ink">Loyalty programme</h3>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Enable the loyalty programme"
          onClick={() => set("enabled", !form.enabled)}
          className={`h-7 w-12 shrink-0 rounded-full transition-colors ${
            form.enabled ? "bg-brown" : "bg-line"
          }`}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-warm-white transition-transform ${
              form.enabled ? "translate-x-[22px]" : "translate-x-[2px]"
            }`}
          />
        </button>
      </div>

      <p className="mb-4 text-[12px] text-ink-muted">
        Customers earn points on what they spend and can put them towards a later
        bill. Birthdays and anniversaries carry an automatic discount. Switching
        the programme off keeps every balance — it only stops new points,
        redemptions and occasion discounts.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Points earned</label>
          <input
            type="number" min={0} disabled={off} className={inputCls}
            value={form.pointsPerAmount}
            onChange={(e) => set("pointsPerAmount", num(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Per ₹ spent</label>
          <input
            type="number" min={1} disabled={off} className={inputCls}
            value={form.pointsAmountUnit}
            onChange={(e) => set("pointsAmountUnit", num(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Points for ₹1 off</label>
          <input
            type="number" min={1} disabled={off} className={inputCls}
            value={form.pointsPerRupee}
            onChange={(e) => set("pointsPerRupee", num(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Minimum to redeem</label>
          <input
            type="number" min={0} disabled={off} className={inputCls}
            value={form.minRedeemPoints}
            onChange={(e) => set("minRedeemPoints", num(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Occasion discount %</label>
          <input
            type="number" min={0} max={100} disabled={off} className={inputCls}
            value={form.occasionDiscountPercent}
            onChange={(e) => set("occasionDiscountPercent", num(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Maximum ₹ off</label>
          <input
            type="number" min={0} disabled={off} className={inputCls}
            value={form.occasionDiscountCap}
            onChange={(e) => set("occasionDiscountCap", num(e.target.value))}
          />
        </div>
      </div>

      <p className="mt-3 rounded-[11px] border border-line bg-cream px-3 py-2.5 text-[12.5px] text-ink-muted">
        A ₹{EXAMPLE_BILL} bill earns <strong className="text-ink">{earned} points</strong>.
        500 points = <strong className="text-ink">₹{worth.toFixed(2)} off</strong>.
        Birthdays and anniversaries take {form.occasionDiscountPercent}% off, up to
        ₹{form.occasionDiscountCap}.
      </p>

      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-none bg-brown p-2.5 text-[13px] font-bold text-warm-white disabled:opacity-60"
      >
        {saving && <Loader2 size={15} className="animate-spin" />}
        Save loyalty settings
      </button>
    </div>
  );
}
