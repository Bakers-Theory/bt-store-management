"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { fetchStaff } from "@/lib/supabase-data";
import { useUIStore } from "@/lib/ui-store";
import { UserModal } from "./UserModal";
import type { Permissions, User } from "@/lib/types";

const permOnCls = "rounded-lg border border-[#cfe6d3] bg-success-bg px-3 py-[5px] text-xs font-bold text-success";
const permOffCls = "rounded-lg border border-[#ece0cd] bg-[#f4ece0] px-3 py-[5px] text-xs font-bold text-[#b3987a]";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserManagement() {
  const toast = useUIStore((s) => s.toast);
  const [users, setUsers] = useState<User[]>([]);
  const [modal, setModal] = useState<{ user: User | null } | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const setDeletingId = (id: string, on: boolean) =>
    setDeleting((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const reload = useCallback(async () => {
    setUsers(await fetchStaff());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const remove = async (u: User) => {
    if (!confirm(`Delete user "${u.name}"? This cannot be undone.`)) return;
    setDeletingId(u.id, true);
    try {
      const res = await fetch("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Could not delete user");
        return;
      }
      toast("User deleted");
      reload();
    } finally {
      setDeletingId(u.id, false);
    }
  };

  const permPill = (label: string, on: boolean) => (
    <span className={on ? permOnCls : permOffCls}>{label}</span>
  );

  const staffCard = (u: User) => {
    const p: Permissions = u.permissions;
    const isOwner = u.role === "Owner";
    return (
      <div key={u.id} className="rounded-[14px] border border-[#f0e2cc] p-3.5">
        <div className="mb-[11px] flex items-center gap-[11px]">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-sm font-bold ${
              isOwner ? "bg-brown text-warm-white" : "bg-[#efdcc1] text-brown"
            }`}
          >
            {initials(u.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{u.name}</div>
            <div className="text-[11.5px] text-ink-light">ID · {u.userId}</div>
          </div>
          <span
            className={`rounded-full px-[11px] py-[3px] text-[11px] font-bold ${
              isOwner ? "bg-brown text-warm-white" : "bg-[#f4e7d2] text-[#8a6a3c]"
            }`}
          >
            {u.role}
          </span>
        </div>

        <div className="flex flex-wrap gap-[7px]">
          {isOwner ? (
            permPill("All access", true)
          ) : (
            <>
              {permPill("Sales", p.sales)}
              {permPill("Inventory", p.inventory)}
              {permPill("Analytics", p.analytics)}
            </>
          )}
        </div>

        {!isOwner && (
          <div className="mt-[11px] flex items-center justify-end gap-1.5 border-t border-line-soft pt-[11px]">
            <button
              className="cursor-pointer rounded-lg border border-line bg-warm-white px-2.5 py-1.5 text-xs font-bold text-ink-muted"
              onClick={() => setModal({ user: u })}
            >
              <Pencil size={14} />
            </button>
            <button
              className="cursor-pointer rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => remove(u)}
              disabled={deleting.has(u.id)}
            >
              {deleting.has(u.id) ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15.5px] font-extrabold">Staff &amp; permissions</h3>
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border-none bg-[#f4e7d2] px-3 py-[7px] text-[12.5px] font-bold text-brown"
          onClick={() => setModal({ user: null })}
        >
          <Plus size={16} /> Add staff
        </button>
      </div>

      <div className="flex flex-col gap-3">{users.map(staffCard)}</div>

      {modal && (
        <UserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
