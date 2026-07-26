import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { userIdToEmail } from "@/lib/auth";
import { isPermissionKey, permissionLabel } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/types";

/**
 * Returns the caller's auth id if they may manage staff, else null.
 *
 * The Owner always may; anyone else needs the `staff.manage` permission. Every
 * handler below additionally refuses to touch the Owner's row, so a delegated
 * manager can never edit, demote, or delete the account above them.
 */
async function requireStaffManager(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role,perms")
    .eq("id", user.id)
    .single();
  if (!data) return null;
  const allowed =
    data.role === "Owner" || (data.perms ?? []).includes("staff.manage");
  return allowed ? user.id : null;
}

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

/**
 * Narrow an untrusted payload to catalogue keys. Unknown strings are rejected
 * rather than dropped: silently storing part of what was sent would make the
 * Settings grid disagree with reality.
 */
function parsePerms(input: unknown): PermissionKey[] | { error: string } {
  if (!Array.isArray(input)) return { error: "Permissions must be a list." };
  const unknown = input.filter((k) => !isPermissionKey(k));
  if (unknown.length) {
    return { error: `Unknown permission: ${String(unknown[0])}` };
  }
  return Array.from(new Set(input as PermissionKey[]));
}

/** Added/removed permissions, by label, for the audit trail. */
function permDiff(before: string[], after: PermissionKey[]): string[] {
  const added = after.filter((k) => !before.includes(k));
  const removed = before.filter((k) => !after.includes(k as PermissionKey));
  return [
    ...added.map((k) => `+${permissionLabel(k)}`),
    ...removed.filter(isPermissionKey).map((k) => `−${permissionLabel(k)}`),
  ];
}

// Create staff
export async function POST(req: Request) {
  const actorId = await requireStaffManager();
  if (!actorId) return forbidden();
  const { userId, name, password, permissions } = (await req.json()) as {
    userId: string;
    name: string;
    password: string;
    permissions: unknown;
  };
  if (!userId?.trim() || !name?.trim() || !password) {
    return bad("Name, User ID and password are required.");
  }
  const perms = parsePerms(permissions);
  if ("error" in perms) return bad(perms.error);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: userIdToEmail(userId),
    password,
    email_confirm: true,
    user_metadata: {
      user_id: userId.trim(),
      name: name.trim(),
      role: "Staff",
      perms,
    },
  });
  if (error) {
    const msg = /already/i.test(error.message)
      ? "This User ID is already taken."
      : error.message;
    return bad(msg);
  }
  await admin.from("activity_log").insert({
    type: "staff_add",
    actor: actorId,
    notes: `Added staff ${name.trim()} (${userId.trim()})`,
  });
  return NextResponse.json({ ok: true });
}

// Edit staff (name / permissions / optional password reset)
export async function PATCH(req: Request) {
  const actorId = await requireStaffManager();
  if (!actorId) return forbidden();
  const { id, name, permissions, password } = (await req.json()) as {
    id: string;
    name: string;
    permissions: unknown;
    password?: string;
  };
  if (!id || !name?.trim()) return bad("Name is required.");
  const perms = parsePerms(permissions);
  if ("error" in perms) return bad(perms.error);

  const admin = createAdminClient();
  // Snapshot the current profile so the audit entry can describe what changed.
  const { data: before } = await admin
    .from("profiles")
    .select("name,role,perms")
    .eq("id", id)
    .single();
  if (before?.role === "Owner") return bad("The Owner account cannot be edited here.");

  const { error: profErr } = await admin
    .from("profiles")
    .update({ name: name.trim(), perms })
    .eq("id", id)
    .eq("role", "Staff"); // never edit the Owner via this route
  if (profErr) return bad(profErr.message);

  // Audit: log the field-level diff (skipped when nothing actually changed).
  if (before) {
    const changes: string[] = [];
    if (before.name !== name.trim()) changes.push(`name → ${name.trim()}`);
    changes.push(...permDiff(before.perms ?? [], perms));
    if (changes.length) {
      await admin.from("activity_log").insert({
        type: "staff_edit",
        actor: actorId,
        notes: `Updated ${before.name}: ${changes.join(", ")}`,
      });
    }
  }

  if (password) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(id, { password });
    if (pwErr) return bad(pwErr.message);
    await admin.from("activity_log").insert({
      type: "password",
      actor: actorId,
      notes: `Reset password for ${before?.name ?? name.trim()}`,
    });
  }
  return NextResponse.json({ ok: true });
}

// Delete staff
export async function DELETE(req: Request) {
  const actorId = await requireStaffManager();
  if (!actorId) return forbidden();
  const { id } = (await req.json()) as { id: string };
  if (!id) return bad("Missing user id.");

  const admin = createAdminClient();
  // Guard: never delete the Owner.
  const { data: prof } = await admin.from("profiles").select("role,name").eq("id", id).single();
  if (prof?.role === "Owner") return bad("The Owner account cannot be deleted.");

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return bad(error.message);
  // Log after deletion succeeds; actor survives the cascade.
  await admin.from("activity_log").insert({
    type: "staff_remove",
    actor: actorId,
    notes: `Removed staff ${prof?.name ?? ""}`.trim(),
  });
  return NextResponse.json({ ok: true });
}
