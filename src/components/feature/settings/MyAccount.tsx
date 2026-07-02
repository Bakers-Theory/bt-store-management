"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";

export function MyAccount() {
  const router = useRouter();
  const user = useCurrentUser();
  const changeOwnPassword = useBakeryStore((s) => s.changeOwnPassword);
  const logout = useBakeryStore((s) => s.logout);
  const toast = useUIStore((s) => s.toast);

  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  if (!user) return null;
  const p = user.permissions;

  const change = () => {
    const r = changeOwnPassword(password);
    if (!r.ok) {
      setErr(r.error ?? "");
      return;
    }
    toast("✅ Password updated");
    setPassword("");
    setErr("");
  };

  const doLogout = () => {
    logout();
    router.replace("/login");
  };

  const badge = (label: string, on: boolean) => (
    <span className={`badge ${on ? "badge-success" : "badge-danger"}`}>
      {label} {on ? "✓" : "✕"}
    </span>
  );

  return (
    <>
      <div className="card">
        <h3 className="mb-2.5">👤 My Account</h3>
        <div className="mb-0.5 border-b border-line py-[9px] text-sm font-semibold">Name: {user.name}</div>
        <div className="mb-0.5 border-b border-line py-[9px] text-sm font-semibold">User ID: {user.userId}</div>
        <div className="mb-0.5 py-[9px] text-sm font-semibold">Role: {user.role}</div>
        <label className="form-label mt-3 block">Your Access</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {badge("Sales", p.sales)}
          {badge("Inventory", p.inventory)}
          {badge("Analytics", p.analytics)}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3.5">🔒 Change Password</h3>
        <div className="form-group">
          <label className="form-label">New Password</label>
          <input type="text" placeholder="Enter new password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
        <button className="btn-primary w-full" onClick={change}>💾 Update Password</button>
      </div>

      <button className="btn-danger w-full p-3 text-[15px]" onClick={doLogout}>
        🚪 Logout
      </button>
    </>
  );
}
