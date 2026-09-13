"use client";

import { useActionState, useState } from "react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addPrescriptionItemAction,
  removePrescriptionItemAction,
  savePrescriptionWeightAction,
  updatePrescriptionItemAction,
} from "@/features/prescriptions/actions";
import type { MedicationOption, PrescriptionItem } from "@/features/prescriptions/queries";
import { computeDose, InvalidDoseError, MissingWeightError } from "@/lib/dose";
import { idleState } from "@/lib/forms";
import {
  DOSE_FORM_LABELS,
  DOSE_FORMS,
  doseAmountFromMass,
  doseFormUnit,
  InvalidConcentrationError,
  prescriptionDirections,
  prescriptionItemLabel,
  type DoseForm,
} from "@/lib/prescription-directions";
import { gramsToKilograms } from "@/lib/units";

type Props = {
  prescriptionId: string;
  appointmentId: string;
  petId: string;
  items: PrescriptionItem[];
  medications: MedicationOption[];
  /** What the calculator uses: this prescription's saved weight, else the visit's. */
  weightGrams: number | null;
  /** Whether weightGrams is saved on the prescription, or only suggested from the visit. */
  weightSaved: boolean;
  canEdit: boolean;
};

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The weight the prescription is dosed against — its own small form, saved independently of the items. */
function WeightForm({
  prescriptionId,
  appointmentId,
  petId,
  weightGrams,
  weightSaved,
}: Pick<Props, "prescriptionId" | "appointmentId" | "petId" | "weightGrams" | "weightSaved">) {
  const [state, formAction] = useActionState(savePrescriptionWeightAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-3 rounded-lg border p-3">
      <FormAlert state={state} />
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="petId" value={petId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field
            label="Patient weight (kg)"
            name="weightKg"
            inputMode="decimal"
            defaultValue={weightGrams ? gramsToKilograms(weightGrams) : ""}
            hint={
              weightSaved
                ? "Doses on this prescription are calculated from this weight."
                : weightGrams
                  ? "Suggested from this visit's record — save it to dose against it."
                  : "No weight recorded for this visit. Weigh the patient and enter it here."
            }
            errors={fieldErrors?.weightKg}
          />
        </div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Save weight
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Dose per kg → total mg → amount of the product, and the directions sentence
 * previewed as it will print. Every value stays editable: the calculator fills
 * fields, it never locks them (CLAUDE.md §11).
 */
function DosingFields({
  defaults,
  weightGrams,
  errors,
  names,
}: {
  defaults?: Partial<PrescriptionItem>;
  weightGrams: number | null;
  errors?: Record<string, string[] | undefined>;
  names: { drugName: string; genericName: string };
}) {
  const [dosePerKg, setDosePerKg] = useState(defaults?.dosePerKg?.toString() ?? "");
  const [doseUnit, setDoseUnit] = useState(defaults?.doseUnit ?? "mg");
  const [computedDose, setComputedDose] = useState(defaults?.computedDose?.toString() ?? "");
  const [doseForm, setDoseForm] = useState<DoseForm | "">(defaults?.doseForm ?? "");
  const [concentration, setConcentration] = useState(defaults?.concentrationMgPerUnit?.toString() ?? "");
  const [doseAmount, setDoseAmount] = useState(defaults?.doseAmount?.toString() ?? "");
  const [route, setRoute] = useState(defaults?.route ?? "");
  const [frequencyPerDay, setFrequencyPerDay] = useState(defaults?.frequencyPerDay?.toString() ?? "");
  const [durationDays, setDurationDays] = useState(defaults?.durationDays?.toString() ?? "");
  const [calcMessage, setCalcMessage] = useState<string | null>(null);

  function calculate() {
    const steps: string[] = [];
    let mg = toNumber(computedDose);

    if (dosePerKg.trim() !== "") {
      try {
        const rate = Number(dosePerKg);
        mg = computeDose(weightGrams, rate);
        setComputedDose(String(mg));
        steps.push(`${gramsToKilograms(weightGrams!)} kg × ${rate} ${doseUnit}/kg = ${mg} ${doseUnit}`);
      } catch (error) {
        if (error instanceof MissingWeightError || error instanceof InvalidDoseError) {
          setCalcMessage(error.message);
          return;
        }
        throw error;
      }
    }

    if (doseForm && concentration.trim() !== "") {
      if (doseUnit.trim().toLowerCase() !== "mg") {
        steps.push("Converting to an amount needs the dose in mg.");
      } else {
        try {
          const amount = doseAmountFromMass(mg ?? Number.NaN, Number(concentration));
          setDoseAmount(String(amount));
          steps.push(`${mg} mg ÷ ${concentration} mg/${doseFormUnit(doseForm)} = ${amount} ${doseFormUnit(doseForm, amount)}`);
        } catch (error) {
          if (error instanceof InvalidConcentrationError) {
            steps.push(error.message);
          } else {
            throw error;
          }
        }
      }
    }

    setCalcMessage(steps.length > 0 ? steps.join(" · ") : "Enter a dose per kg, or a concentration and a dose in mg.");
  }

  const form = doseForm || null;
  const label = prescriptionItemLabel({
    drugName: names.drugName || "Drug",
    genericName: names.genericName || null,
    concentrationMgPerUnit: toNumber(concentration),
    doseForm: form,
  });
  const directions = prescriptionDirections({
    doseAmount: toNumber(doseAmount),
    doseForm: form,
    route,
    frequencyPerDay: toNumber(frequencyPerDay),
    durationDays: toNumber(durationDays),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Dose per kg"
          name="dosePerKg"
          inputMode="decimal"
          value={dosePerKg}
          onChange={(event) => setDosePerKg(event.target.value)}
          hint="Optional — leave blank for a flat dose"
          errors={errors?.dosePerKg}
        />
        <Field
          label="Unit"
          name="doseUnit"
          value={doseUnit}
          onChange={(event) => setDoseUnit(event.target.value)}
          placeholder="mg"
          errors={errors?.doseUnit}
        />
        <Field
          label="Dose"
          name="computedDose"
          inputMode="decimal"
          value={computedDose}
          onChange={(event) => setComputedDose(event.target.value)}
          hint="Total per administration"
          errors={errors?.computedDose}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Given as"
          name="doseForm"
          options={[{ value: "", label: "Choose…" }, ...DOSE_FORMS.map((value) => ({ value, label: DOSE_FORM_LABELS[value] }))]}
          value={doseForm}
          onValueChange={(value) => setDoseForm(value as DoseForm | "")}
          errors={errors?.doseForm}
        />
        <Field
          label={`Concentration (mg/${doseForm ? doseFormUnit(doseForm) : "unit"})`}
          name="concentrationMgPerUnit"
          inputMode="decimal"
          value={concentration}
          onChange={(event) => setConcentration(event.target.value)}
          placeholder="50"
          errors={errors?.concentrationMgPerUnit}
        />
        <div className="grid gap-2">
          <Field
            label={`Amount to give${doseForm ? ` (${doseFormUnit(doseForm, 2)})` : ""}`}
            name="doseAmount"
            inputMode="decimal"
            value={doseAmount}
            onChange={(event) => setDoseAmount(event.target.value)}
            errors={errors?.doseAmount}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <div>
          <Button type="button" variant="outline" onClick={calculate}>
            Calculate
          </Button>
        </div>
        {calcMessage ? (
          <p className="text-muted-foreground text-xs" data-numeric aria-live="polite">
            {calcMessage}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field
          label="Route"
          name="route"
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          placeholder="PO"
          errors={errors?.route}
        />
        <Field
          label="Times a day"
          name="frequencyPerDay"
          inputMode="numeric"
          value={frequencyPerDay}
          onChange={(event) => setFrequencyPerDay(event.target.value)}
          placeholder="2"
          errors={errors?.frequencyPerDay}
        />
        <Field
          label="For how many days"
          name="durationDays"
          inputMode="numeric"
          value={durationDays}
          onChange={(event) => setDurationDays(event.target.value)}
          placeholder="7"
          errors={errors?.durationDays}
        />
        <Field label="Quantity" name="quantity" defaultValue={defaults?.quantity ?? ""} errors={errors?.quantity} />
      </div>

      {/* Free text from before structured directions; carried through so an edit does not wipe it. */}
      <input type="hidden" name="frequency" value={defaults?.frequency ?? ""} />
      <input type="hidden" name="duration" value={defaults?.duration ?? ""} />

      <div className="bg-muted/40 grid gap-0.5 rounded-lg p-3 text-sm" aria-live="polite">
        <span className="text-muted-foreground text-xs">As it will print</span>
        <span className="font-medium">{label}</span>
        <span className={directions ? "" : "text-muted-foreground"}>
          {directions ?? "Directions appear once amount, form, route, times a day and days are filled in."}
        </span>
      </div>

      <p className="text-muted-foreground text-xs">
        The calculator is an aid only. Dose selection and the final amount remain the attending veterinarian&apos;s decision.
      </p>
    </div>
  );
}

function ItemFields({
  medications,
  defaults,
  weightGrams,
  errors,
}: {
  medications: MedicationOption[];
  defaults?: Partial<PrescriptionItem>;
  weightGrams: number | null;
  errors?: Record<string, string[] | undefined>;
}) {
  const [medicationId, setMedicationId] = useState(defaults?.medicationId ?? "");
  const [drugName, setDrugName] = useState(defaults?.drugName ?? "");
  const [genericName, setGenericName] = useState(defaults?.genericName ?? "");
  const [strength, setStrength] = useState(defaults?.strength ?? "");
  const [formulation, setFormulation] = useState(defaults?.formulation ?? "");

  function pickMedication(id: string) {
    setMedicationId(id);
    const medication = medications.find((candidate) => candidate.id === id);
    if (medication) {
      setDrugName(medication.name);
      setGenericName(medication.genericName ?? "");
      setStrength(medication.commonStrength ?? "");
      setFormulation(medication.formulation ?? "");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="From catalog (optional)"
          name="medicationId"
          options={[{ value: "", label: "Type a drug name instead" }, ...medications.map((m) => ({ value: m.id, label: m.name }))]}
          value={medicationId}
          onValueChange={pickMedication}
        />
        <Field
          label="Drug name"
          name="drugName"
          value={drugName}
          onChange={(event) => setDrugName(event.target.value)}
          hint="As dispensed"
          errors={errors?.drugName}
        />
        <Field
          label="Generic name"
          name="genericName"
          value={genericName}
          onChange={(event) => setGenericName(event.target.value)}
          hint="Printed on the prescription"
          errors={errors?.genericName}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Strength (as labelled, optional)"
          name="strength"
          value={strength}
          onChange={(event) => setStrength(event.target.value)}
          errors={errors?.strength}
        />
        <Field
          label="Formulation (optional)"
          name="formulation"
          value={formulation}
          onChange={(event) => setFormulation(event.target.value)}
          placeholder="Oral suspension, film-coated tablet…"
          errors={errors?.formulation}
        />
      </div>

      <DosingFields defaults={defaults} weightGrams={weightGrams} errors={errors} names={{ drugName, genericName }} />

      <TextAreaField
        label="Additional instructions (optional)"
        name="instructions"
        rows={2}
        defaultValue={defaults?.instructions ?? ""}
        hint="For example: with food, shake well."
        errors={errors?.instructions}
      />
    </div>
  );
}

function AddItemForm({
  prescriptionId,
  appointmentId,
  petId,
  medications,
  weightGrams,
}: Pick<Props, "prescriptionId" | "appointmentId" | "petId" | "medications" | "weightGrams">) {
  const [state, formAction] = useActionState(addPrescriptionItemAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-4 border-t pt-4">
      <FormAlert state={state} />
      <input type="hidden" name="prescriptionId" value={prescriptionId} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="petId" value={petId} />
      <ItemFields medications={medications} weightGrams={weightGrams} errors={fieldErrors} />
      <div>
        <SubmitButton pendingLabel="Adding…">Add medication</SubmitButton>
      </div>
    </form>
  );
}

/** How one saved item reads in the list — label, dose, directions. Shared with the read-only detail view. */
export function PrescriptionItemSummary({ item }: { item: PrescriptionItem }) {
  const directions = prescriptionDirections(item);
  const dose =
    item.computedDose != null
      ? `${item.computedDose} ${item.doseUnit ?? ""}`.trim()
      : item.dosePerKg != null
        ? `${item.dosePerKg} ${item.doseUnit ?? ""}/kg`
        : null;

  return (
    <div className="grid gap-0.5">
      <span className="font-medium">{prescriptionItemLabel(item)}</span>
      {item.genericName && item.genericName !== item.drugName ? (
        <span className="text-muted-foreground text-xs">Dispensed as {item.drugName}</span>
      ) : null}
      {directions ? (
        <span className="text-sm">{directions}</span>
      ) : (
        <span className="text-muted-foreground text-xs" data-numeric>
          {[dose ?? "No dose recorded", item.route, item.frequency, item.duration].filter(Boolean).join(" · ")}
        </span>
      )}
      {directions && dose ? (
        <span className="text-muted-foreground text-xs" data-numeric>
          {dose} per dose{item.dosePerKg != null ? ` (${item.dosePerKg} ${item.doseUnit ?? ""}/kg)` : ""}
          {item.quantity ? ` · Quantity ${item.quantity}` : ""}
        </span>
      ) : null}
      {item.instructions ? <span className="text-muted-foreground text-xs">{item.instructions}</span> : null}
    </div>
  );
}

function ItemRow({
  item,
  appointmentId,
  petId,
  medications,
  weightGrams,
  canEdit,
}: {
  item: PrescriptionItem;
  appointmentId: string;
  petId: string;
  medications: MedicationOption[];
  weightGrams: number | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction] = useActionState(updatePrescriptionItemAction, idleState);
  const [, removeAction] = useActionState(removePrescriptionItemAction, idleState);
  const fieldErrors = updateState.status === "error" ? updateState.fieldErrors : undefined;
  const incomplete = prescriptionDirections(item) === null;

  if (!editing) {
    return (
      <li className="grid gap-1 rounded-lg border p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <PrescriptionItemSummary item={item} />
          {canEdit ? (
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <form action={removeAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="appointmentId" value={appointmentId} />
                <input type="hidden" name="petId" value={petId} />
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </div>
          ) : null}
        </div>
        {canEdit && incomplete ? (
          <p className="text-destructive text-xs">Directions incomplete — edit this item before finalizing.</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rounded-lg border p-3">
      <form action={updateAction} className="grid gap-4">
        <FormAlert state={updateState} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <input type="hidden" name="petId" value={petId} />
        <ItemFields medications={medications} defaults={item} weightGrams={weightGrams} errors={fieldErrors} />
        <div className="flex gap-2">
          <SubmitButton pendingLabel="Saving…">Save item</SubmitButton>
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
      </form>
    </li>
  );
}

export function PrescriptionItemList({
  prescriptionId,
  appointmentId,
  petId,
  items,
  medications,
  weightGrams,
  weightSaved,
  canEdit,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Medications</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {canEdit ? (
          <WeightForm
            prescriptionId={prescriptionId}
            appointmentId={appointmentId}
            petId={petId}
            weightGrams={weightGrams}
            weightSaved={weightSaved}
          />
        ) : null}

        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No medications added yet.</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                appointmentId={appointmentId}
                petId={petId}
                medications={medications}
                weightGrams={weightGrams}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}

        {canEdit ? (
          <AddItemForm
            prescriptionId={prescriptionId}
            appointmentId={appointmentId}
            petId={petId}
            medications={medications}
            weightGrams={weightGrams}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
