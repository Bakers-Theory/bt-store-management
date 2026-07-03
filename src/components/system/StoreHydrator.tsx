"use client";

import { useEffect } from "react";
import { useBakeryStore } from "@/lib/store";

/** Triggers persisted-state hydration once, after the first client render. */
export function StoreHydrator() {
  useEffect(() => {
    // After rehydration: in test mode, seed demo data (only if the store is
    // empty); otherwise strip any previously-seeded demo data so non-test
    // builds (e.g. production) fall back to the real localStorage data.
    Promise.resolve(useBakeryStore.persist.rehydrate()).then(() => {
      if (process.env.NEXT_PUBLIC_APP_ENV === "test") {
        useBakeryStore.getState().seedDemo();
      } else {
        useBakeryStore.getState().clearDemo();
      }
    });
  }, []);
  return null;
}
