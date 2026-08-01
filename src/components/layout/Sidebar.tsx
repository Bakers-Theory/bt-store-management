"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { hasAnyPermission, hasPermission, navItems, roleLabel } from "@/lib/permissions";
import { useAuth, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  Calculator,
  Clock,
  Croissant,
  LayoutGrid,
  Loader2,
  LogOut,
  Package,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

// One size and stroke for the whole rail, so no icon reads heavier than its
// neighbours.
const ICON = { size: 20, strokeWidth: 1.8 } as const;

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutGrid {...ICON} />,
  bill: <Receipt {...ICON} />,
  stock: <Package {...ICON} />,
  customers: <Users {...ICON} />,
  history: <Clock {...ICON} />,
  settings: <Settings {...ICON} />,
  attendance: <CalendarCheck {...ICON} />,
  salary: <Banknote {...ICON} />,
  reports: <BarChart3 {...ICON} />,
  suppliers: <Truck {...ICON} />,
  purchases: <Calculator {...ICON} />,
  cashbook: <Wallet {...ICON} />,
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const logo = useBakeryStore((s) => s.bakery.logo);
  const { signOut } = useAuth();

  const items = [
    ...navItems(user),
    ...(hasAnyPermission(user, ["reports.view", "suppliers.reports"])
      ? [{ key: "reports", href: "/reports", icon: "📈", label: "Reports" }]
      : []),
    { key: "settings", href: "/settings", icon: "⚙", label: "Settings" },
  ];

  const [loggingOut, setLoggingOut] = useState(false);

  const doSignOut = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      router.push("/login");
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-[244px] flex-shrink-0 flex-col gap-[5px] border-r border-line bg-warm-white p-4 lg:flex">
      <div className="flex items-center gap-[11px] px-2 pb-5 pt-1.5">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="logo" className="h-[42px] w-[42px] flex-shrink-0 rounded-[13px] object-cover" />
        ) : (
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-gradient-to-br from-brown to-brown-dark text-warm-white shadow-[0_3px_10px_rgba(90,52,20,.3)]">
            <Croissant size={22} />
          </div>
        )}
        <div className="leading-[1.15]">
          <div className="wordmark text-xl text-ink">Bakers Theory</div>
          <div className="text-[11px] font-semibold tracking-[.03em] text-ink-light">STORE MANAGEMENT</div>
        </div>
      </div>

      <div className="px-3 pb-2 pt-1.5 text-[10.5px] font-bold tracking-[.09em] text-line-strong">MENU</div>

      {items.map((it) => {
        const active = pathname === it.href;
        return (
          <Link
            key={it.key}
            href={it.href}
            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-[11px] text-[14.5px] font-semibold transition-all ${
              active
                ? "bg-brown text-warm-white shadow-[0_3px_12px_rgba(124,74,30,.28)]"
                : "text-ink-muted hover:bg-cream"
            }`}
          >
            {ICONS[it.key] ?? <span className="text-xl leading-none">{it.icon}</span>}
            {it.label}
          </Link>
        );
      })}

      {user && (
        <div className="mt-auto flex items-center gap-[11px] border-t border-line-soft pt-4">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-cream-dark text-sm font-bold text-brown">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1 leading-[1.3]">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-bold text-ink">
              {user.name}
            </div>
            <div className="text-[11.5px] font-semibold text-ink-light">{roleLabel(user)}</div>
          </div>
          <button
            onClick={doSignOut}
            title="Sign out"
            aria-label="Sign out"
            disabled={loggingOut}
            className="flex h-[34px] w-[34px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-line bg-warm-white text-ink-light disabled:opacity-60"
          >
            {loggingOut ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <LogOut size={17} strokeWidth={1.9} />
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
