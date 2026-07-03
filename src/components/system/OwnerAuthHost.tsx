"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { LockOpen } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import { useCurrentUser } from "@/components/system/AuthProvider";
import { userIdToEmail } from "@/lib/auth";
import { Modal } from "@/components/ui/Modal";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export function OwnerAuthHost() {
  const req = useUIStore((s) => s.ownerAuth);
  const close = useUIStore((s) => s.closeOwnerAuth);
  const user = useCurrentUser();
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!req) return null;

  const reset = () => {
    setPwd("");
    setErr("");
  };
  const dismiss = () => {
    reset();
    close();
  };
  const confirm = async () => {
    if (!user) {
      setErr("Not signed in");
      return;
    }
    setBusy(true);
    setErr("");
    // Verify the password on a throwaway client so the active session is untouched.
    const verifier = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await verifier.auth.signInWithPassword({
      email: userIdToEmail(user.userId),
      password: pwd,
    });
    setBusy(false);
    if (error) {
      setErr("Incorrect password");
      return;
    }
    const cb = req.onConfirm;
    reset();
    close();
    cb();
  };

  return (
    <Modal title="Confirm your password" onClose={dismiss}>
      <p className="mb-3.5 text-[13px] text-ink-muted">
        This action ({req.label}) needs you to re-enter your password.
      </p>
      <div className="form-group">
        <label className="form-label">Your Password</label>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          placeholder="Enter your password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
          }}
        />
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button
        className="btn-danger inline-flex w-full items-center justify-center gap-1.5 disabled:opacity-60"
        onClick={confirm}
        disabled={busy}
      >
        <LockOpen size={16} /> Confirm &amp; Continue
      </button>
    </Modal>
  );
}
