"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  Calculator,
  Clock,
  LayoutGrid,
  Menu,
  Package,
  Plus,
  Settings,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { hasPermission, navItems, type NavItem } from "@/lib/permissions";
import { useCurrentUser } from "@/components/system/AuthProvider";

// Destinations that stay as always-visible bottom tabs (in this order). Anything
// else navItems() returns spills into the "More" sheet, so adding new sections
// never crowds the bar.
const PRIMARY_KEYS = ["dashboard", "stock", "cashbook"];

const SETTINGS_ITEM: NavItem = { key: "settings", href: "/settings", icon: "⚙️", label: "Settings" };
const REPORTS_ITEM: NavItem = { key: "reports", href: "/reports", icon: "📈", label: "Reports" };

// Slightly larger and heavier than the Sidebar's, since a thumb-height tab bar
// is read at arm's length. Same lucide glyphs either way, so a section looks the
// same on both.
const ICON = { size: 21, strokeWidth: 1.9 } as const;

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutGrid {...ICON} />,
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

const BILL_ICON = <Plus size={22} strokeWidth={2} />;

const MORE_ICON = <Menu {...ICON} />;

const navIcon = (it: NavItem) => ICONS[it.key] ?? <span className="text-xl leading-none">{it.icon}</span>;

export function BottomNav() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = navItems(user);

  const bill = items.find((it) => it.key === "bill");
  const primary = items.filter((it) => it.key !== "bill" && PRIMARY_KEYS.includes(it.key));
  // Everything that isn't the FAB or a primary tab lives in the sheet, plus
  // Settings (which has no route in navItems but is always reachable here).
  const sheetItems = [
    ...items.filter((it) => it.key !== "bill" && !PRIMARY_KEYS.includes(it.key)),
    ...(hasPermission(user, "reports.view") ? [REPORTS_ITEM] : []),
    SETTINGS_ITEM,
  ];
  const moreActive = sheetItems.some((it) => it.href === pathname);

  const linkClass = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-[3px] px-0.5 py-1.5 text-[10.5px] font-bold transition-colors ${
      active ? "text-brown" : "text-ink-light"
    }`;

  const renderNav = (it: NavItem) => {
    const active = pathname === it.href;
    return (
      <Link key={it.key} href={it.href} className={linkClass(active)}>
        {navIcon(it)}
        {it.key === "dashboard" ? "Home" : it.label}
      </Link>
    );
  };

  const renderMore = () => (
    <button
      key="more"
      type="button"
      onClick={() => setMoreOpen(true)}
      className={linkClass(moreOpen || moreActive)}
      aria-haspopup="menu"
      aria-expanded={moreOpen}
    >
      {MORE_ICON}
      More
    </button>
  );

  const renderBill = () => {
    if (!bill) return null;
    const active = pathname === bill.href;
    return (
      <Link key={bill.key} href={bill.href} className={linkClass(active)}>
        <div className="-mt-4 flex h-[46px] w-[46px] items-center justify-center rounded-[15px] bg-brown text-warm-white shadow-[0_5px_14px_rgba(124,74,30,.4)]">
          {BILL_ICON}
        </div>
        Bill
      </Link>
    );
  };

  // Side slots are the primary tabs plus the More button. With a bill FAB they
  // split evenly around the center; without one they fill a plain even row.
  const sideItems = [...primary.map((it) => ({ kind: "nav" as const, it })), { kind: "more" as const }];
  const renderSlot = (slot: { kind: "nav"; it: NavItem } | { kind: "more" }) =>
    slot.kind === "nav" ? renderNav(slot.it) : renderMore();

  const sheet = moreOpen ? (
    <div
      className="fixed inset-0 z-[150] lg:hidden"
      role="dialog"
      aria-modal="true"
      onClick={() => setMoreOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-line bg-warm-white p-3 pb-7 shadow-[0_-6px_28px_rgba(100,60,20,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
        <div className="px-1 pb-2 text-[10.5px] font-bold tracking-[.09em] text-line-strong">MORE</div>
        {sheetItems.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.key}
              href={it.href}
              onClick={() => setMoreOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-[15px] font-semibold transition-colors ${
                active ? "bg-brown text-warm-white" : "text-ink-muted active:bg-cream"
              }`}
            >
              {navIcon(it)}
              {it.label}
            </Link>
          );
        })}
      </div>
    </div>
  ) : null;

  // Zero-permission staff have no primary sections, but Settings is always
  // reachable — surface it as a lone tab so they aren't stranded on NoAccess
  // with no way out.
  if (items.length === 0) {
    return (
      <nav className="sticky bottom-0 z-[100] flex items-end justify-center border-t border-line bg-warm-white px-1.5 pb-3 pt-2 lg:hidden">
        {renderNav(SETTINGS_ITEM)}
      </nav>
    );
  }

  // No bill FAB (user lacks sales): plain even row of the primary tabs + More.
  if (!bill) {
    return (
      <>
        <nav className="sticky bottom-0 z-[100] flex items-end border-t border-line bg-warm-white px-1.5 pb-3 pt-2 lg:hidden">
          {sideItems.map(renderSlot)}
        </nav>
        {sheet}
      </>
    );
  }

  // Keep the bill button centered: split the side slots evenly around it,
  // padding the shorter side with an invisible spacer when the count is odd.
  const leftItems = sideItems.slice(0, Math.ceil(sideItems.length / 2));
  const rightItems = sideItems.slice(leftItems.length);
  const leftSpacers = Math.max(0, rightItems.length - leftItems.length);
  const rightSpacers = Math.max(0, leftItems.length - rightItems.length);
  const spacer = (side: string, i: number) => (
    <div key={`${side}-spacer-${i}`} aria-hidden className="flex-1" />
  );

  return (
    <>
      <nav className="sticky bottom-0 z-[100] flex items-end border-t border-line bg-warm-white px-1.5 pb-3 pt-2 lg:hidden">
        {Array.from({ length: leftSpacers }, (_, i) => spacer("left", i))}
        {leftItems.map(renderSlot)}
        {renderBill()}
        {rightItems.map(renderSlot)}
        {Array.from({ length: rightSpacers }, (_, i) => spacer("right", i))}
      </nav>
      {sheet}
    </>
  );
}
