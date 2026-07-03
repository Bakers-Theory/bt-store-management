"use client";

import { useEffect } from "react";
import { useBakeryStore } from "@/lib/store";

/** Triggers persisted-state hydration once, after the first client render. */
export function StoreHydrator() {
  useEffect(() => {
    useBakeryStore.persist.rehydrate();
  }, []);
  return null;
}
