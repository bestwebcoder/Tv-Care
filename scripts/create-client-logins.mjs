/**
 * Gives existing clients an online account.
 *
 * A client record and a login are separate things in TV Care: most of a
 * practice's roster is walk-in records staff maintain on people's behalf, and
 * clients.user_id is nullable precisely so that is a normal state. This backs
 * the ones that have an email with a real Supabase account, links it, and
 * grants the client role.
 *
 * THE TRAP THIS SCRIPT EXISTS TO AVOID
 *
 * public.handle_new_user (20260820000300_signup.sql) fires on every insert
 * into auth.users. When the metadata says signup_source = 'self_registration'
 * it does three things: creates the profile, grants the client role, and
 * INSERTS A NEW ROW INTO public.clients. Creating an account that way for
 * somebody who is already a client produces a duplicate: a second record with
 * their name and no pets, no appointments and no history, while the real one
 * stays orphaned without a login.
 *
 * So this deliberately omits that flag. The trigger then creates the profile
 * and returns early, and the role grant and the link are made here — which is
 * exactly the "administrative flow that grants the right role deliberately"
 * the trigger's own comment describes.
 *
 * THE PASSWORD
 *
 * Every account is created with the same password, passed with --password, and
 * it must satisfy the same policy as passwordSchema in
 * src/lib/validation/auth.ts (and auth.minimum_password_length /
 * password_requirements in supabase/config.toml). Registration used to accept
 * a 6-digit PIN and this script took --pin to match; that rule is gone, and a
 * short PIN is now rejected by the auth server itself.
 *
 * One password shared across a roster is only safe where the people are
 * fictional. A client's portal shows their pets' medical records, and anyone
 * who knows the pattern can read any of them. Hence the local-only refusal
 * below, matching scripts/seed-demo.mjs.
 *
 * The accounts are created pre-confirmed (email_confirm: true). Email
 * confirmation is required for people who register themselves; these are
 * provisioned by an administrator for clients already on the roster, and there
 * is no inbox to send a fictional address a link to.
 *
 * Defaults to a dry run.
 *
 *   node scripts/create-client-logins.mjs --password 'Demo-Password-123'
 *   node scripts/create-client-logins.mjs --password 'Demo-Password-123' --apply
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
const passwordFlag = process.argv.indexOf("--password");
const password = passwordFlag === -1 ? null : process.argv[passwordFlag + 1];

/** The policy passwordSchema enforces in the app, restated here so a rejection
 *  is reported before any account is touched rather than by the auth server
 *  halfway through the roster. */
function policyFailure(value) {
  if (value.length < 10) return "at least 10 characters";
  if (value.length > 72) return "72 characters or fewer";
  if (!/[a-z]/.test(value)) return "a lowercase letter";
  if (!/[A-Z]/.test(value)) return "an uppercase letter";
  if (!/\d/.test(value)) return "a number";
  return null;
}

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// Not defaulted. A shared credential is a decision, and it should have to be
// typed out by the person making it rather than inherited from a constant.
if (!password) {
  console.error("Pass --password <password>, for example: --password 'Demo-Password-123'");
  process.exit(1);
}

const missing = policyFailure(password);

if (missing) {
  console.error(`That password is rejected by the auth policy: it needs ${missing}.`);
  process.exit(1);
}

// The same hard refusal seed-demo.mjs makes, for the same reason and one more:
// this uses the service role key, and it sets one known credential on every
// account it touches.
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url)) {
  console.error(`Refusing to set a shared password on a non-local database:\n  ${url}`);
  console.error("Real clients get their own credential, through registration or a password reset.");
  process.exit(1);
}

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  console.log(`Target: ${url}`);
  console.log(apply ? "Mode:   applying\n" : "Mode:   dry run — pass --apply to create accounts\n");

  const { data: clients, error } = await db
    .from("clients")
    .select("id, full_name, email, phone, organization_id")
    .is("user_id", null)
    .is("deleted_at", null)
    .order("created_at");

  if (error) throw error;

  const { data: role, error: roleError } = await db
    .from("roles")
    .select("id")
    .eq("slug", "client")
    .eq("is_system", true)
    .single();

  if (roleError) throw roleError;

  // An account is reached by email; a client without one cannot be given a
  // login at all. Reported rather than skipped silently — somebody has to know
  // to go and ask them for an address.
  const eligible = clients.filter((client) => client.email);
  const noEmail = clients.filter((client) => !client.email);

  const { data: page } = await db.auth.admin.listUsers({ perPage: 1000 });
  const takenEmails = new Set(page.users.map((user) => user.email?.toLowerCase()).filter(Boolean));

  const taken = eligible.filter((client) => takenEmails.has(client.email.toLowerCase()));
  const ready = eligible.filter((client) => !takenEmails.has(client.email.toLowerCase()));

  console.log(`Clients with no login: ${clients.length}`);
  console.log(`  will get an account:  ${ready.length}`);
  console.log(`  no email on record:   ${noEmail.length}`);
  console.log(`  email already in use: ${taken.length}\n`);

  for (const client of noEmail) console.log(`  - ${client.full_name}: no email, skipped`);
  for (const client of taken) console.log(`  - ${client.full_name}: ${client.email} already has an account, skipped`);
  if (noEmail.length || taken.length) console.log("");

  if (!apply) {
    for (const client of ready) console.log(`  would create ${client.email} for ${client.full_name}`);
    console.log("\nDry run — nothing was created.");
    return;
  }

  let created = 0;

  for (const client of ready) {
    // No signup_source: the trigger creates the profile and stops. See the
    // note at the top of this file — with it, this line would silently
    // fabricate a second client record for the same person.
    const { data: account, error: createError } = await db.auth.admin.createUser({
      email: client.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: client.full_name, phone: client.phone },
    });

    if (createError) {
      console.error(`  ! ${client.full_name}: ${createError.message}`);
      continue;
    }

    const userId = account.user.id;

    // The role is granted in the client's OWN practice, not the default one:
    // default_organization_id() is right for a stranger registering from the
    // public site and wrong for a record that already belongs somewhere.
    const { error: grantError } = await db
      .from("user_roles")
      .insert({ user_id: userId, role_id: role.id, organization_id: client.organization_id });

    // An account that exists but is not linked or has no role is worse than no
    // account: it can sign in and see nothing, and it holds the email address
    // hostage against a retry. Undo it rather than leave that behind.
    if (grantError) {
      await db.auth.admin.deleteUser(userId);
      console.error(`  ! ${client.full_name}: role grant failed, account rolled back — ${grantError.message}`);
      continue;
    }

    const { error: linkError } = await db
      .from("clients")
      .update({ user_id: userId })
      .eq("id", client.id);

    if (linkError) {
      await db.from("user_roles").delete().eq("user_id", userId);
      await db.auth.admin.deleteUser(userId);
      console.error(`  ! ${client.full_name}: link failed, account rolled back — ${linkError.message}`);
      continue;
    }

    created += 1;
    console.log(`  + ${client.full_name} — ${client.email}`);
  }

  console.log(`\nCreated ${created} account(s). Every one signs in with the password you passed.`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
