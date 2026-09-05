import { createClient } from "@/lib/supabase/server";

/**
 * The patient vocabulary, read for the Settings screen.
 *
 * The patient form reads the same two tables through
 * `src/features/pets/queries.ts`, which shows only the active rows. This is
 * the administrator's view: inactive entries included, with enough context to
 * decide whether a row can be removed or only retired.
 */

export type Result<T> = { status: "ok"; data: T } | { status: "error" };

export type AdminBreed = {
  id: string;
  speciesId: string;
  name: string;
  isActive: boolean;
  /** Patients recorded under this breed. Non-zero means Delete is not offered. */
  patientCount: number;
};

export type AdminSpecies = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  breeds: AdminBreed[];
  patientCount: number;
  /**
   * Whether anything at all points at this species — patients, its own breeds,
   * or a vaccination schedule. Each is ON DELETE RESTRICT, so the database
   * refuses the delete regardless; knowing first is what lets the screen say
   * why instead of showing an administrator a foreign key violation.
   */
  inUse: boolean;
};

/**
 * The whole vocabulary in four reads, not one per species.
 *
 * The patient counts come back as plain id lists and are tallied here. There
 * are a few thousand patients at most in a practice of this size, and the
 * alternative — a count query per row — is one round trip per breed.
 */
export async function listSpeciesForAdmin(): Promise<Result<AdminSpecies[]>> {
  const supabase = await createClient();

  const [speciesResult, breedsResult, petsResult, schedulesResult] = await Promise.all([
    supabase.from("species").select("id, slug, name, sort_order, is_active").order("sort_order").order("name"),
    supabase.from("breeds").select("id, species_id, name, is_active").order("name"),
    supabase.from("pets").select("species_id, breed_id").is("deleted_at", null),
    supabase.from("vaccination_schedules").select("species_id").not("species_id", "is", null),
  ]);

  if (speciesResult.error || breedsResult.error) {
    console.error("[species] admin list failed", speciesResult.error ?? breedsResult.error);
    return { status: "error" };
  }

  // A read failure here would understate what is in use, and understating it
  // offers a Delete the database will refuse. Treat it as "everything is in
  // use" rather than as zero.
  const countsUnknown = Boolean(petsResult.error || schedulesResult.error);
  if (countsUnknown) console.error("[species] usage counts failed", petsResult.error ?? schedulesResult.error);

  const petsBySpecies = new Map<string, number>();
  const petsByBreed = new Map<string, number>();
  for (const row of petsResult.data ?? []) {
    if (row.species_id) petsBySpecies.set(row.species_id, (petsBySpecies.get(row.species_id) ?? 0) + 1);
    if (row.breed_id) petsByBreed.set(row.breed_id, (petsByBreed.get(row.breed_id) ?? 0) + 1);
  }

  const scheduled = new Set<string>();
  for (const row of schedulesResult.data ?? []) if (row.species_id) scheduled.add(row.species_id);

  const breedsBySpecies = new Map<string, AdminBreed[]>();
  for (const row of breedsResult.data ?? []) {
    const breed: AdminBreed = {
      id: row.id,
      speciesId: row.species_id,
      name: row.name,
      isActive: row.is_active,
      patientCount: countsUnknown ? 1 : (petsByBreed.get(row.id) ?? 0),
    };

    const list = breedsBySpecies.get(row.species_id);
    if (list) list.push(breed);
    else breedsBySpecies.set(row.species_id, [breed]);
  }

  return {
    status: "ok",
    data: (speciesResult.data ?? []).map((row) => {
      const breeds = breedsBySpecies.get(row.id) ?? [];
      const patientCount = countsUnknown ? 1 : (petsBySpecies.get(row.id) ?? 0);

      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        breeds,
        patientCount,
        inUse: countsUnknown || patientCount > 0 || breeds.length > 0 || scheduled.has(row.id),
      };
    }),
  };
}
