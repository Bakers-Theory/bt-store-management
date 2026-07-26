import type { PermissionKey, User, UserRole } from "./types";
import { isPermissionKey } from "./permissions";

/** Synthetic email domain that backs the "User ID" login UX in Supabase Auth. */
export const AUTH_EMAIL_DOMAIN = "bt.local";

/** Map a login handle (e.g. "7873557430") to its Supabase Auth email. */
export const userIdToEmail = (userId: string): string =>
  `${userId.trim()}@${AUTH_EMAIL_DOMAIN}`;

/** A row from the public.profiles table. */
export interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  role: UserRole;
  perms: string[] | null;
}

/** Columns to select for a profile (kept in one place). */
export const PROFILE_COLUMNS = "id,user_id,name,role,perms";

/**
 * Adapt a Supabase profile row to the `User` shape the app uses.
 *
 * Unknown keys in `perms` are dropped rather than trusted: a permission the
 * client build doesn't know about can't be rendered or reasoned about, and SQL
 * is the real gate either way.
 */
export function profileToUser(p: ProfileRow): User {
  return {
    id: p.id,
    userId: p.user_id,
    name: p.name,
    role: p.role,
    permissions: (p.perms ?? []).filter(isPermissionKey) as PermissionKey[],
  };
}
