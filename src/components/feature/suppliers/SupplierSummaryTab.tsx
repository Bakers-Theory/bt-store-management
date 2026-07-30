"use client";

import { useEffect, useState } from "react";
import { useUIStore } from "@/lib/ui-store";
import { fetchSupplierSummary } from "@/lib/supabase-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { SupplierAccountBreakdown } from "./SupplierAccountBreakdown";
import type { Supplier, SupplierSummary } from "@/lib/types";

export function SupplierSummaryTab({ supplier }: { supplier: Supplier }) {
  const toast = useUIStore((s) => s.toast);
  const [summary, setSummary] = useState<SupplierSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    fetchSupplierSummary(supplier.id)
      .then((s) => alive && (setSummary(s), setLoaded(true)))
      .catch(() => alive && (setLoaded(true), toast("Couldn't load the summary", "error")));
    return () => {
      alive = false;
    };
  }, [supplier.id, toast]);

  if (!loaded) return <Skeleton className="h-56 w-full rounded-[18px]" />;
  if (!summary) {
    return (
      <p className="rounded-[18px] border border-line bg-warm-white px-5 py-10 text-center text-sm text-ink-muted">
        No account activity yet.
      </p>
    );
  }

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[18px]">
      <SupplierAccountBreakdown summary={summary} />
      <p className="mt-3 text-[11.5px] text-ink-muted">
        Every figure is computed from posted invoices, payments and returns — nothing
        here is stored, so it cannot fall out of step with the ledger.
      </p>
    </div>
  );
}
