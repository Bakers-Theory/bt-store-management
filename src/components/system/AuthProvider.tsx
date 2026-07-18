"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { PROFILE_COLUMNS, profileToUser, type ProfileRow } from "@/lib/auth";
import { useBakeryStore } from "@/lib/store";
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
  const [uid, setUid] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // Track the auth session. IMPORTANT: keep this callback SYNCHRONOUS — awaiting
  // a Supabase DB call inside onAuthStateChange can deadlock on the auth lock
  // (notably on a hard reload), leaving `ready` stuck false and the page blank.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUid(session?.user?.id ?? null);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // Fetch the profile whenever the signed-in user changes — OUTSIDE the auth
  // callback, so it doesn't contend with the auth lock.
  useEffect(() => {
    if (!uid) {
      setUser(null);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", uid)
      .single()
      .then(({ data }) => {
        if (active) setUser(data ? profileToUser(data as ProfileRow) : null);
      });
    return () => {
      active = false;
    };
  }, [uid, supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      refresh: async () => {
        const { data } = await supabase.auth.getUser();
        const id = data.user?.id;
        if (!id) {
          setUser(null);
          return;
        }
        const { data: prof } = await supabase
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", id)
          .single();
        setUser(prof ? profileToUser(prof as ProfileRow) : null);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setUid(null);
        setUser(null);
        // Drop the cached store so the next user on this device starts clean
        // (never inherits the previous user's items, incl. private cost prices).
        useBakeryStore.getState().reset();
        useBakeryStore.persist.clearStorage();
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
