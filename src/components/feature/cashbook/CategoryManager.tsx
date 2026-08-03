"use client";

import { useState } from "react";
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { categoryTree } from "@/lib/cashbook";
import {
  rpcAddCashCategory,
  rpcArchiveCashCategory,
  rpcRenameCashCategory,
} from "@/lib/supabase-data";
import type { CashCategory } from "@/lib/types";

const inputCls =
  "w-full rounded-[9px] border border-line bg-warm-white px-2.5 py-2 text-[13px] text-ink";
const iconBtnCls =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted disabled:opacity-40";

/**
 * Add / rename / remove for the cashbook category tree, shown inline under the
 * category picker in ExpenseForm and CashEntryModal.
 *
 * NOT A MODAL, deliberately: both callers are already <Modal>s, and Modal's
 * Escape handler is a document listener guarded only by stopPropagation, so a
 * nested dialog would close both on one keypress.
 *
 * The caller decides whether to render this at all — it does no permission
 * check of its own. Migration 0058 is the real gate.
 */
export function CategoryManager({
  categories,
  onChanged,
}: {
  categories: CashCategory[];
  onChanged: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const tree = categoryTree(categories);

  // The id of the row with a write in flight, or "add" for the add row. One at
  // a time is enough — every write here is a single small RPC.
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState(""); // "" = top level
  const [newDirection, setNewDirection] =
    useState<CashCategory["direction"]>("out");

  // Only a non-system top-level category may take children. A system category
  // with a child would stop being a leaf, and is_leaf_category() (0045) would
  // then reject every auto-posting to it.
  const parents = tree
    .map((n) => n.category)
    .filter((c) => !c.isSystem);

  const run = (
    key: string,
    work: Promise<unknown>,
    ok: string,
    after?: () => void,
  ) => {
    setBusy(key);
    work
      .then(() => {
        toast(ok, "success");
        after?.();
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setBusy(null));
  };

  const startEdit = (c: CashCategory) => {
    setEditingId(c.id);
    setDraftName(c.name);
  };

  const saveEdit = (c: CashCategory) => {
    const name = draftName.trim();
    if (!name || name === c.name) {
      setEditingId(null);
      return;
    }
    run(c.id, rpcRenameCashCategory(c.id, name), `Renamed to "${name}"`, () =>
      setEditingId(null),
    );
  };

  const remove = (c: CashCategory) => {
    if (!confirm(`Remove "${c.name}"?\n\nPast entries keep this label.`)) return;
    run(c.id, rpcArchiveCashCategory(c.id), `Removed "${c.name}"`);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    run(
      "add",
      rpcAddCashCategory({
        parentId: newParent || null,
        name,
        direction: newDirection,
      }),
      `Added "${name}"`,
      () => setNewName(""),
    );
  };

  const row = (c: CashCategory, indented: boolean) => {
    const editing = editingId === c.id;
    const working = busy === c.id;
    return (
      <div
        key={c.id}
        className={`flex items-center gap-1.5 py-1 ${indented ? "pl-4" : ""}`}
      >
        {editing ? (
          <>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                // The panel lives inside a Modal whose Escape closes the whole
                // dialog. Swallowing it here means Escape cancels the rename
                // first, which is what the operator expects.
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditingId(null);
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit(c);
                }
              }}
              className={inputCls}
              aria-label={`Rename ${c.name}`}
            />
            <button
              type="button"
              onClick={() => saveEdit(c)}
              disabled={working}
              className={iconBtnCls}
              aria-label="Save name"
            >
              {working ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className={iconBtnCls}
              aria-label="Cancel rename"
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 truncate text-[13px] text-ink">{c.name}</span>
            {c.isSystem ? (
              <span
                className="flex h-8 w-8 items-center justify-center text-ink-muted"
                title="Built in — the app posts to this automatically"
              >
                <Lock size={13} />
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  disabled={working}
                  className={iconBtnCls}
                  aria-label={`Rename ${c.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={working}
                  className={iconBtnCls}
                  aria-label={`Remove ${c.name}`}
                >
                  {working ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="mt-2 rounded-[12px] border border-line bg-cream/60 p-3">
      <div className="max-h-56 overflow-y-auto">
        {tree.map((node) => (
          <div key={node.category.id}>
            {row(node.category, false)}
            {node.children.map((child) => row(child, true))}
          </div>
        ))}
      </div>

      <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New category name"
          className={inputCls}
          aria-label="New category name"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            className={inputCls}
            aria-label="Inside group"
          >
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                Inside {p.name}
              </option>
            ))}
          </select>
          <select
            value={newDirection}
            onChange={(e) =>
              setNewDirection(e.target.value as CashCategory["direction"])
            }
            className={inputCls}
            aria-label="Money direction"
          >
            <option value="out">Money out</option>
            <option value="in">Money in</option>
            <option value="both">Both</option>
          </select>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!newName.trim() || busy === "add"}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-brown px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy === "add" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          Add category
        </button>
      </div>
    </div>
  );
}