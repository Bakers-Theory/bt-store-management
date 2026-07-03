// One-time owner seed. Replaces the hardcoded owner in constants.ts.
//
// Requires the Supabase SERVICE ROLE key (never ship this to the client).
// Add to .env.local:
//   SUPABASE_URL=https://xasxbplitrptxsivgaqc.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key from Supabase dashboard>
//   OWNER_USER_ID=7873557430
//   OWNER_NAME=Prateek Kumar Patel
//   OWNER_PASSWORD=<a real strong password>
//
// Run (Node 20+):  node --env-file=.env.local scripts/seed-owner.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.OWNER_USER_ID ?? "admin";
const name = process.env.OWNER_NAME ?? "Prateek Kumar Patel";
const password = process.env.OWNER_PASSWORD;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("Set OWNER_PASSWORD to a strong password (>= 8 chars).");
  process.exit(1);
}

const email = `${userId}@bt.local`;
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    user_id: userId,
    name,
    role: "Owner",
    perm_sales: true,
    perm_inventory: true,
    perm_analytics: true,
  },
});

if (error) {
  console.error("Failed to create owner:", error.message || error.name || error);
  console.error("Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  process.exit(1);
}

console.log(`✅ Owner created: ${name} (login ID: ${userId}, email: ${email})`);
console.log(`   auth user id: ${data.user?.id}`);
console.log("   The handle_new_user trigger created the matching profiles row.");
