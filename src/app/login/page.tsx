"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Loader2, User, Lock, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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

  // Show the branded splash while auth resolves
  if (!ready || user) return <LoadingScreen />;

  return (
    <div className="flex min-h-screen w-full bg-[#fff7ec] sm:bg-[#fcf5eb]">
      
      {/* LEFT PANEL - GRAPHIC (Hidden on Mobile, visible on lg screens) */}
      <div className="relative hidden w-1/2 overflow-hidden bg-[#3a200d] lg:block">
        {/* Subtle slow-zoom animation on the background image */}
        <motion.img
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          transition={{ duration: 10, ease: "easeOut" }}
          src="https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=2072&auto=format&fit=crop"
          alt="Bakery background"
          className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-overlay"
        />
        
        {/* Content Overlay */}
        <div className="absolute inset-0 flex flex-col justify-between p-16">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.8 }}
            className="flex items-center gap-3 text-white/90"
          >
            <Store size={24} />
            <span className="text-sm font-semibold tracking-widest uppercase">Internal Portal</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
          >
            <h1 className="mb-6 text-5xl font-bold leading-[1.15] text-white">
              Crafting joy, <br />
              <span className="text-[#e2b778]">one bake at a time.</span>
            </h1>
            <p className="max-w-md text-lg text-white/70">
              Access your store dashboard to manage daily operations, inventory, and incoming orders efficiently.
            </p>
          </motion.div>
        </div>
      </div>

      {/* RIGHT PANEL - FORM (Full width on mobile, half width on lg screens) */}
      <div className="relative flex w-full flex-col items-center justify-center p-6 lg:w-1/2">
        
        {/* Decorative background blur for mobile */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#efdfc4_0%,transparent_70%)] lg:hidden" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative z-10 w-full max-w-[420px] rounded-[28px] border border-line bg-warm-white p-8 shadow-[0_22px_64px_rgba(90,52,20,0.08)] sm:p-10"
        >
          {/* Header & Logo */}
          <div className="mb-8 flex flex-col items-center text-center">
            <motion.img
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.5, type: "spring" }}
              fetchPriority="high"
              src="/apple-touch-icon.png"
              alt="Bakers Theory"
              className="h-[72px] w-[72px] rounded-[22px] object-cover shadow-[0_8px_24px_rgba(90,52,20,0.2)]"
            />
            <h2 className="wordmark mt-5 text-[32px] leading-[1.1] text-[#3a200d]">
              Bakers Theory
            </h2>
            <p className="mt-1.5 text-[12px] font-bold tracking-[0.1em] text-[#8a6a3c]/80 uppercase">
              Store Management
            </p>
          </div>

          {/* Form Inputs */}
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#8a6a3c]">
                User ID
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <User size={18} className="text-[#8a6a3c]/50" />
                </div>
                <input
                  type="text"
                  placeholder="Enter your ID"
                  autoComplete="username"
                  className="w-full rounded-xl border border-transparent bg-cream py-3.5 pl-11 pr-4 text-[15px] text-ink transition-all placeholder:text-ink/40 focus:border-[#8a6a3c]/30 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#8a6a3c]/10"
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
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <Lock size={18} className="text-[#8a6a3c]/50" />
                </div>
                <input
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-transparent bg-cream py-3.5 pl-11 pr-4 text-[15px] text-ink transition-all placeholder:text-ink/40 focus:border-[#8a6a3c]/30 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#8a6a3c]/10"
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
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg bg-danger/10 px-3 py-2 text-center text-[13.5px] font-semibold text-danger"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit Button */}
          <motion.button
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
          </motion.button>
          
        </motion.div>
      </div>
    </div>
  );
}

// "use client";

