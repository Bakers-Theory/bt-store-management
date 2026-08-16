import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireOwner } from "../owner";

/**
 * Archive / un-archive a staff member.
 *
 * Replaces the old delete path (migration 0074). Deleting a profile cascaded
 * its attendance, salary and advance rows away and blanked its name everywhere
 * else, so a staff member is now switched off instead: the row stays, the work
 * stays, the login stops.
 *
 * Owner-only, not `staff.manage`: locking a colleague out is the one staff
 * action a delegated manager should not be able to take.
 */

/**
 * Supabase has no "ban forever", so a ban is dated a century out. The value is
 * only ever set or cleared, never read back — `archived_at` is the truth the
 * app reads.
 */
const FOREVER = "876000h";

export async function POST(req: Request) {
  const actorId = await requireOwner();
  if (!actorId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, archived } = (await req.json()) as { id: string; archived: boolean };
  if (!id) {
    return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profiles")
    .select("role,name")
    .eq("id", id)
    .single();
  if (!prof) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 400 });
  }
  if (prof.role === "Owner") {
    return NextResponse.json(
      { error: "The Owner account cannot be archived." },
      { status: 400 },
    );
  }

  // The login gate first: if the ban fails, nothing has changed and the caller
  // can retry. Doing it the other way round would leave someone marked archived
  // who can still sign in.
  const { error: banErr } = await admin.auth.admin.updateUserById(id, {
    ban_duration: archived ? FOREVER : "none",
  });
  if (banErr) {
    return NextResponse.json({ error: banErr.message }, { status: 400 });
  }

  const { error: profErr } = await admin
    .from("profiles")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? actorId : null,
    })
    .eq("id", id)
    .eq("role", "Staff");
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    type: "staff_edit",
    actor: actorId,
    notes: archived
      ? `Archived ${prof.name} — can no longer sign in`
      : `Unarchived ${prof.name} — access restored`,
  });

  return NextResponse.json({ ok: true });
}
