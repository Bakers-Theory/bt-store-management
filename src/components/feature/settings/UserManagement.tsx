"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { fetchStaff } from "@/lib/supabase-data";
import { useAuth } from "@/components/system/AuthProvider";
import { useUIStore } from "@/lib/ui-store";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { UserModal } from "./UserModal";
import { PERMISSION_CATALOG, roleLabel } from "@/lib/permissions";
import type { User } from "@/lib/types";

const permOnCls = "rounded-lg border border-[#cfe6d3] bg-success-bg px-3 py-[5px] text-xs font-bold text-success";
const permOffCls = "rounded-lg border border-[#ece0cd] bg-[#f4ece0] px-3 py-[5px] text-xs font-bold text-[#b3987a]";

/**
 * A staff member's grants summarised as the areas they touch, so a card stays
 * readable at 25 possible permissions. The full set lives in the edit modal.
 */
function permAreas(user: User): string[] {
  return PERMISSION_CATALOG.filter((g) =>
    g.perms.some((p) => user.permissions.includes(p.key)),
  ).map((g) => g.title);
}

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
  const { user: me } = useAuth();
  // Archiving locks a colleague out, so it is the Owner's alone — the API says
  // the same, this just keeps the button off screens that would only get a 403.
  const isOwner = me?.role === "Owner";
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [modal, setModal] = useState<{ user: User | null } | null>(null);
  const [confirm, setConfirm] = useState<
    { user: User; action: "archive" | "delete" } | null
  >(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const setBusyId = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Post-mutation refresh (best-effort; keeps the current list on failure).
  const reload = useCallback(async () => {
    try {
      setUsers(await fetchStaff());
    } catch {
      toast("Couldn't refresh staff list", "error");
    }
  }, [toast]);

  // Initial load with a skeleton, then an error + retry on failure instead of a
  // silently blank card.
  useEffect(() => {
    let alive = true;
    setError(false);
    setLoaded(false);
    fetchStaff()
      .then((rows) => {
        if (alive) {
          setUsers(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) {
          setError(true);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [retryToken]);

  /**
   * Switch an account off (or back on). Nothing they recorded is touched — an
   * archived member simply cannot sign in and holds no permissions.
   */
  const setArchived = async (u: User, archived: boolean) => {
    setConfirm(null);
    setBusyId(u.id, true);
    try {
      const res = await fetch("/api/staff/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, archived }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Could not update user", "error");
        return;
      }
      toast(archived ? "Staff archived" : "Staff unarchived", "success");
      reload();
    } finally {
      setBusyId(u.id, false);
    }
  };

  /**
   * Erase an archived staff member. Their attendance, salary and advances go
   * with them; every bill, cash entry and stock movement stays.
   */
  const remove = async (u: User) => {
    setConfirm(null);
    setBusyId(u.id, true);
    try {
      const res = await fetch("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Could not delete user", "error");
        return;
      }
      toast("Staff deleted", "success");
      reload();
    } finally {
      setBusyId(u.id, false);
    }
  };

  const active = users.filter((u) => !u.archivedAt);
  const archived = users.filter((u) => u.archivedAt);

  const permPill = (label: string, on: boolean) => (
    <span key={label} className={on ? permOnCls : permOffCls}>
      {label}
    </span>
  );

  const staffCard = (u: User) => {
    const isOwnerRow = u.role === "Owner";
    const archived = Boolean(u.archivedAt);
    const areas = permAreas(u);
    return (
      <div
        key={u.id}
        className={`rounded-[14px] border border-[#f0e2cc] p-3.5 ${archived ? "opacity-70" : ""}`}
      >
        <div className="mb-[11px] flex items-center gap-[11px]">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-sm font-bold ${
              isOwnerRow ? "bg-brown text-warm-white" : "bg-[#efdcc1] text-brown"
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
              archived
                ? "bg-[#ece7e0] text-ink-light"
                : isOwnerRow
                  ? "bg-brown text-warm-white"
                  : "bg-[#f4e7d2] text-[#8a6a3c]"
            }`}
          >
            {archived ? "Archived" : roleLabel(u)}
          </span>
        </div>

        <div className="flex flex-wrap gap-[7px]">
          {isOwnerRow ? (
            permPill("All access", true)
          ) : areas.length === 0 ? (
            permPill("No access", false)
          ) : (
            <>
              {areas.map((a) => permPill(a, true))}
              <span className={permOffCls}>
                {u.permissions.length} permission{u.permissions.length === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>

        {!isOwnerRow && (
          <div className="mt-[11px] flex items-center justify-end gap-1.5 border-t border-line-soft pt-[11px]">
            {!archived && (
              <button
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-warm-white text-xs font-bold text-ink-muted"
                onClick={() => setModal({ user: u })}
                aria-label={`Edit ${u.name}`}
              >
                <Pencil size={14} />
              </button>
            )}
            {isOwner && (
              <button
                className={`inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-none px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  archived ? "bg-brown" : "bg-danger"
                }`}
                onClick={() =>
                  archived
                    ? setArchived(u, false)
                    : setConfirm({ user: u, action: "archive" })
                }
                disabled={busy.has(u.id)}
                aria-label={`${archived ? "Unarchive" : "Archive"} ${u.name}`}
              >
                {busy.has(u.id) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : archived ? (
                  <ArchiveRestore size={14} />
                ) : (
                  <Archive size={14} />
                )}
                {/* {archived ? "Unarchive" : "Archive"} */}
              </button>
            )}
            {/* Delete is the step behind archiving, so it only appears once the
                account is already switched off. */}
            {isOwner && archived && (
              <button
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-danger bg-warm-white text-danger disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setConfirm({ user: u, action: "delete" })}
                disabled={busy.has(u.id)}
                aria-label={`Delete ${u.name}`}
              >
                <Trash2 size={14} />
              </button>
            )}
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

      <div className="flex flex-col gap-3">
        {!loaded ? (
          [0, 1].map((i) => (
            <div key={i} className="rounded-[14px] border border-[#f0e2cc] p-3.5">
              <div className="flex items-center gap-[11px]">
                <Skeleton className="h-10 w-10 rounded-[11px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))
        ) : error ? (
          <div className="py-6 text-center text-sm text-ink-muted">
            <p className="mb-3">Couldn&apos;t load staff.</p>
            <button
              type="button"
              onClick={() => setRetryToken((t) => t + 1)}
              className="rounded-full bg-brown px-4 py-1.5 text-[13px] font-bold text-warm-white"
            >
              Retry
            </button>
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">No staff added yet</p>
        ) : (
          <>
            {active.map(staffCard)}
            {archived.length > 0 && (
              <>
                <div className="mt-2 flex items-center gap-2 border-t border-line-soft pt-3 text-[12.5px] font-bold text-ink-light">
                  Archived
                  <span className="rounded-full bg-[#f4ece0] px-2 py-[1px] text-[11px]">
                    {archived.length}
                  </span>
                </div>
                {archived.map(staffCard)}
              </>
            )}
          </>
        )}
      </div>

      {modal && (
        <UserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}

      {confirm && (
        <Modal
          title={confirm.action === "archive" ? "Archive staff" : "Delete staff"}
          onClose={() => setConfirm(null)}
        >
          {confirm.action === "archive" ? (
            <p className="text-sm text-ink-muted">
              Archive <span className="font-bold text-ink">{confirm.user.name}</span>?
              They will no longer be able to sign in. Everything they recorded —
              bills, cash entries, attendance, salary and advances — stays exactly
              as it is, and you can unarchive them at any time.
            </p>
          ) : (
            <div className="space-y-2.5 text-sm text-ink-muted">
              <p>
                Delete <span className="font-bold text-ink">{confirm.user.name}</span>{" "}
                permanently? This cannot be undone.
              </p>
              <p>
                <span className="font-bold text-danger">Removed:</span> their
                attendance records, salary setup, salary payments and advances.
              </p>
              <p>
                <span className="font-bold text-ink">Kept:</span> every bill, cash
                book entry, stock movement, purchase, expense and asset record
                they touched — those stay, without their name on them.
              </p>
            </div>
          )}
          <div className="mt-5 flex gap-2.5">
            <button className="btn-secondary flex-1" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn-danger flex flex-1 items-center justify-center gap-2"
              onClick={() =>
                confirm.action === "archive"
                  ? setArchived(confirm.user, true)
                  : remove(confirm.user)
              }
            >
              {confirm.action === "archive" ? (
                <>
                  <Archive size={16} /> Archive
                </>
              ) : (
                <>
                  <Trash2 size={16} /> Delete
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
