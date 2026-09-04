/**
 * Finds and removes truly orphaned accounts — nothing else.
 *
 * "Orphaned" means exactly one thing here: an auth.users row with no
 * matching public.users profile, or a public.users profile with no matching
 * auth.users row. Neither side can have anything referencing it (every other
 * table's user reference is RESTRICT, not CASCADE, specifically so a person
 * cannot be deleted out from under their own history — CLAUDE.md §6/§9), so
 * these are the one class of "stale user" that is safe to hard-delete
 * anywhere, in any environment, without touching clinical or financial
 * records.
 *
 * This deliberately does NOT touch:
 *   - accounts with any real history (appointments, invoices, SOAP records,
 *     audit log entries, ...) — those are not orphans, they are people, and
 *     CLAUDE.md §9/§6 says that data is never silently destroyed;
 *   - the demo seed's fictional practice — supabase db reset already removes
 *     it completely (nothing persists once the local DB is recreated), and
 *     scripts/seed-demo.mjs is the only thing that ever creates it;
 *   - "obsolete services" — there is no code path that fabricates services
 *     outside a migration's reference data, so there is nothing to clean up
 *     there. If a service really is defunct, deactivate or delete it from
 *     Admin → Services, which is what that screen is for.
 *
 * Defaults to a dry run — it reports what it found and changes nothing.
 * Pass --apply to actually delete.
 *
 * Run with:
 *   node scripts/cleanup-orphaned-accounts.mjs            # report only
 *   node scripts/cleanup-orphaned-accounts.mjs --apply     # delete
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
const apply = process.argv.includes("--apply");

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

// Every table with a RESTRICT foreign key to public.users(id) — see the
// migrations' information_schema. If a profile has a row in any of these, it
// is not an orphan: deleting it would either fail outright or, if it somehow
// didn't, take real history down with it.
const DEPENDENT_TABLES = [
  ["appointments", "created_by"],
  ["appointments", "cancelled_by"],
  ["audit_logs", "actor_user_id"],
  ["clients", "user_id"],
  ["data_exports", "actor_user_id"],
  ["data_imports", "actor_user_id"],
  ["deworming_records", "created_by"],
  ["diagnoses", "created_by"],
  ["diagnostics", "created_by"],
  ["doctors", "user_id"],
  ["documents", "uploaded_by"],
  ["invoices", "created_by"],
  ["notifications", "recipient_user_id"],
  ["payments", "recorded_by"],
  ["prescriptions", "created_by"],
  ["refunds", "recorded_by"],
  ["soap_records", "created_by"],
  ["staff", "user_id"],
  ["user_roles", "user_id"],
  ["user_roles", "granted_by"],
  ["vaccinations", "created_by"],
];

async function hasAnyDependent(userId) {
  for (const [table, column] of DEPENDENT_TABLES) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, userId);
    if (error) throw new Error(`Checking ${table}.${column} for ${userId}: ${error.message}`);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function main() {
  console.log(`Target: ${url}${apply ? " (applying changes)" : " (dry run — pass --apply to delete)"}\n`);

  const [authUsers, { data: profiles, error: profilesError }] = await Promise.all([
    listAllAuthUsers(),
    db.from("users").select("id, email"),
  ]);
  if (profilesError) throw profilesError;

  const profileIds = new Set(profiles.map((p) => p.id));
  const authIds = new Set(authUsers.map((u) => u.id));

  const authWithoutProfile = authUsers.filter((u) => !profileIds.has(u.id));
  const profilesWithoutAuth = profiles.filter((p) => !authIds.has(p.id));

  console.log(`auth.users with no public.users profile: ${authWithoutProfile.length}`);
  for (const user of authWithoutProfile) {
    console.log(`  - ${user.id}  ${user.email ?? "(no email)"}`);
    if (apply) {
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (error) console.error(`    failed to delete: ${error.message}`);
      else console.log("    deleted");
    }
  }

  console.log(`\npublic.users profiles with no auth.users row: ${profilesWithoutAuth.length}`);
  for (const profile of profilesWithoutAuth) {
    const blocked = await hasAnyDependent(profile.id);
    if (blocked) {
      console.log(`  - ${profile.id}  ${profile.email} — has real history, leaving in place`);
      continue;
    }
    console.log(`  - ${profile.id}  ${profile.email}`);
    if (apply) {
      const { error } = await db.from("users").delete().eq("id", profile.id);
      if (error) console.error(`    failed to delete: ${error.message}`);
      else console.log("    deleted");
    }
  }

  if (!apply && (authWithoutProfile.length > 0 || profilesWithoutAuth.length > 0)) {
    console.log("\nDry run only — re-run with --apply to delete the rows listed above.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
