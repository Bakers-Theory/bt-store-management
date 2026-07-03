"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { PROFILE_COLUMNS, profileToUser, type ProfileRow } from "@/lib/auth";
import type { User } from "@/lib/types";

interface AuthContextValue {
  /** The signed-in user (profile) in the app's User shape, or null. */
  user: User | null;
  /** True once the initial auth state has resolved. */
  ready: boolean;
  /** Re-fetch the current profile (after edits). */
  refresh: () => Promise<void>;
  /** Sign out of Supabase. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  ready: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const loadProfile = async (userId: string | undefined) => {
    if (!userId) {
      setUser(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .single();
    setUser(data ? profileToUser(data as ProfileRow) : null);
  };

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session (INITIAL_SESSION).
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await loadProfile(session?.user?.id);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      refresh: async () => {
        const { data } = await supabase.auth.getUser();
        await loadProfile(data.user?.id);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setUser(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, ready, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const useCurrentUser = (): User | null => useContext(AuthContext).user;
export const useAuthReady = (): boolean => useContext(AuthContext).ready;
