import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { PROFILE_COLUMNS, profileToUser, type ProfileRow } from "@/lib/auth";
import { defaultRoute } from "@/lib/permissions";

/**
 * Resolve the session server-side so signed-in users go straight to their
 * default route instead of bouncing through /login and a client-side auth
 * round trip. Unauthenticated users are sent to /login.
 */
export default async function Index() {
  const supabase = createClient(cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prof } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  redirect(defaultRoute(prof ? profileToUser(prof as ProfileRow) : null));
}
