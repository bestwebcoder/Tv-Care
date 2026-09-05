import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PetForm } from "@/components/pets/pet-form";
import { requireRole } from "@/features/auth/session";
import { updatePetAction } from "@/features/pets/actions";
import { getPet, listBreeds, listSpecies } from "@/features/pets/queries";

export const metadata: Metadata = { title: "Edit patient · TV Care" };

export default async function AdminEditPatientPage({
  params,
}: PageProps<"/admin/patients/[petId]/edit">) {
  await requireRole("admin", "super_admin");
  const { petId } = await params;

  const result = await getPet(petId);
  if (result.status === "error" || !result.data) notFound();

  // This patient's own species and breed are kept in the lists even if an
  // administrator has since retired them, so saving the form cannot quietly
  // drop what the record already says.
  const [species, breeds] = await Promise.all([
    listSpecies(result.data.speciesId),
    listBreeds({ includeId: result.data.breedId }),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <PetForm
        action={updatePetAction}
        species={species}
        breeds={breeds}
        pet={result.data}
        submitLabel="Save changes"
      />
    </div>
  );
}
