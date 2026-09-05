"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/features/auth/session";
import { failure, invalid, text, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { breedSchema, speciesSchema, speciesSlug } from "@/lib/validation/species";

/**
 * Writes to the shared patient vocabulary.
 *
 * Admin only here, and again in row level security (20261009000100), which is
 * where the rule actually holds: these actions are a convenience layer over
 * policies keyed on settings.manage.
 *
 * Only Settings is revalidated. The patient forms read the vocabulary too, but
 * every one of them is behind requireRole and so rendered per request already
 * — there is no cached copy of them to invalidate.
 */

function revalidateVocabulary() {
  revalidatePath("/admin/settings");
}

function duplicateSpecies(): FormState {
  return {
    status: "error",
    message: "A species with this name already exists.",
    fieldErrors: { name: ["Already in use"] },
  };
}

function duplicateBreed(): FormState {
  return {
    status: "error",
    message: "That species already has a breed with this name.",
    fieldErrors: { name: ["Already in use"] },
  };
}

/**
 * A delete the database refused because something still points at the row.
 *
 * 23503 is a foreign key violation, which for these tables can only mean the
 * ON DELETE RESTRICT on pets, breeds or vaccination_schedules. The screen
 * checks first and hides Delete, so reaching this means the list was read
 * before the record that now uses it was written.
 */
function stillInUse(what: string): FormState {
  return {
    status: "error",
    message: `That ${what} is used by a patient record, so it cannot be deleted. Deactivate it instead — it stays on the records that already use it and stops being offered on new ones.`,
  };
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export async function createSpeciesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const parsed = speciesSchema.safeParse({
    name: text(formData, "name") ?? "",
    sortOrder: text(formData, "sortOrder") ?? 100,
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("species").insert({
    name: parsed.data.name,
    slug: speciesSlug(parsed.data.name),
    sort_order: parsed.data.sortOrder,
  });

  if (error) {
    if (error.code === "23505") return duplicateSpecies();
    return failure("species", error, "We could not add that species just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Species added." };
}

export async function updateSpeciesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const speciesId = text(formData, "speciesId");
  if (!speciesId) return { status: "error", message: "We could not tell which species this is." };

  const parsed = speciesSchema.safeParse({
    name: text(formData, "name") ?? "",
    sortOrder: text(formData, "sortOrder") ?? 100,
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  // slug is deliberately not updated: it is the key migrations seed
  // vaccination schedules against, and a rename must not move it.
  const { error } = await supabase
    .from("species")
    .update({ name: parsed.data.name, sort_order: parsed.data.sortOrder })
    .eq("id", speciesId);

  if (error) {
    if (error.code === "23505") return duplicateSpecies();
    return failure("species", error, "We could not save that species just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Species saved." };
}

export async function toggleSpeciesActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const speciesId = text(formData, "speciesId");
  const isActive = formData.get("isActive") === "true";
  if (!speciesId) return { status: "error", message: "We could not tell which species this is." };

  const supabase = await createClient();

  // Its breeds go with it. Leaving them offerable under a species nobody can
  // choose is not a state the patient form can represent.
  const { error } = await supabase.from("species").update({ is_active: isActive }).eq("id", speciesId);

  if (error) {
    return failure("species", error, "We could not update that species just now. Please try again.");
  }

  const { error: breedError } = await supabase
    .from("breeds")
    .update({ is_active: isActive })
    .eq("species_id", speciesId);

  if (breedError) {
    return failure("species", breedError, "The species was updated, but its breeds could not be. Please try again.");
  }

  revalidateVocabulary();
  return {
    status: "success",
    message: isActive ? "Species reactivated, along with its breeds." : "Species deactivated, along with its breeds.",
  };
}

export async function deleteSpeciesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const speciesId = text(formData, "speciesId");
  if (!speciesId) return { status: "error", message: "We could not tell which species to delete." };

  const supabase = await createClient();
  const { error } = await supabase.from("species").delete().eq("id", speciesId);

  if (error) {
    if (error.code === "23503") return stillInUse("species");
    return failure("species", error, "We could not delete that species just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Species deleted." };
}

// ---------------------------------------------------------------------------
// Breeds
// ---------------------------------------------------------------------------

export async function createBreedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const parsed = breedSchema.safeParse({
    speciesId: text(formData, "speciesId") ?? "",
    name: text(formData, "name") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("breeds")
    .insert({ species_id: parsed.data.speciesId, name: parsed.data.name });

  if (error) {
    if (error.code === "23505") return duplicateBreed();
    return failure("species", error, "We could not add that breed just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Breed added." };
}

export async function updateBreedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const breedId = text(formData, "breedId");
  if (!breedId) return { status: "error", message: "We could not tell which breed this is." };

  const parsed = breedSchema.safeParse({
    speciesId: text(formData, "speciesId") ?? "",
    name: text(formData, "name") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("breeds")
    .select("species_id")
    .eq("id", breedId)
    .maybeSingle();

  if (!existing) return { status: "error", message: "That breed could not be found." };

  // Moving a breed to another species is how a misfiled one gets corrected,
  // but pets carry the composite (breed_id, species_id) key: a patient already
  // recorded under it would be left pointing at a pair that no longer exists.
  // The database refuses that outright; this says so in a sentence.
  if (existing.species_id !== parsed.data.speciesId) {
    const { count } = await supabase
      .from("pets")
      .select("id", { count: "exact", head: true })
      .eq("breed_id", breedId);

    if ((count ?? 0) > 0) {
      return {
        status: "error",
        message:
          "This breed is already recorded on a patient, so it cannot be moved to another species. Add it under the right species and deactivate this one.",
        fieldErrors: { speciesId: ["In use under the current species"] },
      };
    }
  }

  const { error } = await supabase
    .from("breeds")
    .update({ name: parsed.data.name, species_id: parsed.data.speciesId })
    .eq("id", breedId);

  if (error) {
    if (error.code === "23505") return duplicateBreed();
    return failure("species", error, "We could not save that breed just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Breed saved." };
}

export async function toggleBreedActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const breedId = text(formData, "breedId");
  const isActive = formData.get("isActive") === "true";
  if (!breedId) return { status: "error", message: "We could not tell which breed this is." };

  const supabase = await createClient();
  const { error } = await supabase.from("breeds").update({ is_active: isActive }).eq("id", breedId);

  if (error) {
    return failure("species", error, "We could not update that breed just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: isActive ? "Breed reactivated." : "Breed deactivated." };
}

export async function deleteBreedAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "super_admin");

  const breedId = text(formData, "breedId");
  if (!breedId) return { status: "error", message: "We could not tell which breed to delete." };

  const supabase = await createClient();
  const { error } = await supabase.from("breeds").delete().eq("id", breedId);

  if (error) {
    if (error.code === "23503") return stillInUse("breed");
    return failure("species", error, "We could not delete that breed just now. Please try again.");
  }

  revalidateVocabulary();
  return { status: "success", message: "Breed deleted." };
}
