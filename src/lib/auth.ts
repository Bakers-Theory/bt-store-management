import type { User, UserRole } from "./types";

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
  perm_sales: boolean;
  perm_inventory: boolean;
  perm_analytics: boolean;
}

/** Columns to select for a profile (kept in one place). */
export const PROFILE_COLUMNS =
  "id,user_id,name,role,perm_sales,perm_inventory,perm_analytics";

/**
 * Adapt a Supabase profile row to the `User` shape the app already uses, so
 * permissions.ts and existing components work unchanged.
 */
export function profileToUser(p: ProfileRow): User {
  return {
    id: p.id,
    userId: p.user_id,
    name: p.name,
    role: p.role,
    permissions: {
      sales: p.perm_sales,
      inventory: p.perm_inventory,
      analytics: p.perm_analytics,
    },
  };
}
