"use client";

import { useRouter, usePathname } from "next/navigation";
import { Croissant } from "lucide-react";
import { useAuth, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { hasPermission } from "@/lib/permissions";

const TITLES: Record<string, [string, string]> = {
  "/bill": ["New Bill", "Tap products to build the order"],
  "/stock": ["Inventory", "Manage items, stock levels & pricing"],
  "/history": ["History", "Past bills and stock movements"],
  "/settings": ["Settings", "Store profile, staff & permissions"],
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function dashboardSubtitle(firstName: string): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${date} · ${greeting()}, ${firstName}`;
}

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useCurrentUser();
  const logo = useBakeryStore((s) => s.bakery.logo);
  const { signOut } = useAuth();

  const [title, subtitle] = TITLES[pathname] ?? [
    "Dashboard",
    dashboardSubtitle(user?.name.split(" ")[0] ?? ""),
  ];

  const doLogout = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-40 flex flex-shrink-0 items-center gap-3.5 border-b border-line bg-warm-white/90 px-4 py-3.5 backdrop-blur lg:px-[22px]">
      <div className="min-w-0 flex-1">
        <div className="text-xl font-extrabold leading-[1.1] text-ink">{title}</div>
        <div className="truncate text-[12.5px] font-semibold text-ink-light">{subtitle}</div>
      </div>

      {hasPermission(user, "sales") && (
        <button
          onClick={() => router.push("/bill")}
          className="hidden flex-shrink-0 items-center gap-[7px] rounded-[11px] bg-brown px-4 py-2.5 text-[13.5px] font-bold text-warm-white lg:flex cursor-pointer hover:bg-brown/90 focus:outline-none focus:ring-2 focus:ring-brown focus:ring-offset-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Bill
        </button>
      )}

      <button
        onClick={doLogout}
        title="Logout"
        aria-label="Logout"
        className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-[11px] border border-line bg-warm-white text-ink-muted lg:hidden"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
    </header>
  );
}
