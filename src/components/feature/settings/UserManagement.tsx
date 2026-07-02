"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { UserModal } from "./UserModal";
import type { Permissions } from "@/lib/types";

export function UserManagement() {
  const router = useRouter();
  const users = useBakeryStore((s) => s.users);
  const deleteUser = useBakeryStore((s) => s.deleteUser);
  const toast = useUIStore((s) => s.toast);

  const [modal, setModal] = useState<{ id: string | null } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    const r = deleteUser(id);
    if (r.wasCurrentUser) {
      router.replace("/login");
      return;
    }
    if (r.ok) toast("🗑 User deleted");
  };

  const permBadge = (label: string, on: boolean) => (
    <span className={`badge ${on ? "badge-success" : "badge-danger"}`}>
      {label} {on ? "✓" : "✕"}
    </span>
  );

  return (
    <div className="card mt-4">
      <div className="card-header">
        <h3>👥 Manage Users</h3>
        <button className="btn-sm btn-primary" onClick={() => setModal({ id: null })}>➕ New User</button>
      </div>
      {users.map((u) => {
        const p: Permissions = u.permissions;
        return (
          <div key={u.id} className="mb-2 flex items-start gap-3 rounded-xl border border-line bg-white p-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-cream-dark text-xl">
              {u.role === "Owner" ? "👑" : "👤"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">
                {u.name} {u.role === "Owner" && <span className="badge badge-brown">Owner</span>}
              </div>
              <div className="mt-0.5 text-xs text-ink-muted">User ID: {u.userId}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                Password:{" "}
                <span className="font-mono">
                  {revealed.has(u.id) ? u.password : "••••••••"}
                </span>
                <button className="btn-sm btn-secondary px-2 py-0.5 text-[11px]" onClick={() => toggleReveal(u.id)}>👁</button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-[5px]">
                {u.role === "Owner" ? (
                  <span className="badge badge-brown">All Access</span>
                ) : (
                  <>
                    {permBadge("Sales", p.sales)}
                    {permBadge("Inventory", p.inventory)}
                    {permBadge("Analytics", p.analytics)}
                  </>
                )}
              </div>
            </div>
            {u.role !== "Owner" && (
              <div className="flex flex-col gap-1">
                <button className="btn-sm btn-secondary" onClick={() => setModal({ id: u.id })}>✏</button>
                <button className="cursor-pointer rounded-lg border-none bg-danger px-2.5 py-1.5 text-xs text-white" onClick={() => remove(u.id, u.name)}>🗑</button>
              </div>
            )}
          </div>
        );
      })}

      {modal && <UserModal userId={modal.id} onClose={() => setModal(null)} />}
    </div>
  );
}
