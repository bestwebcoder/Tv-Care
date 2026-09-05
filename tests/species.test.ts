import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admin, createOrganization, createUserWithRole, runId, signIn, signedInClient } from "./setup/http";

/**
 * The patient vocabulary becomes administrator-managed —
 * 20261009000100_species_breeds_management.sql.
 *
 * The screen is a card in Settings; the rules worth pinning are the
 * database's. Who may write the list, that the stable slug behind a species
 * survives a rename, and that nothing a patient record is built on can be
 * deleted out from under it.
 */

const RUN = runId();

let orgA: string;
let adminA: SupabaseClient;
let doctorA: SupabaseClient;
let clientA: SupabaseClient;

let adminEmail: string;
let doctorEmail: string;

let speciesId: string;
let breedId: string;

/** Rows this run made, torn down at the end: the vocabulary is shared. */
const madeSpecies: string[] = [];
const madeBreeds: string[] = [];
const madeClients: string[] = [];

async function speciesRow(id: string) {
  const { data } = await admin.from("species").select("name, slug, sort_order, is_active").eq("id", id).single();
  return data!;
}

async function breedRow(id: string) {
  const { data } = await admin.from("breeds").select("name, species_id, is_active").eq("id", id).single();
  return data!;
}

beforeAll(async () => {
  orgA = await createOrganization(`species-${RUN}`);

  const [adminUser, vet, owner] = await Promise.all([
    createUserWithRole(`sp-admin-${RUN}`, "admin", orgA),
    createUserWithRole(`sp-vet-${RUN}`, "doctor", orgA),
    createUserWithRole(`sp-client-${RUN}`, "client", orgA),
  ]);
  adminEmail = adminUser.email;
  doctorEmail = vet.email;

  const { data: species } = await admin
    .from("species")
    .insert({ name: `Horse ${RUN}`, slug: `horse-${RUN}`, sort_order: 500 })
    .select("id")
    .single();
  speciesId = species!.id;
  madeSpecies.push(speciesId);

  const { data: breed } = await admin
    .from("breeds")
    .insert({ species_id: speciesId, name: `Marwari ${RUN}` })
    .select("id")
    .single();
  breedId = breed!.id;
  madeBreeds.push(breedId);

  [adminA, doctorA, clientA] = await Promise.all([
    signedInClient(adminUser.email),
    signedInClient(vet.email),
    signedInClient(owner.email),
  ]);
}, 180_000);

afterAll(async () => {
  // Unlike the account fixtures, these rows land in a list every other test's
  // patient form reads, so this run genuinely has to take them back out.
  //
  // The patient goes first: pets, breeds and species are each ON DELETE
  // RESTRICT, and a single `in (...)` delete is one statement — one row the
  // database still refuses would roll the whole thing back and leave every
  // other fixture behind.
  await admin.from("pets").delete().in("species_id", madeSpecies);
  await admin.from("clients").delete().in("id", madeClients);
  await admin.from("breeds").delete().in("id", madeBreeds);
  await admin.from("species").delete().in("id", madeSpecies);

  const { data: left } = await admin.from("species").select("id").in("id", madeSpecies);
  expect(left ?? [], "species fixtures left in the shared vocabulary").toHaveLength(0);
});

