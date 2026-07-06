"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { navItems } from "@/lib/permissions";
import { useAuth, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { Croissant, Loader2 } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  bill: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
    </svg>
  ),
  stock: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
      <path d="M3 7l9 4 9-4" />
      <path d="M12 21V11" />
    </svg>
  ),
  customers: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  history: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
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

  const items = [...navItems(user), { key: "settings", href: "/settings", icon: "⚙", label: "Settings" }];

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
            <div className="text-[11.5px] font-semibold text-ink-light">{user.role}</div>
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
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
