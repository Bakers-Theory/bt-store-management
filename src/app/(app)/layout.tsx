"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { Topbar } from "@/components/layout/Topbar";
import { BottomNav } from "@/components/layout/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useBakeryStore((s) => s._hasHydrated);
  const user = useCurrentUser();

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  if (!hydrated || !user) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <div className="mx-auto w-full max-w-[600px] flex-1 animate-fade-in p-4">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