// // import { useEffect, useState } from "react";
// import { Loader2 } from "lucide-react";
// import { useRouter } from "next/navigation";
// import { createClient } from "@/utils/supabase/client";
// import {
//   PROFILE_COLUMNS,
//   profileToUser,
//   userIdToEmail,
//   type ProfileRow,
// } from "@/lib/auth";
// import { defaultRoute } from "@/lib/permissions";
// import { useAuthReady, useCurrentUser } from "@/components/system/AuthProvider";
// import { LoadingScreen } from "@/components/system/LoadingScreen";

// export default function LoginPage() {
//   const router = useRouter();
//   const ready = useAuthReady();
//   const user = useCurrentUser();

//   const [userId, setUserId] = useState("");
//   const [password, setPassword] = useState("");
//   const [error, setError] = useState("");
//   const [busy, setBusy] = useState(false);

//   // If already signed in, skip the login screen.
//   useEffect(() => {
//     if (ready && user) router.replace(defaultRoute(user));
//   }, [ready, user, router]);

//   const submit = async () => {
//     if (!userId.trim() || !password) {
//       setError("Please enter your User ID and Password.");
//       return;
//     }
//     setBusy(true);
//     setError("");

//     const supabase = createClient();
//     const { data: auth, error: signErr } = await supabase.auth.signInWithPassword({
//       email: userIdToEmail(userId),
//       password,
//     });
//     if (signErr || !auth.user) {
//       setError("Invalid User ID or Password");
//       setBusy(false);
//       return;
//     }

//     const { data: profile } = await supabase
//       .from("profiles")
//       .select(PROFILE_COLUMNS)
//       .eq("id", auth.user.id)
//       .single();

//     router.replace(
//       profile ? defaultRoute(profileToUser(profile as ProfileRow)) : "/dashboard",
//     );
//   };

//   // Show the branded splash (not a blank screen) while auth resolves, and keep
//   // it up for already-signed-in users while they redirect — avoids a form flash.
//   if (!ready || user) return <LoadingScreen />;

//   return (
//     <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[radial-gradient(circle_at_30%_12%,#fff7ec,#efdfc4)] p-6">
//       <div className="w-full max-w-[384px] rounded-[24px] border border-line bg-warm-white px-8 py-9 shadow-[0_22px_64px_rgba(90,52,20,0.16)]">
//         <div className="mb-[26px] flex flex-col items-center text-center">
//           {/* eslint-disable-next-line @next/next/no-img-element */}
//           <img
//             fetchPriority="high"
//             src="/apple-touch-icon.png"
//             alt="Bakers Theory"
//             className="h-[62px] w-[62px] rounded-[19px] object-cover shadow-[0_7px_20px_rgba(90,52,20,0.32)]"
//           />
//           <div className="wordmark mt-3.5 text-[28px] leading-[1.1]">Bakers Theory</div>
//           <div className="mt-1 text-[11.5px] font-bold tracking-[0.08em] text-ink-light">
//             STORE MANAGEMENT
//           </div>
//         </div>
//         <div className="mb-3.5 text-left">
//           <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">User ID</label>
//           <input
//             type="text"
//             placeholder="Enter your ID"
//             autoComplete="username"
//             className="bg-cream"
//             value={userId}
//             onChange={(e) => setUserId(e.target.value)}
//           />
//         </div>
//         <div className="mb-[22px] text-left">
//           <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]">Password</label>
//           <input
//             type="password"
//             placeholder="Enter your password"
//             autoComplete="current-password"
//             className="bg-cream"
//             value={password}
//             onChange={(e) => setPassword(e.target.value)}
//             onKeyDown={(e) => {
//               if (e.key === "Enter") submit();
//             }}
//           />
//         </div>
//         {error && (
//           <div className="mb-3 text-left text-[13px] font-semibold text-danger">{error}</div>
//         )}
//         <button
//           className="btn-primary flex w-full items-center justify-center gap-2 p-3.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60"
//           onClick={submit}
//           disabled={busy}
//         >
//           {busy && <Loader2 size={16} className="animate-spin" />}
//           {busy ? "Signing in…" : "Sign in"}
//         </button>
//       </div>
//     </div>
//   );
// }
