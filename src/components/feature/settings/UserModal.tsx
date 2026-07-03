"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import type { Permissions, User } from "@/lib/types";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

export function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null; // null = add
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useUIStore((s) => s.toast);

  const [name, setName] = useState(user?.name ?? "");
  const [uidField, setUidField] = useState(user?.userId ?? "");
  const [password, setPassword] = useState("");
  const [perm, setPerm] = useState<Permissions>(
    user?.permissions ?? { sales: false, inventory: false, analytics: false },
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || (!user && !uidField.trim())) {
      setErr("Name and User ID are required.");
      return;
    }
    if (!user && !password) {
      setErr("Set a password for the new staff member.");
      return;
    }
    setBusy(true);
    setErr("");

    const res = user
      ? await fetch("/api/staff", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: user.id,
            name: name.trim(),
            permissions: perm,
            password: password || undefined,
          }),
        })
      : await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: uidField.trim(),
            name: name.trim(),
            password,
            permissions: perm,
          }),
        });

    const body = await res.json();
    if (!res.ok) {
      setErr(body.error ?? "Could not save user");
      setBusy(false);
      return;
    }
    toast(user ? "User updated" : "User created");
    onSaved();
    onClose();
  };

  const toggle = (key: keyof Permissions) =>
    setPerm((p) => ({ ...p, [key]: !p[key] }));

  return (
    <Modal title={user ? "Edit staff" : "Add staff"} onClose={onClose}>
      <div className="mb-3.5">
        <label className={labelCls}>Full name *</label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. Ramesh Sharma"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>User ID *</label>
        <input
          type="text"
          className={inputCls}
          placeholder="e.g. phone number or username"
          value={uidField}
          disabled={!!user}
          onChange={(e) => setUidField(e.target.value)}
        />
        {user && (
          <div className="mt-1 text-[11px] text-ink-light">
            User ID can&apos;t be changed after creation.
          </div>
        )}
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>{user ? "Reset password (optional)" : "Password *"}</label>
        <input
          type="text"
          className={inputCls}
          placeholder={user ? "Leave blank to keep current" : "Set a password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>Grant access</label>
        <div className="mt-1.5 flex flex-col gap-2">
          <label className="flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input
              type="checkbox"
              checked={perm.sales}
              onChange={() => toggle("sales")}
              className="h-[18px] w-auto shrink-0 accent-brown"
            />
            Sales — Billing &amp; bills history
          </label>
          <label className="flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input
              type="checkbox"
              checked={perm.inventory}
              onChange={() => toggle("inventory")}
              className="h-[18px] w-auto shrink-0 accent-brown"
            />
            Inventory — Stock management
          </label>
          <label className="flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input
              type="checkbox"
              checked={perm.analytics}
              onChange={() => toggle("analytics")}
              className="h-[18px] w-auto shrink-0 accent-brown"
            />
            Analytics — Dashboard &amp; reports
          </label>
        </div>
      </div>
      {err && <div className="mb-2.5 text-[13px] font-bold text-danger">{err}</div>}
      <button
        className="w-full rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white disabled:opacity-60"
        onClick={save}
        disabled={busy}
      >
        {busy ? "Saving…" : user ? "Save changes" : "Create staff"}
      </button>
    </Modal>
  );
}
