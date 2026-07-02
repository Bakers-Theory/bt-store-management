"use client";

import { useState } from "react";
import { useUIStore } from "@/lib/ui-store";
import { useBakeryStore } from "@/lib/store";
import { Modal } from "@/components/ui/Modal";

export function OwnerAuthHost() {
  const req = useUIStore((s) => s.ownerAuth);
  const close = useUIStore((s) => s.closeOwnerAuth);
  const owner = useBakeryStore((s) => s.users.find((u) => u.role === "Owner"));
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");

  if (!req) return null;

  const reset = () => {
    setPwd("");
    setErr("");
  };
  const dismiss = () => {
    reset();
    close();
  };
  const confirm = () => {
    if (!owner || pwd !== owner.password) {
      setErr("❌ Incorrect owner password");
      return;
    }
    const cb = req.onConfirm;
    reset();
    close();
    cb();
  };

  return (
    <Modal title="🔒 Owner Authorization" onClose={dismiss}>
      <p className="mb-3.5 text-[13px] text-ink-muted">
        This action ({req.label}) can only be authorized with the Owner&apos;s password.
      </p>
      <div className="form-group">
        <label className="form-label">Owner Password</label>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          placeholder="Enter owner password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
          }}
        />
      </div>
      {err && <div className="mb-2.5 text-[13px] font-semibold text-danger">{err}</div>}
      <button className="btn-danger w-full" onClick={confirm}>
        🔓 Confirm &amp; Continue
      </button>
    </Modal>
  );
}
