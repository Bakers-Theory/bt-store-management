"use client";

import { useEffect } from "react";
import { useBakeryStore } from "@/lib/store";
import { useAuth } from "@/components/system/AuthProvider";

/** Loads store data from Supabase once the user is authenticated. */
export function StoreHydrator() {
  const { user, ready } = useAuth();
  const uid = user?.id;
  const load = useBakeryStore((s) => s.load);

  useEffect(() => {
    if (ready && uid) load();
  }, [ready, uid, load]);

  return null;
}
