"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useBakeryStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import type { Permissions } from "@/lib/types";

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
    <Modal title={userId ? "Edit User" : "Add New User"} onClose={onClose}>
      <div className="form-group">
        <label className="form-label">Full Name *</label>
        <input type="text" placeholder="e.g. Ramesh Sharma" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">User ID *</label>
        <input type="text" placeholder="e.g. phone number or username" value={uidField} onChange={(e) => setUidField(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Password *</label>
        <input type="text" placeholder="Set a password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Grant Access</label>
        <div className="mt-1.5">
          <label className="mb-2 flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input type="checkbox" checked={perm.sales} onChange={() => toggle("sales")} className="h-[18px] w-auto shrink-0 accent-brown" /> 🧾 Sales — Billing &amp; Bills History
          </label>
          <label className="mb-2 flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input type="checkbox" checked={perm.inventory} onChange={() => toggle("inventory")} className="h-[18px] w-auto shrink-0 accent-brown" /> 📦 Inventory — Stock Management
          </label>
          <label className="mb-2 flex items-center gap-2.5 rounded-[10px] bg-cream px-2.5 py-[9px] text-sm font-medium">
            <input type="checkbox" checked={perm.analytics} onChange={() => toggle("analytics")} className="h-[18px] w-auto shrink-0 accent-brown" /> 📊 Analytics — Dashboard &amp; Reports
          </label>
        </div>
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button className="btn-primary w-full" onClick={save}>
        {userId ? "💾 Save Changes" : "✅ Create User"}
      </button>
    </Modal>
  );
}