describe("who may manage the vocabulary", () => {
  it("lets an admin add a species — the grant this migration adds", async () => {
    const { data, error } = await adminA
      .from("species")
      .insert({ name: `Donkey ${RUN}`, slug: `donkey-${RUN}`, sort_order: 510 })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    madeSpecies.push(data!.id);
  });

  it("lets an admin rename a species and add a breed under it", async () => {
    const { error: renameError } = await adminA
      .from("species")
      .update({ name: `Pony ${RUN}` })
      .eq("id", speciesId);
    expect(renameError).toBeNull();
    expect((await speciesRow(speciesId)).name).toBe(`Pony ${RUN}`);

    const { data, error } = await adminA
      .from("breeds")
      .insert({ species_id: speciesId, name: `Sylheti ${RUN}` })
      .select("id")
      .single();
    expect(error).toBeNull();
    madeBreeds.push(data!.id);
  });

  it("refuses a doctor, who reads the list but does not own it", async () => {
    await doctorA.from("species").update({ name: "Doctor was here" }).eq("id", speciesId);
    await doctorA.from("breeds").update({ name: "Doctor was here" }).eq("id", breedId);

    expect((await speciesRow(speciesId)).name).toBe(`Pony ${RUN}`);
    expect((await breedRow(breedId)).name).toBe(`Marwari ${RUN}`);

    const { error } = await doctorA.from("species").insert({ name: `Nope ${RUN}`, slug: `nope-${RUN}` });
    expect(error).not.toBeNull();
  });

  it("refuses a client outright", async () => {
    const { error } = await clientA.from("species").insert({ name: `Client ${RUN}`, slug: `client-${RUN}` });
    expect(error).not.toBeNull();

    await clientA.from("breeds").delete().eq("id", breedId);
    expect(await breedRow(breedId)).toBeTruthy();
  });

  it("still lets every signed-in role read it — the patient form needs it", async () => {
    for (const db of [adminA, doctorA, clientA]) {
      const { data, error } = await db.from("species").select("id").eq("id", speciesId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(1);
    }
  });
});

describe("the slug behind a species", () => {
  it("cannot be moved by a rename, because the column is not grantable", async () => {
    const { error } = await adminA.from("species").update({ slug: `moved-${RUN}` }).eq("id", speciesId);

    expect(error).not.toBeNull();
    expect((await speciesRow(speciesId)).slug).toBe(`horse-${RUN}`);
  });
});

describe("retiring against removing", () => {
  it("deactivates a species without touching the patients recorded under it", async () => {
    const { error } = await adminA.from("species").update({ is_active: false }).eq("id", speciesId);

    expect(error).toBeNull();
    expect((await speciesRow(speciesId)).is_active).toBe(false);

    await adminA.from("species").update({ is_active: true }).eq("id", speciesId);
  });

  it("removes a breed nothing points at", async () => {
    const { data: spare } = await admin
      .from("breeds")
      .insert({ species_id: speciesId, name: `Spare ${RUN}` })
      .select("id")
      .single();

    const { error } = await adminA.from("breeds").delete().eq("id", spare!.id);
    expect(error).toBeNull();

    const { data } = await admin.from("breeds").select("id").eq("id", spare!.id).maybeSingle();
    expect(data).toBeNull();
  });

  it("refuses to delete a species or breed a patient is recorded under", async () => {
    const { data: ownerRow } = await admin
      .from("clients")
      .insert({
        organization_id: orgA,
        full_name: `Vocabulary Owner ${RUN}`,
        phone: `+8801711${RUN.slice(-6).padStart(6, "0")}`,
      })
      .select("id")
      .single();
    madeClients.push(ownerRow!.id);

    const { data: pet } = await admin
      .from("pets")
      .insert({
        client_id: ownerRow!.id,
        organization_id: orgA,
        name: `Vocabulary Patient ${RUN}`,
        species_id: speciesId,
        breed_id: breedId,
      })
      .select("id")
      .single();

    const breedDelete = await adminA.from("breeds").delete().eq("id", breedId);
    expect(breedDelete.error?.code).toBe("23503");

    const speciesDelete = await adminA.from("species").delete().eq("id", speciesId);
    expect(speciesDelete.error?.code).toBe("23503");

    expect(await breedRow(breedId)).toBeTruthy();
    expect(pet?.id).toBeTruthy();
  });
});

describe("the Settings card", () => {
  it("renders the vocabulary for an admin, with its breed count", async () => {
    const session = await signIn(adminEmail);
    const response = await session.page("/admin/settings");

    // React server-renders interpolated text as separate nodes separated by
    // `<!-- -->`, so a sentence built from a count is not a substring of the
    // markup until the comments and tags come out.
    const text = (await response.text()).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ");

    expect(response.status).toBe(200);
    expect(text).toContain("Species and breeds");
    expect(text).toContain(`Pony ${RUN}`);
    // Two breeds by the time this runs: the one made in beforeAll and the one
    // the admin added above. The spare was created and deleted again.
    expect(text).toMatch(/2 of 2 breeds offered/);
  });

  it("does not let a doctor reach the screen at all", async () => {
    const session = await signIn(doctorEmail);
    const response = await session.get("/admin/settings");

    expect(response.status).toBe(307);
  });
});
