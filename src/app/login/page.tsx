"use client";

import { useEffect, useState } from "react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "motion/react";
import { Loader2, Lock, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  PROFILE_COLUMNS,
  profileToUser,
  userIdToEmail,
  type ProfileRow,
} from "@/lib/auth";
import { defaultRoute } from "@/lib/permissions";
import { useAuthReady, useCurrentUser } from "@/components/system/AuthProvider";
import { LoadingScreen } from "@/components/system/LoadingScreen";

const inputClass =
  "w-full rounded-xl border border-transparent bg-cream py-3.5 pl-11 pr-4 text-[15px] text-ink transition-all placeholder:text-ink/40 focus:border-[#8a6a3c]/30 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#8a6a3c]/10";

const iconWrapClass =
  "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4";

export default function LoginPage() {
  const router = useRouter();
  const ready = useAuthReady();
  const user = useCurrentUser();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // If already signed in, skip the login screen.
  useEffect(() => {
    if (ready && user) router.replace(defaultRoute(user));
  }, [ready, user, router]);

  const submit = async () => {
    if (!userId.trim() || !password) {
      setError("Please enter your User ID and Password.");
      return;
    }
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { data: auth, error: signErr } = await supabase.auth.signInWithPassword({
      email: userIdToEmail(userId),
      password,
    });
    if (signErr || !auth.user) {
      setError("Invalid User ID or Password");
      setBusy(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", auth.user.id)
      .single();

    router.replace(
      profile ? defaultRoute(profileToUser(profile as ProfileRow)) : "/dashboard",
    );
  };

  // Show the branded splash (not a blank screen) while auth resolves, and keep
  // it up for already-signed-in users while they redirect — avoids a form flash.
  if (!ready || user) return <LoadingScreen />;

  return (
    <LazyMotion features={domAnimation}>
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#3a200d] p-4 sm:p-6">
        {/* FULL-BLEED BACKGROUND (mobile + desktop): bakery photo with a slow zoom */}
        <m.img
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 12, ease: "easeOut" }}
          src="/login-bakery.jpg"
          alt=""
          aria-hidden="true"
          fetchPriority="low"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Warm brand tint + a soft vignette that darkens the edges and focuses
            attention on the centered card */}
        <div className="absolute inset-0 bg-[#241407]/75" />
        <div className="absolute inset-0 bg-[radial-gradient(115%_115%_at_50%_45%,transparent_30%,rgba(15,8,0,0.7)_100%)]" />

        {/* CENTERED LOGIN CARD — frosted, floats above the photo */}
        <m.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative z-10 w-full max-w-[400px] rounded-[32px] border border-white/50 bg-warm-white/90 p-8 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-10"
        >
          {/* Header & Logo */}
          <div className="mb-8 flex flex-col items-center text-center">
            <m.img
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.5, type: "spring" }}
              fetchPriority="high"
              src="/apple-touch-icon.png"
              alt="Bakers Theory"
              className="h-[72px] w-[72px] rounded-[22px] object-cover shadow-[0_8px_24px_rgba(90,52,20,0.28)]"
            />
            <h2 className="wordmark mt-5 text-[32px] leading-[1.1] text-[#3a200d]">
              Bakers Theory
            </h2>
            <p className="mt-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-[#8a6a3c]/80">
              Store Management
            </p>
            <p className="mt-3 text-[13.5px] text-ink-muted">
              Crafting joy, one bake at a time.
            </p>
          </div>

          {/* Form Inputs */}
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8a6a3c]">
                User ID
              </label>
              <div className="relative">
                <div className={iconWrapClass}>
                  <User size={18} className="text-[#8a6a3c]/50" />
                </div>
                <input
                  type="text"
                  placeholder="Enter your ID"
                  autoComplete="username"
                  className={inputClass}
                  value={userId}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUserId(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8a6a3c]">
                Password
              </label>
              <div className="relative">
                <div className={iconWrapClass}>
                  <Lock size={18} className="text-[#8a6a3c]/50" />
                </div>
                <input
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={inputClass}
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              </div>
            </div>
          </div>

          {/* Error Message with Animation */}
          <div className="mt-4 min-h-[24px]">
            <AnimatePresence>
              {error && (
                <m.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg bg-danger/10 px-3 py-2 text-center text-[13.5px] font-semibold text-danger"
                >
                  {error}
                </m.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit Button */}
          <m.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="btn-primary mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-semibold shadow-lg shadow-[#8a6a3c]/20 transition-all disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none"
            onClick={submit}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </m.button>
        </m.div>
      </div>
    </LazyMotion>
  );
}
