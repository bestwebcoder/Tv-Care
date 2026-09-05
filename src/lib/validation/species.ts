import { z } from "zod";

import { uuidSchema } from "@/lib/validation/common";

/**
 * The patient vocabulary: what an animal is, and what breed of it.
 *
 * Free text on the patient form would let "Golden Retriever" and "golden
 * retriver" become two breeds and quietly break every report that groups by
 * one, which is why 20260820000400_pets.sql made these tables in the first
 * place. Administrators extend the list here instead.
 */

export const speciesSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a species name")
    .max(60, "Keep the name under 60 characters"),
  // Where it sits in the patient form's Species menu. Lower comes first; the
  // seeded list uses tens so a new species can be slotted between two.
  sortOrder: z.coerce
    .number()
    .int("Use a whole number")
    .min(0, "Use 0 or more")
    .max(9999, "Use 9999 or less"),
});

export const breedSchema = z.object({
  speciesId: uuidSchema,
  name: z
    .string()
    .trim()
    .min(1, "Enter a breed name")
    .max(80, "Keep the name under 80 characters"),
});

export type SpeciesInput = z.input<typeof speciesSchema>;
export type SpeciesValues = z.output<typeof speciesSchema>;
export type BreedValues = z.output<typeof breedSchema>;

/**
 * The stable key behind a species name.
 *
 * Written once, when the species is created, and never rewritten: migrations
 * seed vaccination schedules against `species.slug`, so a rename that moved it
 * would silently detach them. The column is not even grantable to
 * `authenticated` for update — see 20261009000100.
 */
export function speciesSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // species_slug_format rejects an empty slug, which a name of only
  // punctuation would produce. Fall back to something valid rather than fail
  // on save with a constraint the administrator cannot see.
  return base || `species-${Date.now().toString(36)}`;
}
