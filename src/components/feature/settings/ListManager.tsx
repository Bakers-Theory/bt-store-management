"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { fetchListRows } from "@/lib/supabase-data";

interface Row {
  id: string;
  kind: string;
  value: string;
}

const SECTIONS: { kind: string; label: string; placeholder: string }[] = [
  { kind: "category", label: "Categories", placeholder: "e.g. Muffins" },
  { kind: "emoji", label: "Icons", placeholder: "Paste an emoji" },
  { kind: "unit", label: "Units", placeholder: "e.g. tray" },
  { kind: "reason", label: "Stock-out reasons", placeholder: "e.g. Sample" },
];

export function ListManager() {
  const addListValue = useBakeryStore((s) => s.addListValue);
  const deleteListValue = useBakeryStore((s) => s.deleteListValue);
  const toast = useUIStore((s) => s.toast);

  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const reload = () => void fetchListRows().then(setRows);
  useEffect(reload, []);

  const add = async (kind: string) => {
    const value = (drafts[kind] ?? "").trim();
    if (!value) return;
    const r = await addListValue(kind, value);
    if (!r.ok) {
      toast(r.error ?? "Could not add");
      return;
    }
    setDrafts((d) => ({ ...d, [kind]: "" }));
    reload();
  };

  const remove = async (row: Row) => {
    const r = await deleteListValue(row.id);
    if (!r.ok) {
      toast(r.error ? `Can't remove "${row.value}" — ${r.error}` : "Could not remove");
      return;
    }
    reload();
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <h3 className="mb-1.5 text-[15.5px] font-extrabold">Item options</h3>
      <p className="mb-3 text-xs text-ink-muted">
        Manage the categories, icons, units and stock-out reasons available when
        adding items. A category or unit still used by an item can&apos;t be removed.
      </p>

      <div className="flex flex-col gap-4">
        {SECTIONS.map((sec) => (
          <div key={sec.kind}>
            <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">{sec.label}</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {rows
                .filter((r) => r.kind === sec.kind)
                .map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-cream px-2.5 py-1 text-[13px]"
                  >
                    {r.value}
                    <button
                      type="button"
                      aria-label={`Remove ${r.value}`}
                      onClick={() => remove(r)}
                      className="text-ink-light hover:text-danger"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={sec.placeholder}
                value={drafts[sec.kind] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [sec.kind]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add(sec.kind);
                  }
                }}
                className="w-full rounded-[11px] border border-line bg-cream px-[13px] py-[9px] text-sm outline-none focus:border-brown"
              />
              <button
                type="button"
                onClick={() => void add(sec.kind)}
                className="inline-flex shrink-0 items-center gap-1 rounded-[11px] border-none bg-brown px-3.5 text-sm font-bold text-warm-white"
              >
                <Plus size={16} /> Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
