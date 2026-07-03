"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/store";

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
};

const BILL_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function BottomNav() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const items = navItems(user);

  if (items.length === 0) return null;

  return (
    <nav className="sticky bottom-0 z-[100] flex items-end border-t border-line bg-warm-white px-1.5 pb-3 pt-2 lg:hidden">
      {items.map((it) => {
        const active = pathname === it.href;
        if (it.key === "bill") {
          return (
            <Link
              key={it.key}
              href={it.href}
              className={`flex flex-1 flex-col items-center gap-[3px] px-0.5 py-1.5 text-[10.5px] font-bold ${
                active ? "text-brown" : "text-ink-light"
              }`}
            >
              <div className="-mt-4 flex h-[46px] w-[46px] items-center justify-center rounded-[15px] bg-brown text-warm-white shadow-[0_5px_14px_rgba(124,74,30,.4)]">
                {BILL_ICON}
              </div>
              Bill
            </Link>
          );
        }
        return (
          <Link
            key={it.key}
            href={it.href}
            className={`flex flex-1 flex-col items-center gap-[3px] px-0.5 py-1.5 text-[10.5px] font-bold transition-colors ${
              active ? "text-brown" : "text-ink-light"
            }`}
          >
            {ICONS[it.key] ?? <span className="text-xl leading-none">{it.icon}</span>}
            {it.key === "dashboard" ? "Home" : it.label}
          </Link>
        );
      })}
      <Link
        href="/settings"
        className={`flex flex-1 flex-col items-center gap-[3px] px-0.5 py-1.5 text-[10.5px] font-bold transition-colors ${
          pathname === "/settings" ? "text-brown" : "text-ink-light"
        }`}
      >
        {ICONS.settings}
        More
      </Link>
    </nav>
  );
}
