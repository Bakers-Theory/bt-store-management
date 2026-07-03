"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const BROWN = "#7c4a1e";

export function CategoryChart({
  data,
  currency,
}: {
  data: { category: string; revenue: number }[];
  currency: string;
}) {
  if (data.length === 0) {
    return <div className="py-6 text-center text-sm text-ink-muted">No sales yet</div>;
  }
  return (
    <div style={{ height: Math.max(data.length * 34, 100) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="category"
            axisLine={false}
            tickLine={false}
            width={96}
            tick={{ fill: "#2c1a0e", fontSize: 12.5, fontWeight: 600 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(124,74,30,0.06)" }}
            formatter={(value) => [`${currency}${Number(value).toLocaleString("en-IN")}`, "Revenue"]}
            contentStyle={{
              background: "#fffcf8",
              border: "1px solid #e8d5bb",
              borderRadius: 10,
              fontSize: 12.5,
            }}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={18} fill={BROWN} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
