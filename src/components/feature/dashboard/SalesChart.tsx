"use client";

import { memo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const BROWN = "var(--color-brown)";
const GRAY = "var(--color-line-strong)";

export const SalesChart = memo(function SalesChart({
  data,
  currency,
}: {
  data: { label: string; total: number }[];
  currency: string;
}) {
  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--color-ink-light)", fontSize: 11, fontWeight: 600 }}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--color-brown) 6%, transparent)" }}
            formatter={(value) => [`${currency}${Number(value).toLocaleString("en-IN")}`, "Sales"]}
            contentStyle={{
              background: "var(--color-warm-white)",
              border: "1px solid var(--color-line)",
              borderRadius: 10,
              fontSize: 12.5,
            }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24}>
            {data.map((entry, i) => (
              <Cell key={entry.label + i} fill={i === data.length - 1 ? BROWN : GRAY} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
