"use client";

import { useActionState, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createBreedAction,
  createSpeciesAction,
  deleteBreedAction,
  deleteSpeciesAction,
  toggleBreedActiveAction,
  toggleSpeciesActiveAction,
  updateBreedAction,
  updateSpeciesAction,
} from "@/features/species/actions";
import type { AdminBreed, AdminSpecies } from "@/features/species/queries";
import { idleState, type FormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Closes a dialog once its action has succeeded, without an effect.
 *
 * The same store-the-last-handled-state trick the branch manager uses: an
 * effect would run a render late and briefly show the dialog over a list that
 * has already changed underneath it.
 */
function useCloseOnSuccess(action: ServerAction) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, idleState);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") setOpen(false);
  }

  return { open, setOpen, state, formAction };
}

/** A one-field form posted by a button — deactivate, reactivate. */
function InlineAction({
  action,
  fields,
  children,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <form action={formAction} className="contents">
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Button type="submit" variant="ghost" size="sm">
        {children}
      </Button>
      {state.status === "error" ? (
        <span className="text-destructive w-full text-sm" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function ConfirmDeleteDialog({
  action,
  fields,
  trigger,
  title,
  description,
  confirmLabel,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
}) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(action);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormAlert state={state} />
        <form action={formAction}>
          {Object.entries(fields).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Deleting…" className="sm:w-auto">
              {confirmLabel}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

function SpeciesFields({
  defaults,
  errors,
}: {
  defaults?: AdminSpecies;
  errors?: Record<string, string[] | undefined>;
}) {
  // Settings already carries a practice "name" and a branch "name"; these need
  // ids of their own or the labels point at the wrong input.
  const prefix = defaults ? `species-${defaults.id}` : "species-new";

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <Field
        label="Species name"
        id={`${prefix}-name`}
        name="name"
        required
        defaultValue={defaults?.name ?? ""}
        errors={errors?.name}
      />
      <Field
        label="Order"
        id={`${prefix}-sort`}
        name="sortOrder"
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        className="sm:w-24"
        defaultValue={defaults?.sortOrder ?? 100}
        hint="Lower comes first"
        errors={errors?.sortOrder}
      />
    </div>
  );
}

function EditSpeciesDialog({ species }: { species: AdminSpecies }) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(updateSpeciesAction);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {species.name}</DialogTitle>
          <DialogDescription>
            Renaming updates every patient record that reads this species. Patients stay attached to it.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="speciesId" value={species.id} />
          <SpeciesFields defaults={species} errors={fieldErrors} />
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
              Save species
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Breeds
// ---------------------------------------------------------------------------

function BreedFields({
  speciesOptions,
  defaults,
  defaultSpeciesId,
  errors,
  idPrefix,
}: {
  speciesOptions: { value: string; label: string }[];
  defaults?: AdminBreed;
  defaultSpeciesId?: string;
  errors?: Record<string, string[] | undefined>;
  idPrefix: string;
}) {
  return (
    <>
      <Field
        label="Breed name"
        id={`${idPrefix}-name`}
        name="name"
        required
        defaultValue={defaults?.name ?? ""}
        errors={errors?.name}
      />
      <SelectField
        label="Species"
        id={`${idPrefix}-species`}
        name="speciesId"
        options={speciesOptions}
        defaultValue={defaults?.speciesId ?? defaultSpeciesId}
        placeholder="Select a species"
        errors={errors?.speciesId}
      />
    </>
  );
}

function EditBreedDialog({
  breed,
  speciesOptions,
}: {
  breed: AdminBreed;
  speciesOptions: { value: string; label: string }[];
}) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(updateBreedAction);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {breed.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="breedId" value={breed.id} />
          <BreedFields speciesOptions={speciesOptions} defaults={breed} errors={fieldErrors} idPrefix={`breed-${breed.id}`} />
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
              Save breed
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddBreedDialog({
  species,
  speciesOptions,
}: {
  species: AdminSpecies;
  speciesOptions: { value: string; label: string }[];
}) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(createBreedAction);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Add breed</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a {species.name.toLowerCase()} breed</DialogTitle>
          <DialogDescription>It appears in the Breed menu on the patient form straight away.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <BreedFields
            speciesOptions={speciesOptions}
            defaultSpeciesId={species.id}
            errors={fieldErrors}
            idPrefix={`breed-new-${species.id}`}
          />
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Adding…" className="sm:w-auto">
              Add breed
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BreedRow({
  breed,
  speciesOptions,
}: {
  breed: AdminBreed;
  speciesOptions: { value: string; label: string }[];
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className={cn(!breed.isActive && "text-muted-foreground")}>{breed.name}</span>
        {!breed.isActive ? <Badge variant="outline">Inactive</Badge> : null}
        {breed.patientCount > 0 ? (
          <span className="text-muted-foreground text-xs">
            {breed.patientCount} {breed.patientCount === 1 ? "patient" : "patients"}
          </span>
        ) : null}
      </span>

      <span className="flex flex-wrap items-center gap-1">
        <EditBreedDialog breed={breed} speciesOptions={speciesOptions} />
        <InlineAction
          action={toggleBreedActiveAction}
          fields={{ breedId: breed.id, isActive: breed.isActive ? "false" : "true" }}
        >
          {breed.isActive ? "Deactivate" : "Reactivate"}
        </InlineAction>
        {breed.patientCount === 0 ? (
          <ConfirmDeleteDialog
            action={deleteBreedAction}
            fields={{ breedId: breed.id }}
            trigger="Delete"
            title={`Delete ${breed.name}?`}
            description="No patient is recorded under this breed, so removing it loses nothing. Once a patient uses it, deactivate it instead."
            confirmLabel="Delete breed"
          />
        ) : null}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function SpeciesRow({
  species,
  speciesOptions,
}: {
  species: AdminSpecies;
  speciesOptions: { value: string; label: string }[];
}) {
  // Collapsed by default: seven species with a dozen breeds each is a wall of
  // text in a screen that is mostly about something else.
  const [open, setOpen] = useState(false);
  const activeBreeds = species.breeds.filter((breed) => breed.isActive).length;

  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {species.name}
            {!species.isActive ? <Badge variant="outline">Inactive</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {activeBreeds} of {species.breeds.length} {species.breeds.length === 1 ? "breed" : "breeds"} offered
            {species.patientCount > 0
              ? ` · ${species.patientCount} ${species.patientCount === 1 ? "patient" : "patients"}`
              : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <EditSpeciesDialog species={species} />
          <InlineAction
            action={toggleSpeciesActiveAction}
            fields={{ speciesId: species.id, isActive: species.isActive ? "false" : "true" }}
          >
            {species.isActive ? "Deactivate" : "Reactivate"}
          </InlineAction>
          {!species.inUse ? (
            <ConfirmDeleteDialog
              action={deleteSpeciesAction}
              fields={{ speciesId: species.id }}
              trigger="Delete"
              title={`Delete ${species.name}?`}
              description="Nothing is recorded under this species, so removing it loses nothing. Once a patient, breed or vaccination schedule uses it, deactivate it instead."
              confirmLabel="Delete species"
            />
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          {open ? "Hide breeds" : "Show breeds"}
        </Button>
        <AddBreedDialog species={species} speciesOptions={speciesOptions} />
      </div>

      {open ? (
        species.breeds.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No breeds yet — patients of this species can still be recorded with the breed left blank.
          </p>
        ) : (
          <ul className="mt-2 grid">
            {species.breeds.map((breed) => (
              <BreedRow key={breed.id} breed={breed} speciesOptions={speciesOptions} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

/**
 * The species and breeds the patient form offers.
 *
 * One shared vocabulary rather than free text, so "Golden Retriever" and
 * "golden retriver" cannot become two breeds and break every report that
 * groups by one. Anything a patient is recorded under is deactivated rather
 * than deleted — the record keeps reading correctly, the menu stops offering
 * it (CLAUDE.md §6).
 */
export function SpeciesManager({ species }: { species: AdminSpecies[] }) {
  const [state, formAction] = useActionState(createSpeciesAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const [adding, setAdding] = useState(false);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") setAdding(false);
  }

  const speciesOptions = species.map((option) => ({ value: option.id, label: option.name }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Species and breeds</CardTitle>
        <CardDescription>
          What the Species and Breed menus offer on the patient form. A species or breed already recorded on a patient
          can be renamed or deactivated, but not removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {species.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No species yet — add the first one and it appears on the patient form straight away.
          </p>
        ) : (
          <ul className="grid gap-2">
            {species.map((row) => (
              <SpeciesRow key={row.id} species={row} speciesOptions={speciesOptions} />
            ))}
          </ul>
        )}

        {adding ? (
          <form action={formAction} className="grid gap-4 border-t pt-4" noValidate>
            <FormAlert state={state} />
            <SpeciesFields errors={fieldErrors} />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Adding…" className="sm:w-auto">
                Add species
              </SubmitButton>
              <Button type="button" variant="outline" size="touch" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              Add species
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
