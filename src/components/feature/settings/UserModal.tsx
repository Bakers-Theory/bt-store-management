"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import type { Permissions } from "@/lib/types";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

export function UserModal({
  userId,
  onClose,
}: {
  userId: string | null; // null = add
  onClose: () => void;
}) {
  const users = useBakeryStore((s) => s.users);
  const addUser = useBakeryStore((s) => s.addUser);
  const editUser = useBakeryStore((s) => s.editUser);
  const toast = useUIStore((s) => s.toast);

  const editing = userId ? users.find((u) => u.id === userId) : undefined;
  const [name, setName] = useState(editing?.name ?? "");
  const [uidField, setUidField] = useState(editing?.userId ?? "");
  const [password, setPassword] = useState(editing?.password ?? "");
  const [perm, setPerm] = useState<Permissions>(
    editing?.permissions ?? { sales: false, inventory: false, analytics: false },
  );
  const [err, setErr] = useState("");

  const save = () => {
    const input = {
      name: name.trim(),
      userId: uidField.trim(),
      password,
      permissions: perm,
    };
    const r = userId ? editUser(userId, input) : addUser(input);
    if (!r.ok) {
      setErr(r.error ?? "");
      return;
    }
    toast(userId ? "✅ User updated" : "✅ User created");
    onClose();
  };

  const toggle = (key: keyof Permissions) =>
    setPerm((p) => ({ ...p, [key]: !p[key] }));

  return (
    <Modal title={userId ? "Edit staff" : "Add staff"} onClose={onClose}>
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
          onChange={(e) => setUidField(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className={labelCls}>Password *</label>
        <input
          type="text"
          className={inputCls}
          placeholder="Set a password"
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
        className="w-full rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white"
        onClick={save}
      >
        {userId ? "Save changes" : "Create staff"}
      </button>
    </Modal>
  );
}
