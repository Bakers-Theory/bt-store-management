"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { defaultRoute } from "@/lib/permissions";

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useBakeryStore((s) => s._hasHydrated);
  const login = useBakeryStore((s) => s.login);
  const user = useCurrentUser();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // If already logged in, skip the login screen.
  useEffect(() => {
    if (hydrated && user) router.replace(defaultRoute(user));
  }, [hydrated, user, router]);

  const submit = () => {
    const r = login(userId.trim(), password);
    if (!r.ok) {
      setError(r.error ?? "");
      return;
    }
    setError("");
    router.replace(defaultRoute(r.user!));
  };

  if (!hydrated || user) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[linear-gradient(160deg,var(--color-brown),var(--color-brown-dark))] p-5">
      <div className="w-full max-w-[360px] rounded-[20px] bg-white px-6 py-[30px] text-center shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
        <div className="mb-1.5 text-[46px]">🧁</div>
        <h1 className="mb-1">Bakers Theory</h1>
        <div className="mb-[22px] text-[13px] text-ink-muted">Sign in to continue</div>
        <div className="form-group text-left">
          <label className="form-label">User ID</label>
          <input
            type="text"
            placeholder="Enter your User ID"
            autoComplete="username"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div className="form-group text-left">
          <label className="form-label">Password</label>
          <input
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        {error && (
          <div className="mb-2.5 text-left text-[13px] font-semibold text-danger">{error}</div>
        )}
        <button
          className="btn-primary w-full p-[13px] text-base"
          onClick={submit}
        >
          🔓 Login
        </button>
      </div>
    </div>
  );
}
