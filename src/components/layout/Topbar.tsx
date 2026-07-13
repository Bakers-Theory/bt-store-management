"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { hasPermission } from "@/lib/permissions";
import { Modal } from "@/components/ui/Modal";

const TITLES: Record<string, [string, string]> = {
  "/bill": ["New Bill", "Tap products to build the order"],
  "/customers": ["Customers", "Directory, purchases & spend"],
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
  const isOpen = useBakeryStore((s) => s.bakery.isOpen);
  const statusChangedBy = useBakeryStore((s) => s.bakery.statusChangedBy);
  const statusChangedAt = useBakeryStore((s) => s.bakery.statusChangedAt);
  const setStoreStatus = useBakeryStore((s) => s.setStoreStatus);
  const toast = useUIStore((s) => s.toast);
  const { signOut } = useAuth();

  const isOwner = user?.role === "Owner";

  const [title, subtitle] = TITLES[pathname] ?? [
    "Dashboard",
    dashboardSubtitle(user?.name.split(" ")[0] ?? ""),
  ];

  const [loggingOut, setLoggingOut] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      router.push("/login");
    } catch {
      setLoggingOut(false);
    }
  };

  const applyToggle = async () => {
    setSaving(true);
    try {
      await setStoreStatus(!isOpen, user?.name ?? "");
      toast(isOpen ? "Store closed" : "Store opened");
      setConfirming(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change store status");
    } finally {
      setSaving(false);
    }
  };

  const pillClass = `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
    isOpen ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
  }`;
  const dot = (
    <span className={`h-2 w-2 rounded-full ${isOpen ? "bg-success" : "bg-danger"}`} />
  );
  const label = isOpen ? "Open" : "Closed";

  return (
    <header className="sticky top-0 z-40 flex flex-shrink-0 items-center gap-3.5 border-b border-line bg-warm-white/90 px-4 py-3.5 backdrop-blur lg:px-[22px]">
      <div className="min-w-0 flex-1">
        <div className="text-xl font-extrabold leading-[1.1] text-ink">{title}</div>
        <div className="truncate text-[12.5px] font-semibold text-ink-light">{subtitle}</div>
      </div>

      {isOwner ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${pillClass} cursor-pointer transition-transform active:scale-95`}
          title="Change store status"
        >
          {dot}
          {label}
        </button>
      ) : (
        <span className={pillClass} title="Store status">
          {dot}
          {label}
        </span>
      )}

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
        disabled={loggingOut}
        title="Logout"
        aria-label="Logout"
        className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-[11px] border border-line bg-warm-white text-ink-muted disabled:opacity-60 lg:hidden"
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

      {confirming && (
        <Modal title={isOpen ? "Close the store?" : "Open the store?"} onClose={() => setConfirming(false)}>
          <p className="text-sm text-ink-muted">
            {isOpen
              ? "New bills cannot be created until you reopen the store. Existing bills, stock, and reports stay accessible."
              : "Billing will be enabled and new sales can be created again."}
          </p>
          {statusChangedAt && (
            <p className="mt-2 text-[12px] text-ink-light">
              Last changed by {statusChangedBy || "—"} on {new Date(statusChangedAt).toLocaleString()}
            </p>
          )}
          <div className="mt-4 flex gap-2.5">
            <button
              className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-60"
              onClick={applyToggle}
              disabled={saving}
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {isOpen ? "Close store" : "Open store"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </header>
  );
}
