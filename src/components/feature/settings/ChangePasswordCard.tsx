"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { useUIStore } from "@/lib/ui-store";

const inputCls =
  "w-full rounded-[11px] border border-line bg-cream px-[13px] py-[11px] text-sm outline-none focus:border-brown";
const labelCls = "mb-[5px] block text-xs font-bold text-[#8a6a3c]";

/** Lets the signed-in user (owner or staff) change their own password. */
export function ChangePasswordCard() {
  const toast = useUIStore((s) => s.toast);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async () => {
    if (!password || password.length < 4) {
      setErr("Password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    toast("Password updated");
    setPassword("");
    setErr("");
  };

  return (
    <div className="rounded-[18px] border border-line bg-warm-white p-[22px] shadow-[0_2px_12px_rgba(100,60,20,0.05)]">
      <h3 className="mb-4 text-[15.5px] font-extrabold">Change password</h3>
      <div className="mb-3.5">
        <label className={labelCls}>New password</label>
        <input
          type="text"
          className={inputCls}
          placeholder="Enter new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {err && <div className="mb-2.5 text-[13px] font-bold text-danger">{err}</div>}
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl border-none bg-brown p-3 text-sm font-bold text-warm-white disabled:cursor-not-allowed disabled:opacity-60"
        onClick={change}
        disabled={busy || !password}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Updating…" : "Update password"}
      </button>
    </div>
  );
}
