"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAuthReady, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { BottomNav } from "@/components/layout/BottomNav";
import { AppSkeleton, ContentSkeleton } from "@/components/system/AppSkeleton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ready = useAuthReady();
  const user = useCurrentUser();
  const hydrated = useBakeryStore((s) => s._hasHydrated);
  const loadError = useBakeryStore((s) => s.loadError);
  const load = useBakeryStore((s) => s.load);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // Until auth resolves we can't render the real nav (it depends on the user's
  // role), so show the full-screen shell skeleton — not a blank screen — for an
  // early FCP.
  if (!ready || !user) return <AppSkeleton />;

  // Auth is resolved: paint the real chrome immediately so the nav is clickable
  // right away, even on a cold load. Only the data-heavy page body waits for the
  // store to hydrate, so views never flash the placeholder profile before real
  // data arrives.
  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 lg:px-8 lg:py-6">
          {loadError && (
            <div className="mx-auto mb-3 flex max-w-[1400px] items-center justify-between gap-3 rounded-xl border border-[#f0c9c0] bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-danger">
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={16} /> Couldn&apos;t load your store data. Check your connection.
              </span>
              <button
                type="button"
                onClick={() => load()}
                className="shrink-0 rounded-full bg-danger px-3 py-1 text-[12px] font-bold text-white"
              >
                Retry
              </button>
            </div>
          )}
          {hydrated ? (
            <div className="mx-auto w-full max-w-[1400px] animate-fade-in">{children}</div>
          ) : (
            <ContentSkeleton />
          )}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
