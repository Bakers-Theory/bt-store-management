"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { navItems, type NavItem } from "@/lib/permissions";
import { useCurrentUser } from "@/components/system/AuthProvider";

// Destinations that stay as always-visible bottom tabs (in this order). Anything
// else navItems() returns spills into the "More" sheet, so adding new sections
// never crowds the bar.
const PRIMARY_KEYS = ["dashboard", "stock", "history"];

const SETTINGS_ITEM: NavItem = { key: "settings", href: "/settings", icon: "⚙️", label: "Settings" };
const REPORTS_ITEM: NavItem = { key: "reports", href: "/reports", icon: "📈", label: "Reports" };

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  stock: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
      <path d="M3 7l9 4 9-4" />
      <path d="M12 21V11" />
    </svg>
  ),
  customers: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  history: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  settings: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  reports: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  ),
};

const BILL_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const MORE_ICON = (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);

const navIcon = (it: NavItem) => ICONS[it.key] ?? <span className="text-xl leading-none">{it.icon}</span>;

export function BottomNav() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = navItems(user);

  if (items.length === 0) return null;

  const bill = items.find((it) => it.key === "bill");
  const primary = items.filter((it) => it.key !== "bill" && PRIMARY_KEYS.includes(it.key));
  // Everything that isn't the FAB or a primary tab lives in the sheet, plus
  // Settings (which has no route in navItems but is always reachable here).
  const sheetItems = [
    ...items.filter((it) => it.key !== "bill" && !PRIMARY_KEYS.includes(it.key)),
    ...(user?.role === "Owner" ? [REPORTS_ITEM] : []),
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
