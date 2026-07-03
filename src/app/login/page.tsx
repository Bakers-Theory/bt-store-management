"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBakeryStore, useCurrentUser } from "@/lib/store";
import { defaultRoute } from "@/lib/permissions";
import { Croissant } from "lucide-react";

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
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[radial-gradient(circle_at_30%_12%,#fff7ec,#efdfc4)] p-6">
      <div className="w-full max-w-[384px] rounded-[24px] border border-line bg-warm-white px-8 py-9 shadow-[0_22px_64px_rgba(90,52,20,0.16)]">
        <div className="mb-[26px] flex flex-col items-center text-center">
          <div className="flex h-[62px] w-[62px] items-center justify-center rounded-[19px] bg-[linear-gradient(150deg,#7c4a1e,#5a3414)] text-warm-white shadow-[0_7px_20px_rgba(90,52,20,0.32)]">
            <Croissant size={31} />
          </div>
          <div className="wordmark mt-3.5 text-[28px] leading-[1.1]">Bakers Theory</div>
          <div className="mt-1 text-[11.5px] font-bold tracking-[0.08em] text-ink-light">
            STORE MANAGER
          </div>
        </div>
        <div className="mb-3.5 text-left">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">User ID</label>
          <input
            type="text"
            placeholder="Enter your ID"
            autoComplete="username"
            className="bg-cream"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div className="mb-[22px] text-left">
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Password</label>
          <input
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            className="bg-cream"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        {error && (
          <div className="mb-3 text-left text-[13px] font-semibold text-danger">{error}</div>
        )}
        <button className="btn-primary w-full p-3.5 text-[15px]" onClick={submit}>
          Sign in
        </button>
        <div className="mt-4 text-center text-xs text-ink-light">
          Owner demo · ID{" "}
          <span className="num font-bold text-[#8a6a3c]">7873557430</span>
        </div>
      </div>
    </div>
  );
}
