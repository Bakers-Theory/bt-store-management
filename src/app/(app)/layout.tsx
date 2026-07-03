"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthReady, useCurrentUser } from "@/components/system/AuthProvider";
import { useBakeryStore } from "@/lib/store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { BottomNav } from "@/components/layout/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ready = useAuthReady();
  const user = useCurrentUser();
  const hydrated = useBakeryStore((s) => s._hasHydrated);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return null;
  // Wait for the Supabase-backed store to load before rendering, so views never
  // flash the placeholder profile and initialise from real data.
  if (!hydrated) return null;

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 lg:px-8 lg:py-6 animate-fade-in">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
