"use client";

import { useCurrentUser } from "@/components/system/AuthProvider";
import { ChangePasswordCard } from "./ChangePasswordCard";

const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";
const permOnCls = "rounded-lg border border-[#cfe6d3] bg-success-bg px-3 py-[5px] text-xs font-bold text-success";
const permOffCls = "rounded-lg border border-[#ece0cd] bg-[#f4ece0] px-3 py-[5px] text-xs font-bold text-[#b3987a]";

export function MyAccount() {
  const user = useCurrentUser();
  if (!user) return null;
  const p = user.permissions;

  const badge = (label: string, on: boolean) => (
    <span className={on ? permOnCls : permOffCls}>{label}</span>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
        <h3 className="mb-4 text-[15.5px] font-extrabold">My account</h3>
        <div className="flex items-center gap-[11px] pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-brown text-sm font-bold text-warm-white">
            {user.name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{user.name}</div>
            <div className="text-[11.5px] text-ink-light">ID · {user.userId}</div>
          </div>
          <span className="rounded-full bg-[#f4e7d2] px-[11px] py-[3px] text-[11px] font-bold text-[#8a6a3c]">
            {user.role}
          </span>
        </div>
        <label className={labelCls}>Your access</label>
        <div className="flex flex-wrap gap-[7px]">
          {badge("Sales", p.sales)}
          {badge("Inventory", p.inventory)}
          {badge("Analytics", p.analytics)}
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}
