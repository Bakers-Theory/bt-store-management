"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const BROWN = "#7c4a1e";
const GRAY = "#c9a97a";

export function SalesChart({
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
            tick={{ fill: "#b08060", fontSize: 11, fontWeight: 600 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(124,74,30,0.06)" }}
            formatter={(value) => [`${currency}${Number(value).toLocaleString("en-IN")}`, "Sales"]}
            contentStyle={{
              background: "#fffcf8",
              border: "1px solid #e8d5bb",
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
}
