"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/store";

export function BottomNav() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const items = navItems(user);

  if (items.length === 0) return null;

  return (
    <nav className="sticky bottom-0 z-[100] flex border-t-[1.5px] border-line bg-white">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`flex flex-1 flex-col items-center gap-[3px] px-1 py-2 text-[10px] font-semibold transition-colors ${
            pathname === it.href ? "text-brown" : "text-ink-muted"
          }`}
        >
          <span className="text-xl">{it.icon}</span>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
