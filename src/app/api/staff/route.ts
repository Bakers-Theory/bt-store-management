import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { userIdToEmail } from "@/lib/auth";

interface Permissions {
  sales: boolean;
  inventory: boolean;
  analytics: boolean;
}

/** Returns the caller's auth id if they are the Owner, else null. */
async function requireOwner(): Promise<string | null> {
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

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

// Create staff
export async function POST(req: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return forbidden();
  const { userId, name, password, permissions } = (await req.json()) as {
    userId: string;
    name: string;
    password: string;
    permissions: Permissions;
  };
  if (!userId?.trim() || !name?.trim() || !password) {
    return bad("Name, User ID and password are required.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: userIdToEmail(userId),
    password,
    email_confirm: true,
    user_metadata: {
      user_id: userId.trim(),
      name: name.trim(),
      role: "Staff",
      perm_sales: !!permissions?.sales,
      perm_inventory: !!permissions?.inventory,
      perm_analytics: !!permissions?.analytics,
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
    actor: ownerId,
    notes: `Added staff ${name.trim()} (${userId.trim()})`,
  });
  return NextResponse.json({ ok: true });
}

// Edit staff (name / permissions / optional password reset)
export async function PATCH(req: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return forbidden();
  const { id, name, permissions, password } = (await req.json()) as {
    id: string;
    name: string;
    permissions: Permissions;
    password?: string;
  };
  if (!id || !name?.trim()) return bad("Name is required.");

  const admin = createAdminClient();
  // Snapshot the current profile so the audit entry can describe what changed.
  const { data: before } = await admin
    .from("profiles")
    .select("name,perm_sales,perm_inventory,perm_analytics")
    .eq("id", id)
    .single();

  const { error: profErr } = await admin
    .from("profiles")
    .update({
      name: name.trim(),
      perm_sales: !!permissions?.sales,
      perm_inventory: !!permissions?.inventory,
      perm_analytics: !!permissions?.analytics,
    })
    .eq("id", id)
    .eq("role", "Staff"); // never edit the Owner via this route
  if (profErr) return bad(profErr.message);

  // Audit: log the field-level diff (skipped when nothing actually changed).
  if (before) {
    const changes: string[] = [];
    if (before.name !== name.trim()) changes.push(`name → ${name.trim()}`);
    const perm = (label: string, was: boolean, now: boolean) => {
      if (was !== now) changes.push(`${now ? "+" : "−"}${label}`);
    };
    perm("Sales", before.perm_sales, !!permissions?.sales);
    perm("Inventory", before.perm_inventory, !!permissions?.inventory);
    perm("Analytics", before.perm_analytics, !!permissions?.analytics);
    if (changes.length) {
      await admin.from("activity_log").insert({
        type: "staff_edit",
        actor: ownerId,
        notes: `Updated ${before.name}: ${changes.join(", ")}`,
      });
    }
  }

  if (password) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(id, { password });
    if (pwErr) return bad(pwErr.message);
    await admin.from("activity_log").insert({
      type: "password",
      actor: ownerId,
      notes: `Reset password for ${before?.name ?? name.trim()}`,
    });
  }
  return NextResponse.json({ ok: true });
}

// Delete staff
export async function DELETE(req: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return forbidden();
  const { id } = (await req.json()) as { id: string };
  if (!id) return bad("Missing user id.");

  const admin = createAdminClient();
  // Guard: never delete the Owner.
  const { data: prof } = await admin.from("profiles").select("role,name").eq("id", id).single();
  if (prof?.role === "Owner") return bad("The Owner account cannot be deleted.");

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return bad(error.message);
  // Log after deletion succeeds; actor is the Owner, so it survives the cascade.
  await admin.from("activity_log").insert({
    type: "staff_remove",
    actor: ownerId,
    notes: `Removed staff ${prof?.name ?? ""}`.trim(),
  });
  return NextResponse.json({ ok: true });
}
