import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * The caller's auth id if they are the Owner, else null.
 *
 * Archiving and deleting are Owner-only, unlike the rest of `staff.manage`:
 * locking a colleague out — or erasing them — is not something a delegated
 * manager should be able to do.
 */
export async function requireOwner(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return data?.role === "Owner" ? user.id : null;
}
