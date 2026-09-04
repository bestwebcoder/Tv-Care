/**
 * Ensures one Super Admin account exists, creating it or updating its
 * password if it already does, and grants the Super Admin role if it is not
 * already held.
 *
 * Unlike seed-demo.mjs this provisions a real account, not a fictional
 * practice, so it is not restricted to the local database — it runs against
 * whichever project NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * point at. The email and password are read from the environment
 * (SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD) rather than written here, so this
 * file is safe to commit and the credentials never enter git history.
 *
 * Run with:
 *   SUPER_ADMIN_EMAIL=someone@example.com SUPER_ADMIN_PASSWORD=... npm run ensure:super-admin
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const merged = { ...process.env };

  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const at = line.indexOf("=");
      merged[line.slice(0, at).trim()] ??= line.slice(at + 1).trim();
    }
  } catch {
    // No .env.local; rely on the environment.
  }

  return merged;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const email = env.SUPER_ADMIN_EMAIL;
const password = env.SUPER_ADMIN_PASSWORD;
const fullName = env.SUPER_ADMIN_NAME?.trim() || "Super Admin";

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (!email || !password) {
  console.error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in the environment and re-run. Example:");
  console.error("  SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD=... npm run ensure:super-admin");
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data: existingProfile, error: profileLookupError } = await db
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileLookupError) throw profileLookupError;

  let userId = existingProfile?.id ?? null;

  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw error;
    console.log(`Updated password for existing account: ${email}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    userId = data.user.id;

    // The profile row already exists: handle_new_user (20260820000300) writes
    // one for every auth account, whatever created it, so that an account can
    // never exist without a profile. Upsert rather than insert — inserting
    // races that trigger and loses, which is exactly what it did.
    const { error: profileError } = await db
      .from("users")
      .upsert({ id: userId, full_name: fullName, email }, { onConflict: "id" });
    if (profileError) throw profileError;

    console.log(`Created account: ${email}`);
  }

  const { data: organization, error: orgError } = await db
    .from("organizations")
    .select("id")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!organization) throw new Error("No active organization to grant the role in.");

  const { data: role, error: roleError } = await db.from("roles").select("id").eq("slug", "super_admin").single();
  if (roleError) throw roleError;

  const { data: existingGrant, error: grantLookupError } = await db
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role_id", role.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (grantLookupError) throw grantLookupError;

  if (existingGrant) {
    console.log("Already holds the Super Admin role — nothing to grant.");
  } else {
    const { error: grantError } = await db
      .from("user_roles")
      .insert({ user_id: userId, role_id: role.id, organization_id: organization.id });
    if (grantError) throw grantError;
    console.log("Granted the Super Admin role.");
  }

  console.log(`Done: ${email} is a Super Admin.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
