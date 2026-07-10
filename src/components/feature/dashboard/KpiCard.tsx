"use client";

import type { ReactNode } from "react";

export type KpiVariant = "hero" | "default" | "warn";

const cardCls: Record<KpiVariant, string> = {
  hero: "rounded-[18px] bg-gradient-to-br from-brown to-brown-dark p-[18px_20px] text-warm-white shadow-card",
  default: "rounded-[18px] border border-line bg-warm-white p-[18px_20px]",
  warn: "rounded-[18px] border border-[#ecd9a8] bg-warn-bg p-[18px_20px]",
};

const labelCls: Record<KpiVariant, string> = {
  hero: "text-[12.5px] font-semibold opacity-80",
  default: "text-[12.5px] font-semibold text-ink-muted",
  warn: "text-[12.5px] font-semibold text-warn",
};

/**
 * One tile in the dashboard's top KPI row. Callers own their value/subtitle
 * content — including any loading-skeleton branch — since the four tiles
 * differ enough there (hero gradient vs. plain vs. always-static warn card)
 * that baking a shared skeleton in here would need as many special cases as
 * it saves. This just supplies the shared card chrome: background, label row,
 * and an optional top-right corner slot (a delta badge or an icon).
 */
export function KpiCard({
  variant = "default",
  label,
  corner,
  value,
  subtitle,
}: {
  variant?: KpiVariant;
  label: string;
  corner?: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className={cardCls[variant]}>
      <div className="flex items-center justify-between">
        <span className={labelCls[variant]}>{label}</span>
        {corner}
      </div>
      {value}
      {subtitle}
    </div>
  );
}
